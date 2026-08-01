import type { GameplaySeed } from './rng.js';

export interface ReplayAction<TPayload = unknown> {
  sequence: number;
  elapsedMs: number;
  type: string;
  payload: TPayload;
}

export interface DeterministicEngine<TState, TAction extends ReplayAction> {
  createInitialState(seed: GameplaySeed): TState;
  reduce(state: Readonly<TState>, action: Readonly<TAction>): TState;
  hash(state: Readonly<TState>): string;
}

export interface Replay<TAction extends ReplayAction = ReplayAction> {
  version: 1;
  seed: GameplaySeed;
  mode: string;
  actions: readonly TAction[];
  finalStateHash: string;
}

export function hasContiguousSequence(
  actions: readonly ReplayAction[],
): boolean {
  return actions.every((action, index) => action.sequence === index);
}
