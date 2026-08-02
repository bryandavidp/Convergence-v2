import type {
  UserBestRecordsDocumentV1,
  UserBestRecordsV1,
  UserBestRecordsWriteV1,
  UserProfileDocumentV1,
  UserProfileV1,
  UserProfileWriteV1,
} from '@convergence/contracts';
import {
  USER_PROFILE_SCHEMA_VERSION,
  userBestRecordsV1Schema,
  userBestRecordsWriteV1Schema,
  userProfileWriteV1Schema,
} from '@convergence/contracts';
import type { LocalDocumentMirror, UserProfileRepository } from '../storage/user-profile-repository.js';
import type { Outbox } from '../storage/outbox.js';
import { classifyOutboxError } from '../storage/outbox.js';

export const USER_PROFILE_OUTBOX_KIND = 'user-profile-update-v1';
export const USER_RECORDS_OUTBOX_KIND = 'user-records-update-v1';

/** Reintentos de compare-and-set antes de rendirse ante carreras ajenas. */
export const MAX_CAS_ATTEMPTS = 3;

export type ProfileLaneStatus =
  | 'synced'
  | 'conflict'
  | 'offline'
  | 'auth-required'
  | 'invalid';

/**
 * Resultado de un ciclo de sincronización. `value` es siempre lo que la app debe
 * usar ahora mismo; en conflicto se conserva lo local y se adjunta lo remoto
 * para que la decisión sea del jugador y no de un desempate por reloj.
 */
export interface ProfileSyncOutcome<TBody> {
  status: ProfileLaneStatus;
  value: TBody;
  revision: number;
  remote: TBody | null;
  error: string | null;
}

/**
 * Fusión de marcas personales. Es monótona -solo puede crecer-, así que dos
 * dispositivos que fusionen en cualquier orden llegan al mismo resultado y
 * ninguna marca puede perderse. Por eso los récords sí se resuelven solos.
 */
export function mergeUserBestRecords(
  local: UserBestRecordsV1,
  remote: UserBestRecordsV1,
  now = Date.now(),
): UserBestRecordsV1 {
  const marks = {
    survivalBest: Math.max(local.survivalBest, remote.survivalBest),
    survivalBestWave: Math.max(local.survivalBestWave, remote.survivalBestWave),
    adventureMaxLevel: Math.max(local.adventureMaxLevel, remote.adventureMaxLevel),
    bestCombo: Math.max(local.bestCombo, remote.bestCombo),
  };
  // `updatedAt` solo avanza si alguna marca cambió respecto a lo remoto. Si
  // avanzara siempre, el cuerpo fusionado nunca sería igual al remoto y cada
  // ciclo de sincronización forzaría una escritura inútil: revisiones y coste
  // creciendo sin que el jugador haya jugado nada.
  const matchesRemote = (Object.keys(marks) as (keyof typeof marks)[])
    .every((key) => marks[key] === remote[key]);
  const merged: UserBestRecordsV1 = {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    uid: local.uid,
    ...marks,
    updatedAt: matchesRemote ? remote.updatedAt : Math.max(local.updatedAt, remote.updatedAt, now),
  };
  return userBestRecordsV1Schema.parse(merged);
}

export interface ProfileSyncTransport {
  fetchRemoteProfile(uid: string): Promise<UserProfileDocumentV1 | null>;
  pushProfile(write: UserProfileWriteV1): Promise<UserProfileDocumentV1>;
  fetchRemoteRecords(uid: string): Promise<UserBestRecordsDocumentV1 | null>;
  pushRecords(write: UserBestRecordsWriteV1): Promise<UserBestRecordsDocumentV1>;
}

/** JSON con claves ordenadas: la huella no puede depender del orden de escritura. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Clave derivada del contenido: el mismo cuerpo sobre la misma revisión base
 * produce siempre la misma clave, así que un reintento tras un corte de red se
 * deduplica en el servidor en lugar de aplicarse dos veces.
 */
export function deriveIdempotencyKey(
  kind: string,
  uid: string,
  baseRevision: number,
  body: unknown,
): string {
  return `${kind}:${uid}:${baseRevision}:${fnv1a(canonicalJson(body))}`.slice(0, 128);
}

