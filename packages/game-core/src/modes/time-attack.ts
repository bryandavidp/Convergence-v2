import {
  convergencePoints,
  emptyBoardBonusPoints,
  feverBoostFor,
  type Difficulty,
} from '../scoring.js';

/**
 * Reglas propias de Contrarreloj. La puntuación vive en `scoring.ts`, común a
 * todos los modos; aquí queda solo lo que este modo no comparte: el reloj, el
 * sprint final y la penalización en segundos.
 */

export const TIMED_START = 60;
export const TIMED_CAP = 90;
export const TIMED_MISTAKE_S = 3;
export const TIMED_GAIN = {
  base: 0.9,
  perIcon: 0.6,
  combo: 0.32,
  comboCap: 4,
  decaySec: 125,
  minDecay: 0.08,
} as const;

export const SPRINT_WINDOW = 10;
export const SPRINT_MULT = 1.5;

export const TIME_ATTACK_MODE_MULT = 1.2;
export const TIME_ATTACK_INITIAL_ICONS = 22;
/** Contrarreloj no tiene niveles: `State.level` vale siempre 1. */
export const TIME_ATTACK_LEVEL = 1;

export const TIME_CAPSULE_SECONDS = 5;

/**
 * Sprint final: con el reloj en marcha y a 10 s o menos, todo puntúa ×1.5. Lee
 * el reloj **antes** de sumar el tiempo de esta convergencia, igual que el motor.
 */
export function sprintMultiplierFor(timeLeftSeconds: number): number {
  return timeLeftSeconds > 0 && timeLeftSeconds <= SPRINT_WINDOW ? SPRINT_MULT : 1;
}

export interface ConvergenceScoreInput {
  readonly removed: number;
  /** Combo **ya actualizado** por este toque. */
  readonly combo: number;
  readonly difficulty: Difficulty;
  /** Reloj antes de aplicar el tiempo ganado por esta convergencia. */
  readonly timeLeftSeconds: number;
  /** Fiebre **ya evaluada** para este toque: entra antes de puntuar. */
  readonly fever: boolean;
}

export function timeAttackConvergencePoints(input: ConvergenceScoreInput): number {
  return convergencePoints({
    removed: input.removed,
    level: TIME_ATTACK_LEVEL,
    combo: input.combo,
    difficulty: input.difficulty,
    mode: 'contrarreloj',
    feverBoost: feverBoostFor(input.fever),
    sprintMultiplier: sprintMultiplierFor(input.timeLeftSeconds),
  });
}

export interface EmptyBoardBonusInput {
  /** Veces que el tablero ha quedado vacío en esta partida, contando esta (1-based). */
  readonly chain: number;
  readonly combo: number;
  readonly difficulty: Difficulty;
  /**
   * Reloj **después** de aplicar el tiempo de la convergencia que vació el
   * tablero: el motor cobra el bono más tarde y lee el reloj ya actualizado.
   */
  readonly timeLeftSeconds: number;
  readonly fever: boolean;
}

export function timeAttackEmptyBoardBonus(input: EmptyBoardBonusInput): number {
  return emptyBoardBonusPoints({
    chain: input.chain,
    combo: input.combo,
    difficulty: input.difficulty,
    mode: 'contrarreloj',
    feverBoost: feverBoostFor(input.fever),
    sprintMultiplier: sprintMultiplierFor(input.timeLeftSeconds),
  });
}

/**
 * Segundos ganados por una convergencia, con rendimiento decreciente: el factor
 * cae del 100 % al 8 % hacia los 125 s de partida, y el reloj tiene tope duro.
 */
export function timeGainFor(
  removed: number,
  combo: number,
  elapsedSeconds: number,
): number {
  const decay = Math.min(1, Math.max(TIMED_GAIN.minDecay, 1 - elapsedSeconds / TIMED_GAIN.decaySec));
  return (
    TIMED_GAIN.base
    + Math.min(removed, 4) * TIMED_GAIN.perIcon
    + Math.min(combo, TIMED_GAIN.comboCap) * TIMED_GAIN.combo
  ) * decay;
}

export function applyTimeGain(timeLeftSeconds: number, gain: number): number {
  return Math.min(TIMED_CAP, timeLeftSeconds + gain);
}

/** Un fallo en score-attack cuesta segundos, nunca iconos. */
export function applyMistakePenalty(timeLeftSeconds: number): number {
  return Math.max(0, timeLeftSeconds - TIMED_MISTAKE_S);
}

/**
 * Cápsula de tiempo: se detona por adyacencia al resolver la convergencia, es
 * decir **después** de aplicar el tiempo ganado, y respeta el mismo tope duro.
 */
export function applyTimeCapsule(timeLeftSeconds: number): number {
  return Math.min(TIMED_CAP, timeLeftSeconds + TIME_CAPSULE_SECONDS);
}
