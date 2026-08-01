'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function guideMarkup() {
  const html = read('index.html');
  return html.slice(html.indexOf('id="view-how"'), html.indexOf('<!-- Pausa -->'));
}

test('guía: sustituye la lista antigua por una experiencia visual completa', () => {
  const guide = guideMarkup();

  assert.match(guide, /class="how-hero"/);
  assert.match(guide, /img\/ui-generated\/guide\/guide-mentor\.png/);
  for (const asset of ['rule-1-tap', 'rule-2-scan', 'rule-3-converge', 'rule-4-combo']) {
    assert.match(guide, new RegExp(`img/ui-generated/guide/${asset}\\.png`));
  }
  assert.equal((guide.match(/class="guide-rule-card"/g) || []).length, 4);
  assert.equal((guide.match(/class="guide-mode-card/g) || []).length, 4);
  assert.equal((guide.match(/class="guide-powerup-card"/g) || []).length, 5);
  assert.doesNotMatch(guide, /class="how-list"/);
  assert.doesNotMatch(guide, /guide-board|guide-compass|guide-combo-art/);
});

test('guía: las tarjetas de modo abren lanzadores reales', () => {
  const guide = guideMarkup();

  for (const mode of ['clasico', 'contrarreloj', 'aventura', 'supervivencia']) {
    assert.match(guide, new RegExp(`data-act="mission-play" data-mode="${mode}"`));
  }
  assert.match(guide, /id="btn-tutorial"/);
  assert.match(read('game.js'), /id="btn-tutorial"|\$\('#btn-tutorial'\)/);
});

test('guía: el mentor es un PNG con alfa y forma parte del precache', () => {
  const rel = 'img/ui-generated/guide/guide-mentor.png';
  const asset = path.join(ROOT, rel);
  const png = fs.readFileSync(asset);
  const sw = read('sw.js');

  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.ok(png.readUInt32BE(16) >= 600);
  assert.ok(png.readUInt32BE(20) >= 900);
  assert.equal(png[25] & 4, 4, 'el mentor debe conservar canal alfa');
  assert.match(sw, /const GUIDE_GENERATED_ART/);
  assert.match(sw, /'guide-mentor'/);
  assert.match(sw, /GUIDE_GENERATED_ART/);
});

test('guía: las cuatro reglas usan PNG generados y precargados', () => {
  const sw = read('sw.js');

  for (const name of ['rule-1-tap', 'rule-2-scan', 'rule-3-converge', 'rule-4-combo']) {
    const png = fs.readFileSync(path.join(ROOT, `img/ui-generated/guide/${name}.png`));
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.equal(png.readUInt32BE(16), 512);
    assert.equal(png.readUInt32BE(20), 512);
    assert.match(sw, new RegExp(`'${name}'`));
  }
});

test('guía: mantiene una composición responsive y accesible', () => {
  const css = read('styles.css');
  const guideCss = css.slice(css.indexOf('GUÍA 2.0'));
  const guide = guideMarkup();

  assert.match(guideCss, /\.guide-rules-grid[\s\S]*?repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(guideCss, /@media \(max-width: 700px\)[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(guideCss, /\.guide-powerup-grid[\s\S]*?overflow-x: auto/);
  assert.match(guideCss, /\.how-hero-art > img:first-child[\s\S]*?object-fit: contain/);
  assert.match(guideCss, /#screen-start #view-how \{[\s\S]*?overflow: hidden/);
  assert.match(guideCss, /> \.how-scroll \{[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto/);
  assert.match(guideCss, /\.guide-rule-visual \{[\s\S]*?aspect-ratio: 1/);
  assert.match(guideCss, /\.how-hero \{[\s\S]*?min-height: clamp\(92px,\s*13svh,\s*118px\)/);
  assert.match(guideCss, /@media \(max-height: 700px\)[\s\S]*?\.how-hero \{ min-height: 80px; \}/);
  assert.match(guide, /aria-labelledby="guide-rules-title"/);
  assert.match(guide, /aria-labelledby="guide-modes-title"/);
  assert.match(guide, /aria-labelledby="guide-powerups-title"/);
});

test('guía: conserva paridad de traducciones y versión de shell', () => {
  const html = read('index.html');
  const js = read('game.js');
  const sw = read('sw.js');

  for (const key of ['how_sub', 'guide_rules_title', 'guide_modes_title', 'guide_powerups_title', 'guide_tutorial_cta']) {
    assert.equal((js.match(new RegExp(`${key}:`, 'g')) || []).length, 2, `${key} debe existir en ES y EN`);
  }

  const version = js.match(/const VERSION = '([\d.]+)'/)?.[1];
  assert.ok(version);
  const escaped = version.replace(/\./g, '\\.');
  assert.match(html, new RegExp(`styles\\.css\\?v=${escaped}`));
  assert.match(html, new RegExp(`game\\.js\\?v=${escaped}`));
  assert.match(sw, new RegExp(`cv-cache-v${escaped}`));
});
