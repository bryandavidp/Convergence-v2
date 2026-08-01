import type { PlatformStorage } from '../platform/contract.js';

export type JsonValidator<T> = (value: unknown) => value is T;

export class JsonRepositoryDataError extends Error {
  readonly storageKey: string;
  override readonly cause: unknown;

  constructor(message: string, storageKey: string, cause?: unknown) {
    super(message);
    this.name = 'JsonRepositoryDataError';
    this.storageKey = storageKey;
    this.cause = cause;
  }
}

/*
 * Distintas instancias de JsonRepository pueden compartir el mismo adaptador
 * (localStorage o Preferences). La cola por adaptador + clave hace que una
 * actualizacion read-modify-write sea atomica dentro de este runtime.
 */
const storageLocks = new WeakMap<PlatformStorage, Map<string, Promise<void>>>();

function locksFor(storage: PlatformStorage): Map<string, Promise<void>> {
  const existing = storageLocks.get(storage);
  if (existing !== undefined) return existing;
  const created = new Map<string, Promise<void>>();
  storageLocks.set(storage, created);
  return created;
}

export class JsonRepository {
  constructor(
    private readonly storage: PlatformStorage,
    private readonly namespace = 'cv2',
    private readonly now: () => number = Date.now,
  ) {}

  async read<T>(key: string, validate?: JsonValidator<T>): Promise<T | null> {
    return this.exclusive(key, () => this.readUnlocked(key, validate));
  }

  async write<T>(key: string, value: T): Promise<void> {
    await this.exclusive(key, async () => {
      await this.writeUnlocked(key, value);
    });
  }

  async remove(key: string): Promise<void> {
    await this.exclusive(key, async () => {
      await this.storage.remove(this.storageKey(key));
    });
  }

  /**
   * Ejecuta una mutacion serializada sobre una unica clave.
   * `null` elimina el documento; cualquier otro valor lo reemplaza completo.
   */
  async update<T>(
    key: string,
    updater: (current: T | null) => T | null | Promise<T | null>,
    validate?: JsonValidator<T>,
  ): Promise<T | null> {
    return this.exclusive(key, async () => {
      const current = await this.readUnlocked(key, validate);
      const next = await updater(current);
      if (next === null) {
        await this.storage.remove(this.storageKey(key));
        return null;
      }
      if (validate !== undefined && !validate(next)) {
        throw new JsonRepositoryDataError(
          'La actualizacion produjo un documento JSON que no cumple su contrato.',
          this.storageKey(key),
        );
      }
      await this.writeUnlocked(key, next);
      return next;
    });
  }

  private async readUnlocked<T>(
    key: string,
    validate?: JsonValidator<T>,
  ): Promise<T | null> {
    const storageKey = this.storageKey(key);
    const raw = await this.storage.get(storageKey);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      await this.quarantine(storageKey, raw);
      throw new JsonRepositoryDataError(
        'El documento persistido contiene JSON corrupto y se ha puesto en cuarentena.',
        storageKey,
        error,
      );
    }

    if (validate !== undefined && !validate(parsed)) {
      await this.quarantine(storageKey, raw);
      throw new JsonRepositoryDataError(
        'El documento persistido no cumple su contrato y se ha puesto en cuarentena.',
        storageKey,
      );
    }
    return parsed as T;
  }

  private async writeUnlocked<T>(key: string, value: T): Promise<void> {
    const storageKey = this.storageKey(key);
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      throw new JsonRepositoryDataError(
        'El valor no se puede serializar como JSON.',
        storageKey,
        error,
      );
    }
    if (serialized === undefined) {
      throw new JsonRepositoryDataError(
        'El valor no produce un documento JSON persistible.',
        storageKey,
      );
    }
    await this.storage.set(storageKey, serialized);
  }

  private async quarantine(storageKey: string, raw: string): Promise<void> {
    const timestamp = Math.max(0, Math.trunc(this.now()));
    await this.storage.set(`${storageKey}.corrupt.${timestamp}`, raw);
    await this.storage.remove(storageKey);
  }

  private storageKey(key: string): string {
    if (key.length === 0 || key.includes('\u0000')) {
      throw new Error('La clave del repositorio JSON no es valida.');
    }
    return `${this.namespace}:${key}`;
  }

  private async exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const storageKey = this.storageKey(key);
    const locks = locksFor(this.storage);
    const predecessor = locks.get(storageKey) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(storageKey, current);

    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      if (locks.get(storageKey) === current) locks.delete(storageKey);
    }
  }
}
