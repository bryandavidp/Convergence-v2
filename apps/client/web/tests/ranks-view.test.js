/* Vista de clasificación y publicación de partidas (fase 6).
 *
 * Lo que se protege aquí es la regla de degradación: la nube es OPCIONAL. Sin
 * transporte, sin red o con una partida no publicable, la vista informa y el
 * juego sigue igual. Nada de rankings puede impedir jugar ni ensuciar el fin de
 * partida, que es donde un fallo se notaría más.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game-core.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { Ranks, RunLog, State, Storage, I18n } = cv;

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function entry(displayName, score) {
  return {
    protocolVersion: 1,
    userId: `uid-${displayName}`,
    displayName,
    mode: 'contrarreloj',
    scope: 'daily',
    scopeId: '2026-08-02',
    score,
    verification: 'verified',
    updatedAt: Date.now(),
  };
}

/** Instala un transporte falso y devuelve lo que recibió. */
function withTransport(impl) {
  const calls = { pages: [], claims: [] };
  globalThis.window.ConvergenceLeaderboards = {
    async page(query) { calls.pages.push(query); return impl.page(query); },
    async submit(claim) { calls.claims.push(claim); return impl.submit(claim); },
  };
  return calls;
}

function clearTransport() { delete globalThis.window.ConvergenceLeaderboards; }

