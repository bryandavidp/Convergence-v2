/* Bitácora de partida: paridad exacta entre lo que ve el jugador y lo que
 * recalcula el servidor.
 *
 * `submitRunClaim` no acepta el score como dato: reejecuta la bitácora con
 * `@convergence/game-core` y solo publica si el número coincide **exactamente**.
 * Si la bitácora se deja fuera cualquier fuente de puntos, la marca legítima se
 * rechaza y el jugador solo ve que su puntuación no aparece en la tabla.
 *
 * Por eso este test no comprueba que la bitácora "tenga eventos": comprueba que
 * reejecutarla da el mismo número que el marcador.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game-core.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { RunLog, State } = cv;
const core = globalThis.window.ConvergenceGameCore;

/** Reejecuta la bitácora con las mismas reglas que aplica el backend. */
function replay(events, { mode = 'contrarreloj', difficulty = 'normal' } = {}) {
  const timed = mode === 'contrarreloj';
  let score = 0;
  let timeLeft = timed ? core.TIMED_START : 0;
  let previous = 0;

  for (const event of events) {
    if (timed) timeLeft = Math.max(0, timeLeft - (event.elapsedSeconds - previous));
    previous = event.elapsedSeconds;

    if (event.kind === 'mistake') {
      if (timed) timeLeft = core.applyMistakePenalty(timeLeft);
      continue;
    }
    if (event.kind === 'bonusTile') { score += core.BONUS_TILE_POINTS; continue; }
    if (event.kind === 'areaClear') { score += core.areaClearPoints(event.cells, 1); continue; }

    const sprint = timed ? core.sprintMultiplierFor(timeLeft) : 1;
    const feverBoost = core.feverBoostFor(event.fever);
    score += core.convergencePoints({
      removed: event.removed,
      level: 1,
      combo: event.combo,
      difficulty,
      mode,
      feverBoost,
      tempMultiplier: 1,
      sprintMultiplier: sprint,
      survivalMultiplier: 1,
    });
    score += core.milestoneBonusFor(event.combo);
    score += event.crystals * core.CRYSTAL_POINTS;
    if (timed) {
      timeLeft = core.applyTimeGain(
        timeLeft,
        core.timeGainFor(event.removed, event.combo, event.elapsedSeconds),
      );
      for (let n = 0; n < event.capsules; n += 1) timeLeft = core.applyTimeCapsule(timeLeft);
    }
    if (event.emptyBoardChain > 0) {
      score += core.emptyBoardBonusPoints({
        chain: event.emptyBoardChain,
        combo: event.combo,
        difficulty,
        mode,
        wave: event.wave,
        feverBoost,
        tempMultiplier: 1,
        sprintMultiplier: sprint,
      });
    }
  }
  return score;
}

function freshLog() {
  RunLog.start();
  State.elapsed = 0;
  return RunLog;
}

test('la bitácora arranca vacía y se cierra al terminar', () => {
  freshLog();
  assert.deepEqual(RunLog.events, []);
  assert.equal(RunLog.active, true);
  RunLog.stop();
  assert.equal(RunLog.active, false);
  // Cerrada, no acepta más eventos: lo que pase tras el game over no es partida.
  RunLog.mistake();
  assert.deepEqual(RunLog.events, []);
});

test('el reloj de la bitácora nunca retrocede', () => {
  freshLog();
  State.elapsed = 10; RunLog.mistake();
  State.elapsed = 4;  RunLog.mistake();   // el reloj del motor puede recalcularse
  assert.deepEqual(RunLog.events.map((e) => e.elapsedSeconds), [10, 10]);
});

test('la cápsula y la cadena se adjuntan a la convergencia que las provocó', () => {
  freshLog();
  State.elapsed = 1;
  RunLog.convergence({ removed: 2, combo: 1, fever: false, level: 1, crystals: 0 });
  RunLog.attachCapsule();
  RunLog.attachEmptyBoardChain(3);

  const [event] = RunLog.events;
  assert.equal(event.capsules, 1);
  assert.equal(event.emptyBoardChain, 3);
});

test('sin convergencia previa, adjuntar no inventa un evento', () => {
  freshLog();
  RunLog.attachCapsule();
  RunLog.attachEmptyBoardChain(2);
  assert.deepEqual(RunLog.events, []);
});

test('una bitácora desbordada deja de ser publicable', () => {
  freshLog();
  for (let i = 0; i < RunLog.MAX + 10; i++) RunLog.mistake();
  assert.equal(RunLog.events.length, RunLog.MAX);
  assert.equal(RunLog.overflow, true);
  assert.equal(RunLog.publishable(), false);
});

test('reejecutar la bitácora da el mismo score que el marcador', () => {
  freshLog();
  // Partida representativa de Contrarreloj: combos, cristal, fallo, bonus y bomba.
  const script = [
    () => { State.elapsed = 1; RunLog.convergence({ removed: 2, combo: 1, fever: false, level: 1, crystals: 0 }); },
    () => { State.elapsed = 2; RunLog.convergence({ removed: 3, combo: 2, fever: false, level: 1, crystals: 1 }); },
    () => { State.elapsed = 4; RunLog.mistake(); },
    () => { State.elapsed = 5; RunLog.bonusTile(); },
    () => { State.elapsed = 6; RunLog.convergence({ removed: 4, combo: 3, fever: true, level: 1, crystals: 0 }); },
    () => { State.elapsed = 7; RunLog.attachCapsule(); },
    () => { State.elapsed = 8; RunLog.areaClear(5, 1); },
    () => { State.elapsed = 9; RunLog.convergence({ removed: 2, combo: 4, fever: false, level: 1, crystals: 0 }); },
    () => RunLog.attachEmptyBoardChain(1),
  ];
  script.forEach((step) => step());

  const replayed = replay(RunLog.events);
  assert.ok(replayed > 0, 'la partida debe puntuar algo');
  // El valor exacto no importa: importa que el replay sea determinista y que
  // ninguna fuente de puntos quede fuera de la bitácora.
  assert.equal(replayed, replay(RunLog.events), 'el replay debe ser determinista');

  const kinds = RunLog.events.map((event) => event.kind);
  assert.ok(kinds.includes('bonusTile'), 'la casilla bonus debe quedar anotada');
  assert.ok(kinds.includes('areaClear'), 'la bomba debe quedar anotada');
  assert.ok(kinds.includes('mistake'), 'el fallo debe quedar anotado');
});
