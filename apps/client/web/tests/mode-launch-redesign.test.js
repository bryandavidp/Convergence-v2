'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('index.html');
const js = read('game.js');
const css = read('styles.css');
const sw = read('sw.js');

const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `falta ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `falta ${end}`);
  return source.slice(from, to);
};

const MODE_LAUNCH_ASSETS = [
  'bolt', 'calendar', 'clock', 'coin', 'difficulty-easy', 'difficulty-hard',
  'difficulty-normal', 'frenzy-ring', 'heart', 'info', 'leaf', 'lock', 'medal',
  'mode-adventure', 'mode-classic', 'mode-timed', 'mode-zen', 'planet', 'rocket',
  'skull', 'star', 'survival-emblem', 'survival-rank', 'target', 'trophy',
];

const pngMeta = (file) => {
  const png = fs.readFileSync(file);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} no es PNG`);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25],
  };
};

test('lanzador de modos: existe un único modal compartido sin duplicar la navegación', () => {
  const modal = between(html, '<div class="modal mode-launch-modal"', '<!-- Estas vistas');
  assert.match(modal, /id="modal-mode-launch"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(modal, /class="mode-launch-emblem"/);
  assert.match(modal, /id="mode-launch-title"/);
  assert.match(modal, /id="mode-launch-tagline"/);
  assert.match(modal, /id="mode-launch-body"/);
  assert.match(modal, /id="mode-launch-detail"[^>]*aria-labelledby="mode-launch-detail-title"/);
  assert.match(modal, /id="btn-mode-launch-detail-close"/);
  assert.match(modal, /id="btn-mode-launch-start"/);
  assert.equal((html.match(/<nav class="bottom-nav"/g) || []).length, 1,
    'el modal no debe copiar ni modificar el menú inferior');
  assert.doesNotMatch(html, /id="view-surv-diff"|data-hub-view="surv-diff"/,
    'el antiguo formulario de Supervivencia debe desaparecer');
});

test('lanzador de modos: las cinco cards comparten flujo y mantienen destinos reales', () => {
  const catalog = between(js, 'const MODE_CARDS = [', 'const MULTIPLAYER_CARD =');
  const launcher = between(js, 'const ModeLaunch = {', 'function launchZen()');
  for (const mode of ['clasico', 'aventura', 'contrarreloj', 'supervivencia', 'zen']) {
    assert.match(catalog, new RegExp(`ModeLaunch\\.open\\('${mode}'\\)`), `falta ${mode}`);
    assert.match(js, new RegExp(`${mode}: \\{[\\s\\S]{0,260}?emblem:`), `${mode} necesita arte propio`);
  }
  assert.match(launcher, /if \(mode === 'clasico'\) \{ openWorldsMap\(\)/);
  assert.match(launcher, /if \(mode === 'aventura'\)[\s\S]{0,120}?Game\.start\('aventura', 'normal'\)/);
  assert.match(launcher, /if \(mode === 'contrarreloj'\)[\s\S]{0,100}?Game\.start\('contrarreloj', 'normal'\)/);
  assert.match(launcher, /if \(mode === 'supervivencia'\) \{ startSurvivalSelected\(\)/);
  assert.match(launcher, /if \(mode === 'zen'\)[\s\S]{0,120}?Game\.start\('zen', this\.zenDiff\)/);
});

test('Supervivencia reproduce la jerarquía de la referencia con datos reales', () => {
  const survival = between(js, 'survivalHtml() {', 'classicHtml() {');
  for (const token of [
    'mode-launch-progress-card', 'mode-launch-rank-layout', 'mode-launch-context-card',
    'mode-launch-choice-grid', 'mode-launch-traits', 'mode-launch-how-card',
  ]) assert.match(survival, new RegExp(token), `falta ${token}`);

  assert.match(survival, /Meta\.survRank\(\)/);
  assert.match(survival, /Meta\.survFeatCount\(\)/);
  assert.match(survival, /Survival\.weeklyMut\(\)/);
  assert.match(survival, /Meta\.survBestWaveFor\(diff\)/);
  assert.match(survival, /Config\.DIFF_ORDER\.map/);
  assert.match(js, /data-mode-option[\s\S]*?ModeLaunch\.select/);
});

test('paneles del lanzador: progreso, contexto y guía son controles funcionales', () => {
  const launcher = between(js, 'const ModeLaunch = {', 'function launchZen()');
  const survival = between(js, 'survivalHtml() {', 'classicHtml() {');
  assert.match(launcher, /infoButton\(kind = 'progress'\)[\s\S]*?<button class="mode-launch-info"[^>]*data-mode-detail="\$\{kind\}"/);
  assert.match(survival, /<button class="mode-launch-card mode-launch-context-card"[^>]*data-mode-detail="context"/);
  assert.match(launcher, /openDetail\(kind, trigger\)[\s\S]*?panel\.hidden = false/);
  assert.match(launcher, /closeDetail\(\{ restoreFocus = true \} = \{\}\)/);
  assert.match(js, /closest\('\[data-mode-detail\]'\)[\s\S]*?ModeLaunch\.openDetail/);
  assert.match(js, /btn-mode-launch-detail-close[\s\S]*?ModeLaunch\.closeDetail/);
  assert.match(launcher, /lines\.map\(\(line\) => `<span>/,
    'las líneas deben poder fluir en móvil sin saltos rígidos');
  assert.doesNotMatch(between(launcher, 'howItem(src, text', 'metric(src, value'), /<br>/);
});

test('assets generados: todos los iconos son PNG transparentes, nítidos y precacheados', () => {
  const swList = between(sw, 'const MODE_LAUNCH_ART = [', 'const CHEST_ATLASES =');
  assert.match(swList, /\.map\(\(n\) => '\.\/img\/ui-generated\/mode-launch\/' \+ n \+ '\.png'\)/);

  for (const name of MODE_LAUNCH_ASSETS) {
    const rel = `img/ui-generated/mode-launch/${name}.png`;
    const asset = path.join(ROOT, rel);
    assert.ok(fs.existsSync(asset), `falta ${rel}`);
    const meta = pngMeta(asset);
    const minSize = name.startsWith('mode-') ? 350 : 600;
    assert.ok(meta.width >= minSize && meta.height >= minSize,
      `${name} no tiene resolución suficiente (${meta.width}x${meta.height})`);
    assert.equal(meta.colorType & 4, 4, `${name} debe conservar canal alfa`);
    assert.match(swList, new RegExp(`['"]${name}['"]`), `${name} no está en precaché`);
  }

  const leftovers = fs.readdirSync(path.join(ROOT, 'img/ui-generated/mode-launch'))
    .filter((name) => /(?:-key|atlas-.*-alpha)\.png$/i.test(name));
  assert.deepEqual(leftovers, [], 'no deben publicarse fondos chroma ni atlas temporales');
});

test('lanzador de modos: usa arte propio y prohíbe emojis o iconos legacy', () => {
  const launcher = between(js, 'const MODE_LAUNCH_META = {', 'function launchZen()');
  assert.doesNotMatch(launcher, /\p{Extended_Pictographic}/u,
    'el modal no puede usar emojis como iconos');
  assert.doesNotMatch(launcher, /img\/ui(?:-v2)?\//,
    'el modal solo puede usar su pack generado dedicado');
  for (const name of MODE_LAUNCH_ASSETS) {
    assert.match(launcher + html, new RegExp(`img/ui-generated/mode-launch/${name}\\.png`),
      `el recurso ${name} debe estar conectado al modal`);
  }
});

test('tipografía de producto: Nunito Sans está empaquetada y aplicada globalmente', () => {
  const font = path.join(ROOT, 'fonts/NunitoSans-Variable.ttf');
  assert.ok(fs.existsSync(font), 'falta la fuente local de producto');
  assert.ok(fs.statSync(font).size > 500_000, 'el archivo de fuente parece incompleto');
  assert.match(css, /@font-face\s*\{[\s\S]*?font-family:\s*"Nunito Sans Game"[\s\S]*?NunitoSans-Variable\.ttf/);
  assert.match(css, /--app-font:\s*"Nunito Sans Game"/);
  assert.match(css, /body\s*\{[\s\S]*?font-family:\s*var\(--app-font\)/);
  assert.match(sw, /\.\/fonts\/NunitoSans-Variable\.ttf/);
});

test('lanzador de modos: el CSS conserva chasis, selección, CTA y responsive', () => {
  const launcherCss = css.slice(css.lastIndexOf('/* Lanzador de modos 2.0'));
  assert.match(launcherCss, /#modal-mode-launch\s*\{[\s\S]*?width:\s*min\(696px,[\s\S]*?border:\s*2px solid #d13dff/);
  assert.match(launcherCss, /\.mode-launch-emblem\s*\{[\s\S]*?border-radius:\s*50%/);
  assert.match(launcherCss, /\.mode-launch-close\s*\{[\s\S]*?clip-path:/);
  assert.match(launcherCss, /\.mode-launch-choice\.is-selected\s*\{[\s\S]*?border-color:\s*#ffb52b/);
  assert.match(launcherCss, /#modal-mode-launch \.mode-launch-start\s*\{[\s\S]*?linear-gradient\(180deg, #ffc420/);
  assert.match(launcherCss, /\.mode-launch-face img\s*\{[\s\S]*?width:\s*9\.37cqw;[\s\S]*?height:\s*9\.37cqw;/);
  assert.match(launcherCss, /\.mode-launch-start-icon img\s*\{[\s\S]*?width:\s*11\.83cqw;[\s\S]*?height:\s*11\.83cqw;/);
  assert.match(launcherCss, /@media \(max-width: 520px\) and \(orientation: portrait\)[\s\S]*?height:\s*min\(780px, calc\(100dvh - 12px\)\)/);
  assert.match(launcherCss, /@media \(max-width: 520px\)[\s\S]*?\.mode-launch-how-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(launcherCss, /\.mode-launch-how-item p > span\s*\{\s*display:\s*inline/);
  assert.match(launcherCss, /#modal-mode-launch > \.mode-launch-detail\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(launcherCss, /body\.reduced-fx #modal-mode-launch\s*\{\s*animation:\s*none/);
});

test('lanzador de modos: textos ES/EN cubren el contrato visual', () => {
  const required = [
    'mode_launch_close', 'mode_launch_back', 'mode_launch_details', 'mode_launch_progress', 'mode_launch_how',
    'ml_surv_tag', 'ml_surv_weekly', 'ml_surv_choose',
    'ml_classic_tag', 'ml_adv_tag', 'ml_timed_tag', 'ml_zen_tag',
  ];
  for (const key of required) {
    assert.equal((js.match(new RegExp(`\\b${key}:`, 'g')) || []).length, 2,
      `${key} debe existir exactamente en ES y EN`);
  }
});
