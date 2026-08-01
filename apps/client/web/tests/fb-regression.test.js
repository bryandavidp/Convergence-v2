'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeEl, getMemoEl } = require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { FX, State, Render, Bosses, Config, I18n, Settings, Adventure, Meta, ModeSignals, Game, Toasts, Boards, Themes, PlayerIcons, PlayerBorders } = cv;
const root = path.join(__dirname, '..');

function withRandomSequence(seq, fn) {
  const prev = Math.random;
  let idx = 0;
  Math.random = () => seq[Math.min(idx++, seq.length - 1)];
  try { return fn(); }
  finally { Math.random = prev; }
}

function snapshotEconomy() {
  const m = Meta.state;
  return {
    coins: m.coins,
    gems: m.gems,
    tickets: m.tickets,
    chests: m.chests,
    boards: JSON.parse(JSON.stringify(m.boards)),
    cosmetics: JSON.parse(JSON.stringify(m.cosmetics)),
  };
}

function restoreEconomy(snap) {
  const m = Meta.state;
  m.coins = snap.coins;
  m.gems = snap.gems;
  m.tickets = snap.tickets;
  m.chests = snap.chests;
  m.boards = snap.boards;
  m.cosmetics = snap.cosmetics;
}

test('FB-5: Picker y PreLevel son capas globales, no hijas de screen-game', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const gameStart = html.indexOf('id="screen-game"');
  const gameEnd = html.indexOf('</section>', gameStart);
  const picker = html.indexOf('id="pick-overlay"');
  const prelevel = html.indexOf('id="prelevel"');
  const mainEnd = html.indexOf('</main>');

  assert.ok(gameStart >= 0, 'screen-game debe existir');
  assert.ok(gameEnd > gameStart, 'screen-game debe cerrarse');
  assert.ok(picker > gameEnd, 'pick-overlay debe quedar fuera de screen-game');
  assert.ok(prelevel > gameEnd, 'prelevel debe quedar fuera de screen-game');
  assert.ok(picker < mainEnd, 'pick-overlay debe seguir dentro de main');
  assert.ok(prelevel < mainEnd, 'prelevel debe seguir dentro de main');
});

test('FB-3: Modal.open resetea scroll y enfoca el CTA del footer sin desplazar', () => {
  const body = getMemoEl('q:.modal-body');
  const footerCta = getMemoEl('q:.modal-actions button:not([disabled])');
  body.scrollTop = 240;
  document.activeElement = null;

  cv.Modal.open('modal-over');

  assert.equal(body.scrollTop, 0, 'el body scrolleable del modal debe abrir arriba');
  assert.equal(document.activeElement, footerCta, 'el foco debe preferir el CTA del footer');
  assert.deepEqual(footerCta._lastFocusOptions, { preventScroll: true });
});

function resetFxPool() {
  FX.pool = Array.from({ length: FX.POOL }, () => ({ el: makeEl('span'), anim: null, busy: false }));
  FX.idx = 0;
  FX.active = 0;
  FX.supported = true;
  FX.wave = makeEl('span');
  FX.convergeHost = makeEl('div');
  FX.convergeGroups = Array.from({ length: FX.CONVERGE_GROUPS }, () => ({
    tiles: Array.from({ length: FX.MAX_CONVERGE_ICONS }, () => {
      const el = makeEl('span'), glyph = makeEl('span');
      el.appendChild(glyph); return { el, glyph, anim: null };
    }),
    trails: Array.from({ length: FX.MAX_CONVERGE_ICONS }, () => ({ el: makeEl('span'), anim: null })),
    particles: Array.from({ length: FX.BURST_PARTICLES }, () => ({ el: makeEl('span'), anim: null })),
    wave: makeEl('span'),
  }));
  FX.convergeGroupIdx = 0;
}

