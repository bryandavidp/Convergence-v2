import {
  applyMistakePenalty,
  applyTimeCapsule,
  applyTimeGain,
  convergencePoints,
  CRYSTAL_POINTS,
  emptyBoardBonusPoints,
  milestoneBonusFor,
  timeGainFor,
  TIMED_START,
  type Difficulty,
} from '@convergence/game-core';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Recalcula una partida de Contrarreloj con **el mismo módulo de reglas que
 * ejecuta el cliente** (`@convergence/game-core`). Si el servidor tuviera su
 * propia copia de las fórmulas, cualquier deriva convertiría una puntuación
 * legítima en un rechazo, que es peor que no verificar.
 *
 * Esto todavía no es el replay completo de la fase 6: aquí no se reproduce el
 * tablero ni el spawn, así que un cliente podría mentir sobre cuántos iconos
 * convergió. Lo que sí queda cerrado es que el score no se acepta como dato: se
 * recalcula a partir de los eventos y se compara.
 */

export const MAX_TIME_ATTACK_EVENTS = 2_000;

export type TimeAttackEvent =
  | {
    readonly kind: 'convergence';
    readonly removed: number;
    readonly combo: number;
    readonly fever: boolean;
    readonly elapsedSeconds: number;
    readonly crystals?: number;
    readonly capsules?: number;
    readonly emptyBoardChain?: number;
  }
  | { readonly kind: 'mistake'; readonly elapsedSeconds: number };

export interface TimeAttackRun {
  readonly difficulty: Difficulty;
  readonly events: readonly TimeAttackEvent[];
  /**
   * Segundo en el que terminó la partida. El reloj sigue corriendo después del
   * último toque, así que sin este dato el servidor cerraría la run con más
   * tiempo del que le quedaba al jugador.
   */
  readonly endedAtSeconds: number;
}

export interface TimeAttackOutcome {
  readonly score: number;
  readonly timeLeftSeconds: number;
  readonly convergences: number;
  readonly mistakes: number;
}

const DIFFICULTIES: readonly Difficulty[] = ['facil', 'normal', 'dificil'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function counter(value: unknown, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) {
    throw new HttpsError('invalid-argument', `${label} inválido.`);
  }
  return Number(value);
}

