'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const HUB_VIEWS = ['events', 'missions', 'how', 'settings', 'daily', 'adventure', 'shop', 'chests', 'multi', 'medals', 'collections'];

test('hub views: las secciones de metajuego ya no tienen semántica de modal', () => {
  const html = read('index.html');
  assert.equal((html.match(/<nav class="bottom-nav"/g) || []).length, 1,
    'la navegación inferior debe seguir siendo una sola instancia');
  assert.match(html, /id="hub-views"/);

  for (const name of HUB_VIEWS) {
    const tag = html.match(new RegExp(`<section class="[^"]*hub-view[^"]*" id="view-${name}" data-hub-view="${name}"[^>]*>`));
    assert.ok(tag, `falta la vista completa ${name}`);
    assert.doesNotMatch(tag[0], /role="dialog"|aria-modal="true"|class="[^"]*\bmodal\b/,
      `${name} no debe seguir comportándose como modal`);
  }

  const transient = [...html.matchAll(/<div class="[^"]*\bmodal\b[^"]*" id="([^"]+)" role="dialog"/g)].map((m) => m[1]).sort();
  assert.deepEqual(transient, ['modal-icon-pack', 'modal-level', 'modal-mode-launch', 'modal-over', 'modal-pause', 'modal-revive'],
    'solo el lanzador de modos, el visor de pack de iconos y los diálogos propios de partida pueden seguir siendo modales');
});

test('hub views: todos los lanzadores cambian de vista sin abrir overlays', () => {
  const js = read('game.js');
  assert.match(js, /const HubViews = \{/);
  assert.match(js, /HubViews\.init\(\)/);
  assert.match(js, /function openSettings\(\)[^\n]+HubViews\.open\('settings'/);
  assert.match(js, /function openShop\(\)[^\n]+HubViews\.open\('shop'/);
  assert.match(js, /function openChests\(\)[^\n]+HubViews\.open\('chests'/);
  assert.match(js, /function openEvents\(\)[\s\S]{0,160}?HubViews\.open\('events', \{ nav: 'nav-events' \}\)/);
  assert.match(js, /function openCollections\(\)[\s\S]{0,160}?HubViews\.open\('collections', \{ nav: 'nav-collections' \}\)/);
  assert.match(js, /a === 'open-guide'[^\n]+HubViews\.open\('how'/);
  assert.match(js, /a === 'nav-missions'[^\n]+HubViews\.open\('missions'/);
  assert.doesNotMatch(js, /Modal\.open\('modal-(?:missions|how|settings|surv-diff|daily|adventure|shop|chests|multi|medals)'\)/);
});

test('cofres: diez atlas con alfa, ranuras y secuencia de cuatro estados', () => {
  const html = read('index.html');
  const css = read('styles.css');
  const js = read('game.js');
  const sw = read('sw.js');
  const ids = ['wood', 'bronze', 'silver', 'gold', 'magic', 'royal', 'supreme', 'champion', 'divine', 'event'];
  for (const id of ids) {
    const rel = `img/ui-generated/chests/atlas/${id}.png`;
    const asset = path.join(ROOT, rel);
    assert.ok(fs.existsSync(asset), `falta ${rel}`);
    const png = fs.readFileSync(asset);
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.ok(png.readUInt32BE(16) >= 1200 && png.readUInt32BE(20) >= 1200, `${id} necesita resolución suficiente para cuatro celdas`);
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), `${id} debe ser un atlas 2×2 cuadrado`);
    assert.equal(png[25] & 4, 4, `${id} debe conservar canal alfa`);
    assert.match(sw, new RegExp(`['\"]${id}['\"]`), `${id} debe entrar en el precache`);
    assert.match(js, new RegExp(`atlas/${id}\\.png`), `${id} debe existir en CHEST_TYPES`);
  }

  assert.match(html, /class="hub-view view-chests"/);
  assert.match(html, /class="chest-progress-card"/);
  assert.match(html, /class="chest-open-options chest-main-actions"/);
  assert.match(html, /id="chest-slots"/);
  assert.match(html, /id="chest-catalog-grid"/);
  assert.match(js, /const CHEST_TYPES = Object\.freeze/);
  assert.match(js, /chestUnlock\(\)/);
  assert.match(js, /startChestUnlock\(uid\)/);
  assert.match(js, /chestInstantCost\(uid\)/);

  assert.match(html, /id="chest-preview"[\s\S]*?id="chest-ceremony"[^>]*hidden inert/);
  assert.match(css, /@keyframes chestAtlasFrames/);
  assert.match(css, /@keyframes chestOpenMotion/);
  assert.match(css, /background-size: 200% 200%/);
  assert.match(css, /chest-frame-unlocked[^}]+background-position: 100% 0/);
  assert.match(css, /chest-frame-half[^}]+background-position: 0 100%/);
  assert.match(css, /chest-frame-open[^}]+background-position: 100% 100%/);
  assert.match(css, /@keyframes chestPrizeRise/);
  assert.match(js, /afterChestAnimation\(motion,\s*'chestOpenMotion',\s*900,\s*run,\s*finish\)/);
  assert.match(js, /requestAnimationFrame\(\(\) => \{[\s\S]*?stage\.classList\.add\('is-playing'\)/);
  assert.match(js, /const reduceMotion\s*=\s*motionOff\(\)/);
  assert.match(js, /function showChestReward\(r, openedType\)[\s\S]*?class="chest-reward-stage/);
});
