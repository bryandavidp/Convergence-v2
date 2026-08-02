/**
 * Reglas puras del modo Contrarreloj, extraídas del motor de `game.js` 2.37.2.
 *
 * Las constantes se duplican aquí a propósito en vez de importarse del cliente:
 * el núcleo debe poder ejecutarse en el backend sin cargar el juego. La
 * duplicación la vigila `time-attack-parity.test.mjs`, que compara cada valor
 * contra el `Config` legacy y falla si alguno se desvía.
 */

/** `[umbral, multiplicador]`, evaluado de mayor a menor: gana la primera coincidencia. */
export const COMBO_MULTIPLIERS: readonly (readonly [number, number])[] = [
  [30, 10], [20, 8], [15, 5], [10, 3], [6, 2], [3, 1.5],
];

/** Puntos planos que se suman exactamente al alcanzar ese combo. */
export const MILESTONES: Readonly<Record<number, number>> = { 10: 500, 20: 1000, 30: 2000 };

export const FEVER_COMBO = 10;
export const FEVER_BOOST = 1.25;

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

export type Difficulty = 'facil' | 'normal' | 'dificil';

export interface DifficultyRules {
  readonly comboWindow: number;
  readonly scoreMult: number;
  readonly initialIcons: number;
}

export const DIFFICULTY: Readonly<Record<Difficulty, DifficultyRules>> = {
  facil: { comboWindow: 5_000, scoreMult: 0.8, initialIcons: 12 },
  normal: { comboWindow: 3_500, scoreMult: 1.0, initialIcons: 18 },
  dificil: { comboWindow: 2_500, scoreMult: 1.3, initialIcons: 24 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function comboMultiplierFor(combo: number): number {
  for (const [threshold, multiplier] of COMBO_MULTIPLIERS) {
    if (combo >= threshold) return multiplier;
  }
  return 1;
}

/**
 * Continuidad del combo: encadena si el toque llega dentro de la ventana de la
 * dificultad, y reinicia a 1 en cuanto se pasa.
 */
export function nextCombo(
  combo: number,
  lastComboAtMs: number,
  nowMs: number,
  comboWindowMs: number,
): number {
  return combo > 0 && nowMs - lastComboAtMs <= comboWindowMs ? combo + 1 : 1;
}

/**
 * Sprint final: con el reloj en marcha y a 10 s o menos, todo puntúa ×1.5. Lee
 * el reloj **antes** de sumar el tiempo de esta convergencia, igual que el motor.
 */
export function sprintMultiplierFor(timeLeftSeconds: number): number {
  return timeLeftSeconds > 0 && timeLeftSeconds <= SPRINT_WINDOW ? SPRINT_MULT : 1;
}

export function feverBoostFor(fever: boolean): number {
  return fever ? FEVER_BOOST : 1;
}

export interface ConvergenceScoreInput {
  /** Iconos eliminados en este toque. */
  readonly removed: number;
  /** Combo **ya actualizado** por este toque. */
  readonly combo: number;
  readonly difficulty: Difficulty;
  /** Reloj antes de aplicar el tiempo ganado por esta convergencia. */
  readonly timeLeftSeconds: number;
  /** Fiebre **ya evaluada** para este toque: entra antes de puntuar. */
  readonly fever: boolean;
}

/**
 * Puntos de una convergencia. Réplica exacta de `game.js`:
 * `floor(removed*10*level * comboMult * diff * modo * fiebre * temp * sprint * surv)`.
 * En Contrarreloj `level` es 1, y `tempMult` y `survMult` valen 1 porque solo los
 * mueven Aventura y Supervivencia.
 */
export function convergencePoints(input: ConvergenceScoreInput): number {
  const base = input.removed * 10 * TIME_ATTACK_LEVEL;
  return Math.floor(
    base
    * comboMultiplierFor(input.combo)
    * DIFFICULTY[input.difficulty].scoreMult
    * TIME_ATTACK_MODE_MULT
    * feverBoostFor(input.fever)
    * sprintMultiplierFor(input.timeLeftSeconds),
  );
}

/** Bono plano de hito; 0 si este combo no es exactamente 10, 20 o 30. */
export function milestoneBonusFor(combo: number): number {
  return MILESTONES[combo] ?? 0;
}

export const EMPTY_BOARD_BONUS = 500;
export const EMPTY_BOARD_CHAIN_STEP = 90;
export const EMPTY_BOARD_COMBO_STEP = 28;
export const EMPTY_BOARD_COMBO_CAP = 12;
export const EMPTY_BOARD_MIN_POINTS = 250;

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

/**
 * Bono por dejar el tablero vacío en modos endless/score-attack. En Contrarreloj
 * no repone tiempo: solo puntúa.
 */
export function emptyBoardBonusPoints(input: EmptyBoardBonusInput): number {
  const combo = Math.min(input.combo || 1, EMPTY_BOARD_COMBO_CAP);
  const raw = EMPTY_BOARD_BONUS
    + input.chain * EMPTY_BOARD_CHAIN_STEP
    + combo * EMPTY_BOARD_COMBO_STEP;
  return Math.max(EMPTY_BOARD_MIN_POINTS, Math.round(
    raw
    * DIFFICULTY[input.difficulty].scoreMult
    * TIME_ATTACK_MODE_MULT
    * feverBoostFor(input.fever)
    * sprintMultiplierFor(input.timeLeftSeconds),
  ));
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
  const decay = clamp(1 - elapsedSeconds / TIMED_GAIN.decaySec, TIMED_GAIN.minDecay, 1);
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

/** Puntos planos de una baldosa de cristal convergida (sin reliquia de Aventura). */
export const CRYSTAL_POINTS = 50;

export const TIME_CAPSULE_SECONDS = 5;

/**
 * Cápsula de tiempo: se detona por adyacencia al resolver la convergencia, es
 * decir **después** de aplicar el tiempo ganado, y respeta el mismo tope duro.
 */
export function applyTimeCapsule(timeLeftSeconds: number): number {
  return Math.min(TIMED_CAP, timeLeftSeconds + TIME_CAPSULE_SECONDS);
}

export function shouldEnterFever(fever: boolean, combo: number): boolean {
  return !fever && combo >= FEVER_COMBO;
}
