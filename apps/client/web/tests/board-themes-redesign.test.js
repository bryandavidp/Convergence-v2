'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MOCKUP_PATH = path.join(ROOT, 'docs', 'mockups', 'board-themes-redesign', 'board-themes-interactive-mockup.html');
const MOCKUP = fs.readFileSync(MOCKUP_PATH, 'utf8');
const V4_MANIFEST_PATH = path.join(ROOT, 'docs', 'mockups', 'board-themes-redesign', 'board-theme-v4-manifest.json');
const V4_MANIFEST = JSON.parse(fs.readFileSync(V4_MANIFEST_PATH, 'utf8'));

function cssBlock(start, end) {
  const from = MOCKUP.indexOf(start);
  const to = MOCKUP.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `no se pudo aislar ${start}`);
  return MOCKUP.slice(from, to);
}

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test('board themes V4: marco, junta, tablero y radios son concéntricos', () => {
  const wrap = cssBlock('    .board-wrap {', '    /* El ambiente vive dentro de la abertura');
  const frameBase = cssBlock('    .board-wrap::before {', '    /* Decoración V4.1:');
  const decor = cssBlock('    .board-wrap::after {', '    .board {');
  const board = cssBlock('    .board {', '    .cell {');

  assert.match(wrap, /--board-radius:\s*var\(--cell-radius,\s*9px\);/);
  assert.match(wrap, /--board-frame-band:\s*8px;/);
  assert.match(wrap, /--board-grid-inset:\s*calc\(var\(--board-frame-band\) \+ 1px\);/);
  assert.match(wrap, /--board-frame-joint:\s*clamp\(3px,\s*1vw,\s*3\.8px\);/);
  assert.match(wrap, /--board-frame-thickness:\s*var\(--board-grid-inset\);/);
  assert.match(wrap, /--board-frame-inner-radius:\s*calc\(var\(--board-radius\) \+ var\(--board-frame-joint\)\);/);
  assert.match(wrap, /--board-frame-outer-radius:\s*calc\(var\(--board-frame-inner-radius\) \+ var\(--board-frame-thickness\)\);/);
  assert.match(wrap, /--board-shell-radius:\s*calc\(var\(--board-radius\) \+ var\(--board-grid-inset\)\);/);
  assert.match(wrap, /width:\s*382\.19px;/);
  assert.match(wrap, /height:\s*382\.19px;/);
  assert.match(wrap, /padding:\s*0;/);
  assert.match(wrap, /overflow:\s*visible;/);
  assert.match(wrap, /border:\s*var\(--board-grid-inset\) solid transparent;/);
  assert.match(wrap, /background-clip:\s*padding-box;/);
  assert.match(wrap, /contain:\s*layout;/);
  assert.match(wrap, /pointer-events:\s*none;/);
  assert.doesNotMatch(wrap, /border-image-/);
  assert.match(frameBase, /inset:\s*calc\(0px - var\(--board-frame-expand\)\);/);
  assert.match(frameBase, /padding:\s*var\(--board-frame-thickness\);/);
  assert.match(frameBase, /border-radius:\s*var\(--board-frame-outer-radius\);/);
  assert.match(frameBase, /background-image:\s*var\(--theme-frame-base-image, none\);/);
  assert.match(frameBase, /clip-path:\s*inset\(0 round var\(--board-frame-outer-radius\)\);/);
  assert.match(frameBase, /-webkit-mask-composite:\s*xor;/);
  assert.match(frameBase, /mask-composite:\s*exclude;/);
  assert.match(decor, /background-image:\s*var\(--theme-decor-image, none\);/);
  assert.doesNotMatch(decor, /border-image|\bstretch\b|clip-path/);
  assert.match(board, /border-radius:\s*var\(--board-radius\);/);
  assert.match(board, /box-shadow:\s*0 0 0 var\(--board-frame-joint\)/);
  assert.match(board, /pointer-events:\s*auto;/);
  assert.match(MOCKUP, /\.board::before\s*\{/);
  assert.doesNotMatch(wrap, /board-frame-(?:gap|art-inset|outset)/);
});

test('board themes V4: cambiar de tema conserva DOM, geometría y 44 assets por capas', () => {
  const ids = ['classic', 'madera', 'hielo', 'lava', 'cristal', 'magico', 'futurista', 'dorado', 'bosque', 'cosmico', 'jardin'];
  const applyTheme = MOCKUP.slice(MOCKUP.indexOf('      function applyTheme(id)'), MOCKUP.indexOf('      function runFx(cells)'));

  assert.match(MOCKUP, /for \(let i = 0; i < 64; i\+\+\)/);
  assert.match(MOCKUP, /const FILLED = new Set\(\[[^\]]+\]\);/);
  assert.doesNotMatch(applyTheme, /\.style\.(?:width|height|top|left)|appendChild|remove\(/);
  assert.match(applyTheme, /--theme-frame-base-image/);
  assert.match(applyTheme, /--theme-decor-image/);
  assert.doesNotMatch(MOCKUP, /assetPath\([^\n]+['"]frame-v3\.png['"]\)/);
  assert.equal(V4_MANIFEST.version, '4.1');
  assert.deepEqual(V4_MANIFEST.geometry.frameCanvas, [1024, 1024]);
  assert.deepEqual(V4_MANIFEST.geometry.decorCanvas, [1024, 1024]);

  for (const id of ids) {
    for (const file of ['board-surface-v3.jpg', 'cell-surface-v3.jpg', 'frame-base-v4.png', 'decor-v4.png']) {
      assert.ok(fs.existsSync(path.join(ROOT, 'img', 'board-themes', 'v2', id, file)), `falta ${id}/${file}`);
    }
    assert.deepEqual(pngSize(path.join(ROOT, 'img', 'board-themes', 'v2', id, 'frame-base-v4.png')), [1024, 1024]);
    assert.deepEqual(pngSize(path.join(ROOT, 'img', 'board-themes', 'v2', id, 'decor-v4.png')), [1024, 1088]);
    assert.ok(V4_MANIFEST.themes[id].frameBaseV4Sha256);
    assert.ok(V4_MANIFEST.themes[id].decorV4Sha256);
  }

  assert.deepEqual(ids.filter((id) => V4_MANIFEST.themes[id].hasDecor), ids);
});
