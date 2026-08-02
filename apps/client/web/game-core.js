/* GENERADO por scripts/build-game-core-browser.mjs — no editar a mano.
 * Fuente: packages/game-core/src/scoring.ts, packages/game-core/src/modes/time-attack.ts, packages/game-core/src/modes/zen.ts
 * Regenerar con: npm run build:core:browser
 */
(function () {
  'use strict';
  var exports = {};
  // Los módulos del núcleo comparten espacio de exportación, así que una
  // importación relativa entre ellos devuelve ese mismo objeto.
  function require() { return exports; }
// --- packages/game-core/src/scoring.ts ---
"use strict";
/**
 * Puntuación compartida por todos los modos, extraída del motor de `game.js`.
 *
 * Los seis modos usan la misma fórmula y solo cambian los factores que le
 * entran. Tenerla una sola vez evita que extraer cada modo sea reescribirla, y
 * que una corrección se aplique a unos modos y a otros no.
 *
 * Las constantes se duplican aquí a propósito en lugar de importarse del
 * cliente: el núcleo se ejecuta también en el backend, sin cargar el juego. La
 * duplicación la vigilan los tests de paridad, que comparan cada valor contra el
 * `Config` legacy y fallan si alguno se desvía.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_BOARD_MIN_POINTS = exports.EMPTY_BOARD_COMBO_CAP = exports.EMPTY_BOARD_WAVE_STEP = exports.EMPTY_BOARD_COMBO_STEP = exports.EMPTY_BOARD_CHAIN_STEP = exports.EMPTY_BOARD_BONUS = exports.CRYSTAL_POINTS = exports.FEVER_BOOST = exports.FEVER_COMBO = exports.MILESTONES = exports.COMBO_MULTIPLIERS = exports.MODE_MULTIPLIERS = exports.DIFFICULTY = void 0;
exports.comboMultiplierFor = comboMultiplierFor;
exports.nextCombo = nextCombo;
exports.milestoneBonusFor = milestoneBonusFor;
exports.feverBoostFor = feverBoostFor;
exports.convergencePoints = convergencePoints;
exports.emptyBoardBonusPoints = emptyBoardBonusPoints;
exports.DIFFICULTY = {
    facil: {
        comboWindow: 5000, scoreMult: 0.8, initialIcons: 12,
        spawnStart: 6000, spawnMin: 2000, penaltyBase: 1,
    },
    normal: {
        comboWindow: 3500, scoreMult: 1.0, initialIcons: 18,
        spawnStart: 5000, spawnMin: 1400, penaltyBase: 2,
    },
    dificil: {
        comboWindow: 2500, scoreMult: 1.3, initialIcons: 24,
        spawnStart: 3800, spawnMin: 900, penaltyBase: 3,
    },
};
/** Multiplicador constante de cada modo durante toda la partida. */
exports.MODE_MULTIPLIERS = {
    tutorial: 0.5,
    clasico: 1,
    aventura: 1.1,
    contrarreloj: 1.2,
    supervivencia: 1.5,
    zen: 0.8,
};
/** `[umbral, multiplicador]`, evaluado de mayor a menor: gana la primera coincidencia. */
exports.COMBO_MULTIPLIERS = [
    [30, 10], [20, 8], [15, 5], [10, 3], [6, 2], [3, 1.5],
];
/** Puntos planos que se suman exactamente al alcanzar ese combo. */
exports.MILESTONES = { 10: 500, 20: 1000, 30: 2000 };
exports.FEVER_COMBO = 10;
exports.FEVER_BOOST = 1.25;
/** Puntos planos de una baldosa de cristal convergida. */
exports.CRYSTAL_POINTS = 50;
exports.EMPTY_BOARD_BONUS = 500;
exports.EMPTY_BOARD_CHAIN_STEP = 90;
exports.EMPTY_BOARD_COMBO_STEP = 28;
exports.EMPTY_BOARD_WAVE_STEP = 45;
exports.EMPTY_BOARD_COMBO_CAP = 12;
exports.EMPTY_BOARD_MIN_POINTS = 250;
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
/** Bono plano de hito; 0 si este combo no es exactamente 10, 20 o 30. */
function milestoneBonusFor(combo) {
    return exports.MILESTONES[combo] ?? 0;
}
function feverBoostFor(fever, extraBoost = 0) {
    return fever ? exports.FEVER_BOOST + extraBoost : 1;
}
/**
 * Puntos de una convergencia. Réplica exacta de `game.js`:
 * `floor(removed*10*level * comboMult * dificultad * modo * fiebre * temp * sprint * surv)`.
 */
function convergencePoints(factors) {
    const base = factors.removed * 10 * factors.level;
    return Math.floor(base
        * comboMultiplierFor(factors.combo)
        * exports.DIFFICULTY[factors.difficulty].scoreMult
        * exports.MODE_MULTIPLIERS[factors.mode]
        * factors.feverBoost
        * (factors.tempMultiplier ?? 1)
        * (factors.sprintMultiplier ?? 1)
        * (factors.survivalMultiplier ?? 1));
}
/**
 * Bono por dejar el tablero vacío. Solo lo cobran los modos endless o
 * score-attack; los demás usan el bono plano de tablero perfecto.
 */
function emptyBoardBonusPoints(factors) {
    const combo = Math.min(factors.combo || 1, exports.EMPTY_BOARD_COMBO_CAP);
    const raw = exports.EMPTY_BOARD_BONUS
        + factors.chain * exports.EMPTY_BOARD_CHAIN_STEP
        + combo * exports.EMPTY_BOARD_COMBO_STEP
        + (factors.mode === 'supervivencia' ? (factors.wave ?? 1) * exports.EMPTY_BOARD_WAVE_STEP : 0);
    return Math.max(exports.EMPTY_BOARD_MIN_POINTS, Math.round(raw
        * exports.DIFFICULTY[factors.difficulty].scoreMult
        * exports.MODE_MULTIPLIERS[factors.mode]
        * factors.feverBoost
        * (factors.tempMultiplier ?? 1)
        * (factors.sprintMultiplier ?? 1)));
}

// --- packages/game-core/src/modes/time-attack.ts ---
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIME_CAPSULE_SECONDS = exports.TIME_ATTACK_LEVEL = exports.TIME_ATTACK_INITIAL_ICONS = exports.TIME_ATTACK_MODE_MULT = exports.SPRINT_MULT = exports.SPRINT_WINDOW = exports.TIMED_GAIN = exports.TIMED_MISTAKE_S = exports.TIMED_CAP = exports.TIMED_START = void 0;
exports.sprintMultiplierFor = sprintMultiplierFor;
exports.timeAttackConvergencePoints = timeAttackConvergencePoints;
exports.timeAttackEmptyBoardBonus = timeAttackEmptyBoardBonus;
exports.timeGainFor = timeGainFor;
exports.applyTimeGain = applyTimeGain;
exports.applyMistakePenalty = applyMistakePenalty;
exports.applyTimeCapsule = applyTimeCapsule;
const scoring_js_1 = require("../scoring.js");
/**
 * Reglas propias de Contrarreloj. La puntuación vive en `scoring.ts`, común a
 * todos los modos; aquí queda solo lo que este modo no comparte: el reloj, el
 * sprint final y la penalización en segundos.
 */
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
exports.TIME_CAPSULE_SECONDS = 5;
/**
 * Sprint final: con el reloj en marcha y a 10 s o menos, todo puntúa ×1.5. Lee
 * el reloj **antes** de sumar el tiempo de esta convergencia, igual que el motor.
 */
function sprintMultiplierFor(timeLeftSeconds) {
    return timeLeftSeconds > 0 && timeLeftSeconds <= exports.SPRINT_WINDOW ? exports.SPRINT_MULT : 1;
}
function timeAttackConvergencePoints(input) {
    return (0, scoring_js_1.convergencePoints)({
        removed: input.removed,
        level: exports.TIME_ATTACK_LEVEL,
        combo: input.combo,
        difficulty: input.difficulty,
        mode: 'contrarreloj',
        feverBoost: (0, scoring_js_1.feverBoostFor)(input.fever),
        sprintMultiplier: sprintMultiplierFor(input.timeLeftSeconds),
    });
}
function timeAttackEmptyBoardBonus(input) {
    return (0, scoring_js_1.emptyBoardBonusPoints)({
        chain: input.chain,
        combo: input.combo,
        difficulty: input.difficulty,
        mode: 'contrarreloj',
        feverBoost: (0, scoring_js_1.feverBoostFor)(input.fever),
        sprintMultiplier: sprintMultiplierFor(input.timeLeftSeconds),
    });
}
/**
 * Segundos ganados por una convergencia, con rendimiento decreciente: el factor
 * cae del 100 % al 8 % hacia los 125 s de partida, y el reloj tiene tope duro.
 */
function timeGainFor(removed, combo, elapsedSeconds) {
    const decay = Math.min(1, Math.max(exports.TIMED_GAIN.minDecay, 1 - elapsedSeconds / exports.TIMED_GAIN.decaySec));
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
/**
 * Cápsula de tiempo: se detona por adyacencia al resolver la convergencia, es
 * decir **después** de aplicar el tiempo ganado, y respeta el mismo tope duro.
 */
function applyTimeCapsule(timeLeftSeconds) {
    return Math.min(exports.TIMED_CAP, timeLeftSeconds + exports.TIME_CAPSULE_SECONDS);
}

// --- packages/game-core/src/modes/zen.ts ---
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZEN_FEVER_BOOST = exports.ZEN_SOFT_CLEAR_FRACTION = exports.ZEN_LEVEL = exports.ZEN_MODE_MULT = void 0;
exports.zenConvergencePoints = zenConvergencePoints;
exports.zenEmptyBoardBonus = zenEmptyBoardBonus;
exports.zenMistakeCost = zenMistakeCost;
const scoring_js_1 = require("../scoring.js");
/**
 * Reglas propias de Zen. Es el modo santuario: sin reloj, sin penalizaciones y
 * **sin Fiebre**, así que el factor de fiebre es constantemente 1. Llenar el
 * tablero tampoco es derrota — el motor hace una limpieza parcial y sigue.
 */
exports.ZEN_MODE_MULT = 0.8;
/** Zen no tiene niveles: `State.level` vale siempre 1. */
exports.ZEN_LEVEL = 1;
/** Fracción del tablero que se libera al desbordar, en vez de terminar la partida. */
exports.ZEN_SOFT_CLEAR_FRACTION = 0.45;
/**
 * Zen declara `noFever`, así que `feverNeed()` devuelve `Infinity` y el estado
 * de fiebre nunca se activa. El factor queda fijo en 1 por construcción, no por
 * casualidad: si alguien activara la fiebre aquí, la puntuación cambiaría.
 */
exports.ZEN_FEVER_BOOST = 1;
function zenConvergencePoints(input) {
    return (0, scoring_js_1.convergencePoints)({
        removed: input.removed,
        level: exports.ZEN_LEVEL,
        combo: input.combo,
        difficulty: input.difficulty,
        mode: 'zen',
        feverBoost: exports.ZEN_FEVER_BOOST,
    });
}
/** Zen es endless, así que sí cobra el bono de tablero vacío. */
function zenEmptyBoardBonus(input) {
    return (0, scoring_js_1.emptyBoardBonusPoints)({
        chain: input.chain,
        combo: input.combo,
        difficulty: input.difficulty,
        mode: 'zen',
        feverBoost: exports.ZEN_FEVER_BOOST,
    });
}
/**
 * Un fallo en Zen no cuesta nada: el modo declara `penalties: false`, así que no
 * quita tiempo ni añade iconos. Se expone como función para que quede explícito
 * en el núcleo y no como una omisión.
 */
function zenMistakeCost() {
    return 0;
}

  window.ConvergenceGameCore = Object.freeze(exports);
})();
