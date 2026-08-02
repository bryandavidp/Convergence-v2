import {
  convergencePoints,
  emptyBoardBonusPoints,
  type Difficulty,
} from '../scoring.js';

/**
 * Reglas propias de Zen. Es el modo santuario: sin reloj, sin penalizaciones y
 * **sin Fiebre**, así que el factor de fiebre es constantemente 1. Llenar el
 * tablero tampoco es derrota — el motor hace una limpieza parcial y sigue.
 */

export const ZEN_MODE_MULT = 0.8;
/** Zen no tiene niveles: `State.level` vale siempre 1. */
export const ZEN_LEVEL = 1;
/** Fracción del tablero que se libera al desbordar, en vez de terminar la partida. */
export const ZEN_SOFT_CLEAR_FRACTION = 0.45;

/**
 * Zen declara `noFever`, así que `feverNeed()` devuelve `Infinity` y el estado
 * de fiebre nunca se activa. El factor queda fijo en 1 por construcción, no por
 * casualidad: si alguien activara la fiebre aquí, la puntuación cambiaría.
 */
export const ZEN_FEVER_BOOST = 1;

export interface ZenConvergenceInput {
  readonly removed: number;
  /** Combo **ya actualizado** por este toque. */
  readonly combo: number;
  readonly difficulty: Difficulty;
}

export function zenConvergencePoints(input: ZenConvergenceInput): number {
  return convergencePoints({
    removed: input.removed,
    level: ZEN_LEVEL,
    combo: input.combo,
    difficulty: input.difficulty,
    mode: 'zen',
    feverBoost: ZEN_FEVER_BOOST,
  });
}

export interface ZenEmptyBoardInput {
  /** Veces que el tablero ha quedado vacío en esta partida, contando esta (1-based). */
  readonly chain: number;
  readonly combo: number;
  readonly difficulty: Difficulty;
}

/** Zen es endless, así que sí cobra el bono de tablero vacío. */
export function zenEmptyBoardBonus(input: ZenEmptyBoardInput): number {
  return emptyBoardBonusPoints({
    chain: input.chain,
    combo: input.combo,
    difficulty: input.difficulty,
    mode: 'zen',
    feverBoost: ZEN_FEVER_BOOST,
  });
}

/**
 * Un fallo en Zen no cuesta nada: el modo declara `penalties: false`, así que no
 * quita tiempo ni añade iconos. Se expone como función para que quede explícito
 * en el núcleo y no como una omisión.
 */
export function zenMistakeCost(): 0 {
  return 0;
}
