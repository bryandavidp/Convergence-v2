/* GENERADO por scripts/build-game-core-browser.mjs — no editar a mano.
 * Fuente: packages/game-core/src/modes/time-attack.ts
 * Regenerar con: npm run build:core:browser
 */
(function () {
  'use strict';
  var exports = {};
"use strict";
/**
 * Reglas puras del modo Contrarreloj, extraídas del motor de `game.js` 2.37.2.
 *
 * Las constantes se duplican aquí a propósito en vez de importarse del cliente:
 * el núcleo debe poder ejecutarse en el backend sin cargar el juego. La
 * duplicación la vigila `time-attack-parity.test.mjs`, que compara cada valor
 * contra el `Config` legacy y falla si alguno se desvía.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIME_CAPSULE_SECONDS = exports.CRYSTAL_POINTS = exports.EMPTY_BOARD_MIN_POINTS = exports.EMPTY_BOARD_COMBO_CAP = exports.EMPTY_BOARD_COMBO_STEP = exports.EMPTY_BOARD_CHAIN_STEP = exports.EMPTY_BOARD_BONUS = exports.DIFFICULTY = exports.TIME_ATTACK_LEVEL = exports.TIME_ATTACK_INITIAL_ICONS = exports.TIME_ATTACK_MODE_MULT = exports.SPRINT_MULT = exports.SPRINT_WINDOW = exports.TIMED_GAIN = exports.TIMED_MISTAKE_S = exports.TIMED_CAP = exports.TIMED_START = exports.FEVER_BOOST = exports.FEVER_COMBO = exports.MILESTONES = exports.COMBO_MULTIPLIERS = void 0;
exports.comboMultiplierFor = comboMultiplierFor;
exports.nextCombo = nextCombo;
exports.sprintMultiplierFor = sprintMultiplierFor;
exports.feverBoostFor = feverBoostFor;
exports.convergencePoints = convergencePoints;
exports.milestoneBonusFor = milestoneBonusFor;
exports.emptyBoardBonusPoints = emptyBoardBonusPoints;
exports.timeGainFor = timeGainFor;
exports.applyTimeGain = applyTimeGain;
exports.applyMistakePenalty = applyMistakePenalty;
exports.applyTimeCapsule = applyTimeCapsule;
exports.shouldEnterFever = shouldEnterFever;
/** `[umbral, multiplicador]`, evaluado de mayor a menor: gana la primera coincidencia. */
exports.COMBO_MULTIPLIERS = [
    [30, 10], [20, 8], [15, 5], [10, 3], [6, 2], [3, 1.5],
];
/** Puntos planos que se suman exactamente al alcanzar ese combo. */
exports.MILESTONES = { 10: 500, 20: 1000, 30: 2000 };
exports.FEVER_COMBO = 10;
exports.FEVER_BOOST = 1.25;
exports.TIMED_START = 60;
exports.TIMED_CAP = 90;
exports.TIMED_MISTAKE_S = 3;
exports.TIMED_GAIN = {
    base: 0.9,
    perIcon: 0.6,
    combo: 0.32,
    comboCap: 4,
    decaySec: 125,
    minDecay: 0.08,
};
exports.SPRINT_WINDOW = 10;
exports.SPRINT_MULT = 1.5;
exports.TIME_ATTACK_MODE_MULT = 1.2;
exports.TIME_ATTACK_INITIAL_ICONS = 22;
/** Contrarreloj no tiene niveles: `State.level` vale siempre 1. */
exports.TIME_ATTACK_LEVEL = 1;
exports.DIFFICULTY = {
    facil: { comboWindow: 5000, scoreMult: 0.8, initialIcons: 12 },
    normal: { comboWindow: 3500, scoreMult: 1.0, initialIcons: 18 },
    dificil: { comboWindow: 2500, scoreMult: 1.3, initialIcons: 24 },
};
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function comboMultiplierFor(combo) {
    for (const [threshold, multiplier] of exports.COMBO_MULTIPLIERS) {
        if (combo >= threshold)
            return multiplier;
    }
    return 1;
}
/**
 * Continuidad del combo: encadena si el toque llega dentro de la ventana de la
 * dificultad, y reinicia a 1 en cuanto se pasa.
 */
function nextCombo(combo, lastComboAtMs, nowMs, comboWindowMs) {
    return combo > 0 && nowMs - lastComboAtMs <= comboWindowMs ? combo + 1 : 1;
}
/**
 * Sprint final: con el reloj en marcha y a 10 s o menos, todo puntúa ×1.5. Lee
 * el reloj **antes** de sumar el tiempo de esta convergencia, igual que el motor.
 */
function sprintMultiplierFor(timeLeftSeconds) {
    return timeLeftSeconds > 0 && timeLeftSeconds <= exports.SPRINT_WINDOW ? exports.SPRINT_MULT : 1;
}
function feverBoostFor(fever) {
    return fever ? exports.FEVER_BOOST : 1;
}
/**
 * Puntos de una convergencia. Réplica exacta de `game.js`:
 * `floor(removed*10*level * comboMult * diff * modo * fiebre * temp * sprint * surv)`.
 * En Contrarreloj `level` es 1, y `tempMult` y `survMult` valen 1 porque solo los
 * mueven Aventura y Supervivencia.
 */
function convergencePoints(input) {
    const base = input.removed * 10 * exports.TIME_ATTACK_LEVEL;
    return Math.floor(base
        * comboMultiplierFor(input.combo)
        * exports.DIFFICULTY[input.difficulty].scoreMult
        * exports.TIME_ATTACK_MODE_MULT
        * feverBoostFor(input.fever)
        * sprintMultiplierFor(input.timeLeftSeconds));
}
/** Bono plano de hito; 0 si este combo no es exactamente 10, 20 o 30. */
function milestoneBonusFor(combo) {
    return exports.MILESTONES[combo] ?? 0;
}
exports.EMPTY_BOARD_BONUS = 500;
exports.EMPTY_BOARD_CHAIN_STEP = 90;
exports.EMPTY_BOARD_COMBO_STEP = 28;
exports.EMPTY_BOARD_COMBO_CAP = 12;
exports.EMPTY_BOARD_MIN_POINTS = 250;
/**
 * Bono por dejar el tablero vacío en modos endless/score-attack. En Contrarreloj
 * no repone tiempo: solo puntúa.
 */
function emptyBoardBonusPoints(input) {
    const combo = Math.min(input.combo || 1, exports.EMPTY_BOARD_COMBO_CAP);
    const raw = exports.EMPTY_BOARD_BONUS
        + input.chain * exports.EMPTY_BOARD_CHAIN_STEP
        + combo * exports.EMPTY_BOARD_COMBO_STEP;
    return Math.max(exports.EMPTY_BOARD_MIN_POINTS, Math.round(raw
        * exports.DIFFICULTY[input.difficulty].scoreMult
        * exports.TIME_ATTACK_MODE_MULT
        * feverBoostFor(input.fever)
        * sprintMultiplierFor(input.timeLeftSeconds)));
}
/**
 * Segundos ganados por una convergencia, con rendimiento decreciente: el factor
 * cae del 100 % al 8 % hacia los 125 s de partida, y el reloj tiene tope duro.
 */
function timeGainFor(removed, combo, elapsedSeconds) {
    const decay = clamp(1 - elapsedSeconds / exports.TIMED_GAIN.decaySec, exports.TIMED_GAIN.minDecay, 1);
    return (exports.TIMED_GAIN.base
        + Math.min(removed, 4) * exports.TIMED_GAIN.perIcon
        + Math.min(combo, exports.TIMED_GAIN.comboCap) * exports.TIMED_GAIN.combo) * decay;
}
function applyTimeGain(timeLeftSeconds, gain) {
    return Math.min(exports.TIMED_CAP, timeLeftSeconds + gain);
}
/** Un fallo en score-attack cuesta segundos, nunca iconos. */
function applyMistakePenalty(timeLeftSeconds) {
    return Math.max(0, timeLeftSeconds - exports.TIMED_MISTAKE_S);
}
/** Puntos planos de una baldosa de cristal convergida (sin reliquia de Aventura). */
exports.CRYSTAL_POINTS = 50;
exports.TIME_CAPSULE_SECONDS = 5;
/**
 * Cápsula de tiempo: se detona por adyacencia al resolver la convergencia, es
 * decir **después** de aplicar el tiempo ganado, y respeta el mismo tope duro.
 */
function applyTimeCapsule(timeLeftSeconds) {
    return Math.min(exports.TIMED_CAP, timeLeftSeconds + exports.TIME_CAPSULE_SECONDS);
}
function shouldEnterFever(fever, combo) {
    return !fever && combo >= exports.FEVER_COMBO;
}

  window.ConvergenceGameCore = Object.freeze(exports);
})();
