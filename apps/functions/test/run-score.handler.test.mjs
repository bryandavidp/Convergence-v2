import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAX_RUN_EVENTS,
  parseRunClaim,
  recomputeRun,
  verifyRunClaim,
} from '../lib/run-score.js';
import { verifyRun } from '../lib/index.js';

function convergence(overrides = {}) {
  return {
    kind: 'convergence',
    removed: 2,
    combo: 1,
    fever: false,
    elapsedSeconds: 0,
    ...overrides,
  };
}

function claim(events, mode = 'contrarreloj', difficulty = 'normal') {
  return { mode, difficulty, events, endedAtSeconds: 0 };
}

test('el callable exige identidad autenticada antes de recalcular', async () => {
  await assert.rejects(
    verifyRun.run({ data: {}, auth: undefined }),
    (error) => {
      assert.equal(error?.code, 'unauthenticated');
      return true;
    },
  );
});

test('cada modo aplica su propio multiplicador', () => {
  const events = [convergence()];
  // base 20 · dificultad normal 1.0 · multiplicador del modo
  assert.equal(recomputeRun(claim(events, 'tutorial')).score, 10);
  assert.equal(recomputeRun(claim(events, 'clasico')).score, 20);
  assert.equal(recomputeRun(claim(events, 'aventura')).score, 22);
  assert.equal(recomputeRun(claim(events, 'contrarreloj')).score, 24);
  assert.equal(recomputeRun(claim(events, 'supervivencia')).score, 30);
  assert.equal(recomputeRun(claim(events, 'zen')).score, 16);
});

test('Zen ignora una Fiebre declarada: el modo no puede tenerla', () => {
  const withFever = recomputeRun(claim([convergence({ fever: true })], 'zen'));
  const withoutFever = recomputeRun(claim([convergence()], 'zen'));
  assert.equal(withFever.score, withoutFever.score);
});

test('el nivel declarado solo se respeta donde el modo lo tiene', () => {
  const events = [convergence({ level: 10 })];
  // Clásico y Aventura escalan con el nivel...
  assert.equal(recomputeRun(claim(events, 'clasico')).score, 200);
  // ...y el resto lo ignora, aunque el cliente lo envíe.
  assert.equal(recomputeRun(claim(events, 'contrarreloj')).score, 24);
  assert.equal(recomputeRun(claim(events, 'zen')).score, 16);
});

test('Supervivencia deriva nivel y multiplicadores de la oleada, no del cliente', () => {
  // Oleada 13 en normal: nivel sintético 3, tier de frenesí 3.
  const base = recomputeRun(claim([convergence({ wave: 13, level: 999 })], 'supervivencia'));
  assert.equal(base.score, 90, 'el nivel 999 declarado se ignora: manda la oleada');

  const boosted = recomputeRun(claim(
    [convergence({ wave: 13, x2Active: true, frenzyActive: true, scoreBoost: 0.5 })],
    'supervivencia',
  ));
  assert.ok(boosted.score > base.score, 'potenciadores y bendiciones deben sumar');
});

test('un multiplicador enviado por el cliente no se usa jamás', () => {
  const honest = recomputeRun(claim([convergence()], 'clasico'));
  const cheated = recomputeRun(claim(
    [convergence({ tempMultiplier: 1000, feverBoost: 1000, survivalMultiplier: 1000 })],
    'clasico',
  ));
  assert.equal(cheated.score, honest.score, 'los factores se derivan, no se aceptan');
});

test('el bono de tablero vacío solo lo cobran los modos endless', () => {
  const events = [convergence({ emptyBoardChain: 1 })];
  assert.ok(recomputeRun(claim(events, 'zen')).score > 500, 'Zen es endless');
  assert.equal(recomputeRun(claim(events, 'clasico')).score, 20, 'Clásico no lo cobra');
});

test('el bono plano de tablero perfecto solo lo cobran los modos sin bono escalado', () => {
  const events = [convergence({ perfectLevel: true })];
  assert.equal(recomputeRun(claim(events, 'clasico')).score, 20 + 500);
  assert.equal(recomputeRun(claim(events, 'zen')).score, 16, 'Zen usa el escalado, no el plano');
});

