import type {
  LegacyProgressCommitV1,
  LegacyProgressImportV1,
  LegacyProgressPreviewResultV1,
} from '@convergence/contracts';
import {
  LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
  legacyProgressCommitV1Schema,
  legacyProgressImportV1Schema,
  legacyProgressPreviewResultV1Schema,
} from '@convergence/contracts';

import type { JsonRepository } from '../storage/json-repository.js';
import type { Outbox, OutboxItem } from '../storage/outbox.js';
import type { LegacyProgressTransport } from './legacy-progress-transport.js';

export const PROFILE_REPLICA_STORAGE_VERSION = 1 as const;
export const LEGACY_PREVIEW_OUTBOX_KIND = 'legacy-progress-preview-v1';
export const LEGACY_COMMIT_OUTBOX_KIND = 'legacy-progress-commit-v1';

export type ProfileSyncStatus =
  | 'local-only'
  | 'queued'
  | 'syncing'
  | 'awaiting-confirmation'
  | 'synced'
  | 'offline'
  | 'conflict'
  | 'identity-mismatch'
  | 'invalid-local'
  | 'error';

export interface ProfileReplicaV1 {
  storageVersion: typeof PROFILE_REPLICA_STORAGE_VERSION;
  ownerUid: string;
  serverRevision: number;
  status: ProfileSyncStatus;
  idempotencyKey: string | null;
  lastObservedLegacyHash: string | null;
  lastCommittedPayloadFingerprint: string | null;
  preview: LegacyProgressPreviewResultV1 | null;
  lastError: string | null;
  updatedAt: number;
}

/**
 * Resumen exclusivamente presentacional del preview. Es un subconjunto
 * deliberado de la proyección: solo lo que la UI necesita enseñar para que el
 * jugador decida. Nunca transporta economía, cofres ni el payload en
 * cuarentena, que siguen siendo decisión de Functions.
 */
export interface ProfilePreviewSummaryV1 {
  level: number;
  xp: number;
  adventureMaxLevel: number;
  achievements: number;
  economyQuarantined: boolean;
}

export interface ProfileSyncPublicState {
  status: ProfileSyncStatus;
  serverRevision: number;
  canConfirm: boolean;
  lastError: string | null;
  preview: ProfilePreviewSummaryV1 | null;
}

