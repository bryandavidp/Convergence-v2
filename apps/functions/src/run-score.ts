import {
  adventureCrystalPoints,
  adventureRouteMultiplier,
  applyMistakePenalty,
  applyTimeCapsule,
  applyTimeGain,
  areaClearPoints,
  BONUS_TILE_POINTS,
  convergencePoints,
  CRYSTAL_POINTS,
  emptyBoardBonusPoints,
  feverBoostFor,
  milestoneBonusFor,
  PERFECT_BOARD_BONUS,
  sprintMultiplierFor,
  survivalFeverBoost,
  survivalLevel,
  survivalScoreMultiplier,
  survivalTempMultiplier,
  timeGainFor,
  TIMED_START,
  type Difficulty,
  type ScoringModeId,
} from '@convergence/game-core';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Recalcula una partida de cualquier modo con **el mismo módulo de reglas que
 * ejecuta el cliente** (`@convergence/game-core`). Si el servidor tuviera su
 * propia copia de las fórmulas, cualquier deriva convertiría una puntuación
 * legítima en un rechazo, que es peor que no verificar.
 *
 * Principio de diseño: el cliente envía **hechos acotados** (combo, oleada,
 * potenciadores activos) y el servidor **deriva** los multiplicadores con el
 * núcleo. Aceptar los multiplicadores ya calculados permitiría enviar un
 * `tempMultiplier` de 1000 y que el recálculo lo bendijera.
 *
 * Esto todavía no es el replay completo de la fase 6: no se reproduce el tablero
 * ni el spawn, así que un cliente puede mentir sobre cuántos iconos convergió.
 * Lo que sí queda cerrado es que el score no se acepta como dato.
 */

export const MAX_RUN_EVENTS = 4_000;
export const MAX_LEVEL = 10_000;
export const MAX_WAVE = 10_000;
export const MAX_SCORE_BOOST = 5;

/** Modos cuyo tablero vacío cobra el bono escalado; el resto cobra el plano. */
const ENDLESS_MODES: ReadonlySet<ScoringModeId> = new Set([
  'contrarreloj', 'supervivencia', 'zen',
]);
/** Solo Contrarreloj lleva reloj de partida. */
const TIMED_MODES: ReadonlySet<ScoringModeId> = new Set(['contrarreloj']);

const MODES: readonly ScoringModeId[] = [
  'tutorial', 'clasico', 'aventura', 'contrarreloj', 'supervivencia', 'zen',
];
const DIFFICULTIES: readonly Difficulty[] = ['facil', 'normal', 'dificil'];

export interface ConvergenceEvent {
  readonly kind: 'convergence';
  readonly removed: number;
  readonly combo: number;
  readonly fever: boolean;
  readonly elapsedSeconds: number;
  /** Nivel declarado; solo se respeta en Clásico y Aventura. */
  readonly level: number;
  readonly crystals: number;
  readonly capsules: number;
  readonly emptyBoardChain: number;
  readonly perfectLevel: boolean;
  readonly wave: number;
  readonly x2Active: boolean;
  readonly frenzyActive: boolean;
  readonly scoreBoost: number;
  readonly goldenWave: boolean;
  readonly denseRoute: boolean;
  readonly crystalRelic: boolean;
}

export interface MistakeEvent {
  readonly kind: 'mistake';
  readonly elapsedSeconds: number;
}

/**
 * Casilla bonus: suma un tanto fijo al tocarla, sin converger nada.
 *
 * Existe como evento propio porque el motor suma esos puntos **fuera** de una
 * convergencia. Sin modelarlo, cualquier partida que tocara una casilla bonus
 * recalculaba menos de lo que vio el jugador y se rechazaba en silencio: la
 * marca legítima simplemente no aparecía en la tabla.
 *
 * No lleva importe: lo pone el servidor desde el núcleo. Si viajara en el
 * evento, el cliente elegiría cuánto vale.
 */
export interface BonusTileEvent {
  readonly kind: 'bonusTile';
  readonly elapsedSeconds: number;
}

/**
 * Bomba: limpia un área y puntúa por celda despejada. Igual que el bonus, es
 * puntuación fuera de convergencia. El cliente declara **cuántas celdas** cayó,
 * acotado al área máxima de una detonación (3×3 = 9); el valor por celda lo
 * calcula el servidor.
 */