test('el score del cliente se compara, nunca se acepta como dato', () => {
  const payload = { claimedScore: 20, run: claim([convergence()], 'clasico') };
  assert.equal(verifyRunClaim(payload).accepted, true);

  const inflated = verifyRunClaim({ ...payload, claimedScore: 999_999 });
  assert.equal(inflated.accepted, false);
  assert.equal(inflated.score, 20, 'el recalculado manda');
  assert.equal(inflated.mode, 'clasico');
});

test('rechaza reclamaciones imposibles antes de recalcular', () => {
  const invalid = [
    { claimedScore: 0, run: claim([convergence({ removed: 1 })]) },
    { claimedScore: 0, run: claim([convergence({ removed: 9 })]) },
    { claimedScore: 0, run: claim([convergence({ combo: -1 })]) },
    { claimedScore: 0, run: claim([convergence({ elapsedSeconds: -5 })]) },
    { claimedScore: 0, run: claim([convergence({ wave: 0 })], 'supervivencia') },
    { claimedScore: 0, run: claim([convergence({ scoreBoost: 99 })], 'supervivencia') },
    { claimedScore: 0, run: claim([convergence({ fever: 'sí' })]) },
    { claimedScore: 0, run: claim([{ kind: 'teleport', elapsedSeconds: 0 }]) },
    { claimedScore: 0, run: claim([convergence()], 'karaoke') },
    { claimedScore: 0, run: claim([convergence()], 'clasico', 'imposible') },
    { claimedScore: -1, run: claim([convergence()]) },
  ];
  for (const [index, payload] of invalid.entries()) {
    assert.throws(
      () => verifyRunClaim(payload),
      (error) => error.code === 'invalid-argument',
      `caso ${index} debería rechazarse`,
    );
  }
});

test('una run desmesurada se rechaza en vez de procesarse', () => {
  const events = Array.from({ length: MAX_RUN_EVENTS + 1 }, () => convergence());
  assert.throws(
    () => parseRunClaim(claim(events)),
    (error) => error.code === 'invalid-argument',
  );
});

/**
 * La comprobación que da sentido a todo lo demás: se juegan partidas reales de
 * los seis modos con el motor del cliente y se recalculan en el backend. El
 * motor corre **sin** `window.ConvergenceGameCore`, así que usa su expresión
 * histórica: si el recálculo coincide, cliente y servidor puntúan igual.
 */
