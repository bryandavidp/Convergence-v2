/* global Buffer */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

require('./dom-stub.js');
require('../game.js');

const { IconPacks, Engine, Meta, Render } = globalThis.window.__cv;

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

function assertPngAsset(packId, fileName) {
  const def = IconPacks.DEFS[packId];
  const file = path.join(__dirname, '..', 'img', 'icon-packs', def.dir, fileName);
  const png = fs.readFileSync(file);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${fileName}: firma PNG`);
  assert.equal(png.readUInt32BE(16), 512, `${fileName}: ancho`);
  assert.equal(png.readUInt32BE(20), 512, `${fileName}: alto`);
  assert.equal(png[25], 6, `${fileName}: debe conservar RGBA`);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

function decodeRgbaPng(file) {
  const png = fs.readFileSync(file);
  const idat = [];
  let offset = 8;
  let width = 0, height = 0;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, `${file}: profundidad PNG`);
      assert.equal(data[9], 6, `${file}: color RGBA`);
      assert.equal(data[12], 0, `${file}: PNG no entrelazado`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const packed = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = packed[source++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = packed[source++];
      const left = x >= 4 ? pixels[row + x - 4] : 0;
      const up = y > 0 ? pixels[row - stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[row - stride + x - 4] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : (() => { throw new Error(`${file}: filtro PNG ${filter}`); })();
      pixels[row + x] = (raw + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

function visibleComponents(file, alphaThreshold = 48) {
  const { width, height, pixels } = decodeRgbaPng(file);
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || pixels[start * 4 + 3] <= alphaThreshold) continue;
    let head = 0, tail = 0, size = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width, y = Math.floor(index / width);
      size++;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= seen.length || seen[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1 || pixels[next * 4 + 3] <= alphaThreshold) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    if (size < 40) continue;
    const hash = crypto.createHash('sha256');
    const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
    const normalized = Buffer.alloc(boxWidth * boxHeight * 4);
    let target = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const source = (y * width + x) * 4;
        if (pixels[source + 3] > alphaThreshold) pixels.copy(normalized, target, source, source + 4);
        target += 4;
      }
    }
    hash.update(`${boxWidth}x${boxHeight}|`);
    hash.update(normalized);
    components.push({ minX, minY, maxX, maxY, size, hash: hash.digest('hex') });
  }
  return components.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
}

test('Joyas Prisma registra los diez PNG transparentes del diseño', () => {
  assert.equal(IconPacks.DEFS.prismatic.rarity, 'legendary');
  assert.equal(IconPacks.DEFS.prismatic.cost, 1800);
  assert.equal(IconPacks.PRISMATIC_ASSETS.length, 10);
  assert.equal(IconPacks.iconsOf('prismatic').length, 10);

  for (const asset of IconPacks.PRISMATIC_ASSETS) {
    assertPngAsset('prismatic', asset.file);
  }
});

test('los packs raster registran precios, rareza y todos sus PNG', () => {
  const expected = [
    ['basic-redesigned', 'common', 350, 20],
    ['gem-pattern', 'rare', 500, 20],
    ['nature-basic', 'rare', 800, 8],
    ['nature-advanced', 'epic', 1600, 10],
    ['neon', 'epic', 1200, 8],
    ['marine', 'epic', 1200, 8],
    ['magic', 'epic', 1500, 8],
    ['elemental', 'legendary', 2000, 12],
  ];
  assert.deepEqual(IconPacks.order, ['cosmos', 'basic-redesigned', 'gem-pattern', 'nature-basic', 'neon', 'marine', 'magic', 'nature-advanced', 'prismatic', 'elemental']);
  for (const [packId, rarity, cost, count] of expected) {
    assert.equal(IconPacks.DEFS[packId].rarity, rarity);
    assert.equal(IconPacks.DEFS[packId].cost, cost);
    assert.equal(IconPacks.CATALOGS[packId].length, count);
    assert.equal(IconPacks.iconsOf(packId).length, count);
    for (const asset of IconPacks.CATALOGS[packId]) assertPngAsset(packId, asset.file);
    assertPngAsset(packId, 'thumbnail.png');
  }
});

test('los 48 iconos nuevos conservan lienzo transparente y escala jugable', () => {
  const packs = ['basic-redesigned', 'marine', 'magic', 'elemental'];
  for (const packId of packs) {
    const dir = path.join(__dirname, '..', 'img', 'icon-packs', IconPacks.DEFS[packId].dir);
    for (const asset of IconPacks.CATALOGS[packId]) {
      const file = path.join(dir, asset.file);
      const { width, height, pixels } = decodeRgbaPng(file);
      const cornerAlphas = [3, (width - 1) * 4 + 3, ((height - 1) * width) * 4 + 3, (width * height - 1) * 4 + 3];
      assert.ok(cornerAlphas.every((index) => pixels[index] === 0), `${packId}/${asset.file}: esquinas transparentes`);
      const visible = visibleComponents(file, 24).reduce((total, item) => total + item.size, 0);
      assert.ok(visible > 4000, `${packId}/${asset.file}: icono visible y legible`);
    }
  }
});

test('Pack Gemas mantiene símbolos idénticos, cantidades exactas y separación en el patrón de cinco', () => {
  const dir = path.join(__dirname, '..', 'img', 'icon-packs', 'gem-pattern');
  for (const family of ['violet-diamond', 'orange-gem', 'blue-drop', 'pink-heart']) {
    for (let count = 1; count <= 5; count++) {
      const file = path.join(dir, `${family}-${count}.png`);
      const components = visibleComponents(file);
      assert.equal(components.length, count, `${family}-${count}: cantidad visual exacta`);
      if (count > 1) {
        const signatures = components.map((item) => `${item.maxX - item.minX + 1}x${item.maxY - item.minY + 1}:${item.hash}`);
        const details = components.map((item) => `${item.minX},${item.minY}-${item.maxX},${item.maxY} size=${item.size}`);
        assert.equal(new Set(signatures).size, 1, `${family}-${count}: cada repetición debe ser idéntica (${signatures.join(', ')}; ${details.join(', ')})`);
      }
      if (count === 5) {
        let minimumGap = Infinity;
        for (let a = 0; a < components.length; a++) {
          for (let b = a + 1; b < components.length; b++) {
            const one = components[a], two = components[b];
            const gapX = one.maxX < two.minX ? two.minX - one.maxX - 1
              : two.maxX < one.minX ? one.minX - two.maxX - 1 : 0;
            const gapY = one.maxY < two.minY ? two.minY - one.maxY - 1
              : two.maxY < one.minY ? one.minY - two.maxY - 1 : 0;
            minimumGap = Math.min(minimumGap, Math.max(gapX, gapY));
          }
        }
        assert.ok(minimumGap >= 8, `${family}-5: separación mínima ${minimumGap}px`);
      }
    }
  }
});

test('el renderer conserva SVG para Cosmos y usa IMG para Joyas Prisma', () => {
  const iconId = IconPacks.iconsOf('prismatic')[0];
  assert.match(IconPacks.svg('cosmos', iconId), /^<svg\b/);
  assert.match(IconPacks.svg('prismatic', iconId), /^<img\b/);
  assert.match(IconPacks.svg('prismatic', iconId), /violet-diamond\.png/);
});

test('el renderer resuelve cada pack raster desde su propia carpeta', () => {
  const iconId = IconPacks.iconsOf('nature-basic')[0];
  assert.match(IconPacks.svg('gem-pattern', iconId), /gem-pattern\/violet-diamond-1\.png/);
  assert.match(IconPacks.svg('basic-redesigned', iconId), /basic-redesigned\/red-circle\.png/);
  assert.match(IconPacks.svg('elemental', iconId), /elemental\/fire\.png/);
  assert.match(IconPacks.svg('marine', iconId), /marine\/starfish\.png/);
  assert.match(IconPacks.svg('magic', iconId), /magic\/magic-crystal\.png/);
  assert.match(IconPacks.svg('nature-basic', iconId), /nature-basic\/green-leaf\.png/);
  assert.match(IconPacks.svg('nature-advanced', iconId), /nature-advanced\/hibiscus\.png/);
  assert.match(IconPacks.svg('neon', iconId), /neon\/neon-square\.png/);
  assert.equal(IconPacks.iconName('nature-basic', iconId, 'es'), 'Hoja verde');
  assert.equal(IconPacks.iconName('nature-advanced', iconId, 'en'), 'Hibiscus');
  assert.equal(IconPacks.iconName('neon', iconId, 'es'), 'Cuadrado neón');
  assert.equal(IconPacks.iconName('neon', iconId, 'en'), 'Neon square');
  assert.equal(IconPacks.iconName('gem-pattern', iconId, 'es'), '1 diamante violeta');
  assert.equal(IconPacks.iconName('gem-pattern', iconId, 'en'), '1 violet diamond');
  assert.equal(IconPacks.iconName('basic-redesigned', iconId, 'es'), 'Círculo rojo');
  assert.equal(IconPacks.iconName('elemental', iconId, 'en'), 'Fire');
  assert.equal(IconPacks.iconName('marine', iconId, 'es'), 'Estrella de mar');
  assert.equal(IconPacks.iconName('magic', iconId, 'en'), 'Magic crystal');
});

test('Joyas Prisma usa su miniatura generada en tienda y coleccion', () => {
  const file = path.join(__dirname, '..', 'img', 'icon-packs', 'prismatic-jewels', 'thumbnail.png');
  const png = fs.readFileSync(file);
  assert.equal(png.readUInt32BE(16), 512, 'ancho de miniatura');
  assert.equal(png.readUInt32BE(20), 512, 'alto de miniatura');
  assert.equal(png[25], 6, 'la miniatura conserva RGBA');
  assert.match(IconPacks.previewHtml('prismatic'), /class="iconpack-thumbnail"/);
  assert.match(IconPacks.previewHtml('prismatic'), /prismatic-jewels\/thumbnail\.png/);
  assert.match(IconPacks.previewHtml('nature-basic'), /nature-basic\/thumbnail\.png/);
  assert.match(IconPacks.previewHtml('nature-advanced'), /nature-advanced\/thumbnail\.png/);
  assert.match(IconPacks.previewHtml('neon'), /neon\/thumbnail\.png/);
  assert.match(IconPacks.previewHtml('gem-pattern'), /gem-pattern\/thumbnail\.png/);
  assert.match(IconPacks.previewHtml('basic-redesigned'), /basic-redesigned\/thumbnail\.png/);
  assert.match(IconPacks.previewHtml('elemental'), /elemental\/thumbnail\.png/);
  assert.match(IconPacks.previewHtml('marine'), /marine\/thumbnail\.png/);
  assert.match(IconPacks.previewHtml('magic'), /magic\/thumbnail\.png/);
  assert.match(IconPacks.previewHtml('cosmos'), /class="iconpack-collage"/);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(sw, /'golden-star','thumbnail'/);
  assert.match(sw, /NATURE_BASIC_PACK_ASSETS/);
  assert.match(sw, /NATURE_ADVANCED_PACK_ASSETS/);
  assert.match(sw, /NEON_PACK_ASSETS/);
  assert.match(sw, /GEM_PATTERN_PACK_ASSETS/);
  assert.match(sw, /BASIC_REDESIGNED_PACK_ASSETS/);
  assert.match(sw, /ELEMENTAL_PACK_ASSETS/);
  assert.match(sw, /MARINE_PACK_ASSETS/);
  assert.match(sw, /MAGIC_PACK_ASSETS/);
  assert.match(sw, /'pink-heart-1','pink-heart-2','pink-heart-3','pink-heart-4','pink-heart-5','thumbnail'/);
  assert.match(sw, /'neon-diamond','neon-hexagon','neon-heart','neon-drop','thumbnail'/);
});

test('los nuevos packs raster se compran por el precio indicado y se equipan', () => isolated(() => {
  for (const [packId, cost, firstFile] of [
    ['basic-redesigned', 350, 'red-circle.png'],
    ['gem-pattern', 500, 'violet-diamond-1.png'],
    ['nature-basic', 800, 'green-leaf.png'],
    ['nature-advanced', 1600, 'hibiscus.png'],
    ['neon', 1200, 'neon-square.png'],
    ['marine', 1200, 'starfish.png'],
    ['magic', 1500, 'magic-crystal.png'],
    ['elemental', 2000, 'fire.png'],
  ]) {
    Meta.state.coins = 3000;
    Meta.state.cosmetics.iconPack = IconPacks.DEFAULT;
    delete Meta.state.cosmetics.iconPacks[packId];
    assert.equal(Meta.buyIconPack(packId), true);
    assert.equal(Meta.coins(), 3000 - cost);
    assert.equal(Meta.ownsIconPack(packId), true);
    assert.equal(Meta.equipIconPack(packId), true);
    assert.equal(Meta.equippedIconPack(), packId);
    assert.match(IconPacks.svg(packId, IconPacks.iconsOf(packId)[0]), new RegExp(firstFile.replace('.', '\\.')));
  }
}));

test('Joyas Prisma se compra, descuenta monedas y queda equipado', () => isolated(() => {
  Meta.state.coins = 2000;
  Meta.state.cosmetics.iconPack = IconPacks.DEFAULT;
  delete Meta.state.cosmetics.iconPacks.prismatic;
  assert.equal(Meta.buyIconPack('prismatic'), true);
  assert.equal(Meta.coins(), 200);
  assert.equal(Meta.ownsIconPack('prismatic'), true);
  assert.equal(Meta.equipIconPack('prismatic'), true);
  assert.equal(Meta.equippedIconPack(), 'prismatic');
  assert.match(IconPacks.svg(Meta.equippedIconPack(), IconPacks.iconsOf('prismatic')[0]), /violet-diamond\.png/);
}));

test('cambiar de pack repinta la misma ficha sin alterar su id lógico', () => isolated(() => {
  const prev = { glyphs: Render.glyphs, cellId: Render._cellId, cellPack: Render._cellPack };
  try {
    const iconId = IconPacks.iconsOf('prismatic')[0];
    Render.glyphs = [{ innerHTML: '' }];
    Render._cellId = [];
    Render._cellPack = [];
    Meta.state.cosmetics.iconPack = IconPacks.DEFAULT;
    Render.setGlyph(0, iconId);
    assert.match(Render.glyphs[0].innerHTML, /^<svg\b/);
    Meta.state.cosmetics.iconPacks.prismatic = 1;
    assert.equal(Meta.equipIconPack('prismatic'), true);
    Render.setGlyph(0, iconId);
    assert.match(Render.glyphs[0].innerHTML, /violet-diamond\.png/);
    assert.equal(Render._cellId[0], iconId);
  } finally {
    Render.glyphs = prev.glyphs;
    Render._cellId = prev.cellId;
    Render._cellPack = prev.cellPack;
  }
}));

test('ningún pack raster duplica figuras distintas dentro de un nivel', () => {
  for (const packId of ['basic-redesigned', 'gem-pattern', 'nature-basic', 'nature-advanced', 'neon', 'marine', 'magic', 'prismatic', 'elemental']) {
    for (let level = 1; level <= 160; level++) {
      const rendered = Engine.poolForLevel(level).map((iconId) => {
        const html = IconPacks.svg(packId, iconId);
        return html.match(/\/([^/]+\.png)"/)[1];
      });
      assert.equal(new Set(rendered).size, rendered.length, `${packId}, nivel ${level}: figura visual duplicada`);
    }
  }
});