test('FX: la convergencia mueve una ficha por icono y explota una vez en el centro', () => {
  const cells = [24, 30, 3, 59];
  const prev = {
    size: State.size, combo: State.combo, board: State.board,
    cells: Render.cells, cellId: Render._cellId, reducedFx: Settings.reducedFx, cap: FX.cap,
    gridMetrics: FX._gridMetrics, nextGroup: FX._nextConvergeGroup,
    flyTile: FX._flyTile, tracePath: FX._tracePath, iconBurst: FX._iconBurst, convergeWave: FX._convergeWave,
  };
  State.size = 8;
  State.combo = 20;
  State.board = new Array(64).fill(null);
  cells.forEach((i, k) => { State.board[i] = ['circle_red', 'square_blue', 'triangle_green', 'star_yellow'][k]; });
  Render.cells = Array.from({ length: 64 }, () => makeEl('button'));
  Render.cells.forEach((el) => el.classList.add('cell', 'has-icon'));
  Render._cellId = [...State.board];
  Settings.reducedFx = false;

  const run = (cap) => {
    resetFxPool(); FX.cap = cap;
    const group = FX.convergeGroups[0];
    const flights = [], trails = [], bursts = [], waves = [];
    FX._gridMetrics = () => ({ cellW: 40, cellH: 40, cellPx: 40, xy: (i) => ({ x: i % 8 * 45 + 20, y: (i / 8 | 0) * 45 + 20 }) });
    FX._nextConvergeGroup = () => group;
    FX._flyTile = (slot, id, source, from, to, cellW, cellH) => {
      flights.push({ slot, id, source, from, to, cellW, cellH }); return true;
    };
    FX._tracePath = (slot, from, to, cellPx, color) => {
      trails.push({ slot, from, to, cellPx, color }); return true;
    };
    FX._iconBurst = (slots, center, iconColors, comboColor, cellPx) => {
      bursts.push({ slots, center, iconColors, comboColor, cellPx }); return FX.BURST_PARTICLES;
    };
    FX._convergeWave = (wave, center, cellPx, color) => { waves.push({ wave, center, cellPx, color }); return {}; };
    const result = FX.converge(27, cells, '#ffd84d');
    return { flights, trails, bursts, waves, result };
  };

  try {
    const lowCap = run(1);
    const highCap = run(50);
    const plan = ({ flights, trails, bursts, waves, result }) => ({
      flights: flights.map(({ id, from, to, cellW, cellH }) => ({ id, from, to, cellW, cellH })),
      trails: trails.map(({ from, to, cellPx, color }) => ({ from, to, cellPx, color })),
      bursts: bursts.map(({ center, iconColors, comboColor, cellPx }) => ({ center, iconColors, comboColor, cellPx })),
      waves: waves.map(({ center, cellPx, color }) => ({ center, cellPx, color })),
      result,
    });
    assert.deepEqual(plan(lowCap), plan(highCap), 'el plan magnético no debe depender del cap de partículas');
    assert.equal(lowCap.flights.length, cells.length);
    assert.equal(lowCap.trails.length, cells.length);
    assert.equal(lowCap.bursts.length, 1);
    assert.equal(lowCap.waves.length, 1);
    assert.equal(lowCap.result.flights, cells.length);
    assert.equal(lowCap.result.trails, cells.length);
    assert.equal(lowCap.result.particles, FX.BURST_PARTICLES);
    assert.equal(lowCap.result.wave, true);
    assert.ok(lowCap.flights.every(({ to, cellW, cellH }) =>
      to.x === lowCap.waves[0].center.x && to.y === lowCap.waves[0].center.y && cellW === 40 && cellH === 40),
    'todas las fichas completas deben terminar en el mismo punto de convergencia');
    assert.ok(lowCap.flights.every(({ source }, k) => source === Render.cells[cells[k]]),
      'el vuelo debe copiar la casilla cuadrada original, no solo el glifo');
    assert.deepEqual(lowCap.flights.map(({ id }) => id), cells.map((i) => State.board[i]),
      'cada clon debe conservar el arte exacto del icono original');
    assert.deepEqual(lowCap.bursts[0].center, lowCap.waves[0].center,
      'explosión y onda deben nacer exactamente donde colapsan las fichas');
    assert.equal(FX.active, 0, 'la convergencia no debe consumir el pool de partículas');
  } finally {
    State.size = prev.size; State.combo = prev.combo; State.board = prev.board;
    Render.cells = prev.cells; Render._cellId = prev.cellId;
    Settings.reducedFx = prev.reducedFx; FX.cap = prev.cap;
    FX._gridMetrics = prev.gridMetrics; FX._nextConvergeGroup = prev.nextGroup;
    FX._flyTile = prev.flyTile; FX._tracePath = prev.tracePath;
    FX._iconBurst = prev.iconBurst; FX._convergeWave = prev.convergeWave;
  }
});

