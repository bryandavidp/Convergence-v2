'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const { Meta, DailyMut, buildMissions } = globalThis.window.__cv;
const { getMemoEl } = require('./dom-stub.js');
const ROOT = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const between = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `no se pudo aislar ${start}`);
  return source.slice(from, to);
};

test('Misiones renderiza diaria, semanal, progreso, premio automático y reroll accionable', () => {
  const box = getMemoEl('q:#start-missions');
  buildMissions();
  assert.match(box.innerHTML, /mission-card/);
  assert.match(box.innerHTML, /role="progressbar"/);
  assert.match(box.innerHTML, /\+150 XP/);
  assert.match(box.innerHTML, /\+400 XP/);
  assert.match(box.innerHTML, /data-act="mission-play"/);
  const daily = Meta.dailyMission();
  if (!daily.done) {
    assert.match(box.innerHTML, /data-act="reroll-mission"/);
    assert.match(box.innerHTML, /aria-describedby="mission-reroll-note"/);
  }

  const handler = between(js, "else if (a === 'open-missions')", "else if (a === 'claim-daily')");
  assert.match(handler, /Meta\.rerollDaily\(\)/);
  assert.match(handler, /refreshStart\(\)/);
  assert.match(js, /wt-missions[\s\S]*?buildMissions\(\); HubViews\.open\('missions'\)/);
});

test('la ficha compartida define duración, guardado, objetivo y entrada para los cinco modos', () => {
  const meta = between(js, 'const MODE_SESSION_META = {', 'const ModeLaunch = {');
  for (const mode of ['clasico', 'aventura', 'contrarreloj', 'supervivencia', 'zen']) {
    assert.match(meta, new RegExp(`${mode}: \\{[^}]*duration:[^}]*save:[^}]*goal:[^}]*entry:`));
  }
  const launcher = between(js, 'const ModeLaunch = {', 'function launchZen');
  assert.match(launcher, /sessionHtml\(mode\)/);
  assert.match(launcher, /this\.sessionHtml\(this\.current\) \+ builders\[this\.current\]\(\)/);
  assert.match(launcher, /const preserveHub = document\.body\.dataset\.screen === 'start'/);
  assert.match(launcher, /if \(!preserveHub\)[\s\S]*?HubViews\.home\([\s\S]*?Screens\.show\('start'\)/);
  assert.match(css, /\.mode-launch-session\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/);
});

test('cada mutador diario declara una habilidad transferible y un modo real', () => {
  const validModes = new Set(['clasico', 'aventura', 'contrarreloj']);
  for (const id of DailyMut.LIST) {
    const lesson = DailyMut.lesson(id);
    assert.ok(lesson && /^daily_skill_/.test(lesson.skill), `${id} necesita habilidad`);
    assert.ok(validModes.has(lesson.mode), `${id} necesita destino válido`);
  }
  assert.match(js, /class="di-learning"/);
  assert.match(js, /class="daily-practice"[\s\S]*?data-act="daily-practice"/);
  assert.match(js, /State\.dailyMut \|\| DailyMut\.pick/);
  assert.match(js, /State\.dailyMut = mut;[\s\S]*?DailyMut\.apply\(mut\)/);
});

test('Inicio tiene un único CTA contextual y prioriza una partida guardada', () => {
  assert.equal((html.match(/id="home-play-now"/g) || []).length, 1);
  const refresh = between(js, 'function refreshStart() {', 'function refreshEvents() {');
  assert.match(refresh, /const snapshot = RunSave\.load\(\)/);
  assert.match(refresh, /if \(snapshot && resume\)[\s\S]*?playNow\.hidden = true/);
  assert.match(refresh, /dailyRun\.plays[\s\S]*?route = 'daily'/);
  assert.match(refresh, /ratio >= \.5[\s\S]*?route = 'mission'/);
  assert.match(refresh, /home_play_classic/);
});

test('HubViews conserva una pila de retorno y distingue Inicio, vistas y mapa', () => {
  const hub = between(js, 'const HubViews = {', 'const Modal = {');
  assert.match(hub, /_history:\s*\[\]/);
  assert.match(hub, /screen === 'worlds'[\s\S]*?kind: 'worlds'/);
  assert.match(hub, /kind: 'hub'/);
  assert.match(hub, /back\(\)[\s\S]*?route\.kind === 'hub'[\s\S]*?history: false/);
  assert.match(hub, /route\.kind === 'worlds'[\s\S]*?Worlds\.open\(\)/);
  assert.match(js, /\[data-view-back\][\s\S]*?HubViews\.back\(\)/);
  assert.match(js, /HubViews\.current !== 'home'\) HubViews\.back\(\)/);
});