export interface LegacyProgressSyncOptions {
  now?: () => number;
  readLegacyMeta?: () => string | null;
  isOnline?: () => boolean;
  publish?: (state: ProfileSyncPublicState) => void;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isStatus(value: unknown): value is ProfileSyncStatus {
  return value === 'local-only'
    || value === 'queued'
    || value === 'syncing'
    || value === 'awaiting-confirmation'
    || value === 'synced'
    || value === 'offline'
    || value === 'conflict'
    || value === 'identity-mismatch'
    || value === 'invalid-local'
    || value === 'error';
}

export function isProfileReplicaV1(value: unknown): value is ProfileReplicaV1 {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set([
    'storageVersion',
    'ownerUid',
    'serverRevision',
    'status',
    'idempotencyKey',
    'lastObservedLegacyHash',
    'lastCommittedPayloadFingerprint',
    'preview',
    'lastError',
    'updatedAt',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  return value.storageVersion === PROFILE_REPLICA_STORAGE_VERSION
    && typeof value.ownerUid === 'string'
    && value.ownerUid.length >= 1
    && value.ownerUid.length <= 128
    && isSafeInteger(value.serverRevision)
    && isStatus(value.status)
    && (value.idempotencyKey === null
      || (typeof value.idempotencyKey === 'string'
        && /^[A-Za-z0-9_-]{12,96}$/.test(value.idempotencyKey)))
    && (value.lastObservedLegacyHash === null
      || (typeof value.lastObservedLegacyHash === 'string'
        && /^[a-f0-9]{64}$/.test(value.lastObservedLegacyHash)))
    && (value.lastCommittedPayloadFingerprint === null
      || (typeof value.lastCommittedPayloadFingerprint === 'string'
        && /^[a-f0-9]{64}$/.test(value.lastCommittedPayloadFingerprint)))
    && (value.preview === null
      || legacyProgressPreviewResultV1Schema.safeParse(value.preview).success)
    && (value.lastError === null
      || (typeof value.lastError === 'string' && value.lastError.length <= 300))
    && isSafeInteger(value.updatedAt);
}

function readableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string'
    ? error.code.toLowerCase().replace(/^functions\//, '')
    : '';
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function freshReplica(uid: string, now: number): ProfileReplicaV1 {
  return {
    storageVersion: PROFILE_REPLICA_STORAGE_VERSION,
    ownerUid: uid,
    serverRevision: 0,
    status: 'local-only',
    idempotencyKey: null,
    lastObservedLegacyHash: null,
    lastCommittedPayloadFingerprint: null,
    preview: null,
    lastError: null,
    updatedAt: now,
  };
}

function previewSummary(
  preview: LegacyProgressPreviewResultV1 | null,
): ProfilePreviewSummaryV1 | null {
  if (preview === null) return null;
  const { progress, claimCounts } = preview.projection;
  return Object.freeze({
    level: progress.level,
    xp: progress.xp,
    adventureMaxLevel: progress.adventureMaxLevel,
    achievements: claimCounts.achievements,
    economyQuarantined: preview.warnings.includes('economy-quarantined'),
  });
}

function publicState(replica: ProfileReplicaV1): ProfileSyncPublicState {
  return Object.freeze({
    status: replica.status,
    serverRevision: replica.serverRevision,
    canConfirm: replica.status === 'awaiting-confirmation' && replica.preview !== null,
    lastError: replica.lastError,
    preview: previewSummary(replica.preview),
  });
}

/**
 * Migra una sola reclamación cv_meta. Nunca reemplaza el Meta vivo ni convierte
 * economía/puntuaciones en autoridad; esas decisiones pertenecen a Functions.
 */
export class LegacyProgressSyncCoordinator {
  private readonly now: () => number;
  private readonly readLegacyMeta: () => string | null;
  private readonly isOnline: () => boolean;
  private readonly publish: (state: ProfileSyncPublicState) => void;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private replica: ProfileReplicaV1 | null = null;
  private captureFlight: Promise<void> | null = null;
  private drainFlight: Promise<void> | null = null;
  private retryTimer: unknown = null;

  constructor(
    readonly ownerUid: string,
    private readonly repository: JsonRepository,
    private readonly outbox: Outbox,
    private readonly transport: LegacyProgressTransport,
    options: LegacyProgressSyncOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.readLegacyMeta = options.readLegacyMeta
      ?? (() => window.localStorage.getItem('cv_meta'));
    this.isOnline = options.isOnline ?? (() => navigator.onLine);
    this.publish = options.publish ?? (() => {});
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
  }

  async start(): Promise<void> {
    const foreign = (await this.outbox.list()).some(
      (item) => item.ownerUid !== this.ownerUid,
    );
    if (foreign) {
      this.replica = freshReplica(this.ownerUid, this.now());
      await this.setState('identity-mismatch', 'Existe una cola ligada a otra identidad.');
      return;
    }

    this.replica = (await this.repository.read<ProfileReplicaV1>(
      this.replicaKey(),
      isProfileReplicaV1,
    )) ?? freshReplica(this.ownerUid, this.now());
    if (this.replica.ownerUid !== this.ownerUid) {
      await this.setState('identity-mismatch', 'El perfil local pertenece a otra identidad.');
      return;
    }
    this.publish(publicState(this.replica));
    await this.captureLegacyMeta();
    await this.drain();
  }

  snapshot(): ProfileSyncPublicState {
    return publicState(this.requireReplica());
  }

  async captureLegacyMeta(): Promise<void> {
    if (this.captureFlight !== null) return this.captureFlight;
    const attempt = this.captureLegacyMetaInternal();
    this.captureFlight = attempt;
    try {
      await attempt;
    } finally {
      if (this.captureFlight === attempt) this.captureFlight = null;
    }
  }

  private async captureLegacyMetaInternal(): Promise<void> {
    const replica = this.requireReplica();
    if (
      replica.status === 'synced'
      || replica.status === 'awaiting-confirmation'
      || replica.status === 'identity-mismatch'
      || replica.idempotencyKey !== null
    ) return;

    const raw = this.readLegacyMeta();
    if (raw === null) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch (error) {
      await this.setState('invalid-local', readableError(error));
      return;
    }

    const observedHash = await sha256(raw);
    if (
      replica.lastObservedLegacyHash === observedHash
      && (replica.status === 'queued' || replica.status === 'syncing')
    ) return;
    const idempotencyKey = `legacy_${(await sha256(
      `${this.ownerUid}\0${String(replica.serverRevision)}\0${raw}`,
    )).slice(0, 56)}`;
    const candidate = legacyProgressImportV1Schema.safeParse({
      protocolVersion: 1,
      idempotencyKey,
      baseRevision: replica.serverRevision,
      legacySchemaVersion: 10,
      payload,
    });
    if (!candidate.success) {
      await this.setState('invalid-local', 'cv_meta no cumple el contrato legacy v10.');
      return;
    }

    await this.outbox.enqueue({
      id: `preview:${idempotencyKey}`,
      ownerUid: this.ownerUid,
      kind: LEGACY_PREVIEW_OUTBOX_KIND,
      createdAt: this.now(),
      payload: candidate.data,
    });
    replica.idempotencyKey = idempotencyKey;
    replica.lastObservedLegacyHash = observedHash;
    replica.status = this.isOnline() ? 'queued' : 'offline';
    replica.lastError = null;
    await this.saveReplica();
  }

  async confirm(): Promise<void> {
    const replica = this.requireReplica();
    if (replica.preview === null || replica.idempotencyKey === null) {
      throw new Error('No existe una previsualización legacy pendiente.');
    }
    if (replica.status !== 'awaiting-confirmation' && replica.status !== 'queued') {
      throw new Error('La importación legacy no está lista para confirmar.');
    }
    const commit = legacyProgressCommitV1Schema.parse({
      protocolVersion: 1,
      idempotencyKey: replica.idempotencyKey,
      operationId: replica.preview.operationId,
      policyVersion: LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
      planHash: replica.preview.planHash,
      baseRevision: replica.preview.baseRevision,
      confirmation: true,
    });
    await this.outbox.enqueue({
      id: `commit:${replica.idempotencyKey}`,
      ownerUid: this.ownerUid,
      kind: LEGACY_COMMIT_OUTBOX_KIND,
      createdAt: this.now(),
      payload: commit,
    });
    await this.outbox.acknowledge(`preview:${replica.idempotencyKey}`, this.ownerUid);
    await this.setState(this.isOnline() ? 'queued' : 'offline', null);
    await this.drain();
  }

  async notifyOnline(): Promise<void> {
    if (!this.isOnline()) {
      await this.setState('offline', null);
      return;
    }
    await this.outbox.unblockAuth(this.ownerUid, this.now());
    await this.drain();
  }

  async drain(): Promise<void> {
    if (this.drainFlight !== null) return this.drainFlight;
    const attempt = this.drainInternal();
    this.drainFlight = attempt;
    try {
      await attempt;
    } finally {
      if (this.drainFlight === attempt) this.drainFlight = null;
    }
  }

  private async drainInternal(): Promise<void> {
    const replica = this.requireReplica();
    if (replica.status === 'identity-mismatch' || replica.status === 'synced') return;
    if (!this.isOnline()) {
      await this.setState('offline', null);
      return;
    }

    await this.outbox.releaseExpiredLeases(this.now());
    while (true) {
      const item = await this.outbox.leaseNext(this.ownerUid, this.now());
      if (item === null) break;
      await this.setState('syncing', null);
      const shouldContinue = await this.process(item);
      if (!shouldContinue) break;
    }
    await this.armRetry();
  }

  private async process(item: OutboxItem): Promise<boolean> {
    try {
      if (item.kind === LEGACY_PREVIEW_OUTBOX_KIND) {
        const request = legacyProgressImportV1Schema.parse(item.payload);
        const preview = await this.transport.preview(request);
        const replica = this.requireReplica();
        replica.preview = preview;
        replica.serverRevision = preview.currentRevision;
        replica.status = 'awaiting-confirmation';
        replica.lastError = null;
        await this.saveReplica();
        await this.outbox.markAwaitingConfirmation(item.id, this.ownerUid, this.now());
        return true;
      }
      if (item.kind === LEGACY_COMMIT_OUTBOX_KIND) {
        const request = legacyProgressCommitV1Schema.parse(item.payload);
        const result = await this.transport.commit(request);
        const replica = this.requireReplica();
        replica.serverRevision = result.toRevision;
        replica.lastCommittedPayloadFingerprint = result.payloadFingerprint;
        replica.preview = null;
        replica.status = 'synced';
        replica.lastError = null;
        await this.saveReplica();
        await this.outbox.acknowledge(item.id, this.ownerUid);
        return true;
      }
      throw Object.assign(new Error('Kind de outbox no soportado.'), {
        code: 'invalid-argument',
      });
    } catch (error) {
      const updated = await this.outbox.retry(item.id, this.ownerUid, error, this.now());
      const code = errorCode(error);
      const status: ProfileSyncStatus = updated.status === 'blocked-conflict'
        ? 'conflict'
        : updated.status === 'failed-permanent'
          ? (code === 'invalid-argument' ? 'invalid-local' : 'error')
          : updated.status === 'blocked-auth'
            ? 'error'
            : 'offline';
      await this.setState(status, readableError(error));
      return false;
    }
  }

  private async armRetry(): Promise<void> {
    if (this.retryTimer !== null) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    const retryAt = (await this.outbox.list(this.ownerUid))
      .filter((item) => item.status === 'queued' || item.status === 'retry-wait')
      .reduce<number | null>((soonest, item) => (
        soonest === null ? item.nextAttemptAt : Math.min(soonest, item.nextAttemptAt)
      ), null);
    if (retryAt === null) return;
    const delay = Math.max(0, retryAt - this.now());
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.drain();
    }, delay);
  }

  private async setState(status: ProfileSyncStatus, error: string | null): Promise<void> {
    const replica = this.requireReplica();
    replica.status = status;
    replica.lastError = error?.slice(0, 300) ?? null;
    await this.saveReplica();
  }

  private async saveReplica(): Promise<void> {
    const replica = this.requireReplica();
    replica.updatedAt = this.now();
    await this.repository.write(this.replicaKey(), replica);
    this.publish(publicState(replica));
  }

  private replicaKey(): string {
    return `profile-v1:${this.ownerUid}`;
  }

  private requireReplica(): ProfileReplicaV1 {
    if (this.replica === null) {
      throw new Error('El coordinador de perfil no se ha iniciado.');
    }
    return this.replica;
  }
}
