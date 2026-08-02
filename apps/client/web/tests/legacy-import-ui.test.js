'use strict';

// UI de importación de progreso legacy (ROADMAP Fase 5). El modal y la barra de
// sincronización se pintan desde ProfileSyncPublicState, así que aquí se cubre
// justo lo que el gate no veía: que cada clave i18n exista en ES y EN, que cada
// data-act tenga rama en el dispatcher y que el modal se abra por Modal.open.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const { I18n } = globalThis.window.__cv;
const gameJs = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const syncTs = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'online', 'legacy-progress-sync.ts'),
  'utf8',
);

// Recorta el marcado de la feature entre anclas de hermanos: el modal llega
// hasta el siguiente .modal y la barra hasta la tarjeta de jugador.
function sliceBetween(startAnchor, endAnchor) {
  const start = indexHtml.indexOf(startAnchor);
  assert.notEqual(start, -1, `no se encontró ${startAnchor} en index.html`);
  const end = indexHtml.indexOf(endAnchor, start + startAnchor.length);
  assert.notEqual(end, -1, `no se encontró el cierre ${endAnchor} tras ${startAnchor}`);
  return indexHtml.slice(start, end);
}

function featureMarkup() {
  const modal = sliceBetween('id="modal-legacy-import"', '<div class="modal ');
  const bar = sliceBetween('id="profile-sync-bar"', 'profile-player-card');
  return `${modal}\n${bar}`;
}

test('legacy import: todas las claves i18n del marcado existen en ES y EN', () => {
  const markup = featureMarkup();
  const keys = [...markup.matchAll(/data-i18n(?:-al|-ph|-html)?="([a-z0-9_]+)"/g)].map((m) => m[1]);

  assert.ok(keys.length >= 10, 'el marcado debe seguir declarando sus textos por data-i18n');
  for (const lang of ['es', 'en']) {
    for (const key of new Set(keys)) {
      assert.ok(I18n.DICT[lang][key], `falta la clave ${key} en ${lang}`);
    }
  }
});

test('legacy import: hay un estado traducido para cada ProfileSyncStatus', () => {
  const union = syncTs.match(/export type ProfileSyncStatus =([\s\S]*?);/);
  assert.ok(union, 'ProfileSyncStatus debe seguir siendo una unión literal');
  const statuses = [...union[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(statuses.length >= 10, 'se esperaban todos los estados del coordinador');

  for (const status of statuses) {
    const key = status === 'awaiting-confirmation'
      ? 'sync_status_awaiting'
      : `sync_status_${status.replace(/-/g, '_')}`;
    for (const lang of ['es', 'en']) {
      assert.ok(I18n.DICT[lang][key], `falta ${key} en ${lang} para el estado ${status}`);
    }
  }
});

test('legacy import: los textos de resultado del puente tienen traducción', () => {
  for (const key of ['legacy_import_done', 'legacy_import_kept_local', 'legacy_import_unavailable']) {
    for (const lang of ['es', 'en']) {
      assert.ok(I18n.DICT[lang][key], `falta ${key} en ${lang}`);
    }
  }
});

test('legacy import: cada data-act del marcado tiene rama en el dispatcher', () => {
  const actions = [...featureMarkup().matchAll(/data-act="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(actions)].sort(),
    ['legacy-import-cancel', 'legacy-import-confirm', 'review-sync'],
    'el marcado declara exactamente las tres acciones de la feature',
  );
  for (const action of actions) {
    assert.ok(
      gameJs.includes(`a === '${action}'`),
      `el dispatcher de clicks no maneja data-act="${action}"`,
    );
  }
});

test('legacy import: el modal se abre por Modal.open y no manipulando hidden', () => {
  const fn = gameJs.match(/function showLegacyImportModal\([\s\S]*?\n    \}/);
  assert.ok(fn, 'showLegacyImportModal debe seguir existiendo');
  assert.ok(
    fn[0].includes("Modal.open('modal-legacy-import')"),
    'abrir el modal a mano deja el overlay y el foco sin gestionar',
  );
  assert.ok(
    !/modal\.hidden\s*=\s*false/.test(fn[0]),
    'no se debe forzar hidden=false saltándose el gestor de modales',
  );
});

test('legacy import: la confirmación viaja por el evento del coordinador', () => {
  const fn = gameJs.match(/function confirmLegacyImport\([\s\S]*?\n    \}/);
  assert.ok(fn, 'confirmLegacyImport debe seguir existiendo');
  assert.ok(
    fn[0].includes("'convergence:legacy-import-confirm'"),
    'la confirmación debe emitir el evento que escucha profile-emulator-bootstrap',
  );
  assert.ok(
    fn[0].includes('window.ConvergenceProfileMigration'),
    'sin el carril montado la UI no puede prometer una importación',
  );
});

test('legacy import: el coordinador publica el resumen que consume la UI', () => {
  assert.ok(
    /preview: ProfilePreviewSummaryV1 \| null/.test(syncTs),
    'ProfileSyncPublicState debe transportar el resumen presentacional',
  );
  const summary = syncTs.match(/export interface ProfilePreviewSummaryV1 \{([\s\S]*?)\}/);
  assert.ok(summary, 'ProfilePreviewSummaryV1 debe existir');
  for (const field of ['level', 'xp', 'adventureMaxLevel', 'achievements']) {
    assert.ok(summary[1].includes(field), `el resumen debe exponer ${field}`);
  }
  for (const forbidden of ['coins', 'gems', 'chests']) {
    assert.ok(
      !summary[1].includes(forbidden),
      `el resumen no puede transportar ${forbidden}: la economía es autoridad del backend`,
    );
  }
});
