/* GENERADO por scripts/build-game-core-browser.mjs — no editar a mano.
 * Fuente: packages/game-core/src/scoring.ts, packages/game-core/src/modes/adventure.ts, packages/game-core/src/modes/classic.ts, packages/game-core/src/modes/survival.ts, packages/game-core/src/modes/time-attack.ts, packages/game-core/src/modes/tutorial.ts, packages/game-core/src/modes/zen.ts
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
exports.PENALTY_SPAWN_FACTOR = exports.PENALTY_MAX_ICONS = exports.PENALTY_MIN_ICONS = exports.PERFECT_BOARD_BONUS = exports.EMPTY_BOARD_MIN_POINTS = exports.EMPTY_BOARD_COMBO_CAP = exports.EMPTY_BOARD_WAVE_STEP = exports.EMPTY_BOARD_COMBO_STEP = exports.EMPTY_BOARD_CHAIN_STEP = exports.EMPTY_BOARD_BONUS = exports.CRYSTAL_POINTS = exports.FEVER_BOOST = exports.FEVER_COMBO = exports.MILESTONES = exports.COMBO_MULTIPLIERS = exports.MODE_MULTIPLIERS = exports.DIFFICULTY = void 0;
exports.iconPenaltyCount = iconPenaltyCount;
exports.penalizedSpawnRate = penalizedSpawnRate;
exports.areaClearPoints = areaClearPoints;
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
/**
 * Bono plano por completar un nivel con el tablero perfecto. Lo cobran los modos
 * **sin** bono escalado —Tutorial, Clásico y Aventura—, que no son endless ni
 * score-attack. Se suma dentro del mismo toque que completa el nivel.
 */
exports.PERFECT_BOARD_BONUS = 500;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
exports.PENALTY_MIN_ICONS = 1;
exports.PENALTY_MAX_ICONS = 5;
/** Factor por el que se acelera el spawn tras un fallo en los modos con castigo. */
exports.PENALTY_SPAWN_FACTOR = 0.95;
/**
 * Iconos que añade un fallo en los modos con penalización (Clásico, Aventura y
 * Supervivencia). Escala con la dificultad y con el nivel, y está acotado.
 */
function iconPenaltyCount(difficulty, level) {
    return clamp(exports.DIFFICULTY[difficulty].penaltyBase + Math.floor((level - 1) / 3), exports.PENALTY_MIN_ICONS, exports.PENALTY_MAX_ICONS);
}
/** El fallo también acelera el ritmo de aparición, con suelo por dificultad. */
function penalizedSpawnRate(difficulty, spawnRate) {
    return Math.max(exports.DIFFICULTY[difficulty].spawnMin, Math.round(spawnRate * exports.PENALTY_SPAWN_FACTOR));
}
/**
 * Puntos de una limpieza por área (bomba y baldosas similares). A diferencia de
 * una convergencia, **no** pasa por combo, dificultad, modo ni fiebre: es la base
 * desnuda `celdas * 10 * nivel`.
 */