function sameBody(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export class UserProfileSyncCoordinator {
  constructor(
    private readonly uid: string,
    private readonly repository: UserProfileRepository,
    private readonly outbox: Outbox,
    private readonly transport: ProfileSyncTransport,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Perfil (nombre y cosméticos): no se puede fusionar solo, porque elegir un
   * avatar no es "mayor" que elegir otro. Si hay ediciones locales y el
   * servidor avanzó por otro lado, se declara conflicto y no se pisa nada.
   */
  async syncProfile(): Promise<ProfileSyncOutcome<UserProfileV1>> {
    const mirror = await this.repository.loadProfileMirror(this.uid);
    try {
      const remote = await this.transport.fetchRemoteProfile(this.uid);

      if (remote === null) return await this.pushProfile(mirror, 0);

      if (!mirror.dirty) {
        // Sin ediciones locales pendientes, adoptar lo remoto no pierde nada.
        await this.repository.saveProfileMirror(this.uid, {
          revision: remote.revision,
          body: remote.profile,
          dirty: false,
        });
        return this.outcome('synced', remote.profile, remote.revision, null);
      }

      if (remote.revision === mirror.revision) return await this.pushProfile(mirror, remote.revision);

      if (sameBody(remote.profile, mirror.body)) {
        // Mismo contenido por otra vía: adoptar la revisión y dejar de estar sucio.
        await this.repository.saveProfileMirror(this.uid, {
          revision: remote.revision,
          body: mirror.body,
          dirty: false,
        });
        return this.outcome('synced', mirror.body, remote.revision, null);
      }

      return this.outcome('conflict', mirror.body, mirror.revision, remote.profile);
    } catch (error) {
      return await this.handleFailure(
        error,
        USER_PROFILE_OUTBOX_KIND,
        mirror,
        (body) => this.outcome('offline', body, mirror.revision, null),
      );
    }
  }

  /**
   * Marcas personales: la fusión es monótona, así que un conflicto de revisión
   * se resuelve reintentando sobre la revisión nueva. Solo se abandona si el
   * servidor sigue moviéndose bajo los pies tras MAX_CAS_ATTEMPTS.
   */
  async syncBestRecords(): Promise<ProfileSyncOutcome<UserBestRecordsV1>> {
    const mirror = await this.repository.loadRecordsMirror(this.uid);
    let working = mirror;
    try {
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
        const remote = await this.transport.fetchRemoteRecords(this.uid);
        if (remote === null) return await this.pushRecords(working, 0);

        const merged = mergeUserBestRecords(working.body, remote.records, this.now());

        if (sameBody(merged, remote.records)) {
          // El servidor ya contiene todo lo local: nada que subir.
          await this.repository.saveRecordsMirror(this.uid, {
            revision: remote.revision,
            body: merged,
            dirty: false,
          });
          return this.outcome('synced', merged, remote.revision, null);
        }

        try {
          return await this.pushRecords({ ...working, body: merged }, remote.revision);
        } catch (error) {
          if (classifyOutboxError(error).category !== 'conflict') throw error;
          // Otro dispositivo escribió entre el fetch y el push: refusionar.
          working = { revision: remote.revision, body: merged, dirty: true };
        }
      }
      await this.repository.saveRecordsMirror(this.uid, { ...working, dirty: true });
      return this.outcome('conflict', working.body, working.revision, null);
    } catch (error) {
      return await this.handleFailure(
        error,
        USER_RECORDS_OUTBOX_KIND,
        working,
        (body) => this.outcome('offline', body, working.revision, null),
      );
    }
  }

  private async pushProfile(
    mirror: LocalDocumentMirror<UserProfileV1>,
    baseRevision: number,
  ): Promise<ProfileSyncOutcome<UserProfileV1>> {
    const write = userProfileWriteV1Schema.parse({
      idempotencyKey: deriveIdempotencyKey(
        USER_PROFILE_OUTBOX_KIND,
        this.uid,
        baseRevision,
        mirror.body,
      ),
      baseRevision,
      profile: mirror.body,
    });
    const stored = await this.transport.pushProfile(write);
    await this.repository.saveProfileMirror(this.uid, {
      revision: stored.revision,
      body: stored.profile,
      dirty: false,
    });
    return this.outcome('synced', stored.profile, stored.revision, null);
  }

  private async pushRecords(
    mirror: LocalDocumentMirror<UserBestRecordsV1>,
    baseRevision: number,
  ): Promise<ProfileSyncOutcome<UserBestRecordsV1>> {
    const write = userBestRecordsWriteV1Schema.parse({
      idempotencyKey: deriveIdempotencyKey(
        USER_RECORDS_OUTBOX_KIND,
        this.uid,
        baseRevision,
        mirror.body,
      ),
      baseRevision,
      records: mirror.body,
    });
    const stored = await this.transport.pushRecords(write);
    await this.repository.saveRecordsMirror(this.uid, {
      revision: stored.revision,
      body: stored.records,
      dirty: false,
    });
    return this.outcome('synced', stored.records, stored.revision, null);
  }

  /**
   * Solo lo transitorio se encola para reintento. Un fallo de autenticación o
   * un rechazo permanente no mejoran reintentando y no deben quedar girando en
   * la outbox consumiendo intentos.
   */
  private async handleFailure<TBody>(
    error: unknown,
    kind: string,
    mirror: LocalDocumentMirror<TBody>,
    offline: (body: TBody) => ProfileSyncOutcome<TBody>,
  ): Promise<ProfileSyncOutcome<TBody>> {
    const classification = classifyOutboxError(error);
    if (classification.category === 'retry') {
      await this.outbox.enqueue({
        id: `${kind}:${this.uid}:${mirror.revision}:${fnv1a(canonicalJson(mirror.body))}`,
        ownerUid: this.uid,
        kind,
        createdAt: Math.trunc(this.now()),
        payload: { baseRevision: mirror.revision, body: mirror.body },
      });
      return offline(mirror.body);
    }
    const status: ProfileLaneStatus = classification.category === 'auth'
      ? 'auth-required'
      : classification.category === 'conflict'
        ? 'conflict'
        : 'invalid';
    return this.outcome(status, mirror.body, mirror.revision, null, classification.message);
  }

  private outcome<TBody>(
    status: ProfileLaneStatus,
    value: TBody,
    revision: number,
    remote: TBody | null,
    error: string | null = null,
  ): ProfileSyncOutcome<TBody> {
    return Object.freeze({ status, value, revision, remote, error });
  }
}