test('el backend recalcula lo que puntuó el motor en los seis modos', async () => {
  const VCLOCK = { t: 0 };
  Object.defineProperty(globalThis, 'performance', {
    value: { now: () => VCLOCK.t },
    configurable: true,
    writable: true,
  });

  const require = createRequire(import.meta.url);
  const webRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../client/web',
  );
  require(path.join(webRoot, 'tests/dom-stub.js'));
  require(path.join(webRoot, 'game.js'));

  const cv = globalThis.window.__cv;
  delete globalThis.window.ConvergenceGameCore;
  cv.Render.buildBoard();
  if (typeof cv.FX.init === 'function') cv.FX.init();
  for (const key of Object.keys(cv.FX)) if (typeof cv.FX[key] === 'function') cv.FX[key] = () => {};
  for (const key of Object.keys(cv.Sound)) if (typeof cv.Sound[key] === 'function') cv.Sound[key] = () => {};
  for (let chapter = 0; chapter < 120; chapter += 1) cv.Meta.markAdvChapterSeen(chapter);
  cv.Survival._mutOverride = 'none';

  const { Game, State, Loop, Survival, Adventure } = cv;

  function playAndVerify(mode, difficulty) {
    if (mode === 'aventura') {
      cv.Meta.state.adventure.maxLevel = 1;
      if (typeof Adventure.resetRun === 'function') Adventure.resetRun();
    }
    const events = [];
    let skipped = 0;
    let perfectThisTap = false;

    VCLOCK.t = 0;
    Game.start(mode, difficulty, undefined, 0xbeef);

    const originalLevelComplete = Game.levelComplete.bind(Game);
    Game.levelComplete = (perfect) => { perfectThisTap = !!perfect; return originalLevelComplete(perfect); };
    const originalActivate = Game.activate.bind(Game);
    Game.activate = (index) => {
      perfectThisTap = false;
      const converging = cv.Engine.converging(index);
      const before = {
        comboAt: State.comboAt,
        elapsed: State.elapsed,
        level: State.level,
        removedTotal: State.removedTotal,
        emptyBoards: State.emptyBoards || 0,
        wave: Survival.wave,
        crystals: converging
          .filter((idx) => State.tiles[idx] && State.tiles[idx].type === 'crystal').length,
        capsules: State.tiles
          .map((tile, idx) => (tile && tile.type === 'timecap' ? idx : -1))
          .filter((idx) => idx !== -1),
      };
      originalActivate(index);

      if (converging.length < 2) {
        events.push({ kind: 'mistake', elapsedSeconds: before.elapsed });
        return;
      }
      // Toque rechazado por el motor (tablero bloqueado, baldosa rompible).
      if (State.comboAt === before.comboAt) return;
      // Los efectos de baldosa puntúan aparte: ese sistema no está extraído.
      if (State.removedTotal - before.removedTotal !== converging.length) { skipped += 1; return; }

      events.push({
        kind: 'convergence',
        removed: converging.length,
        combo: State.combo,
        fever: State.fever,
        elapsedSeconds: before.elapsed,
        level: before.level,
        crystals: before.crystals,
        capsules: before.capsules
          .filter((idx) => !State.tiles[idx] || State.tiles[idx].type !== 'timecap').length,
        emptyBoardChain: (State.emptyBoards || 0) > before.emptyBoards ? State.emptyBoards : 0,
        perfectLevel: perfectThisTap,
        wave: before.wave,
        x2Active: mode === 'supervivencia' ? Survival.x2Active() : false,
        frenzyActive: mode === 'supervivencia' ? Survival.frenzyActive() : false,
        scoreBoost: mode === 'supervivencia' ? (Survival.scoreBoost || 0) : 0,
        goldenWave: mode === 'supervivencia' ? Survival.goldenWaveWaves > 0 : false,
        denseRoute: mode === 'aventura' ? (State.tempMult || 1) > 1 : false,
        crystalRelic: mode === 'aventura' && Adventure.hasRelic('crystal'),
      });
    };

    let nextActAt = 220;
    while (VCLOCK.t < 90_000 && events.length < 250) {
      VCLOCK.t += 50;
      Loop.tick(VCLOCK.t);
      if (State.status === 'levelComplete') { Game.nextLevel(); continue; }
      if (State.status === 'paused') {
        const pending = cv.Picker && cv.Picker.pending;
        if (!pending) break;
        if (pending.onCancel) cv.Picker.cancel();
        else if (pending.options && pending.options.length) cv.Picker.pick(pending.options[0].id);
        else cv.Picker.cancel();
        continue;
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

    // El Tutorial fuerza `facil` aunque se pida otra: la reclamación debe llevar
    // la dificultad con la que el motor puntuó de verdad.
    return {
      events, skipped, engineScore: State.score, elapsed: State.elapsed,
      effectiveDifficulty: State.diff,
    };
  }

  for (const mode of ['tutorial', 'clasico', 'aventura', 'contrarreloj', 'supervivencia', 'zen']) {
    const { events, skipped, engineScore, elapsed, effectiveDifficulty } = playAndVerify(mode, 'normal');
    const convergences = events.filter((event) => event.kind === 'convergence').length;
    assert.ok(convergences >= 5, `${mode}: muestra insuficiente (${convergences})`);
    // Solo se puede exigir igualdad exacta si ningún toque puntuó por otra vía.
    if (skipped > 0) continue;

    const verdict = verifyRunClaim({
      claimedScore: engineScore,
      run: { mode, difficulty: effectiveDifficulty, events, endedAtSeconds: elapsed },
    });
    assert.equal(
      verdict.score,
      engineScore,
      `${mode}: el recálculo del servidor debe cuadrar con el motor del cliente`,
    );
    assert.equal(verdict.accepted, true, `${mode}: la reclamación honesta debe aceptarse`);
  }
});