export interface AreaClearEvent {
  readonly kind: 'areaClear';
  readonly cells: number;
  readonly level: number;
  /** Solo lo usa Supervivencia, que deriva su nivel de la oleada. */
  readonly wave: number;
  readonly elapsedSeconds: number;
}

export type RunEvent = ConvergenceEvent | MistakeEvent | BonusTileEvent | AreaClearEvent;

/** Celdas máximas que puede despejar una detonación: el área 3×3 que usa el motor. */
export const MAX_AREA_CLEAR_CELLS = 9;

export interface RunClaim {
  readonly mode: ScoringModeId;
  readonly difficulty: Difficulty;
  readonly events: readonly RunEvent[];
  readonly endedAtSeconds: number;
}

export interface RunOutcome {
  readonly score: number;
  readonly timeLeftSeconds: number;
  readonly convergences: number;
  readonly mistakes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): HttpsError {
  return new HttpsError('invalid-argument', message);
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw invalid(`${label} inválido.`);
  }
  return Number(value);
}

function optionalInteger(value: unknown, label: string, max: number, fallback = 0): number {
  return value === undefined ? fallback : integer(value, label, 0, max);
}

function flag(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw invalid(`${label} inválido.`);
  return value;
}

export function parseRunClaim(data: unknown): RunClaim {
  if (!isRecord(data)) throw invalid('Run inválida.');
  if (typeof data.mode !== 'string' || !MODES.includes(data.mode as ScoringModeId)) {
    throw invalid('Modo desconocido.');
  }
  if (
    typeof data.difficulty !== 'string'
    || !DIFFICULTIES.includes(data.difficulty as Difficulty)
  ) {
    throw invalid('Dificultad desconocida.');
  }
  if (!Array.isArray(data.events)) throw invalid('La run debe traer una lista de eventos.');
  if (data.events.length > MAX_RUN_EVENTS) throw invalid('La run supera el máximo de eventos.');

  let previousElapsed = 0;
  const events = data.events.map((raw): RunEvent => {
    if (!isRecord(raw)) throw invalid('Evento inválido.');
    const elapsed = Number(raw.elapsedSeconds);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 86_400) {
      throw invalid('elapsedSeconds inválido.');
    }
    // El reloj de partida solo avanza: una run que retrocede está manipulada.
    if (elapsed < previousElapsed) throw invalid('elapsedSeconds no puede retroceder.');
    previousElapsed = elapsed;

    if (raw.kind === 'mistake') return { kind: 'mistake', elapsedSeconds: elapsed };
    if (raw.kind === 'bonusTile') return { kind: 'bonusTile', elapsedSeconds: elapsed };
    if (raw.kind === 'areaClear') {
      return {
        kind: 'areaClear',
        cells: integer(raw.cells, 'cells', 0, MAX_AREA_CLEAR_CELLS),
        level: raw.level === undefined ? 1 : integer(raw.level, 'level', 1, MAX_LEVEL),
        wave: raw.wave === undefined ? 1 : integer(raw.wave, 'wave', 1, MAX_WAVE),
        elapsedSeconds: elapsed,
      };
    }
    if (raw.kind !== 'convergence') throw invalid('Tipo de evento desconocido.');

    // Una convergencia elimina entre 2 y 4 iconos: fuera de ahí no es jugada
    // posible y no se recalcula, se rechaza.
    const removed = integer(raw.removed, 'removed', 2, 4);
    const scoreBoost = raw.scoreBoost === undefined ? 0 : Number(raw.scoreBoost);
    if (!Number.isFinite(scoreBoost) || scoreBoost < 0 || scoreBoost > MAX_SCORE_BOOST) {
      throw invalid('scoreBoost inválido.');
    }

    return {
      kind: 'convergence',
      removed,
      combo: integer(raw.combo, 'combo', 0, MAX_RUN_EVENTS),
      fever: flag(raw.fever, 'fever'),
      elapsedSeconds: elapsed,
      level: raw.level === undefined ? 1 : integer(raw.level, 'level', 1, MAX_LEVEL),
      crystals: optionalInteger(raw.crystals, 'crystals', 4),
      capsules: optionalInteger(raw.capsules, 'capsules', 4),
      emptyBoardChain: optionalInteger(raw.emptyBoardChain, 'emptyBoardChain', MAX_RUN_EVENTS),
      perfectLevel: flag(raw.perfectLevel, 'perfectLevel'),
      wave: raw.wave === undefined ? 1 : integer(raw.wave, 'wave', 1, MAX_WAVE),
      x2Active: flag(raw.x2Active, 'x2Active'),
      frenzyActive: flag(raw.frenzyActive, 'frenzyActive'),
      scoreBoost,
      goldenWave: flag(raw.goldenWave, 'goldenWave'),
      denseRoute: flag(raw.denseRoute, 'denseRoute'),
      crystalRelic: flag(raw.crystalRelic, 'crystalRelic'),
    };
  });

  const endedAtSeconds = data.endedAtSeconds === undefined
    ? previousElapsed
    : Number(data.endedAtSeconds);
  if (
    !Number.isFinite(endedAtSeconds)
    || endedAtSeconds < previousElapsed
    || endedAtSeconds > 86_400
  ) {
    throw invalid('endedAtSeconds inválido.');
  }

  return {
    mode: data.mode as ScoringModeId,
    difficulty: data.difficulty as Difficulty,
    events,
    endedAtSeconds,
  };
}

