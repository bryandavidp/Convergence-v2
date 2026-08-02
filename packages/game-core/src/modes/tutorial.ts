import {
  convergencePoints,
  feverBoostFor,
  type Difficulty,
} from '../scoring.js';

/**
 * Reglas propias del Tutorial. Es el modo más simple: sin niveles, sin
 * penalización y sin reloj. Solo baja el multiplicador de modo a 0.5 para que
 * aprender no infle las estadísticas de la cuenta.
 *
 * Ojo: el Tutorial **sí** puede entrar en Fiebre. No declara `noFever`, así que
 * `feverNeed()` devuelve el umbral normal; por eso el factor se recibe y no se
 * fija, a diferencia de Zen.
 */

export const TUTORIAL_MODE_MULT = 0.5;
export const TUTORIAL_LEVEL = 1;

export interface TutorialConvergenceInput {
  readonly removed: number;
  /** Combo **ya actualizado** por este toque. */
  readonly combo: number;
  readonly difficulty: Difficulty;
  /** Fiebre **ya evaluada**: entra antes de puntuar. */
  readonly fever: boolean;
}

export function tutorialConvergencePoints(input: TutorialConvergenceInput): number {
  return convergencePoints({
    removed: input.removed,
    level: TUTORIAL_LEVEL,
    combo: input.combo,
    difficulty: input.difficulty,
    mode: 'tutorial',
    feverBoost: feverBoostFor(input.fever),
  });
}

/** El Tutorial no declara `penalties`: fallar no cuesta nada. */
export function tutorialMistakeCost(): 0 {
  return 0;
}