export function parseTimeAttackRun(data: unknown): TimeAttackRun {
  if (!isRecord(data)) throw new HttpsError('invalid-argument', 'Run inválida.');
  const difficulty = data.difficulty;
  if (typeof difficulty !== 'string' || !DIFFICULTIES.includes(difficulty as Difficulty)) {
    throw new HttpsError('invalid-argument', 'Dificultad desconocida.');
  }
  if (!Array.isArray(data.events)) {
    throw new HttpsError('invalid-argument', 'La run debe traer una lista de eventos.');
  }
  if (data.events.length > MAX_TIME_ATTACK_EVENTS) {
    throw new HttpsError('invalid-argument', 'La run supera el máximo de eventos.');
  }

  let previousElapsed = 0;
  const events = data.events.map((raw): TimeAttackEvent => {
    if (!isRecord(raw)) throw new HttpsError('invalid-argument', 'Evento inválido.');
    const elapsed = Number(raw.elapsedSeconds);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 86_400) {
      throw new HttpsError('invalid-argument', 'elapsedSeconds inválido.');
    }
    // El reloj de partida solo avanza: una run que retrocede en el tiempo está
    // manipulada, y además rompería el drenaje del contador.
    if (elapsed < previousElapsed) {
      throw new HttpsError('invalid-argument', 'elapsedSeconds no puede retroceder.');
    }
    previousElapsed = elapsed;

    if (raw.kind === 'mistake') return { kind: 'mistake', elapsedSeconds: elapsed };
    if (raw.kind !== 'convergence') {
      throw new HttpsError('invalid-argument', 'Tipo de evento desconocido.');
    }
    if (typeof raw.fever !== 'boolean') {
      throw new HttpsError('invalid-argument', 'fever inválido.');
    }
    return {
      kind: 'convergence',
      // Una convergencia elimina entre 2 y 4 iconos: fuera de ahí no es una
      // jugada posible y no se recalcula, se rechaza.
      removed: counter(raw.removed, 'removed', 4) >= 2
        ? counter(raw.removed, 'removed', 4)
        : (() => { throw new HttpsError('invalid-argument', 'removed inválido.'); })(),
      combo: counter(raw.combo, 'combo', 10_000),
      fever: raw.fever,
      elapsedSeconds: elapsed,
      crystals: raw.crystals === undefined ? 0 : counter(raw.crystals, 'crystals', 4),
      capsules: raw.capsules === undefined ? 0 : counter(raw.capsules, 'capsules', 4),
      emptyBoardChain: raw.emptyBoardChain === undefined
        ? 0
        : counter(raw.emptyBoardChain, 'emptyBoardChain', 10_000),
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
    throw new HttpsError('invalid-argument', 'endedAtSeconds inválido.');
  }

  return { difficulty: difficulty as Difficulty, events, endedAtSeconds };
}

export function recomputeTimeAttackRun(run: TimeAttackRun): TimeAttackOutcome {
  let score = 0;
  let timeLeft = TIMED_START;
  let convergences = 0;
  let mistakes = 0;
  let previousElapsed = 0;

  for (const event of run.events) {
    // El reloj corre entre jugadas. Sin drenarlo aquí, el servidor creería que
    // el jugador nunca entra en la ventana de sprint y puntuaría de menos.
    timeLeft = Math.max(0, timeLeft - (event.elapsedSeconds - previousElapsed));
    previousElapsed = event.elapsedSeconds;

    if (event.kind === 'mistake') {
      timeLeft = applyMistakePenalty(timeLeft);
      mistakes += 1;
      continue;
    }
    convergences += 1;

    // El orden es el del motor: puntuar con el reloj previo, después sumar
    // tiempo, y solo entonces cobrar el bono de tablero vacío.
    score += convergencePoints({
      removed: event.removed,
      combo: event.combo,
      difficulty: run.difficulty,
      timeLeftSeconds: timeLeft,
      fever: event.fever,
    });
    score += milestoneBonusFor(event.combo);
    score += (event.crystals ?? 0) * CRYSTAL_POINTS;

    timeLeft = applyTimeGain(
      timeLeft,
      timeGainFor(event.removed, event.combo, event.elapsedSeconds),
    );
    for (let n = 0; n < (event.capsules ?? 0); n += 1) timeLeft = applyTimeCapsule(timeLeft);

    if ((event.emptyBoardChain ?? 0) > 0) {
      score += emptyBoardBonusPoints({
        chain: event.emptyBoardChain as number,
        combo: event.combo,
        difficulty: run.difficulty,
        timeLeftSeconds: timeLeft,
        fever: event.fever,
      });
    }
  }

  // Drenaje final: el reloj no se detiene con el último toque. Se tolera que
  // falte el dato para que un cálculo directo nunca devuelva NaN.
  const endedAt = Number.isFinite(run.endedAtSeconds) ? run.endedAtSeconds : previousElapsed;
  timeLeft = Math.max(0, timeLeft - Math.max(0, endedAt - previousElapsed));

  return { score, timeLeftSeconds: timeLeft, convergences, mistakes };
}

export interface TimeAttackVerdict extends TimeAttackOutcome {
  readonly accepted: boolean;
  readonly claimedScore: number;
}

/**
 * El score que envía el cliente nunca se guarda como autoritativo: se compara
 * con el recalculado y se marca `accepted` solo si coinciden exactamente.
 */
export function verifyTimeAttackClaim(data: unknown): TimeAttackVerdict {
  if (!isRecord(data)) throw new HttpsError('invalid-argument', 'Reclamación inválida.');
  const claimedScore = counter(data.claimedScore, 'claimedScore', Number.MAX_SAFE_INTEGER);
  const outcome = recomputeTimeAttackRun(parseTimeAttackRun(data.run));
  return { ...outcome, claimedScore, accepted: outcome.score === claimedScore };
}
