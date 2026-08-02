import {
  convergencePoints,
  feverBoostFor,
  iconPenaltyCount,
  penalizedSpawnRate,
  type Difficulty,
} from '../scoring.js';

/**
 * Reglas propias de Clásico. Es el primer modo cuyo **nivel escala la
 * puntuación**: la base es `removed * 10 * level`, así que el mismo movimiento
 * en el nivel 30 vale treinta veces más que en el 1. Contrarreloj, Zen y
 * Tutorial fijaban ese factor en 1 y por eso no aparecía hasta ahora.
 *
 * No es endless ni score-attack, así que vaciar el tablero **no** cobra el bono
 * escalado, sino el plano de tablero perfecto.
 */

export const CLASSIC_MODE_MULT = 1;
export const CLASSIC_MIN_LEVEL = 1;
export const CLASSIC_MAX_LEVEL = 50;

export interface ClassicConvergenceInput {
  readonly removed: number;
  /** Combo **ya actualizado** por este toque. */
  readonly combo: number;
  readonly difficulty: Difficulty;
  /** Nivel del mundo en curso: escala la base de puntos. */
  readonly level: number;
  /** Fiebre **ya evaluada**: entra antes de puntuar. */
  readonly fever: boolean;
}

export function classicConvergencePoints(input: ClassicConvergenceInput): number {
  return convergencePoints({
    removed: input.removed,
    level: input.level,
    combo: input.combo,
    difficulty: input.difficulty,
    mode: 'clasico',
    feverBoost: feverBoostFor(input.fever),
  });
}

/** Iconos que añade un fallo; crece con dificultad y nivel, acotado a 1..5. */
export function classicMistakeIcons(difficulty: Difficulty, level: number): number {
  return iconPenaltyCount(difficulty, level);
}

/** Un fallo también acelera el spawn, con suelo por dificultad. */
export function classicPenalizedSpawnRate(difficulty: Difficulty, spawnRate: number): number {
  return penalizedSpawnRate(difficulty, spawnRate);
}