test('FX: la convergencia retira el glyph sin reactivar la salida CSS heredada', () => {
  const prev = {
    cells: Render.cells,
    glyphs: Render.glyphs,
    cellId: Render._cellId,
    board: State.board,
    tiles: State.tiles,
    combo: State.combo,
  };
  const convergenceCell = makeEl('button');
  const auxiliaryCell = makeEl('button');
  convergenceCell.classList.add('has-icon', 'clear', 'spawn');
  auxiliaryCell.classList.add('has-icon');
  convergenceCell.style.setProperty('--clear-snap', '.2');
  Render.cells = [convergenceCell, auxiliaryCell];
  Render.glyphs = [makeEl('span'), makeEl('span')];
  Render._cellId = ['circle_red', 'square_blue'];
  Render.glyphs[0].innerHTML = '<svg></svg>';
  Render.glyphs[1].innerHTML = '<svg></svg>';
  State.board = [null, null];
  State.tiles = [null, null];
  State.combo = 1;

  try {
    Render.clearAnim([0], 27);
    assert.equal(convergenceCell.classList.contains('clear'), false);
    assert.equal(convergenceCell.classList.contains('spawn'), false);
    assert.equal(convergenceCell.classList.contains('has-icon'), false);
    assert.equal(convergenceCell.style.getPropertyValue('--clear-snap'), '');
    assert.equal(Render._cellId[0], null);
    assert.equal(Render.glyphs[0].innerHTML, '');

    Render.clearAnim([1]);
    assert.equal(auxiliaryCell.classList.contains('clear'), true,
      'las limpiezas que no son convergencias deben conservar su salida temática');
  } finally {
    Render.cells = prev.cells;
    Render.glyphs = prev.glyphs;
    Render._cellId = prev.cellId;
    State.board = prev.board;
    State.tiles = prev.tiles;
    State.combo = prev.combo;
  }
});

