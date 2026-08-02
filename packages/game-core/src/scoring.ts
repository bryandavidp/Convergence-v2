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

/**
 * Los seis modos que existen en `Config.MODES` y por tanto tienen multiplicador.
 * No se reutiliza `GameModeId` de `state-v2.ts` porque aquel incluye
 * `reto-diario`, que es un flag sobre otro modo y no un modo con reglas propias.
 */
export type ScoringModeId =
  | 'tutorial'
  | 'clasico'
  | 'aventura'
  | 'contrarreloj'
  | 'supervivencia'
  | 'zen';

export type Difficulty = 'facil' | 'normal' | 'dificil';

export interface DifficultyRules {
  readonly comboWindow: number;
  readonly scoreMult: number;
  readonly initialIcons: number;
  readonly spawnStart: number;
  readonly spawnMin: number;
  readonly penaltyBase: number;
}

export const DIFFICULTY: Readonly<Record<Difficulty, DifficultyRules>> = {
  facil: {
    comboWindow: 5_000, scoreMult: 0.8, initialIcons: 12,
    spawnStart: 6_000, spawnMin: 2_000, penaltyBase: 1,
  },
  normal: {
    comboWindow: 3_500, scoreMult: 1.0, initialIcons: 18,
    spawnStart: 5_000, spawnMin: 1_400, penaltyBase: 2,
  },
  dificil: {
    comboWindow: 2_500, scoreMult: 1.3, initialIcons: 24,
    spawnStart: 3_800, spawnMin: 900, penaltyBase: 3,
  },
};

/** Multiplicador constante de cada modo durante toda la partida. */
export const MODE_MULTIPLIERS: Readonly<Record<ScoringModeId, number>> = {
  tutorial: 0.5,
  clasico: 1,
  aventura: 1.1,
  contrarreloj: 1.2,
  supervivencia: 1.5,
  zen: 0.8,
};

/** `[umbral, multiplicador]`, evaluado de mayor a menor: gana la primera coincidencia. */
export const COMBO_MULTIPLIERS: readonly (readonly [number, number])[] = [
  [30, 10], [20, 8], [15, 5], [10, 3], [6, 2], [3, 1.5],
];

/** Puntos planos que se suman exactamente al alcanzar ese combo. */
export const MILESTONES: Readonly<Record<number, number>> = { 10: 500, 20: 1000, 30: 2000 };

export const FEVER_COMBO = 10;
export const FEVER_BOOST = 1.25;

/** Puntos planos de una baldosa de cristal convergida. */
export const CRYSTAL_POINTS = 50;

export const EMPTY_BOARD_BONUS = 500;
export const EMPTY_BOARD_CHAIN_STEP = 90;
export const EMPTY_BOARD_COMBO_STEP = 28;
export const EMPTY_BOARD_WAVE_STEP = 45;
export const EMPTY_BOARD_COMBO_CAP = 12;
export const EMPTY_BOARD_MIN_POINTS = 250;

/**
 * Bono plano por completar un nivel con el tablero perfecto. Lo cobran los modos
 * **sin** bono escalado —Tutorial, Clásico y Aventura—, que no son endless ni
 * score-attack. Se suma dentro del mismo toque que completa el nivel.
 */
export const PERFECT_BOARD_BONUS = 500;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const PENALTY_MIN_ICONS = 1;
export const PENALTY_MAX_ICONS = 5;
/** Factor por el que se acelera el spawn tras un fallo en los modos con castigo. */
export const PENALTY_SPAWN_FACTOR = 0.95;

/**
 * Iconos que añade un fallo en los modos con penalización (Clásico, Aventura y
 * Supervivencia). Escala con la dificultad y con el nivel, y está acotado.
 */
export function iconPenaltyCount(difficulty: Difficulty, level: number): number {
  return clamp(
    DIFFICULTY[difficulty].penaltyBase + Math.floor((level - 1) / 3),
    PENALTY_MIN_ICONS,
    PENALTY_MAX_ICONS,
  );
}

