import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ADVENTURE_DENSE_ROUTE_MULT,
  areaClearPoints,
  CLASSIC_MODE_MULT,
  CRYSTAL_POINTS,
  DIFFICULTY,
  FRENZY_BASE_MULT,
  FRENZY_TIER_STEP,
  PERFECT_BOARD_BONUS,
  RELIC_COMBO_WINDOW_BONUS_MS,
  RELIC_CRYSTAL_BONUS,
  SURVIVAL_VAR_EVERY,
  TUTORIAL_MODE_MULT,
  adventureComboWindow,
  adventureConvergencePoints,
  adventureCrystalPoints,
  classicConvergencePoints,
  classicMistakeIcons,
  frenzyMultiplier,
  frenzyTier,
  iconPenaltyCount,
  milestoneBonusFor,
  nextCombo,
  penalizedSpawnRate,
  survivalConvergencePoints,
  survivalEmptyBoardBonus,
  survivalFeverBoost,
  survivalFeverThreshold,
  survivalLevel,
  survivalScoreMultiplier,
  survivalTempMultiplier,
  tutorialConvergencePoints,
} from '../dist/index.js';

const VCLOCK = { t: 0 };
Object.defineProperty(globalThis, 'performance', {
  value: { now: () => VCLOCK.t },
  configurable: true,
  writable: true,
});

const require = createRequire(import.meta.url);
const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../apps/client/web',
);
require(path.join(webRoot, 'tests/dom-stub.js'));
require(path.join(webRoot, 'game.js'));

const cv = globalThis.window.__cv;
assert.ok(cv, 'game.js no expuso window.__cv');

cv.Render.buildBoard();
if (typeof cv.FX.init === 'function') cv.FX.init();
for (const key of Object.keys(cv.FX)) if (typeof cv.FX[key] === 'function') cv.FX[key] = () => {};
for (const key of Object.keys(cv.Sound)) if (typeof cv.Sound[key] === 'function') cv.Sound[key] = () => {};
// Aventura pausa esperando un tap en las intros de capítulo, que en Node no llega.
for (let chapter = 0; chapter < 120; chapter += 1) cv.Meta.markAdvChapterSeen(chapter);
// Mutador semanal de Supervivencia: fijarlo hace la batería reproducible.
cv.Survival._mutOverride = 'none';

const { Config, Game, State, Loop, Survival, Adventure } = cv;

test('las constantes de los cuatro modos no se han desviado del motor', () => {
  assert.equal(TUTORIAL_MODE_MULT, Config.MODES.tutorial.mult);
  assert.equal(CLASSIC_MODE_MULT, Config.MODES.clasico.mult);
  assert.equal(Config.MODES.tutorial.penalties, false, 'el tutorial no penaliza');
  assert.equal(Config.MODES.clasico.penalties, true);
  assert.equal(Config.MODES.aventura.penalties, true);
  assert.equal(Config.MODES.supervivencia.endless, true);

  for (const difficulty of ['facil', 'normal', 'dificil']) {
    assert.equal(SURVIVAL_VAR_EVERY[difficulty], Survival.TUNE[difficulty].varEvery);
    assert.equal(DIFFICULTY[difficulty].penaltyBase, Config.DIFFICULTY[difficulty].penaltyBase);
    assert.equal(DIFFICULTY[difficulty].spawnMin, Config.DIFFICULTY[difficulty].spawnMin);
  }
});

test('la penalización por fallo coincide con la del motor en todo el rango', () => {
  for (const difficulty of ['facil', 'normal', 'dificil']) {
    for (let level = 1; level <= 60; level += 1) {
      const expected = Math.min(
        5,
        Math.max(1, Config.DIFFICULTY[difficulty].penaltyBase + Math.floor((level - 1) / 3)),
      );
      assert.equal(iconPenaltyCount(difficulty, level), expected, `${difficulty} nivel ${level}`);
      assert.equal(classicMistakeIcons(difficulty, level), expected);
    }
    assert.equal(
      penalizedSpawnRate(difficulty, 5_000),
      Math.max(Config.DIFFICULTY[difficulty].spawnMin, Math.round(5_000 * 0.95)),
    );
  }
});

test('las fórmulas de frenesí y nivel sintético de Supervivencia son las del motor', () => {
  for (const difficulty of ['facil', 'normal', 'dificil']) {
    Survival.diff = difficulty;
    for (let wave = 1; wave <= 40; wave += 1) {
      Survival.wave = wave;
      assert.equal(frenzyTier(wave), Survival.frenzyTier(), `tier oleada ${wave}`);
      assert.equal(
        survivalLevel(wave, difficulty),
        1 + Math.floor((wave - 1) / Survival.TUNE[difficulty].varEvery),
        `nivel sintético oleada ${wave} · ${difficulty}`,
      );
      assert.equal(
        survivalFeverThreshold(wave),
        Math.max(6, Config.FEVER_COMBO - Survival.frenzyTier()),
      );
      assert.equal(
        frenzyMultiplier(wave, true),
        FRENZY_BASE_MULT + Survival.frenzyTier() * FRENZY_TIER_STEP,
      );
      assert.equal(frenzyMultiplier(wave, false), 1);
    }
  }
});