/**
 * Nivel efectivo. Solo Clásico y Aventura tienen nivel propio; en el resto lo
 * fija la regla del modo, así que un nivel declarado se ignora en vez de
 * creerse.
 */
function levelOf(
  mode: ScoringModeId,
  difficulty: Difficulty,
  level: number,
  wave: number,
): number {
  if (mode === 'supervivencia') return survivalLevel(wave, difficulty);
  if (mode === 'clasico' || mode === 'aventura') return level;
  return 1;
}

function levelFor(mode: ScoringModeId, difficulty: Difficulty, event: ConvergenceEvent): number {
  return levelOf(mode, difficulty, event.level, event.wave);
}

function feverBoostFactor(mode: ScoringModeId, event: ConvergenceEvent): number {
  // Zen declara `noFever`: aunque el cliente afirme lo contrario, no rinde.
  if (mode === 'zen') return 1;
  if (mode === 'supervivencia') return survivalFeverBoost(event.fever, event.wave);
  return feverBoostFor(event.fever);
}

function tempFactor(mode: ScoringModeId, event: ConvergenceEvent): number {
  if (mode === 'supervivencia') {
    return survivalTempMultiplier(event.wave, {
      x2Active: event.x2Active,
      frenzyActive: event.frenzyActive,
    });
  }
  if (mode === 'aventura') return adventureRouteMultiplier(event.denseRoute ? 'dense' : 'calm');
  return 1;
}

function survivalFactor(mode: ScoringModeId, event: ConvergenceEvent): number {
  return mode === 'supervivencia'
    ? survivalScoreMultiplier(event.scoreBoost, event.goldenWave)
    : 1;
}

function crystalValue(mode: ScoringModeId, event: ConvergenceEvent): number {
  return mode === 'aventura' ? adventureCrystalPoints(event.crystalRelic) : CRYSTAL_POINTS;
}

/**
 * Normaliza un evento por si `recomputeRun` se llama sin pasar por
 * `parseRunClaim`. Un campo ausente convertiría la suma en `NaN` y un `NaN`
 * jamás debe llegar a un veredicto: compararlo con el score reclamado daría
 * siempre `false` y rechazaría partidas legítimas sin explicación.
 */
function normalize(event: RunEvent): RunEvent {
  if (event.kind === 'mistake' || event.kind === 'bonusTile') return event;
  if (event.kind === 'areaClear') {
    return {
      ...event,
      cells: event.cells ?? 0,
      level: event.level ?? 1,
      wave: event.wave ?? 1,
    };
  }
  return {
    ...event,
    crystals: event.crystals ?? 0,
    capsules: event.capsules ?? 0,
    emptyBoardChain: event.emptyBoardChain ?? 0,
    level: event.level ?? 1,
    wave: event.wave ?? 1,
    scoreBoost: event.scoreBoost ?? 0,
    perfectLevel: event.perfectLevel ?? false,
    x2Active: event.x2Active ?? false,
    frenzyActive: event.frenzyActive ?? false,
    goldenWave: event.goldenWave ?? false,
    denseRoute: event.denseRoute ?? false,
    crystalRelic: event.crystalRelic ?? false,
  };
}

