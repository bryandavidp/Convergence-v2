export type GameplaySeed = number | string;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

/**
 * Replica la normalización que hoy realiza Game.start antes de llamar a RNG.seed:
 * una cadena compuesta solo por dígitos equivale a la misma semilla numérica.
 */
export function normalizeGameplaySeed(seed: GameplaySeed): number {
  const normalized =
    typeof seed === 'string' && /^\d+$/.test(seed) ? Number(seed) : seed;
  return typeof normalized === 'string'
    ? hashString(normalized)
    : normalized >>> 0;
}

/**
 * Mulberry32 compatible con el RNG del snapshot 2.37.1.
 *
 * Exponer snapshot/restore es el primer paso necesario para replays exactos:
 * el RunSave legacy todavía no persiste la posición del stream.
 */
export class Mulberry32 {
  private state: number;

  constructor(seed: GameplaySeed) {
    this.state = normalizeGameplaySeed(seed);
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  snapshot(): number {
    return this.state;
  }

  restore(state: number): void {
    this.state = state >>> 0;
  }
}
