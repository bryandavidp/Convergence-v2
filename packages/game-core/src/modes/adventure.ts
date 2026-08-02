import {
  convergencePoints,
  feverBoostFor,
  iconPenaltyCount,
  penalizedSpawnRate,
  CRYSTAL_POINTS,
  type Difficulty,
} from '../scoring.js';

/**
 * Reglas propias de Aventura. Como Clásico, el nivel escala la puntuación, pero
 * además aparece el primer **multiplicador temporal** del juego: la ruta densa
 * multiplica los puntos por 1.25 durante todo el capítulo.
 *
 * Los modificadores vivos (ruta elegida, reliquias) no puede conocerlos el
 * núcleo: se los pasa quien llama. El núcleo solo declara cuánto valen.
 */

export const ADVENTURE_MODE_MULT = 1.1;

/** Ruta densa: más obstáculos a cambio de ×1.25 en puntos. */
export const ADVENTURE_DENSE_ROUTE_MULT = 1.25;
/** Ruta calma: sin bonus de puntos, solo ralentiza el spawn. */
export const ADVENTURE_CALM_ROUTE_MULT = 1;

/** La reliquia de combo alarga la ventana de encadenado. */
export const RELIC_COMBO_WINDOW_BONUS_MS = 400;
/** La reliquia de cristal añade puntos extra por cada cristal convergido. */
export const RELIC_CRYSTAL_BONUS = 30;

export type AdventureRoute = 'dense' | 'calm' | null;

export function adventureRouteMultiplier(route: AdventureRoute): number {
  return route === 'dense' ? ADVENTURE_DENSE_ROUTE_MULT : ADVENTURE_CALM_ROUTE_MULT;
}

/** Ventana de combo efectiva, alargada si el jugador lleva la reliquia. */
export function adventureComboWindow(baseWindowMs: number, hasComboRelic: boolean): number {
  return baseWindowMs + (hasComboRelic ? RELIC_COMBO_WINDOW_BONUS_MS : 0);
}

/** Puntos de un cristal en Aventura, con la reliquia correspondiente aplicada. */
export function adventureCrystalPoints(hasCrystalRelic: boolean): number {
  return CRYSTAL_POINTS + (hasCrystalRelic ? RELIC_CRYSTAL_BONUS : 0);
}

export interface AdventureConvergenceInput {
  readonly removed: number;
  /** Combo **ya actualizado** por este toque. */
  readonly combo: number;
  readonly difficulty: Difficulty;
  /** Nivel de aventura alcanzado: escala la base de puntos. */
  readonly level: number;
  /** Fiebre **ya evaluada**: entra antes de puntuar. */
  readonly fever: boolean;
  /**
   * Multiplicador temporal vivo. El motor lo mantiene en `State.tempMult`, que
   * en Aventura vale 1.25 con ruta densa y 1 en el resto.
   */
  readonly tempMultiplier: number;
}

export function adventureConvergencePoints(input: AdventureConvergenceInput): number {
  return convergencePoints({
    removed: input.removed,
    level: input.level,
    combo: input.combo,
    difficulty: input.difficulty,
    mode: 'aventura',
    feverBoost: feverBoostFor(input.fever),
    tempMultiplier: input.tempMultiplier,
  });
}

export function adventureMistakeIcons(difficulty: Difficulty, level: number): number {
  return iconPenaltyCount(difficulty, level);
}

export function adventurePenalizedSpawnRate(difficulty: Difficulty, spawnRate: number): number {
  return penalizedSpawnRate(difficulty, spawnRate);
}