/** El fallo también acelera el ritmo de aparición, con suelo por dificultad. */
export function penalizedSpawnRate(difficulty: Difficulty, spawnRate: number): number {
  return Math.max(
    DIFFICULTY[difficulty].spawnMin,
    Math.round(spawnRate * PENALTY_SPAWN_FACTOR),
  );
}

/**
 * Puntos de una limpieza por área (bomba y baldosas similares). A diferencia de
 * una convergencia, **no** pasa por combo, dificultad, modo ni fiebre: es la base
 * desnuda `celdas * 10 * nivel`.
 */
export function areaClearPoints(cells: number, level: number): number {
  return cells * 10 * level;
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

/** Bono plano de hito; 0 si este combo no es exactamente 10, 20 o 30. */
export function milestoneBonusFor(combo: number): number {
  return MILESTONES[combo] ?? 0;
}

export function feverBoostFor(fever: boolean, extraBoost = 0): number {
  return fever ? FEVER_BOOST + extraBoost : 1;
}

/**
 * Factores variables de una convergencia. Los que un modo no usa valen 1, que es
 * exactamente lo que hace el motor: la expresión es la misma para todos y son
 * los factores neutros los que la especializan.
 */
export interface ConvergenceFactors {
  readonly removed: number;
  /** Nivel de dificultad efectivo del modo; 1 en los modos sin niveles. */
  readonly level: number;
  /** Combo **ya actualizado** por este toque. */
  readonly combo: number;
  readonly difficulty: Difficulty;
  readonly mode: ScoringModeId;
  /** Fiebre **ya evaluada**: entra antes de puntuar, así que el toque que la activa ya cobra. */
  readonly feverBoost: number;
  readonly tempMultiplier?: number;
  readonly sprintMultiplier?: number;
  readonly survivalMultiplier?: number;
}

/**
 * Puntos de una convergencia. Réplica exacta de `game.js`:
 * `floor(removed*10*level * comboMult * dificultad * modo * fiebre * temp * sprint * surv)`.
 */
export function convergencePoints(factors: ConvergenceFactors): number {
  const base = factors.removed * 10 * factors.level;
  return Math.floor(
    base
    * comboMultiplierFor(factors.combo)
    * DIFFICULTY[factors.difficulty].scoreMult
    * MODE_MULTIPLIERS[factors.mode]
    * factors.feverBoost
    * (factors.tempMultiplier ?? 1)
    * (factors.sprintMultiplier ?? 1)
    * (factors.survivalMultiplier ?? 1),
  );
}

export interface EmptyBoardFactors {
  /** Veces que el tablero ha quedado vacío en esta partida, contando esta (1-based). */
  readonly chain: number;
  readonly combo: number;
  readonly difficulty: Difficulty;
  readonly mode: ScoringModeId;
  readonly feverBoost: number;
  /** Oleada actual; solo suma en Supervivencia. */
  readonly wave?: number;
  readonly tempMultiplier?: number;
  readonly sprintMultiplier?: number;
}

/**
 * Bono por dejar el tablero vacío. Solo lo cobran los modos endless o
 * score-attack; los demás usan el bono plano de tablero perfecto.
 */
export function emptyBoardBonusPoints(factors: EmptyBoardFactors): number {
  const combo = Math.min(factors.combo || 1, EMPTY_BOARD_COMBO_CAP);
  const raw = EMPTY_BOARD_BONUS
    + factors.chain * EMPTY_BOARD_CHAIN_STEP
    + combo * EMPTY_BOARD_COMBO_STEP
    + (factors.mode === 'supervivencia' ? (factors.wave ?? 1) * EMPTY_BOARD_WAVE_STEP : 0);
  return Math.max(EMPTY_BOARD_MIN_POINTS, Math.round(
    raw
    * DIFFICULTY[factors.difficulty].scoreMult
    * MODE_MULTIPLIERS[factors.mode]
    * factors.feverBoost
    * (factors.tempMultiplier ?? 1)
    * (factors.sprintMultiplier ?? 1),
  ));
}
