'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getMemoEl } = require('./dom-stub.js');
require('../game.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const { State, Render, Survival, Bosses, Adventure, Game, Settings, Toasts, Feedback, Sound } = globalThis.window.__cv;
const q = (selector) => getMemoEl('q:' + selector);

test('HUD: hay un unico centro de eventos estatico y reutilizable', () => {
  assert.equal((html.match(/id="hud-event-center"/g) || []).length, 1,
    'el centro de eventos debe declararse una sola vez en el HTML');
  assert.equal((html.match(/id="toasts"/g) || []).length, 1,
    'todos los avisos deben compartir un unico host');

  const dockAt = html.indexOf('id="hud-event-dock"');
  const centerAt = html.indexOf('id="hud-event-center"');
  const boardAt = html.indexOf('id="board"');
  assert.ok(dockAt >= 0 && centerAt > dockAt && centerAt < boardAt,
    'el centro de eventos debe vivir en el HUD superior, antes del tablero');

  const renderEvent = Toasts._render.toString();
  assert.match(renderEvent, /#hud-event-center/);
  assert.doesNotMatch(renderEvent, /createElement|appendChild|\.append\(/,
    'mostrar un evento debe actualizar el nodo fijo, no crear overlays nuevos');
});

test('HUD: intro, jefe, rango y combo no crean texto informativo sobre el tablero', () => {
  for (const id of ['combo', 'rank', 'boss-card', 'surv-intro']) {
    assert.doesNotMatch(html, new RegExp(`id=["']${id}["']`),
      `el overlay #${id} no debe existir en la jerarquia del tablero`);
  }

  assert.match(Render.bossCard.toString(), /Toasts\.event/,
    'la entrada del jefe debe pasar por el centro de eventos');
  assert.doesNotMatch(Render.bossCard.toString(), /createElement|appendChild|board-wrap/);
  assert.match(Render.rankFlash.toString(), /scoreFeedback/,
    'el rango debe celebrarse junto a la puntuacion');
  assert.doesNotMatch(Render.rankFlash.toString(), /board-wrap|popupsEl|appendChild/);

  const intro = Survival.intro.toString();
  assert.match(intro, /Toasts\.event/,
    'la introduccion de Supervivencia debe usar el mismo centro de eventos');
  assert.doesNotMatch(intro, /surv-intro|board-wrap|createElement|appendChild|innerHTML/,
    'la introduccion no debe volver a montar una tarjeta sobre el tablero');
  assert.doesNotMatch(source, /getElementById\(['"]surv-intro['"]\)/,
    'no debe quedar un productor oculto del overlay de introduccion anterior');

  assert.doesNotMatch(html, /id=["']chapter-intro["']/,
    'la introduccion pasiva de Aventura tampoco debe cubrir el tablero');
  const chapterIntro = Adventure.maybeChapterIntro.toString();
  assert.match(chapterIntro, /Toasts\.event/);
  assert.doesNotMatch(chapterIntro, /chapter-intro|State\.status\s*=\s*['"]paused|addEventListener/,
    'el cambio de capitulo debe informarse en el HUD sin pausar ni montar un overlay');
});

test('HUD: el feedback de puntuacion usa un pool fijo fuera del tablero', () => {
  const prev = {
    size: State.size,
    boardEl: Render.boardEl,
    cells: Render.cells,
    glyphs: Render.glyphs,
    popupsEl: Render.popupsEl,
    popupPool: Render.popupPool,
    convergeLayer: Render.convergeLayer,
    scoreFeedbackEl: Render.scoreFeedbackEl,
    scoreFeedbackPool: Render.scoreFeedbackPool,
    scoreFeedbackNext: Render.scoreFeedbackNext,
    reducedFx: Settings.reducedFx,
  };
  const board = q('#board');
  const spatialHost = q('#popups');
  const scoreHost = q('#score-feedback');
  board.replaceChildren();
  spatialHost.replaceChildren();
  scoreHost.replaceChildren();
  Render.popupPool = [];
  Render.scoreFeedbackPool = [];
  Render.scoreFeedbackNext = 0;
  State.size = 4;
  Settings.reducedFx = false;

  try {
    Render.buildBoard();
    assert.equal(Render.popupPool.length, 0,
      'no debe reservarse un pool de mensajes por casilla');
    assert.equal(spatialHost.children.length, 1,
      'el host espacial solo conserva la capa tecnica de convergencia');
    assert.equal(spatialHost.children[0].className, 'converge-layer');
    assert.equal(Render.scoreFeedbackPool.length, 5,
      'el feedback inmediato debe tener un limite fijo de cinco nodos');
    assert.equal(scoreHost.children.length, 5);

    for (let i = 0; i < 18; i++) Render.popup(i, `+${i + 1}`, '#fff');
    assert.equal(Render.scoreFeedbackPool.length, 5,
      'una racha larga debe reciclar el pool sin crecer el DOM');
    assert.equal(scoreHost.children.length, 5);
    assert.equal(spatialHost.children.length, 1,
      'ningun popup de texto debe volver al tablero');
    assert.ok(Render.scoreFeedbackPool.some((el) => /^\+\d+$/.test(el.textContent)),
      'los puntos deben terminar en el feedback del marcador');
  } finally {
    State.size = prev.size;
    Render.boardEl = prev.boardEl;
    Render.cells = prev.cells;
    Render.glyphs = prev.glyphs;
    Render.popupsEl = prev.popupsEl;
    Render.popupPool = prev.popupPool;
    Render.convergeLayer = prev.convergeLayer;
    Render.scoreFeedbackEl = prev.scoreFeedbackEl;
    Render.scoreFeedbackPool = prev.scoreFeedbackPool;
    Render.scoreFeedbackNext = prev.scoreFeedbackNext;
    Settings.reducedFx = prev.reducedFx;
  }
});

test('HUD: la cola prioriza, interrumpe, pausa y se reinicia sin duplicar tarjetas', async () => {
  const prev = { mode: State.mode, status: State.status, reducedFx: Settings.reducedFx };
  const card = q('#hud-event-center');
  State.mode = 'clasico';
  State.status = 'playing';
  Settings.reducedFx = true;
  Toasts.reset();

  try {
    assert.equal(Toasts.show({ key: 'low', title: 'Aviso menor', priority: 20, ms: 5000 }), true);
    assert.equal(Toasts._evActive.key, 'low');
    assert.equal(card.hidden, false);
    assert.equal(document.body.classList.contains('hud-event-active'), true,
      'el estado permanente debe ceder su mismo hueco mientras hay un evento');

    assert.equal(Toasts.event({ key: 'boss', title: 'Jefe', priority: 100, ms: 5000 }), true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(Toasts._evActive.key, 'boss',
      'un evento critico debe interrumpir al aviso de prioridad menor');
    assert.strictEqual(q('#hud-event-center'), card,
      'la preempcion debe reutilizar exactamente la misma tarjeta');

    const bossActive = Toasts._evActive;
    const bossTimer = Toasts._timer;
    const bossStarted = bossActive.startedAt;
    const bossRemaining = bossActive.remaining;
    assert.equal(Toasts.event({ key: 'boss', title: 'Jefe repetido', priority: 100, ms: 9000 }), false,
      'la misma clave activa debe rechazarse como el mismo evento semantico');
    assert.strictEqual(Toasts._evActive, bossActive);
    assert.equal(Toasts._timer, bossTimer, 'el duplicado no debe reiniciar el reloj visible');
    assert.equal(bossActive.startedAt, bossStarted);
    assert.equal(bossActive.remaining, bossRemaining);
    assert.equal(bossActive.count, 1);

    Toasts.event({ key: 'wave', title: 'Oleada', priority: 80, ms: 5000 });
    Toasts.show({ key: 'reward', title: 'Recompensa', priority: 50, ms: 5000 });
    assert.deepEqual(Toasts._evQ.map((item) => item.key), ['wave', 'reward'],
      'los eventos pendientes deben quedar ordenados por prioridad');
    const queuedWave = Toasts._evQ.find((item) => item.key === 'wave');
    const waveExpiry = queuedWave.expiresAt;
    assert.equal(Toasts.event({ key: 'wave', title: 'Oleada otra vez', priority: 99, ms: 9000, expiresAt: Date.now() + 20000 }), false);
    assert.equal(Toasts._evQ.filter((item) => item.key === 'wave').length, 1);
    assert.equal(queuedWave.expiresAt, waveExpiry, 'el duplicado en cola no debe prolongar su vigencia');

    const active = Toasts._evActive;
    Toasts.pause();
    assert.equal(Toasts._paused, true);
    assert.equal(Toasts._timer, 0, 'pausar debe detener el reloj del mensaje activo');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.strictEqual(Toasts._evActive, active,
      'el evento visible no debe caducar mientras la partida esta pausada');

    Toasts.resume();
    assert.equal(Toasts._paused, false);
    assert.notEqual(Toasts._timer, 0, 'reanudar debe continuar el tiempo restante');

    Toasts.reset();
    assert.equal(Toasts._evActive, null);
    assert.deepEqual(Toasts._evQ, []);
    assert.equal(Toasts._paused, false);
    assert.equal(card.hidden, true);
    assert.equal(document.body.classList.contains('hud-event-active'), false);
  } finally {
    Toasts.reset();
    State.mode = prev.mode;
    State.status = prev.status;
    Settings.reducedFx = prev.reducedFx;
  }
});

test('HUD: el narrador y el feedback se emiten una vez por instancia de evento', () => {
  const prev = { mode: State.mode, status: State.status, enc: Bosses.enc, danger: Sound.danger, reducedFx: Settings.reducedFx };
  State.mode = 'supervivencia';
  State.status = 'playing';
  Settings.reducedFx = true;
  Toasts.reset();

  try {
    const firstBoss = { id: 'void', kind: 'boss', resolved: false };
    Bosses.enc = firstBoss;
    assert.equal(Toasts._idleItem().key, 'idle-boss-narrator-void');
    assert.equal(Toasts._idleItem(), null,
      'el mismo encuentro no debe volver a producir su frase de narrador');
    Bosses.enc = { id: 'void', kind: 'boss', resolved: false };
    assert.equal(Toasts._idleItem().key, 'idle-boss-narrator-void',
      'una nueva instancia del mismo jefe si puede narrarse una vez');
    Bosses.enc = null;
    assert.equal(Toasts._idleItem(), null,
      'sin encuentro de jefe activo _idleItem no debe generar notificaciones en bucle');

    let sounds = 0;
    Sound.danger = () => { sounds++; };
    Toasts.reset();
    State.mode = 'clasico';
    assert.equal(Feedback.event('waveSoon', { key: 'one-shot', title: 'Atencion', ms: 5000 }), true);
    assert.equal(Feedback.event('waveSoon', { key: 'one-shot', title: 'Atencion', ms: 5000 }), false);
    assert.equal(sounds, 1, 'rechazar el aviso duplicado tambien debe silenciar audio y haptica repetidos');
  } finally {
    Toasts.reset();
    State.mode = prev.mode;
    State.status = prev.status;
    Bosses.enc = prev.enc;
    Sound.danger = prev.danger;
    Settings.reducedFx = prev.reducedFx;
  }
});

test('HUD: todos los modos comparten layout protegido y contenedores visuales del menu', () => {
  assert.match(css, /\.screen-game\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;/,
    'la cabecera debe medir su contenido y dejar al tablero solo el espacio restante');
  assert.match(css, /\.board-area\s*\{[\s\S]*?container-type:\s*size;/);
  assert.match(css, /\.board-column\s*\{[\s\S]*?100cqh/,
    'el lado del tablero debe depender de la altura disponible en todos los modos');
  assert.doesNotMatch(css, /body\.mode-zen[^{}]*\.hud-wallet[^{}]*display:\s*none/,
    'Zen debe conservar los recursos prioritarios');
  assert.doesNotMatch(css, /body\.mode-zen[^{}]*\.occ[^{}]*display:\s*none/,
    'Zen debe conservar la barra contextual con tono sereno');

  assert.match(css, /--hud-surface-top:/);
  assert.match(css, /--hud-lip:/);
  assert.match(css, /\.score-row\s*\{[\s\S]*?border:\s*2px solid[\s\S]*?0 4px 0/,
    'el marcador debe ser una tarjeta elevada, no texto flotante');
  assert.match(css, /\.surv-bar\s*\{[\s\S]*?border:\s*2px solid var\(--hud-border\)/);
  assert.match(css, /\.context-bar\s*\{[\s\S]*?border:\s*2px solid/);
  assert.match(css, /\.booster-bar\s*\{[\s\S]*?border:\s*2px solid var\(--hud-border\)/);
  assert.match(css, /grid-template-areas:\s*"mode-slot" "score-slot"/,
    'fuera de Supervivencia, estado y eventos deben reutilizar el mismo zocalo');
  assert.match(css, /body\.hud-event-active:not\(\.mode-surv\):not\(\.mode-tutorial\) \.obj-banner\s*\{\s*visibility:\s*hidden;/,
    'el estado permanente no debe transparentarse por debajo de un aviso activo');

  const contextAt = html.indexOf('id="hud-context-bar"');
  const hintAt = html.indexOf('id="btn-hint"');
  const contextEnd = html.indexOf('</div>', hintAt);
  assert.ok(contextAt >= 0 && hintAt > contextAt && contextEnd > hintAt,
    'la pista debe vivir dentro de la barra contextual para no flotar sobre el tablero');
  assert.equal((html.match(/id="btn-hint"/g) || []).length, 1);

  const coachAt = html.indexOf('id="coach"');
  const boosterAt = html.indexOf('id="booster-bar"');
  assert.ok(coachAt > html.indexOf('id="board"') && coachAt < boosterAt,
    'la guia del tutorial debe ser una fila del HUD situada despues del tablero');
  assert.match(css, /\.coach\s*\{[\s\S]*?position:\s*relative;[\s\S]*?grid-row:\s*3;/);
  assert.doesNotMatch(css, /\.coach\s*\{[^}]*position:\s*fixed;/,
    'la guia no debe volver a ser un overlay fijo sobre las casillas');
  assert.match(css, /body:not\(\[data-screen="start"\]\) \.update-banner\s*\{\s*display:\s*none !important;/,
    'un aviso PWA creado en el menu tampoco debe perseguir la partida y tapar el HUD');
});

test('HUD: Supervivencia integra un unico marcador en el pie del bloque de estado', () => {
  for (const id of [
    'surv-footer', 'hud-score-slot', 'hud-score-row',
    'hud-score', 'hud-mult', 'power-rings', 'pr-frenzy',
  ]) {
    assert.equal((html.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length, 1,
      `#${id} debe existir una sola vez`);
  }

  const barAt = html.indexOf('id="surv-bar"');
  const footerAt = html.indexOf('id="surv-footer"');
  const eventAt = html.indexOf('id="hud-event-dock"');
  const normalSlotAt = html.indexOf('id="hud-score-slot"');
  const rowAt = html.indexOf('id="hud-score-row"');
  assert.ok(barAt < footerAt && footerAt < eventAt,
    'el pie directo del marcador debe pertenecer a #surv-bar');
  assert.ok(eventAt < normalSlotAt && normalSlotAt < rowAt,
    'el mismo marcador debe comenzar en su slot normal para los demas modos');
  assert.doesNotMatch(html, /id=["']surv-(?:build|score-slot)["']/,
    'el pie no debe conservar subcontenedores ni el marcador semanal durante la partida');
  assert.doesNotMatch(Survival.render.toString(), /#surv-build|sb-chip/,
    'Supervivencia no debe volver a producir chips de semana o build en el HUD');

  const mount = Render.mountScoreRow.toString();
  assert.match(mount, /#hud-score-row/);
  assert.match(mount, /#hud-score-slot/);
  assert.match(mount, /#surv-footer/);
  assert.match(mount, /appendChild/);
  assert.match(mount, /normalSlot\.hidden/);
  assert.doesNotMatch(mount, /cloneNode|createElement|innerHTML/,
    'el montaje debe mover el nodo real, nunca duplicar sus datos o listeners');

  const row = q('#hud-score-row');
  const normalSlot = q('#hud-score-slot');
  const survivalFooter = q('#surv-footer');
  normalSlot.appendChild(row);
  Render.mountScoreRow(true);
  assert.strictEqual(row.parentNode, survivalFooter);
  assert.equal(normalSlot.hidden, true);
  Render.mountScoreRow(false);
  assert.strictEqual(row.parentNode, normalSlot);
  assert.equal(normalSlot.hidden, false);

  const start = Game.start.toString();
  const modeAt = start.indexOf('const isSurv');
  const mountAt = start.indexOf('Render.mountScoreRow(isSurv)');
  const setupAt = start.indexOf('this.setupLevel()');
  assert.ok(modeAt >= 0 && modeAt < mountAt);
  assert.ok(mountAt < setupAt,
    'el marcador debe montarse antes del primer Render.hud del nivel');
  assert.match(Game.setupLevel.toString(), /Render\.hud\(\)/);

  assert.match(css, /\.surv-footer\s*\{[^}]*display:\s*block;[^}]*border-top:/);
  assert.match(css, /body\.mode-surv \.surv-footer > \.score-row\s*\{[^}]*border:\s*0;[^}]*background:\s*none;[^}]*box-shadow:\s*none;/,
    'la fila compartida debe apoyarse directamente sobre el contenedor principal');
  assert.match(css, /body\.mode-surv \.surv-footer \.gscore\s*\{[^}]*background:\s*none;[^}]*box-shadow:\s*none;/,
    'la puntuacion no debe conservar un subcontenedor visual');
  assert.match(css, /body\.mode-surv \.score-side\s*\{[^}]*grid-column:\s*3;/);
  assert.match(css, /body\.mode-surv \.gscore\s*\{[^}]*grid-column:\s*2;/);
  assert.match(css, /body\.mode-surv \.surv-footer > \.score-row \.power-rings\s*\{[^}]*width:\s*32px;/);
  assert.match(Survival.render.toString(), /#pr-frenzy/);
  assert.match(Survival.render.toString(), /#power-rings/);

  const scoreAt = html.indexOf('id="hud-score"');
  const multAt = html.indexOf('id="hud-mult"');
  assert.ok(scoreAt < multAt, 'el multiplicador debe ir despues y a la derecha de la puntuacion');
  const multRule = [...css.matchAll(/(?:^|\r?\n)\.mult-chip\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .find((body) => /position:\s*absolute;/.test(body));
  assert.ok(multRule, 'debe existir el estilo posicionado del multiplicador');
  assert.match(multRule, /left:\s*calc\(100% \+ \.36rem\);/);
  assert.match(multRule, /border:\s*0;/);
  assert.match(multRule, /background:\s*none;/);
  assert.doesNotMatch(css, /body\.mode-surv \.mult-chip\s*\{/,
    'Supervivencia no debe convertir de nuevo el multiplicador en un circulo independiente');
});

test('HUD: la barra contextual reutiliza el mismo modulo segun el estado', () => {
  const prev = {
    mode: State.mode,
    status: State.status,
    enc: Bosses.enc,
    waveAcc: Survival.waveAcc,
    waveMs: Survival.WAVE_MS,
    x2Until: Survival.x2Until,
    freezeUntil: Survival.freezeUntil,
    frenzyUntil: Survival.frenzyUntil,
    sig: Render._contextSig,
    timePressure: State.timePressure,
    timeLeft: State.timeLeft,
  };
  const bar = q('#hud-context-bar');
  const value = q('#occ-percent');
  const fill = q('#hud-progress-fill');

  try {
    State.mode = 'supervivencia';
    State.status = 'playing';
    Bosses.enc = null;
    Survival.WAVE_MS = 1000;
    Survival.waveAcc = 0;
    Survival.x2Until = 0;
    Survival.freezeUntil = 0;
    Survival.frenzyUntil = 0;
    Render._contextSig = '';

    Render.contextBar(67, 1);
    assert.equal(bar.dataset.context, 'danger');
    assert.equal(value.textContent, '67%');
    assert.equal(fill.style.width, '67.0%');

    Survival.waveAcc = 900;
    Render._contextSig = '';
    Render.contextBar(20, 0);
    assert.equal(bar.dataset.context, 'wave',
      'al acercarse la siguiente oleada la misma barra debe cambiar de contexto');
    assert.ok(fill.classList.contains('context-wave'));
    assert.notEqual(value.textContent, '20%');

    State.mode = 'zen';
    Render._contextSig = '';
    Render.contextBar(42, 0);
    assert.equal(bar.dataset.context, 'zen');
    assert.ok(fill.classList.contains('context-zen'),
      'Zen debe mostrar el mismo modulo con lenguaje sereno, no ocultarlo');

    State.mode = 'contrarreloj';
    State.timePressure = 1;
    State.timeLeft = 17;
    Render._contextSig = '';
    Render.contextBar(42, 0);
    assert.equal(bar.dataset.context, 'time');
    assert.ok(fill.classList.contains('context-time'),
      'los modos cronometrados deben poder convertir la barra en cuenta atras');
  } finally {
    State.mode = prev.mode;
    State.status = prev.status;
    Bosses.enc = prev.enc;
    Survival.waveAcc = prev.waveAcc;
    Survival.WAVE_MS = prev.waveMs;
    Survival.x2Until = prev.x2Until;
    Survival.freezeUntil = prev.freezeUntil;
    Survival.frenzyUntil = prev.frenzyUntil;
    Render._contextSig = prev.sig;
    State.timePressure = prev.timePressure;
    State.timeLeft = prev.timeLeft;
  }
});

test('HUD: la version de JS, CSS y service worker permanece sincronizada', () => {
  const gameVersion = source.match(/const VERSION = ['"]([^'"]+)['"]/);
  assert.ok(gameVersion, 'game.js debe declarar VERSION');
  const version = gameVersion[1];

  const htmlVersions = [...html.matchAll(/(?:styles\.css|game\.js)\?v=([^"']+)/g)].map((m) => m[1]);
  assert.equal(htmlVersions.length, 2);
  assert.ok(htmlVersions.every((v) => v === version),
    'index.html debe apuntar a la misma version de CSS y JS');

  const cacheVersion = sw.match(/const CACHE = ['"]cv-cache-v([^'"]+)['"]/);
  assert.ok(cacheVersion);
  assert.equal(cacheVersion[1], version, 'la cache shell debe cambiar con el HUD');
  const swVersions = [...sw.matchAll(/(?:styles\.css|game\.js)\?v=([^'",\s]+)/g)].map((m) => m[1]);
  assert.equal(swVersions.length, 2);
  assert.ok(swVersions.every((v) => v === version),
    'el precache debe pedir los mismos assets versionados que index.html');
});