export function recomputeRun(claim: RunClaim): RunOutcome {
  const { mode, difficulty } = claim;
  const timed = TIMED_MODES.has(mode);

  let score = 0;
  let timeLeft = timed ? TIMED_START : 0;
  let convergences = 0;
  let mistakes = 0;
  let previousElapsed = 0;

  for (const raw of claim.events) {
    const event = normalize(raw);
    // En los modos con reloj este corre entre jugadas. Sin drenarlo, el servidor
    // creería que el jugador nunca entra en la ventana de sprint.
    if (timed) timeLeft = Math.max(0, timeLeft - (event.elapsedSeconds - previousElapsed));
    previousElapsed = event.elapsedSeconds;

    if (event.kind === 'mistake') {
      if (timed) timeLeft = applyMistakePenalty(timeLeft);
      mistakes += 1;
      continue;
    }
    // Puntuación fuera de convergencia: no toca combo, ni reloj, ni fiebre.
    if (event.kind === 'bonusTile') {
      score += BONUS_TILE_POINTS;
      continue;
    }
    if (event.kind === 'areaClear') {
      score += areaClearPoints(event.cells, levelOf(mode, difficulty, event.level, event.wave));
      continue;
    }
    convergences += 1;

    const sprint = timed ? sprintMultiplierFor(timeLeft) : 1;
    const feverBoost = feverBoostFactor(mode, event);
    const tempMultiplier = tempFactor(mode, event);

    // El orden es el del motor: puntuar con el reloj previo, después sumar
    // tiempo, y solo entonces cobrar el bono de tablero vacío.
    score += convergencePoints({
      removed: event.removed,
      level: levelFor(mode, difficulty, event),
      combo: event.combo,
      difficulty,
      mode,
      feverBoost,
      tempMultiplier,
      sprintMultiplier: sprint,
      survivalMultiplier: survivalFactor(mode, event),
    });
    score += milestoneBonusFor(event.combo);
    score += event.crystals * crystalValue(mode, event);

    if (timed) {
      timeLeft = applyTimeGain(
        timeLeft,
        timeGainFor(event.removed, event.combo, event.elapsedSeconds),
      );
      for (let n = 0; n < event.capsules; n += 1) timeLeft = applyTimeCapsule(timeLeft);
    }

    if (event.emptyBoardChain > 0 && ENDLESS_MODES.has(mode)) {
      score += emptyBoardBonusPoints({
        chain: event.emptyBoardChain,
        combo: event.combo,
        difficulty,
        mode,
        wave: event.wave,
        feverBoost,
        tempMultiplier,
        sprintMultiplier: sprint,
      });
    }
    // Los modos sin bono escalado cobran el plano al completar nivel perfecto.
    if (event.perfectLevel && !ENDLESS_MODES.has(mode)) score += PERFECT_BOARD_BONUS;
  }

  if (timed) {
    const endedAt = Number.isFinite(claim.endedAtSeconds) ? claim.endedAtSeconds : previousElapsed;
    timeLeft = Math.max(0, timeLeft - Math.max(0, endedAt - previousElapsed));
  }

  return { score, timeLeftSeconds: timeLeft, convergences, mistakes };
}

export interface RunVerdict extends RunOutcome {
  readonly accepted: boolean;
  readonly claimedScore: number;
  readonly mode: ScoringModeId;
}

/**
 * El score que envía el cliente nunca se guarda como autoritativo: se compara
 * con el recalculado y se marca `accepted` solo si coinciden exactamente.
 */
export function verifyRunClaim(data: unknown): RunVerdict {
  if (!isRecord(data)) throw invalid('Reclamación inválida.');
  const claimedScore = integer(data.claimedScore, 'claimedScore', 0, Number.MAX_SAFE_INTEGER);
  const claim = parseRunClaim(data.run);
  const outcome = recomputeRun(claim);
  return {
    ...outcome,
    mode: claim.mode,
    claimedScore,
    accepted: outcome.score === claimedScore,
  };
}