test('la vista existe en el DOM con sus contenedores y es accesible', () => {
  assert.match(html, /id="view-ranks"[^>]*data-hub-view="ranks"/);
  for (const id of ['ranks-scopes', 'ranks-status', 'ranks-list', 'ranks-viewer', 'ranks-more']) {
    assert.ok(html.includes(`id="${id}"`), `falta el contenedor #${id}`);
  }
  // El estado se anuncia a lectores de pantalla: cargar y fallar son cambios que
  // no se ven si solo se pintan.
  assert.match(html, /id="ranks-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="ranks-scopes"[^>]*role="tablist"/);
});

test('hay un punto de entrada y su accion esta cableada', () => {
  assert.match(html, /data-act="nav-ranks"/);
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  assert.match(source, /a === 'nav-ranks'/);
});

test('los cuatro periodos existen y el diario es el que abre', () => {
  assert.deepEqual(Ranks.SCOPES.map((scope) => scope.id), ['daily', 'weekly', 'season', 'all-time']);
  assert.equal(Ranks.scope, 'daily');
});

test('todas las claves de la vista estan en ES y EN', () => {
  const keys = [...new Set([...html.matchAll(/data-i18n="(ranks_[a-z_]+)"/g)].map((m) => m[1]))];
  assert.ok(keys.length > 0, 'la vista debe traducirse por data-i18n');
  const extra = [
    'ranks_loading', 'ranks_empty', 'ranks_offline', 'ranks_error', 'ranks_you',
    'ranks_your_rank', 'ranks_unranked', 'ranks_alias_title', 'ranks_alias_sub',
    'ranks_alias_invalid', 'ranks_published', 'ranks_not_improved', 'ranks_rejected',
  ];
  for (const key of [...keys, ...extra]) {
    for (const lang of ['es', 'en']) {
      const previous = cv.Settings.lang;
      cv.Settings.lang = lang;
      const value = I18n.t(key);
      cv.Settings.lang = previous;
      assert.ok(value && value !== key, `falta la clave ${key} en ${lang}`);
    }
  }
});

test('sin transporte la vista lo dice y no revienta', async () => {
  clearTransport();
  assert.equal(Ranks.available(), false);
  await Ranks.load({ reset: true });
  assert.equal(document.querySelector('#ranks-status').textContent, I18n.t('ranks_offline'));
});

test('una tabla vacia se distingue de un error', async () => {
  withTransport({
    page: async () => ({ boardId: 'contrarreloj:daily:x', entries: [], nextCursor: null, viewerRank: null }),
    submit: async () => ({}),
  });
  await Ranks.load({ reset: true });
  assert.equal(document.querySelector('#ranks-status').textContent, I18n.t('ranks_empty'));

  withTransport({
    page: async () => { throw new Error('red caida'); },
    submit: async () => ({}),
  });
  await Ranks.load({ reset: true });
  assert.equal(document.querySelector('#ranks-status').textContent, I18n.t('ranks_error'));
  clearTransport();
});

test('la pagina se pinta ordenada y el boton de paginar sigue al cursor', async () => {
  withTransport({
    page: async (query) => (query.cursor
      ? { boardId: 'b', entries: [entry('Cee', 100)], nextCursor: null, viewerRank: 3 }
      : { boardId: 'b', entries: [entry('Ada', 300), entry('Bo', 200)], nextCursor: 'CURSOR', viewerRank: 3 }),
    submit: async () => ({}),
  });

  await Ranks.load({ reset: true });
  assert.equal(document.querySelector('#ranks-more').hidden, false, 'con cursor debe poder paginarse');
  assert.equal(Ranks.entries.length, 2);

  await Ranks.load();
  assert.equal(Ranks.entries.length, 3, 'la segunda pagina se acumula, no reemplaza');
  assert.equal(document.querySelector('#ranks-more').hidden, true, 'sin cursor no se pagina mas');
  assert.equal(
    document.querySelector('#ranks-viewer').textContent,
    I18n.t('ranks_your_rank').replace('{n}', '3'),
  );
  clearTransport();
});

test('el alias se escapa: un nombre con HTML no puede inyectar markup', async () => {
  Storage.rankAlias = '';
  withTransport({
    page: async () => ({
      boardId: 'b',
      entries: [entry('<img src=x onerror=alert(1)>', 10)],
      nextCursor: null,
      viewerRank: null,
    }),
    submit: async () => ({}),
  });
  await Ranks.load({ reset: true });
  const list = document.querySelector('#ranks-list').innerHTML;
  assert.ok(!list.includes('<img src=x'), 'el alias remoto debe escaparse');
  assert.ok(list.includes('&lt;img'), 'debe quedar escapado, no eliminado');
  clearTransport();
});

test('no se publica lo que no debe publicarse', async () => {
  const calls = withTransport({
    page: async () => ({ boardId: 'b', entries: [], nextCursor: null, viewerRank: null }),
    submit: async () => ({ verification: 'verified', score: 1, claimedScore: 1, improvedBoards: ['b'], alreadyApplied: false }),
  });
  Storage.rankAlias = 'Nova';

  // Otro modo: la vertical es solo Contrarreloj.
  State.mode = 'clasico';
  RunLog.start(); RunLog.mistake();
  await Ranks.publishRun();
  assert.equal(calls.claims.length, 0, 'solo Contrarreloj publica');

  // Bitacora desbordada: la partida deja de ser verificable.
  State.mode = 'contrarreloj';
  RunLog.start();
  for (let i = 0; i < RunLog.MAX + 1; i++) RunLog.mistake();
  await Ranks.publishRun();
  assert.equal(calls.claims.length, 0, 'una bitacora desbordada no se publica');
  clearTransport();
});

test('la reclamacion lleva la version del juego y no lleva userId', async () => {
  const calls = withTransport({
    page: async () => ({ boardId: 'b', entries: [], nextCursor: null, viewerRank: null }),
    submit: async () => ({ verification: 'verified', score: 10, claimedScore: 10, improvedBoards: ['b'], alreadyApplied: false }),
  });
  Storage.rankAlias = 'Nova';
  State.mode = 'contrarreloj'; State.diff = 'normal'; State.score = 10;
  RunLog.start(); State.elapsed = 1;
  RunLog.convergence({ removed: 2, combo: 1, fever: false, level: 1, crystals: 0 });

  await Ranks.publishRun();
  assert.equal(calls.claims.length, 1);
  const [claim] = calls.claims;
  // La identidad la deriva el servidor de Auth: mandarla seria reclamar por otro.
  assert.equal('userId' in claim, false);
  assert.equal(claim.mode, 'contrarreloj');
  assert.equal(claim.claimedScore, 10);
  assert.ok(claim.gameVersion, 'sin version el backend rechaza la partida');
  assert.ok(Array.isArray(claim.events) && claim.events.length > 0);
  clearTransport();
});

test('un fallo al publicar no propaga: el fin de partida no puede romperse', async () => {
  withTransport({
    page: async () => ({ boardId: 'b', entries: [], nextCursor: null, viewerRank: null }),
    submit: async () => { throw new Error('callable caida'); },
  });
  Storage.rankAlias = 'Nova';
  State.mode = 'contrarreloj'; State.score = 5;
  RunLog.start(); State.elapsed = 1;
  RunLog.convergence({ removed: 2, combo: 1, fever: false, level: 1, crystals: 0 });

  await assert.doesNotReject(() => Ranks.publishRun());
  clearTransport();
});

test('la fila propia se distingue sin depender solo del color', () => {
  assert.match(css, /\.ranks-row\.is-me\s*\{[^}]*border-color/);
});

test('si el transporte llega tarde, la tabla se recarga sola', async () => {
  // Bug real: el bundle modular publica el transporte DESPUES de iniciar sesion.
  // Abrir la clasificacion antes dejaba "sin conexion" para siempre porque nada
  // reintentaba.
  // init() del juego no corre en Node (DOMContentLoaded nunca dispara), asi que
  // los listeners se registran a mano, igual que hace el arranque real.
  Ranks.initEvents();
  clearTransport();
  await Ranks.load({ reset: true });
  assert.equal(document.querySelector('#ranks-status').textContent, I18n.t('ranks_offline'));

  cv.HubViews.current = 'ranks';
  const calls = withTransport({
    page: async () => ({ boardId: 'b', entries: [entry('Ada', 10)], nextCursor: null, viewerRank: 1 }),
    submit: async () => ({}),
  });
  window.dispatchEvent(new CustomEvent('convergence:leaderboards-ready'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.pages.length, 1, 'el evento debe disparar una recarga');
  assert.equal(Ranks.entries.length, 1);
  clearTransport();
});

test('sin prompt disponible se publica con alias neutro, nunca con el nombre del jugador', async () => {
  const previousPrompt = window.prompt;
  delete window.prompt;
  Storage.rankAlias = '';
  try {
    const alias = await Ranks.ensureAlias();
    assert.match(alias, /^Jugador#\d{4}$/, 'debe generarse un alias neutro y editable');
    assert.equal(Storage.rankAlias, alias, 'queda guardado para poder cambiarlo');
  } finally {
    if (previousPrompt) window.prompt = previousPrompt;
    Storage.rankAlias = '';
  }
});

test('si el jugador cancela el prompt, no se publica nada', async () => {
  const previousPrompt = window.prompt;
  window.prompt = () => null;
  Storage.rankAlias = '';
  try {
    assert.equal(await Ranks.ensureAlias(), null);
    assert.equal(Storage.rankAlias, '', 'cancelar no puede dejar alias guardado');
  } finally {
    if (previousPrompt) window.prompt = previousPrompt; else delete window.prompt;
  }
});