function areaClearPoints(cells, level) {
    return cells * 10 * level;
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

// --- packages/game-core/src/modes/adventure.ts ---
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RELIC_CRYSTAL_BONUS = exports.RELIC_COMBO_WINDOW_BONUS_MS = exports.ADVENTURE_CALM_ROUTE_MULT = exports.ADVENTURE_DENSE_ROUTE_MULT = exports.ADVENTURE_MODE_MULT = void 0;
exports.adventureRouteMultiplier = adventureRouteMultiplier;
exports.adventureComboWindow = adventureComboWindow;
exports.adventureCrystalPoints = adventureCrystalPoints;
exports.adventureConvergencePoints = adventureConvergencePoints;
exports.adventureMistakeIcons = adventureMistakeIcons;
exports.adventurePenalizedSpawnRate = adventurePenalizedSpawnRate;
const scoring_js_1 = require("../scoring.js");
/**
 * Reglas propias de Aventura. Como Clásico, el nivel escala la puntuación, pero
 * además aparece el primer **multiplicador temporal** del juego: la ruta densa
 * multiplica los puntos por 1.25 durante todo el capítulo.
 *
 * Los modificadores vivos (ruta elegida, reliquias) no puede conocerlos el
 * núcleo: se los pasa quien llama. El núcleo solo declara cuánto valen.
 */
exports.ADVENTURE_MODE_MULT = 1.1;
/** Ruta densa: más obstáculos a cambio de ×1.25 en puntos. */
exports.ADVENTURE_DENSE_ROUTE_MULT = 1.25;
/** Ruta calma: sin bonus de puntos, solo ralentiza el spawn. */
exports.ADVENTURE_CALM_ROUTE_MULT = 1;
/** La reliquia de combo alarga la ventana de encadenado. */
exports.RELIC_COMBO_WINDOW_BONUS_MS = 400;
/** La reliquia de cristal añade puntos extra por cada cristal convergido. */
exports.RELIC_CRYSTAL_BONUS = 30;
function adventureRouteMultiplier(route) {
    return route === 'dense' ? exports.ADVENTURE_DENSE_ROUTE_MULT : exports.ADVENTURE_CALM_ROUTE_MULT;
}
/** Ventana de combo efectiva, alargada si el jugador lleva la reliquia. */
function adventureComboWindow(baseWindowMs, hasComboRelic) {
    return baseWindowMs + (hasComboRelic ? exports.RELIC_COMBO_WINDOW_BONUS_MS : 0);
}
/** Puntos de un cristal en Aventura, con la reliquia correspondiente aplicada. */
function adventureCrystalPoints(hasCrystalRelic) {
    return scoring_js_1.CRYSTAL_POINTS + (hasCrystalRelic ? exports.RELIC_CRYSTAL_BONUS : 0);
}
function adventureConvergencePoints(input) {
    return (0, scoring_js_1.convergencePoints)({
        removed: input.removed,
        level: input.level,
        combo: input.combo,
        difficulty: input.difficulty,
        mode: 'aventura',
        feverBoost: (0, scoring_js_1.feverBoostFor)(input.fever),
        tempMultiplier: input.tempMultiplier,
    });
}
function adventureMistakeIcons(difficulty, level) {
    return (0, scoring_js_1.iconPenaltyCount)(difficulty, level);
}
function adventurePenalizedSpawnRate(difficulty, spawnRate) {
    return (0, scoring_js_1.penalizedSpawnRate)(difficulty, spawnRate);
}

// --- packages/game-core/src/modes/classic.ts ---
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLASSIC_MAX_LEVEL = exports.CLASSIC_MIN_LEVEL = exports.CLASSIC_MODE_MULT = void 0;
exports.classicConvergencePoints = classicConvergencePoints;
exports.classicMistakeIcons = classicMistakeIcons;
exports.classicPenalizedSpawnRate = classicPenalizedSpawnRate;
const scoring_js_1 = require("../scoring.js");
/**
 * Reglas propias de Clásico. Es el primer modo cuyo **nivel escala la
 * puntuación**: la base es `removed * 10 * level`, así que el mismo movimiento
 * en el nivel 30 vale treinta veces más que en el 1. Contrarreloj, Zen y
 * Tutorial fijaban ese factor en 1 y por eso no aparecía hasta ahora.
 *
 * No es endless ni score-attack, así que vaciar el tablero **no** cobra el bono
 * escalado, sino el plano de tablero perfecto.
 */
exports.CLASSIC_MODE_MULT = 1;
exports.CLASSIC_MIN_LEVEL = 1;
exports.CLASSIC_MAX_LEVEL = 50;
function classicConvergencePoints(input) {
    return (0, scoring_js_1.convergencePoints)({
        removed: input.removed,
        level: input.level,
        combo: input.combo,
        difficulty: input.difficulty,
        mode: 'clasico',
        feverBoost: (0, scoring_js_1.feverBoostFor)(input.fever),
    });
}
/** Iconos que añade un fallo; crece con dificultad y nivel, acotado a 1..5. */
function classicMistakeIcons(difficulty, level) {
    return (0, scoring_js_1.iconPenaltyCount)(difficulty, level);
}
/** Un fallo también acelera el spawn, con suelo por dificultad. */
function classicPenalizedSpawnRate(difficulty, spawnRate) {
    return (0, scoring_js_1.penalizedSpawnRate)(difficulty, spawnRate);
}

// --- packages/game-core/src/modes/survival.ts ---
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.X2_BOOSTER_MULT = exports.GOLDEN_WAVE_MULT = exports.SURVIVAL_MIN_FEVER_COMBO = exports.FRENZY_FEVER_STEP = exports.FRENZY_TIER_STEP = exports.FRENZY_BASE_MULT = exports.FRENZY_WAVES_PER_TIER = exports.FRENZY_MAX_TIER = exports.SURVIVAL_VAR_EVERY = exports.SURVIVAL_MODE_MULT = void 0;
exports.survivalLevel = survivalLevel;
exports.frenzyTier = frenzyTier;
exports.frenzyMultiplier = frenzyMultiplier;
exports.survivalTempMultiplier = survivalTempMultiplier;
exports.survivalScoreMultiplier = survivalScoreMultiplier;
exports.survivalFeverBoost = survivalFeverBoost;
exports.survivalFeverThreshold = survivalFeverThreshold;
exports.survivalConvergencePoints = survivalConvergencePoints;
exports.survivalEmptyBoardBonus = survivalEmptyBoardBonus;
exports.survivalMistakeIcons = survivalMistakeIcons;
exports.survivalPenalizedSpawnRate = survivalPenalizedSpawnRate;
const scoring_js_1 = require("../scoring.js");
/**
 * Reglas propias de Supervivencia, el modo con más factores vivos del juego. Es
 * el único que toca **los tres** multiplicadores variables a la vez:
 *
 * - `survivalMultiplier`: bendiciones acumuladas y oleada dorada.
 * - `tempMultiplier`: potenciador ×2 y frenesí.
 * - `feverBoost`: la Fiebre rinde más según el tier de frenesí, y además entra
 *   antes (el umbral baja con el tier).
 *
 * El estado vivo —oleada, bendiciones, potenciadores activos— no puede
 * conocerlo el núcleo: se lo pasa quien llama. Aquí solo viven las fórmulas.
 */
exports.SURVIVAL_MODE_MULT = 1.5;
/** Cada cuántas oleadas sube el nivel de dificultad efectivo, por dificultad. */
exports.SURVIVAL_VAR_EVERY = {
    facil: 8,
    normal: 6,
    dificil: 5,
};
exports.FRENZY_MAX_TIER = 3;
exports.FRENZY_WAVES_PER_TIER = 4;
exports.FRENZY_BASE_MULT = 1.55;
exports.FRENZY_TIER_STEP = 0.1;
/** Cada tier de frenesí añade esto al rendimiento de la Fiebre. */
exports.FRENZY_FEVER_STEP = 0.06;
/** Suelo del umbral de Fiebre: el frenesí lo baja, pero nunca por debajo de 6. */
exports.SURVIVAL_MIN_FEVER_COMBO = 6;
exports.GOLDEN_WAVE_MULT = 2;
exports.X2_BOOSTER_MULT = 2;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/**
 * Nivel de dificultad sintético: Supervivencia no tiene niveles explícitos, así
 * que la puntuación escala con la oleada a través de este valor.
 */
function survivalLevel(wave, difficulty) {
    return 1 + Math.floor((wave - 1) / exports.SURVIVAL_VAR_EVERY[difficulty]);
}
function frenzyTier(wave) {
    return clamp(Math.floor((wave - 1) / exports.FRENZY_WAVES_PER_TIER) + 1, 1, exports.FRENZY_MAX_TIER);
}
function frenzyMultiplier(wave, frenzyActive) {
    return frenzyActive ? exports.FRENZY_BASE_MULT + frenzyTier(wave) * exports.FRENZY_TIER_STEP : 1;
}
/** Multiplicador temporal: potenciador ×2 y frenesí se acumulan. */
function survivalTempMultiplier(wave, options) {
    return (options.x2Active ? exports.X2_BOOSTER_MULT : 1) * frenzyMultiplier(wave, options.frenzyActive);
}
/** Bendiciones acumuladas por oleada dorada. */
function survivalScoreMultiplier(scoreBoost, goldenWaveActive) {
    return (1 + (scoreBoost || 0)) * (goldenWaveActive ? exports.GOLDEN_WAVE_MULT : 1);
}
/** En Supervivencia la Fiebre rinde más cuanto mayor es el tier de frenesí. */
function survivalFeverBoost(fever, wave) {
    return fever ? scoring_js_1.FEVER_BOOST + frenzyTier(wave) * exports.FRENZY_FEVER_STEP : 1;
}
/** El frenesí también adelanta la entrada en Fiebre, con suelo en 6. */
function survivalFeverThreshold(wave) {
    return Math.max(exports.SURVIVAL_MIN_FEVER_COMBO, scoring_js_1.FEVER_COMBO - frenzyTier(wave));
}
function survivalConvergencePoints(input) {
    return (0, scoring_js_1.convergencePoints)({
        removed: input.removed,
        level: input.level,
        combo: input.combo,
        difficulty: input.difficulty,
        mode: 'supervivencia',
        feverBoost: input.feverBoost,
        tempMultiplier: input.tempMultiplier,
        survivalMultiplier: input.survivalMultiplier,
    });
}
/**
 * Supervivencia es endless, así que cobra el bono escalado. A diferencia del
 * resto, **la oleada suma**, y el multiplicador de bendiciones no entra aquí:
 * el motor no lo aplica a este bono.
 */
function survivalEmptyBoardBonus(input) {
    return (0, scoring_js_1.emptyBoardBonusPoints)({
        chain: input.chain,
        combo: input.combo,
        difficulty: input.difficulty,
        mode: 'supervivencia',
        wave: input.wave,
        feverBoost: input.feverBoost,
        tempMultiplier: input.tempMultiplier,
    });
}
function survivalMistakeIcons(difficulty, level) {
    return (0, scoring_js_1.iconPenaltyCount)(difficulty, level);
}
function survivalPenalizedSpawnRate(difficulty, spawnRate) {
    return (0, scoring_js_1.penalizedSpawnRate)(difficulty, spawnRate);
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

// --- packages/game-core/src/modes/tutorial.ts ---
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TUTORIAL_LEVEL = exports.TUTORIAL_MODE_MULT = void 0;
exports.tutorialConvergencePoints = tutorialConvergencePoints;
exports.tutorialMistakeCost = tutorialMistakeCost;
const scoring_js_1 = require("../scoring.js");
/**
 * Reglas propias del Tutorial. Es el modo más simple: sin niveles, sin
 * penalización y sin reloj. Solo baja el multiplicador de modo a 0.5 para que
 * aprender no infle las estadísticas de la cuenta.
 *
 * Ojo: el Tutorial **sí** puede entrar en Fiebre. No declara `noFever`, así que
 * `feverNeed()` devuelve el umbral normal; por eso el factor se recibe y no se
 * fija, a diferencia de Zen.
 */
exports.TUTORIAL_MODE_MULT = 0.5;
exports.TUTORIAL_LEVEL = 1;
function tutorialConvergencePoints(input) {
    return (0, scoring_js_1.convergencePoints)({
        removed: input.removed,
        level: exports.TUTORIAL_LEVEL,
        combo: input.combo,
        difficulty: input.difficulty,
        mode: 'tutorial',
        feverBoost: (0, scoring_js_1.feverBoostFor)(input.fever),
    });
}
/** El Tutorial no declara `penalties`: fallar no cuesta nada. */
function tutorialMistakeCost() {
    return 0;
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
