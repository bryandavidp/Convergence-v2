import {
  convergencePoints,
  emptyBoardBonusPoints,
  iconPenaltyCount,
  penalizedSpawnRate,
  FEVER_BOOST,
  FEVER_COMBO,
  type Difficulty,
} from '../scoring.js';

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

export const SURVIVAL_MODE_MULT = 1.5;

/** Cada cuántas oleadas sube el nivel de dificultad efectivo, por dificultad. */
export const SURVIVAL_VAR_EVERY: Readonly<Record<Difficulty, number>> = {
  facil: 8,
  normal: 6,
  dificil: 5,
};

export const FRENZY_MAX_TIER = 3;
export const FRENZY_WAVES_PER_TIER = 4;
export const FRENZY_BASE_MULT = 1.55;
export const FRENZY_TIER_STEP = 0.1;
/** Cada tier de frenesí añade esto al rendimiento de la Fiebre. */
export const FRENZY_FEVER_STEP = 0.06;
/** Suelo del umbral de Fiebre: el frenesí lo baja, pero nunca por debajo de 6. */
export const SURVIVAL_MIN_FEVER_COMBO = 6;
export const GOLDEN_WAVE_MULT = 2;
export const X2_BOOSTER_MULT = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Nivel de dificultad sintético: Supervivencia no tiene niveles explícitos, así
 * que la puntuación escala con la oleada a través de este valor.
 */
export function survivalLevel(wave: number, difficulty: Difficulty): number {
  return 1 + Math.floor((wave - 1) / SURVIVAL_VAR_EVERY[difficulty]);
}

export function frenzyTier(wave: number): number {
  return clamp(Math.floor((wave - 1) / FRENZY_WAVES_PER_TIER) + 1, 1, FRENZY_MAX_TIER);
}

export function frenzyMultiplier(wave: number, frenzyActive: boolean): number {
  return frenzyActive ? FRENZY_BASE_MULT + frenzyTier(wave) * FRENZY_TIER_STEP : 1;
}

/** Multiplicador temporal: potenciador ×2 y frenesí se acumulan. */
export function survivalTempMultiplier(
  wave: number,
  options: { readonly x2Active: boolean; readonly frenzyActive: boolean },
): number {
  return (options.x2Active ? X2_BOOSTER_MULT : 1) * frenzyMultiplier(wave, options.frenzyActive);
}

/** Bendiciones acumuladas por oleada dorada. */
export function survivalScoreMultiplier(
  scoreBoost: number,
  goldenWaveActive: boolean,
): number {
  return (1 + (scoreBoost || 0)) * (goldenWaveActive ? GOLDEN_WAVE_MULT : 1);
}

/** En Supervivencia la Fiebre rinde más cuanto mayor es el tier de frenesí. */
export function survivalFeverBoost(fever: boolean, wave: number): number {
  return fever ? FEVER_BOOST + frenzyTier(wave) * FRENZY_FEVER_STEP : 1;
}

/** El frenesí también adelanta la entrada en Fiebre, con suelo en 6. */
export function survivalFeverThreshold(wave: number): number {
  return Math.max(SURVIVAL_MIN_FEVER_COMBO, FEVER_COMBO - frenzyTier(wave));
}

export interface SurvivalConvergenceInput {
  readonly removed: number;
  /** Combo **ya actualizado** por este toque. */
  readonly combo: number;
  readonly difficulty: Difficulty;
  /** Nivel sintético; normalmente `survivalLevel(wave, difficulty)`. */
  readonly level: number;
  /** Fiebre **ya evaluada**: entra antes de puntuar. */
  readonly feverBoost: number;
  readonly tempMultiplier: number;
  readonly survivalMultiplier: number;
}

export function survivalConvergencePoints(input: SurvivalConvergenceInput): number {
  return convergencePoints({
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

export interface SurvivalEmptyBoardInput {
  /** Veces que el tablero ha quedado vacío en esta partida, contando esta (1-based). */
  readonly chain: number;
  readonly combo: number;
  readonly difficulty: Difficulty;
  /** La oleada suma al bono: es el único modo donde el término cuenta. */
  readonly wave: number;
  readonly feverBoost: number;
  readonly tempMultiplier: number;
}

/**
 * Supervivencia es endless, así que cobra el bono escalado. A diferencia del
 * resto, **la oleada suma**, y el multiplicador de bendiciones no entra aquí:
 * el motor no lo aplica a este bono.
 */
export function survivalEmptyBoardBonus(input: SurvivalEmptyBoardInput): number {
  return emptyBoardBonusPoints({
    chain: input.chain,
    combo: input.combo,
    difficulty: input.difficulty,
    mode: 'supervivencia',
    wave: input.wave,
    feverBoost: input.feverBoost,
    tempMultiplier: input.tempMultiplier,
  });
}

export function survivalMistakeIcons(difficulty: Difficulty, level: number): number {
  return iconPenaltyCount(difficulty, level);
}

export function survivalPenalizedSpawnRate(difficulty: Difficulty, spawnRate: number): number {
  return penalizedSpawnRate(difficulty, spawnRate);
}