test('bendiciones y potenciadores componen igual que en el motor', () => {
  Survival.wave = 9;
  Survival.scoreBoost = 0.3;
  Survival.goldenWaveWaves = 0;
  assert.equal(survivalScoreMultiplier(0.3, false), Survival.scoreMult());

  Survival.goldenWaveWaves = 2;
  assert.equal(survivalScoreMultiplier(0.3, true), Survival.scoreMult());

  Survival.scoreBoost = 0;
  Survival.goldenWaveWaves = 0;
  assert.equal(survivalTempMultiplier(9, { x2Active: false, frenzyActive: false }), 1);
  assert.equal(
    survivalTempMultiplier(9, { x2Active: true, frenzyActive: true }),
    2 * (FRENZY_BASE_MULT + frenzyTier(9) * FRENZY_TIER_STEP),
  );
});

test('la limpieza por área puntúa sin multiplicadores, como en el motor', () => {
  // `pts = cells.length * 10 * State.level` en el efecto de bomba: ni combo, ni
  // dificultad, ni modo, ni fiebre.
  assert.equal(areaClearPoints(5, 1), 50);
  assert.equal(areaClearPoints(5, 4), 200);
  assert.equal(areaClearPoints(0, 9), 0);
});

test('las reliquias de Aventura valen lo que dice el motor', () => {
  assert.equal(adventureCrystalPoints(false), CRYSTAL_POINTS);
  assert.equal(adventureCrystalPoints(true), CRYSTAL_POINTS + RELIC_CRYSTAL_BONUS);
  assert.equal(adventureComboWindow(3_500, false), 3_500);
  assert.equal(adventureComboWindow(3_500, true), 3_500 + RELIC_COMBO_WINDOW_BONUS_MS);
  assert.equal(ADVENTURE_DENSE_ROUTE_MULT, 1.25);
});

/**
 * Juega una partida real y compara toque a toque la puntuación del motor contra
 * la que predice el núcleo. `predict` recibe el estado previo y devuelve los
 * puntos esperados de ese toque, incluidos hitos, cristales y bonos.
 */
function playAndCompare({ mode, difficulty, seed, predict, minSamples = 15, setup }) {
  const samples = [];

  VCLOCK.t = 0;
  Game.start(mode, difficulty, undefined, seed);
  if (setup) setup();

  // El bono de tablero perfecto lo decide el motor, no se puede inferir del
  // estado: Aventura completa niveles sin que cuenten como perfectos. Se envuelve
  // `levelComplete` para leer su decisión real en el toque en curso.
  let perfectThisTap = false;
  const originalLevelComplete = Game.levelComplete.bind(Game);
  Game.levelComplete = (perfect) => { perfectThisTap = !!perfect; return originalLevelComplete(perfect); };

  const originalActivate = Game.activate.bind(Game);
  Game.activate = (index) => {
    const converging = cv.Engine.converging(index);
    perfectThisTap = false;
    const before = {
      score: State.score,
      // El Tutorial fuerza `facil` aunque se pida otra: la dificultad efectiva
      // es la del motor, no la solicitada.
      difficulty: State.diff,
      combo: State.combo,
      comboAt: State.comboAt,
      comboWindow: State.comboWindow,
      fever: State.fever,
      level: State.level,
      tempMult: State.tempMult || 1,
      now: performance.now(),
      removed: converging.length,
      wave: Survival.wave,
      emptyBoards: State.emptyBoards || 0,
      removedTotal: State.removedTotal,
      crystals: converging
        .filter((idx) => State.tiles[idx] && State.tiles[idx].type === 'crystal').length,
      survivalMultiplier: mode === 'supervivencia' ? Survival.scoreMult() : 1,
      // Las reliquias se ganan a mitad de partida: hay que leerlas en el toque,
      // no al comparar, o se aplicarían a convergencias anteriores a obtenerlas.
      crystalRelic: mode === 'aventura' && Adventure.hasRelic('crystal'),
    };
    originalActivate(index);
    // El motor rechaza toques sin procesarlos: tablero bloqueado en Supervivencia,
    // baldosas rompibles, disparadores. Solo en una convergencia procesada avanza
    // `comboAt`, así que es la señal exacta de que el toque contó.
    if (before.removed < 2 || State.comboAt === before.comboAt) return;
    // Las baldosas de efecto (bombas, áreas) limpian celdas extra y puntúan
    // aparte dentro del mismo toque. Son otro sistema, todavía sin extraer, así
    // que esos toques no sirven para comparar la fórmula de convergencia.
    if (State.removedTotal - before.removedTotal !== before.removed) return;
    samples.push({
      before,
      after: {
        score: State.score,
        combo: State.combo,
        fever: State.fever,
        emptyBoardChain: (State.emptyBoards || 0) > before.emptyBoards ? State.emptyBoards : 0,
        // Completar el nivel con el tablero perfecto suma un bono plano dentro
        // del mismo delta de puntuación en los modos sin bono escalado.
        // `perfectEver` no sirve como señal: es de partida, no de nivel, así que
        // el segundo tablero perfecto de la misma run no lo movería.
        perfectLevel: perfectThisTap,
      },
    });
  };

  let nextActAt = 220;
  while (VCLOCK.t < 180_000 && samples.length < 200) {
    VCLOCK.t += 50;
    Loop.tick(VCLOCK.t);
    if (State.status === 'levelComplete') { Game.nextLevel(); continue; }
    if (State.status === 'paused') {
      const pending = cv.Picker && cv.Picker.pending;
      if (pending) {
        if (pending.onCancel) cv.Picker.cancel();
        else if (pending.options && pending.options.length) cv.Picker.pick(pending.options[0].id);
        else cv.Picker.cancel();
        continue;
      }
      break;
    }
    if (State.status !== 'playing') break;
    if (VCLOCK.t < nextActAt) continue;
    nextActAt += 220;

    let played = -1;
    for (let i = 0; i < State.board.length; i += 1) {
      if (State.board[i] === null && cv.Engine.converging(i).length >= 2) { played = i; break; }
    }
    if (played === -1) continue;
    Game.activate(played);
  }
  Game.activate = originalActivate;
  Game.levelComplete = originalLevelComplete;

  assert.ok(samples.length >= minSamples, `${mode}/${difficulty}: muestra insuficiente (${samples.length})`);

  for (const [index, { before, after }] of samples.entries()) {
    const combo = nextCombo(before.combo, before.comboAt, before.now, before.comboWindow);
    assert.equal(after.combo, combo, `${mode}/${difficulty} #${index}: combo`);
    assert.equal(
      after.score - before.score,
      predict({ before, after, combo, difficulty: before.difficulty }),
      `${mode}/${difficulty} #${index}: puntos (removed=${before.removed}, combo=${combo}, level=${before.level})`,
    );
  }
  return samples;
}