test('FX: Imán y anclas no superponen un burst antiguo al vuelo magnético', () => {
  const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  assert.doesNotMatch(source, /conv\.push\(extra\);\s*FX\.burst\(/,
    'el icono atraído por Imán ya forma parte de FX.converge');
  assert.doesNotMatch(Bosses.onAnchorHit.toString(), /FX\.burst\(/,
    'un ancla convergente no debe recibir un segundo estallido');
});

test('FB-1: los emisores forzados respetan ABS_MAX', () => {
  resetFxPool();
  FX.cap = 1;
  FX.active = FX.ABS_MAX - 1;
  FX._emit(0, 0, 0, 0, 0, 0.2, 4, '#fff', 0, 0, 0, true);
  assert.equal(FX.active, FX.ABS_MAX);
  FX._emit(0, 0, 0, 0, 0, 0.2, 4, '#fff', 0, 0, 0, true);
  assert.equal(FX.active, FX.ABS_MAX, 'force no puede rebasar ABS_MAX');
});

test('FX: la estela crece hasta el centro y conserva el camino tras el impacto', () => {
  resetFxPool();
  const slot = FX.convergeGroups[0].trails[0];
  const records = [];
  slot.el.animate = (frames, options) => {
    const anim = { frames, options, onfinish: null, oncancel: null, cancel() {} };
    records.push(anim); return anim;
  };

  assert.equal(FX._tracePath(slot, { x: 20, y: 30 }, { x: 140, y: 30 }, 40, '#ff5b6e'), true);
  assert.equal(records.length, 1);
  const [{ frames, options }] = records;
  const impactOffset = FX.CONVERGE_TRAVEL_MS / (FX.CONVERGE_TRAVEL_MS + FX.CONVERGE_TRAIL_FADE_MS);
  assert.equal(options.duration, FX.CONVERGE_TRAVEL_MS + FX.CONVERGE_TRAIL_FADE_MS);
  assert.equal(options.easing, 'linear');
  assert.equal(frames.length, 8);
  assert.equal(frames[5].offset, impactOffset);
  assert.equal(frames[5].opacity, 0.94, 'el recorrido completo debe seguir visible al impactar');
  assert.ok(frames[6].offset > impactOffset, 'la estela debe permanecer después del impacto');
  assert.equal(frames.at(-1).opacity, 0);
  assert.match(frames[0].transform, /translate3d\(20\.0px,27\.9px,0\) rotate\(0\.00deg\) scaleX\(0\.015\)/);
  assert.match(frames[5].transform, /scaleX\(1\)$/);
  assert.equal(slot.el.style.width, '120.0px');
  assert.equal(slot.el.style.height, '4.2px');
  assert.equal(slot.el.style.color, '#ff5b6e');
  records[0].onfinish();
  assert.equal(slot.anim, null);
  assert.equal(slot.el.style.opacity, '0');
});

test('FX: la ficha completa conserva cuerpo/icono y usa aceleración magnética común', () => {
  resetFxPool();
  const records = [];
  const slot = FX.convergeGroups[0].tiles[0];
  const source = makeEl('button');
  source.classList.add('cell', 'has-icon', 'tile-crystal', 'spawn');
  source.dataset.tileGlyph = '+50';
  slot.el.animate = (frames, options) => {
    const anim = { frames, options, onfinish: null, oncancel: null, cancel() {} };
    records.push(anim); return anim;
  };

  assert.equal(FX._flyTile(slot, 'circle_red', source, { x: 20, y: 30 }, { x: 140, y: 170 }, 50, 46), true);
  assert.equal(records.length, 1);
  const [{ frames, options }] = records;
  assert.equal(options.duration, FX.CONVERGE_TRAVEL_MS);
  assert.equal(options.delay || 0, 0);
  assert.equal(frames.length, 6);
  assert.equal(frames[0].opacity, 1);
  assert.equal(frames.at(-1).opacity, 0);
  assert.deepEqual(frames.map(({ offset }) => offset), [0, 0.10, 0.32, 0.62, 0.84, 1]);
  assert.match(frames[0].transform, new RegExp(`translate3d\\(${(20 - 25).toFixed(1)}px,${(30 - 23).toFixed(1)}px`));
  assert.match(frames[1].transform, /translate3d\(-6\.4px,5\.3px/, 'la micro-anticipación debe retroceder sin retrasar el disparo');
  assert.match(frames[4].transform, /scale3d\(/, 'la fase rápida debe estirar la ficha en la dirección del viaje');
  assert.match(frames.at(-1).transform, new RegExp(`translate3d\\(${(140 - 25).toFixed(1)}px,${(170 - 23).toFixed(1)}px`));
  assert.equal(slot.el.style.width, '50.0px');
  assert.equal(slot.el.style.height, '46.0px');
  assert.equal(slot.el.className.includes('tile-crystal'), true);
  assert.equal(slot.el.className.includes('spawn'), false);
  assert.equal(slot.el.dataset.tileGlyph, '+50');
  assert.match(slot.glyph.innerHTML, /<svg/);
  records[0].onfinish();
  assert.equal(slot.anim, null);
  assert.equal(slot.glyph.innerHTML, '');
});

test('FX: la explosión radial anterior reaparece solo en el centro y escala con la celda', () => {
  resetFxPool();
  const comboBak = State.combo;
  const slots = FX.convergeGroups[0].particles;
  const records = [];
  slots.forEach((slot) => {
    slot.el.animate = (frames, options) => {
      const anim = { frames, options, onfinish: null, oncancel: null, cancel() {} };
      records.push({ el: slot.el, frames, options, anim }); return anim;
    };
  });

  try {
    State.combo = 1;
    withRandomSequence(Array(36).fill(0.5), () => {
      assert.equal(FX._iconBurst(slots, { x: 100, y: 120 }, ['#ff5b6e'], '#fff', 40), 12);
    });
  } finally { State.combo = comboBak; }

  assert.equal(records.length, FX.BURST_PARTICLES);
  records.forEach(({ el, frames, options }, k) => {
    assert.equal(options.delay, FX.CONVERGE_TRAVEL_MS);
    assert.equal(options.duration, 700);
    assert.equal(frames[0].opacity, 0, 'ninguna partícula debe verse durante el viaje');
    assert.equal(frames[1].opacity, 1);
    assert.equal(el.style.width, '5.2px');
    const final = frames.at(-1).transform;
    const angle = k * 30 * Math.PI / 180;
    const x = 100 - 2.6 + Math.cos(angle) * 40;
    const y = 120 - 2.6 + Math.sin(angle) * 40;
    assert.match(final, new RegExp(`translate3d\\(${x.toFixed(1)}px,${y.toFixed(1)}px`));
  });

  const low = FX._burstProfile('#ff5b6e', '#fff', 1);
  const high = FX._burstProfile('#ff5b6e', '#ffd84d', 30);
  assert.ok(high.colors.length > low.colors.length);
  assert.ok(high.distanceScale > low.distanceScale);
  assert.ok(high.sizeScale > low.sizeScale);
});

test('FX: onda y explosión empiezan exactamente cuando terminan las fichas', () => {
  resetFxPool();
  const comboBak = State.combo;
  const wave = FX.convergeGroups[0].wave;
  const records = [];
  let cancelled = 0;
  wave.getAnimations = () => [{ cancel() { cancelled++; } }];
  wave.animate = (frames, options) => { records.push({ frames, options }); return {}; };

  try {
    for (const combo of [1, 30]) {
      State.combo = combo;
      FX._convergeWave(wave, { x: 100, y: 120 }, 50, '#b46cff');
    }
  } finally { State.combo = comboBak; }

  assert.equal(records.length, 2);
  assert.equal(cancelled, 2, 'una onda nueva debe cancelar cualquier onda magnética anterior');
  records.forEach(({ frames, options }) => {
    assert.equal(options.duration, FX.CONVERGE_WAVE_MS);
    assert.equal(options.delay, FX.CONVERGE_TRAVEL_MS);
    assert.equal(frames[0].opacity, 0, 'la onda debe permanecer invisible durante el viaje');
  });
});

test('FX: la geometría local respeta gaps y escala igual en móvil, tableta y escritorio', () => {
  const board = getMemoEl('q:#board');
  const prev = {
    host: FX.convergeHost, rect: FX.boardRect, size: State.size,
    getComputedStyle: window.getComputedStyle,
  };
  const host = makeEl('div');
  FX.convergeHost = host;
  State.size = 8;
  let gap = 0;
  window.getComputedStyle = () => ({ columnGap: `${gap}px`, rowGap: `${gap}px` });

  const measure = (width, cssGap, scale) => {
    gap = cssGap;
    host.clientWidth = width + 20; host.clientHeight = width + 20;
    host.getBoundingClientRect = () => ({ left: 0, top: 0, width: (width + 20) * scale, height: (width + 20) * scale });
    FX.boardRect = { left: 10 * scale, top: 10 * scale, width: width * scale, height: width * scale };
    return FX._gridMetrics();
  };

  try {
    const mobile = measure(356, 3.9, 1);
    const mobileScaled = measure(356, 3.9, 2);
    const desktop = measure(618, 5, 1);
    assert.ok(Math.abs(mobile.cellPx - 41.0875) < 1e-9);
    assert.ok(Math.abs(desktop.cellPx - 72.875) < 1e-9);
    assert.deepEqual(mobileScaled.xy(0), mobile.xy(0), 'el scale del tablero no debe desalinear la capa local');
    assert.deepEqual(mobileScaled.xy(63), mobile.xy(63));
    assert.equal(mobileScaled.cellPx, mobile.cellPx);
    assert.equal(board != null, true);
  } finally {
    FX.convergeHost = prev.host; FX.boardRect = prev.rect; State.size = prev.size;
    if (prev.getComputedStyle === undefined) delete window.getComputedStyle;
    else window.getComputedStyle = prev.getComputedStyle;
  }
});

test('FX: reduced-fx omite fichas, estelas, explosión y onda magnética', () => {
  const prev = {
    reducedFx: Settings.reducedFx, nextGroup: FX._nextConvergeGroup,
    flyTile: FX._flyTile, tracePath: FX._tracePath,
    iconBurst: FX._iconBurst, convergeWave: FX._convergeWave,
  };
  let flights = 0, trails = 0, bursts = 0, waves = 0;
  Settings.reducedFx = true;
  FX._nextConvergeGroup = () => FX.convergeGroups[0];
  FX._flyTile = () => { flights++; return true; };
  FX._tracePath = () => { trails++; return true; };
  FX._iconBurst = () => { bursts++; return 12; };
  FX._convergeWave = () => { waves++; return {}; };
  try { FX.converge(27, [24, 30], '#fff'); }
  finally {
    Settings.reducedFx = prev.reducedFx;
    FX._nextConvergeGroup = prev.nextGroup;
    FX._flyTile = prev.flyTile;
    FX._tracePath = prev.tracePath;
    FX._iconBurst = prev.iconBurst;
    FX._convergeWave = prev.convergeWave;
  }
  assert.equal(flights, 0);
  assert.equal(trails, 0);
  assert.equal(bursts, 0);
  assert.equal(waves, 0);
});

test('FB-1: aviso reduced-fx heredado y limpieza de popup.show quedan protegidos', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const langBak = Settings.lang;
  for (const lang of ['es', 'en']) {
    Settings.lang = lang;
    assert.ok(I18n.t('rfx_system_notice') !== 'rfx_system_notice');
    assert.ok(/settings|ajustes/i.test(I18n.t('perf_light_on')));
  }
  Settings.lang = langBak;
  assert.ok(/\.converge-layer\b/.test(css), 'la coreografía debe vivir en una capa local al tablero');
  assert.ok(/\.converge-tile\b/.test(css), 'debe viajar la ficha cuadrada completa');
  assert.ok(/\.converge-trail\b/.test(css), 'cada ficha debe marcar su recorrido con una estela');
  assert.ok(/\.converge-particle\b/.test(css), 'la explosión central debe conservar partículas dedicadas');
  assert.ok(!/\.converge-fly\b/.test(css), 'el clon que movía solo el glifo no debe volver');
  assert.ok(!/\.fly-glyph\b/.test(css), 'la implementación antigua desacoplada del pool no debe volver');
  assert.ok(!/\.popup\.show/.test(css), 'la ruta muerta .popup.show no debe volver');
  assert.ok(!/popup-float-flat/.test(css), 'el override muerto de perf-2 no debe volver');
});

test('FB-6: el objetivo score de Aventura escala y muestra progreso vivo', () => {
  const prev = {
    objective: Adventure.objective,
    target: Adventure.target,
    levelScore0: Adventure.levelScore0,
    score: State.score,
    lang: Settings.lang,
  };
  Settings.lang = 'es';
  Adventure.objective = 'score';
  Adventure.target = Adventure.scoreTarget(3);
  Adventure.levelScore0 = 1200;
  State.score = 1500;

  assert.equal(Adventure.scoreTarget(3), 900, 'L3 debe requerir 900 puntos');
  assert.equal(Adventure.scoreTarget(8), 2800, 'L8 debe escalar con capítulo/nivel');
  assert.equal(Adventure.objectiveText(), 'Puntos: 300/900');
  assert.equal(Adventure.completionReason(), 'Objetivo cumplido: 900 pts');

  Adventure.objective = prev.objective;
  Adventure.target = prev.target;
  Adventure.levelScore0 = prev.levelScore0;
  State.score = prev.score;
  Settings.lang = prev.lang;
});

test('FB-4: el reto diario centraliza umbrales y actualiza siguiente medalla', () => {
  const prev = {
    score: State.score,
    isDaily: State.isDaily,
    lang: Settings.lang,
    show: Toasts.show,
    seen: Game._dailyMedalSeen,
  };
  const note = getMemoEl('q:#daily-note');
  const calls = [];
  Toasts.show = (msg, type, duration, icon) => calls.push({ msg, type, duration, icon });
  Settings.lang = 'es';
  State.isDaily = true;
  State.score = 0;
  Game._dailyMedalSeen = Object.create(null);

  try {
    assert.deepEqual(Meta.DAILY_MEDALS, [750, 1500, 2500]);
    assert.equal(Meta.dailyNextMedal(0), 750);
    assert.equal(Meta.dailyNextMedal(750), 1500);
    assert.equal(Meta.dailyNextMedal(2500), null);
    assert.match(ModeSignals.dailyNoteText(0), /750/);

    State.score = 800;
    Game.updateDailyObjective(700);

    assert.match(note.textContent, /1500/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].msg, /Bronce/);
    assert.match(calls[0].msg, /1500/);
    assert.equal(calls[0].icon, '🥉');
  } finally {
    Toasts.show = prev.show;
    Game._dailyMedalSeen = prev.seen;
    State.score = prev.score;
    State.isDaily = prev.isDaily;
    Settings.lang = prev.lang;
  }
});

test('FB-4: textos del reto diario no vuelven a usar ellipsis ni ocultar chips', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const badge = css.match(/^\.mc-badge \{[^}]+\}/m);
  assert.ok(badge, 'la regla .mc-badge debe existir');
  assert.match(badge[0], /white-space: normal/);
  assert.doesNotMatch(badge[0], /ellipsis/);
  assert.doesNotMatch(css, /\.mc-feats \{ display: none; \}/);
  assert.match(css, /\.ac-daily-state span/);
  assert.match(css, /#view-daily/);
});

test('FB-7: el drop cosmético concede no poseídos y grantTheme es idempotente', () => {
  const snap = snapshotEconomy();
  const m = Meta.state;
  try {
    m.coins = 0; m.gems = 0; m.tickets = 0; m.chests = 1;
    m.boards = { owned: { classic: 1 }, equipped: 'classic' };
    m.cosmetics = { owned: {}, theme: 'default', skin: 'default', fx: 'default' };

    // CH-4: .5 evita tier-up; 0 fija el lote de monedas garantizado; .99 fuerza
    // cosmético en la tirada principal y 0 elige el primero del pool.
    const r = withRandomSequence([.5, 0, .99, 0], () => Meta.openChest());
    assert.equal(r.kind, 'cosmetic');
    assert.equal(r.cosmeticKind, 'board');
    assert.equal(Meta.ownsBoard(r.id), true);
    assert.equal(m.boards.owned[r.id], 1);
    assert.ok(!Meta.chestCosmeticPool().some((x) => x.cosmeticKind === r.cosmeticKind && x.id === r.id));

    assert.equal(Meta.grantTheme('neon'), true);
    assert.match(m.cosmetics.owned.neon, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(Meta.grantTheme('neon'), false);
  } finally {
    restoreEconomy(snap);
  }
});

test('FB-7: pool cosmético vacío cae a gemas normales o jackpot premium', () => {
  const snap = snapshotEconomy();
  const m = Meta.state;
  try {
    m.coins = 0; m.gems = Meta.PREMIUM_CHEST_GEMS; m.tickets = 0; m.chests = 1;
    m.boards = { owned: { classic: 1 }, equipped: 'classic' };
    Boards.order.forEach((id) => { if (id !== 'classic' && !Boards.DEFS[id].exclusive) m.boards.owned[id] = 1; });
    m.cosmetics = { owned: {}, theme: 'default', skin: 'default', fx: 'default', avatarIcon: PlayerIcons.DEFAULT, avatarBorder: PlayerBorders.DEFAULT, avatarIcons: {}, avatarBorders: {} };
    Themes.order.forEach((id) => { if (id !== 'default') m.cosmetics.owned[id] = '2026-01-01'; });
    PlayerIcons.order.forEach((id) => { m.cosmetics.avatarIcons[id] = '2026-01-01'; });
    PlayerBorders.order.forEach((id) => { m.cosmetics.avatarBorders[id] = '2026-01-01'; });

    const normal = withRandomSequence([.5, 0, .99, 0], () => Meta.openChest());
    assert.deepEqual({ kind: normal.kind, amount: normal.amount, fallback: normal.fallback }, { kind: 'gems', amount: 8, fallback: 'cosmetic' });
    assert.equal(m.gems, Meta.PREMIUM_CHEST_GEMS + 8);

    const premium = withRandomSequence([0.99, 0], () => Meta.openPremiumChest());
    assert.deepEqual({ kind: premium.kind, amount: premium.amount, rarity: premium.rarity, fallback: premium.fallback }, { kind: 'coins', amount: 600, rarity: 'jackpot', fallback: 'cosmetic' });
    assert.equal(m.gems, 8);
    const allCoins = normal.items.concat(premium.items).filter((item) => item.kind === 'coins').reduce((sum, item) => sum + item.amount, 0);
    assert.equal(m.coins, allCoins, 'cada premio de la ceremonia se aplica exactamente una vez');
  } finally {
    restoreEconomy(snap);
  }
});

test('FB-7: UI de cofres conserva feedback clicable y revelado persistente', () => {
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const prevLang = Settings.lang;
  assert.doesNotMatch(js, /ob\.disabled = n <= 0/);
  assert.doesNotMatch(js, /pb\.disabled = Meta\.gems\(\) < Meta\.PREMIUM_CHEST_GEMS/);
  assert.match(js, /classList\.toggle\('is-poor'/);
  assert.match(css, /\.chest-opening-stage\.is-playing \.chest-opening-motion/);
  assert.match(css, /\.chest-opening-stage\.is-playing \.chest-opening-sprite/);
  assert.match(css, /\.chest-reveal/);
  assert.match(js, /afterChestAnimation\(motion,\s*'chestOpenMotion'/);
  assert.doesNotMatch(js, /setTimeout\(finish, reduceMotion \? 0 : 1120\)/);
  try {
    for (const lang of ['es', 'en']) {
      Settings.lang = lang;
      ['chest_reveal_title', 'chest_cosmetic_title', 'chest_continue', 'chest_equip', 'chest_reward_board', 'chest_reward_theme'].forEach((key) => {
        assert.notEqual(I18n.t(key), key);
      });
    }
  } finally {
    Settings.lang = prevLang;
  }
});

test('FB-8: navegar a una vista del hub tras game over cierra la run', () => {
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const start = js.indexOf('open(name, options = {})');
  const end = js.indexOf('home(options = {})', start);
  const openView = js.slice(start, end);

  assert.ok(start >= 0 && end > start, 'debe existir HubViews.open');
  assert.match(openView, /document\.body\.dataset\.screen === 'game' && State\.status === 'over'/);
  assert.match(openView, /State\.status = 'idle'/);
  assert.match(openView, /Screens\.show\('start'\)/);
});

test('SV-HUD: el estado de jefe no reserva filas históricas ni duplica información', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /surv-subrow|surv-best-wave/);
  assert.doesNotMatch(html, /id=["']surv-build["']/,
    'el HUD de partida no debe mostrar el marcador semanal ni una fila de build');
  assert.doesNotMatch(css, /\.surv-build|\.sb-chip/,
    'el marcador retirado no debe conservar reglas que puedan volver a reservar espacio');
});

test('FB-2: Contrarreloj tiene material inicial propio y DDA de hambre acotado', () => {
  const prev = { elapsed: State.elapsed, iconCount: State.iconCount };
  const mode = Config.MODES.contrarreloj;
  try {
    assert.equal(mode.initialIcons, 22);

    State.elapsed = 5;
    State.iconCount = 6;
    assert.equal(mode.spawnFactor(), 1, 'el DDA no debe apilarse durante el warm-up');

    State.elapsed = 12;
    State.iconCount = 10;
    assert.equal(mode.spawnFactor(), 0.65);
    State.iconCount = 16;
    assert.equal(mode.spawnFactor(), 0.85);
    State.iconCount = 24;
    assert.equal(mode.spawnFactor(), 1);
    State.iconCount = 30;
    assert.equal(mode.spawnFactor(), 1.1);
  } finally {
    State.elapsed = prev.elapsed;
    State.iconCount = prev.iconCount;
  }
});
