'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { Meta, PlayerIcons, PlayerBorders, playerAvatarHtml } = cv;
const root = path.join(__dirname, '..');

function snapshotMeta() { return JSON.parse(JSON.stringify(Meta.state)); }
function restoreMeta(snapshot) {
  const state = Meta.state;
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, JSON.parse(JSON.stringify(snapshot)));
  localStorage.setItem('cv_meta', JSON.stringify(state));
}
function isolated(run) {
  const snapshot = snapshotMeta();
  try { return run(); } finally { restoreMeta(snapshot); }
}

function assertPngAsset(relativePath, expectedColorType) {
  const assetPath = path.join(root, relativePath);
  const png = fs.readFileSync(assetPath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${relativePath} no es PNG`);
  assert.equal(png.readUInt32BE(16), 512, `${relativePath} debe medir 512 px de ancho`);
  assert.equal(png.readUInt32BE(20), 512, `${relativePath} debe medir 512 px de alto`);
  assert.equal(png[25], expectedColorType, `${relativePath} usa un formato de color inesperado`);
  assert.ok(png.length > 100000, `${relativePath} parece un placeholder`);
}

test('catálogo incluye diez iconos y diez bordes únicos', () => {
  assert.equal(PlayerIcons.order.length, 10);
  assert.equal(PlayerBorders.order.length, 10);
  assert.equal(new Set(PlayerIcons.order).size, 10);
  assert.equal(new Set(PlayerBorders.order).size, 10);
  PlayerIcons.order.forEach((id) => assert.ok(PlayerIcons.DEFS[id], `falta el icono ${id}`));
  PlayerBorders.order.forEach((id) => assert.ok(PlayerBorders.DEFS[id], `falta el borde ${id}`));
  PlayerIcons.order.forEach((id) => assertPngAsset(PlayerIcons.DEFS[id].asset, 2));
  PlayerBorders.order.forEach((id) => assertPngAsset(PlayerBorders.DEFS[id].asset, 6));
});

test('el perfil empieza con un icono y un borde equipados', () => {
  assert.equal(Meta.avatarIcon(), PlayerIcons.DEFAULT);
  assert.equal(Meta.avatarBorder(), PlayerBorders.DEFAULT);
  assert.equal(Meta.ownsAvatarIcon(PlayerIcons.DEFAULT), true);
  assert.equal(Meta.ownsAvatarBorder(PlayerBorders.DEFAULT), true);
});

test('comprar y equipar cosméticos descuenta monedas y persiste el loadout', () => isolated(() => {
  Meta.state.coins = 10000;
  delete Meta.state.cosmetics.avatarIcons.comet;
  delete Meta.state.cosmetics.avatarBorders.plasma;
  const initial = Meta.coins();
  assert.equal(Meta.buyAvatarIcon('comet'), true);
  assert.equal(Meta.coins(), initial - PlayerIcons.DEFS.comet.cost);
  assert.equal(Meta.equipAvatarIcon('comet'), true);
  assert.equal(Meta.avatarIcon(), 'comet');
  const afterIcon = Meta.coins();
  assert.equal(Meta.buyAvatarBorder('plasma'), true);
  assert.equal(Meta.coins(), afterIcon - PlayerBorders.DEFS.plasma.cost);
  assert.equal(Meta.equipAvatarBorder('plasma'), true);
  assert.equal(Meta.avatarBorder(), 'plasma');
}));

test('los cofres ofrecen y conceden iconos y bordes aún bloqueados', () => isolated(() => {
  Meta.state.cosmetics.avatarIcons = { [PlayerIcons.DEFAULT]: 1 };
  Meta.state.cosmetics.avatarBorders = { [PlayerBorders.DEFAULT]: 1 };
  const pool = Meta.chestCosmeticPool();
  assert.ok(pool.some((item) => item.cosmeticKind === 'avatarIcon'));
  assert.ok(pool.some((item) => item.cosmeticKind === 'avatarBorder'));
  Meta._applyChestReward({ kind: 'cosmetic', cosmeticKind: 'avatarIcon', id: 'prism' });
  Meta._applyChestReward({ kind: 'cosmetic', cosmeticKind: 'avatarBorder', id: 'royal' });
  assert.equal(Meta.ownsAvatarIcon('prism'), true);
  assert.equal(Meta.ownsAvatarBorder('royal'), true);
}));

test('el avatar generado y las vistas exponen el nuevo flujo visual', () => {
  const avatar = playerAvatarHtml('nova', 'starlight', 'sample');
  const borderReward = PlayerBorders.html('eclipse', 'reward-border-preview');
  assert.match(avatar, /player-icon-png/);
  assert.match(avatar, /img\/player-icons\/nova\.png/);
  assert.match(avatar, /img\/player-borders\/starlight\.png/);
  assert.match(avatar, /data-player-frame="starlight"/);
  assert.match(borderReward, /img\/player-borders\/eclipse\.png/);
  assert.match(borderReward, /reward-border-preview/);
  assert.doesNotMatch(borderReward, /player-icon|player-avatar/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(html, /id="profile-icon-grid"/);
  assert.match(html, /id="profile-border-grid"/);
  assert.match(html, /id="pause-run-summary"/);
  assert.match(js, /data-picon-buy/);
  assert.match(js, /data-pborder-buy/);
  assert.match(css, /Player identity 2.9/);
  assert.match(css, /hub-header-avatar-frame/);
  assert.match(css, /cr-item-face > \.reward-border-preview/);
  assert.match(css, /hub-header-avatar-art[^}]*width: auto; height: auto;/);
  assert.match(css, /hub-header-avatar-art \.player-icon-png[^}]*transform: none;/);
  assert.doesNotMatch(css, /data-player-frame-style=/);
  assert.doesNotMatch(css, /player-icon-svg/);
  assert.match(js, /img\/player-icons/);
  assert.match(sw, /IMAGE_MANIFEST = \[\]\.concat\([\s\S]*?\bPLAYER_ICON_ASSETS\b/);
  assert.match(sw, /IMAGE_MANIFEST = \[\]\.concat\([\s\S]*?\bPLAYER_BORDER_ASSETS\b/);
});