for (const difficulty of ['facil', 'normal', 'dificil']) {
  test(`paridad del Tutorial · ${difficulty}`, () => {
    playAndCompare({
      // El Tutorial es corto y guiado: da menos muestra que el resto.
      mode: 'tutorial', difficulty, seed: 0x7c7, minSamples: 5,
      predict: ({ before, after, combo, difficulty }) => before.crystals * CRYSTAL_POINTS
        + tutorialConvergencePoints({
          removed: before.removed, combo, difficulty, fever: before.fever || combo >= Config.FEVER_COMBO,
        })
        + milestoneBonusFor(combo)
        + (after.perfectLevel ? PERFECT_BOARD_BONUS : 0),
    });
  });

  test(`paridad de Clásico · ${difficulty}`, () => {
    playAndCompare({
      mode: 'clasico', difficulty, seed: 0xc1a51c0,
      predict: ({ before, after, combo, difficulty }) => before.crystals * CRYSTAL_POINTS
        + classicConvergencePoints({
          removed: before.removed, combo, difficulty, level: before.level,
          fever: before.fever || combo >= Config.FEVER_COMBO,
        })
        + milestoneBonusFor(combo)
        + (after.perfectLevel ? PERFECT_BOARD_BONUS : 0),
    });
  });

  test(`paridad de Aventura · ${difficulty}`, () => {
    playAndCompare({
      mode: 'aventura', difficulty, seed: 0xadbe27,
      predict: ({ before, after, combo, difficulty }) => before.crystals * adventureCrystalPoints(before.crystalRelic)
        + adventureConvergencePoints({
          removed: before.removed, combo, difficulty, level: before.level,
          fever: before.fever || combo >= Config.FEVER_COMBO,
          tempMultiplier: before.tempMult,
        })
        + milestoneBonusFor(combo)
        + (after.perfectLevel ? PERFECT_BOARD_BONUS : 0),
    });
  });

  test(`paridad de Supervivencia · ${difficulty}`, () => {
    playAndCompare({
      mode: 'supervivencia', difficulty, seed: 0x5c2b1a,
      predict: ({ before, after, combo, difficulty }) => {
        const fever = before.fever || combo >= survivalFeverThreshold(before.wave);
        const feverBoost = survivalFeverBoost(fever, before.wave);
        return before.crystals * CRYSTAL_POINTS
          + survivalConvergencePoints({
            removed: before.removed, combo, difficulty, level: before.level,
            feverBoost, tempMultiplier: before.tempMult,
            survivalMultiplier: before.survivalMultiplier,
          })
          + milestoneBonusFor(combo)
          + (after.emptyBoardChain > 0
            ? survivalEmptyBoardBonus({
              chain: after.emptyBoardChain, combo, difficulty,
              wave: before.wave, feverBoost, tempMultiplier: before.tempMult,
            })
            : 0);
      },
    });
  });
}
