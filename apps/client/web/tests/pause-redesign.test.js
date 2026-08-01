'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('pausa: reproduce la jerarquía visual del mockup', () => {
  const html = read('index.html');
  const pause = html.slice(html.indexOf('id="modal-pause"'), html.indexOf('id="modal-icon-pack"'));

  assert.match(pause, /class="pause-head-decor"/);
  assert.match(pause, /class="pause-emblem"/);
  assert.match(pause, /id="btn-pause-settings"/);
  assert.match(pause, /class="pause-scroll"/);
  assert.match(pause, /id="pause-player-card"/);
  assert.match(pause, /class="pause-run-panel"/);
  assert.match(pause, /id="pause-run-summary"/);
  assert.match(pause, /id="pause-note"/);
  assert.ok(pause.indexOf('id="pause-player-card"') < pause.indexOf('class="pause-run-panel"'));
  assert.ok(pause.indexOf('class="pause-run-panel"') < pause.indexOf('id="btn-resume"'));
});

test('pausa: usa arte del juego y conserva datos dinámicos', () => {
  const js = read('game.js');

  assert.match(js, /playerCardHtml\('player-card-pause'\)/);
  assert.match(js, /img\/ui-generated\/modes\/mode-survival\.png/);
  assert.match(js, /class="pause-run-art pause-run-art-survival"/);
  assert.doesNotMatch(js, /pause-run-(?:heart|enemy)/);
  assert.match(js, /class="pause-run-stat is-score"/);
  assert.match(js, /State\.maxCombo \|\| State\.combo/);
  assert.match(js, /Survival\.wave \|\| 1/);
  assert.match(js, /player-card-collection/);
});

test('pausa: mantiene marco flotante, scroll y tres CTA diferenciados', () => {
  const css = read('styles.css');
  const pauseCss = css.slice(css.indexOf('/* Pausa — composición fiel'));

  assert.match(pauseCss, /#modal-pause\.pause-modal[^}]*overflow:visible/s);
  assert.match(pauseCss, /\.pause-scroll[^}]*overflow-y:auto/s);
  assert.match(pauseCss, /\.pause-emblem[^}]*position:absolute/s);
  assert.match(pauseCss, /\.pause-run-panel/);
  assert.match(pauseCss, /\.pause-run-art img[^}]*object-fit:contain/s);
  assert.doesNotMatch(pauseCss, /\.pause-run-(?:heart|enemy)\b/);
  assert.match(pauseCss, /\.pause-btn-resume[^}]*#7cf20f/s);
  assert.match(pauseCss, /\.pause-btn-restart[^}]*#8e27d5/s);
  assert.match(pauseCss, /\.pause-btn-menu[^}]*#27305f/s);
  assert.doesNotMatch(pauseCss, /\.pause-run-card\b|\.pause-run-icon\b/);
});

test('pausa: versión de shell sincronizada', () => {
  const html = read('index.html');
  const js = read('game.js');
  const sw = read('sw.js');

  // Versión-agnóstico: se toma VERSION de game.js como fuente de verdad y se exige
  // que CACHE (sw.js) y los ?v= de index.html coincidan. Así el triple bump se
  // valida en cada release sin fijar un número que rompa el test tras cada versión.
  const m = js.match(/const VERSION = '([\d.]+)'/);
  assert.ok(m, 'game.js debe declarar const VERSION');
  const v = m[1].replace(/\./g, '\\.');
  assert.match(html, new RegExp(`styles\\.css\\?v=${v}`));
  assert.match(html, new RegExp(`game\\.js\\?v=${v}`));
  assert.match(sw, new RegExp(`cv-cache-v${v}`));
});
