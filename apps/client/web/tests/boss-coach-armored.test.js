'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { State, Bosses, Survival, BossCoach, I18n, Render } = cv;
cv.Render.buildBoard();

function freshRun(wave = 6) {
  State.mode = 'supervivencia';
  State.diff = 'normal';
  State.status = 'playing';
  State.board = new Array(64).fill('circle_red');
  State.tiles = new Array(64).fill(null);
  State.iconCount = 64;
  Survival.wave = wave;
  Bosses.abort();
}

function cleanup() {
  Bosses.abort();
  BossCoach.hide();
  State.status = 'idle';
  localStorage.removeItem('cv_bosstut_flags');
}

test('BossCoach: gestiona correctamente las banderas en localStorage y no repite tutoriales', () => {
  cleanup();
  try {
    assert.equal(BossCoach.hasSeen('boss_intro'), false);
    assert.equal(BossCoach.check('boss_intro', '👑'), true, 'primer chequeo devuelve true');
    assert.equal(BossCoach.hasSeen('boss_intro'), true, 'bandera registrada');
    assert.equal(BossCoach.check('boss_intro', '👑'), false, 'segundo chequeo devuelve false');
  } finally {
    cleanup();
  }
});

test('BossCoach: pausa el estado del juego (State.status = paused) mientras se lee el tutorial y reanuda al cerrar', () => {
  freshRun(6);
  try {
    assert.equal(State.status, 'playing');
    BossCoach.show('boss_intro', '👑');
    assert.equal(State.status, 'paused', 'el juego se pausa automáticamente mientras el tutorial está abierto');

    Bosses.ENCOUNTERS = true;
    const e = Bosses.startEncounter('meteor');
    const msBefore = e.ms;
    Bosses.tick(1000);
    assert.equal(e.ms, msBefore, 'el temporizador del jefe NO avanza mientras está pausado');

    BossCoach.hide();
    assert.equal(State.status, 'playing', 'el estado vuelve a playing al cerrar el tutorial');
  } finally {
    cleanup();
  }
});

test('Bosses: la duración del jefe es ~100s y dañar un ancla extiende la permanencia (+6s)', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    const e = Bosses.startEncounter('meteor');
    assert.ok(e);
    const expectedBase = Math.round(Survival.WAVE_MS * 2.5);
    assert.equal(e.durMs, expectedBase, 'duración base del jefe es ~100s');

    const initialDur = e.durMs;
    const idx = Bosses._anchorIdx()[0];
    Bosses.onAnchorHit(idx);
    assert.equal(e.durMs, initialDur + 6000, 'golpear un ancla otorga +6s extra de tiempo');
  } finally {
    cleanup();
  }
});

test('Bosses: las anclas blindadas se renderizan con boss-armored', () => {
  freshRun(12);
  try {
    Bosses.ENCOUNTERS = true;
    const e = Bosses.startEncounter('lockdown');
    assert.ok(e);
    const armoredIdx = Bosses._anchorIdx().find((i) => State.tiles[i] && State.tiles[i].hits > 0);
    assert.ok(armoredIdx !== undefined, 'hay al menos un ancla blindada');
    Render.syncCell(armoredIdx);
    const cellEl = Render.cells[armoredIdx];
    assert.ok(cellEl.classList.contains('boss-armored'), 'celda contiene la clase boss-armored');
  } finally {
    cleanup();
  }
});

test('Survival: offerBoons despliega el tutorial boss_boons la primera vez y ejecuta la callback al cerrar', () => {
  freshRun(6);
  try {
    let pickerOpened = false;
    const originalOpen = cv.Picker.open;
    cv.Picker.open = () => { pickerOpened = true; };

    Survival.offerBoons();
    assert.equal(BossCoach.hasSeen('boss_boons'), true, 'la bandera boss_boons ha sido vista');
    assert.equal(pickerOpened, false, 'Picker.open no se abre hasta presionar ¡Entendido!');

    BossCoach.hide();
    cv.Picker.open = originalOpen;
  } finally {
    cleanup();
  }
});

test('BossCoach: aceptar bendiciones abre el selector y aplica la variante visual correcta', () => {
  freshRun(6);
  try {
    let pickerOpened = false;
    const originalOpen = cv.Picker.open;
    cv.Picker.open = () => { pickerOpened = true; };

    Survival.offerBoons();
    assert.equal(document.querySelector('#boss-coach').dataset.tutorial, 'boons');
    assert.equal(document.querySelector('#boss-coach').getAttribute('aria-labelledby'), 'boss-coach-boons-title');
    BossCoach.accept();
    assert.equal(pickerOpened, true, 'el selector real se abre al aceptar el tutorial');

    cv.Picker.open = originalOpen;
  } finally {
    cleanup();
  }
});

test('BossCoach: bendiciones mantiene título/texto en flujo y el 2× dentro de una tarjeta del mismo tamaño', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

  assert.match(html, /<div class="boss-coach-boons-copy">[\s\S]*?<\/div>\s*<div class="boss-coach-boon-list">/);
  assert.match(html, /<span><i class="boss-coach-score-icon" aria-hidden="true">2×<\/i><\/span>/);
  assert.match(css, /\.boss-coach-boon-list\s*\{\s*grid-area:\s*list;/);
  assert.doesNotMatch(css, /\.boss-coach-boons-copy\s*\{\s*display:\s*contents;/);
});

test('I18n: todas las claves de BossCoach y anclas blindadas existen en ES y EN', () => {
  const keys = [
    'bosstut_boss_intro_title', 'bosstut_boss_intro_body',
    'bosstut_boss_intro_panel', 'bosstut_boss_intro_detail1_title', 'bosstut_boss_intro_detail1_body',
    'bosstut_boss_intro_detail2_title', 'bosstut_boss_intro_detail2_body', 'bosstut_boss_intro_tip_title', 'bosstut_boss_intro_tip_body',
    'bosstut_boss_armored_title', 'bosstut_boss_armored_body',
    'bosstut_boss_armored_panel', 'bosstut_boss_armored_detail1_title', 'bosstut_boss_armored_detail1_body',
    'bosstut_boss_armored_detail2_title', 'bosstut_boss_armored_detail2_body', 'bosstut_boss_armored_tip_title', 'bosstut_boss_armored_tip_body',
    'bosstut_boss_phase2_title', 'bosstut_boss_phase2_body',
    'bosstut_boss_phase2_panel', 'bosstut_boss_phase2_detail1_title', 'bosstut_boss_phase2_detail1_body',
    'bosstut_boss_phase2_detail2_title', 'bosstut_boss_phase2_detail2_body', 'bosstut_boss_phase2_tip_title', 'bosstut_boss_phase2_tip_body',
    'bosstut_boss_boons_title', 'bosstut_boss_boons_body', 'bosstut_boss_boons_tip',
    'surv_armored_hint', 'surv_armored_broken',
  ];
  for (const k of keys) {
    assert.ok(I18n.DICT.es[k], `falta clave ES: ${k}`);
    assert.ok(I18n.DICT.en[k], `falta clave EN: ${k}`);
  }
});
