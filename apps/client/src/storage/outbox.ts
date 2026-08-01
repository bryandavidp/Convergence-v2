import type { JsonRepository } from './json-repository.js';

export const OUTBOX_STORAGE_VERSION = 2 as const;
export const DEFAULT_OUTBOX_LEASE_MS = 30_000;
export const DEFAULT_OUTBOX_BASE_DELAY_MS = 1_000;
export const DEFAULT_OUTBOX_MAX_DELAY_MS = 300_000;
export const MAX_OUTBOX_ITEMS = 32;
export const MAX_OUTBOX_PAYLOAD_BYTES = 300 * 1024;
export const MAX_OUTBOX_DOCUMENT_BYTES = 1024 * 1024;

export type OutboxStatus =
  | 'queued'
  | 'sending'
  | 'retry-wait'
  | 'blocked-auth'
  | 'awaiting-confirmation'
  | 'blocked-conflict'
  | 'failed-permanent';

export interface OutboxErrorState {
  code: string;
  message: string;
  retryable: boolean;
  at: number;
}

export interface OutboxItem<TPayload = unknown> {
  storageVersion: typeof OUTBOX_STORAGE_VERSION;
  id: string;
  ownerUid: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  status: OutboxStatus;
  nextAttemptAt: number;
  leaseUntil: number | null;
  lastError: OutboxErrorState | null;
  payload: TPayload;
}

export interface NewOutboxItem<TPayload = unknown> {
  id: string;
  ownerUid: string;
  kind: string;
  createdAt: number;
  payload: TPayload;
}

export interface OutboxDocument {
  storageVersion: typeof OUTBOX_STORAGE_VERSION;
  items: OutboxItem[];
}

export type OutboxErrorCategory = 'retry' | 'auth' | 'conflict' | 'permanent';

export interface OutboxErrorClassification {
  category: OutboxErrorCategory;
  code: string;
  message: string;
  retryAfterMs: number | null;
}

export interface OutboxOptions {
  now?: () => number;
  random?: () => number;
  leaseMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class OutboxIdentityConflictError extends Error {
  constructor(id: string) {
    super(`La idempotency key ${id} ya existe con otro owner, kind o payload.`);
    this.name = 'OutboxIdentityConflictError';
  }
}

export class OutboxOwnershipError extends Error {
  constructor(id: string, ownerUid: string) {
    super(`La operacion ${id} no pertenece al usuario ${ownerUid}.`);
    this.name = 'OutboxOwnershipError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === 'string' && expected.includes(key));
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 12
    && value.length <= 128;
}

function isValidOwner(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= 128;
}

function isValidKind(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(value);
}

function isOutboxStatus(value: unknown): value is OutboxStatus {
  return value === 'queued'
    || value === 'sending'
    || value === 'retry-wait'
    || value === 'blocked-auth'
    || value === 'awaiting-confirmation'
    || value === 'blocked-conflict'
    || value === 'failed-permanent';
}

const forbiddenJsonKeys = new Set(['__proto__', 'prototype', 'constructor']);

function inspectJsonValue(value: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const visited = new WeakSet<object>();
  let nodes = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) return false;
    const current = entry.value;
    nodes += 1;
    if (nodes > 20_000 || entry.depth > 64) return false;
    if (
      current === null
      || typeof current === 'string'
      || typeof current === 'boolean'
    ) continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current !== 'object' || visited.has(current)) return false;
    visited.add(current);

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) return false;
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => (
        key !== 'length'
        && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key))
      ))) return false;
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.hasOwn(current, index)) return false;
        pending.push({ value: current[index], depth: entry.depth + 1 });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== 'string' || forbiddenJsonKeys.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        descriptor === undefined
        || !('value' in descriptor)
        || !descriptor.enumerable
      ) return false;
      pending.push({ value: descriptor.value, depth: entry.depth + 1 });
    }
  }
  return true;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function payloadFingerprint(value: unknown): string {
  const visit = (current: unknown): string => {
    if (current === null) return 'null';
    if (typeof current === 'string' || typeof current === 'boolean') {
      return JSON.stringify(current);
    }
    if (typeof current === 'number') return JSON.stringify(current);
    if (Array.isArray(current)) return `[${current.map(visit).join(',')}]`;
    const record = current as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${visit(record[key])}`
    )).join(',')}}`;
  };
  return visit(value);
}

function assertPayload(payload: unknown): void {
  if (!inspectJsonValue(payload)) {
    throw new Error('El payload del outbox debe ser JSON finito, aciclico y seguro.');
  }
  const bytes = utf8ByteLength(JSON.stringify(payload));
  if (bytes > MAX_OUTBOX_PAYLOAD_BYTES) {
    throw new Error(`El payload del outbox supera ${MAX_OUTBOX_PAYLOAD_BYTES} bytes.`);
  }
}

function clonePayload<TPayload>(payload: TPayload): TPayload {
  return JSON.parse(JSON.stringify(payload)) as TPayload;
}

function isErrorState(value: unknown): value is OutboxErrorState {
  return isRecord(value)
    && hasExactKeys(value, ['code', 'message', 'retryable', 'at'])
    && typeof value.code === 'string'
    && value.code.length > 0
    && value.code.length <= 128
    && typeof value.message === 'string'
    && value.message.length <= 500
    && typeof value.retryable === 'boolean'
    && isSafeInteger(value.at);
}

function isOutboxItem(value: unknown): value is OutboxItem {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      'storageVersion',
      'id',
      'ownerUid',
      'kind',
      'createdAt',
      'updatedAt',
      'attempts',
      'status',
      'nextAttemptAt',
      'leaseUntil',
      'lastError',
      'payload',
    ])
    ||
    value.storageVersion !== OUTBOX_STORAGE_VERSION
    || !isValidId(value.id)
    || !isValidOwner(value.ownerUid)
    || !isValidKind(value.kind)
    || !isSafeInteger(value.createdAt)
    || !isSafeInteger(value.updatedAt)
    || Number(value.updatedAt) < Number(value.createdAt)
    || !isSafeInteger(value.attempts)
    || !isOutboxStatus(value.status)
    || !isSafeInteger(value.nextAttemptAt)
    || !(value.leaseUntil === null || isSafeInteger(value.leaseUntil))
    || !(value.lastError === null || isErrorState(value.lastError))
    || !inspectJsonValue(value.payload)
    || utf8ByteLength(JSON.stringify(value.payload)) > MAX_OUTBOX_PAYLOAD_BYTES
  ) return false;
  if (value.status === 'sending') return value.leaseUntil !== null;
  return value.leaseUntil === null;
}

export function isOutboxDocument(value: unknown): value is OutboxDocument {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['storageVersion', 'items'])
    || value.storageVersion !== OUTBOX_STORAGE_VERSION
    || !Array.isArray(value.items)
    || value.items.length > MAX_OUTBOX_ITEMS
  ) return false;
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!isOutboxItem(item) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return utf8ByteLength(JSON.stringify(value)) <= MAX_OUTBOX_DOCUMENT_BYTES;
}

function normalizedErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string') {
    return error.code.toLowerCase().replace(/^functions\//, '');
  }
  if (isRecord(error) && typeof error.name === 'string') {
    return error.name.toLowerCase();
  }
  return 'unknown';
}

function readableError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : isRecord(error) && typeof error.message === 'string'
      ? error.message
      : String(error);
  return message.slice(0, 500);
}

function numericProperty(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function errorHttpStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  return numericProperty(error, 'httpStatus') ?? numericProperty(error, 'status');
}

function errorRetryAfter(error: unknown): number | null {
  if (!isRecord(error)) return null;
  return numericProperty(error, 'retryAfterMs');
}

export function classifyOutboxError(error: unknown): OutboxErrorClassification {
  const code = normalizedErrorCode(error);
  const httpStatus = errorHttpStatus(error);
  const retryAfterMs = errorRetryAfter(error);
  const message = readableError(error);

  if (
    httpStatus === 401
    || code === 'unauthenticated'
    || code === 'auth/user-token-expired'
    || code === 'auth/id-token-expired'
    || code === 'auth/invalid-user-token'
  ) {
    return { category: 'auth', code, message, retryAfterMs };
  }
  if (
    httpStatus === 409
    || code === 'aborted'
    || code === 'conflict'
    || code === 'failed-precondition'
  ) {
    return { category: 'conflict', code, message, retryAfterMs };
  }
  if (
    error instanceof TypeError
    || code === 'aborterror'
    || code === 'cancelled'
    || code === 'deadline-exceeded'
    || code === 'internal'
    || code === 'network-request-failed'
    || code === 'resource-exhausted'
    || code === 'timeout'
    || code === 'unavailable'
    || (code === 'unknown' && httpStatus === null)
    || httpStatus === 408
    || httpStatus === 425
    || httpStatus === 429
    || (httpStatus !== null && httpStatus >= 500 && httpStatus <= 599)
  ) {
    return { category: 'retry', code, message, retryAfterMs };
  }
  return { category: 'permanent', code, message, retryAfterMs };
}

export function calculateOutboxBackoff(
  attempts: number,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    random?: () => number;
    retryAfterMs?: number | null;
  } = {},
): number {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_OUTBOX_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_OUTBOX_MAX_DELAY_MS;
  const random = options.random ?? Math.random;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error('Los intentos del backoff deben empezar en 1.');
  }
  if (baseDelayMs < 1 || maxDelayMs < baseDelayMs) {
    throw new Error('La configuracion de backoff no es valida.');
  }
  const randomValue = random();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
    throw new Error('La fuente de jitter debe devolver un numero entre 0 y 1.');
  }
  const exponent = Math.min(attempts - 1, 30);
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
  const jittered = Math.max(1, Math.floor(exponential * (0.5 + randomValue * 0.5)));
  return Math.max(jittered, options.retryAfterMs ?? 0);
}

function emptyDocument(): OutboxDocument {
  return { storageVersion: OUTBOX_STORAGE_VERSION, items: [] };
}

export class Outbox {
  private static readonly KEY = 'outbox-v2';
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly leaseMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(
    private readonly repository: JsonRepository,
    options: OutboxOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.leaseMs = options.leaseMs ?? DEFAULT_OUTBOX_LEASE_MS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_OUTBOX_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_OUTBOX_MAX_DELAY_MS;
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1) {
      throw new Error('El lease del outbox no es valido.');
    }
  }

  async list(ownerUid?: string): Promise<OutboxItem[]> {
    if (ownerUid !== undefined && !isValidOwner(ownerUid)) {
      throw new Error('El ownerUid del outbox no es valido.');
    }
    const document = await this.readDocument();
    return ownerUid === undefined
      ? document.items
      : document.items.filter((item) => item.ownerUid === ownerUid);
  }

  async enqueue<TPayload>(
    item: NewOutboxItem<TPayload>,
  ): Promise<'inserted' | 'duplicate'> {
    this.assertNewItem(item);
    // Captura el comando en el momento de encolarlo: una mutacion posterior del
    // objeto del llamador nunca puede cambiar lo que representa la misma key.
    const payload = clonePayload(item.payload);
    let result: 'inserted' | 'duplicate' = 'inserted';
    await this.updateDocument((document) => {
      const existing = document.items.find((candidate) => candidate.id === item.id);
      if (existing !== undefined) {
        const sameIdentity = existing.ownerUid === item.ownerUid
          && existing.kind === item.kind
          && payloadFingerprint(existing.payload) === payloadFingerprint(payload);
        if (!sameIdentity) throw new OutboxIdentityConflictError(item.id);
        result = 'duplicate';
        return document;
      }
      if (document.items.length >= MAX_OUTBOX_ITEMS) {
        throw new Error(`El outbox no puede superar ${MAX_OUTBOX_ITEMS} operaciones.`);
      }
      const now = Math.max(item.createdAt, Math.trunc(this.now()));
      document.items.push({
        storageVersion: OUTBOX_STORAGE_VERSION,
        id: item.id,
        ownerUid: item.ownerUid,
        kind: item.kind,
        createdAt: item.createdAt,
        updatedAt: now,
        attempts: 0,
        status: 'queued',
        nextAttemptAt: item.createdAt,
        leaseUntil: null,
        lastError: null,
        payload,
      });
      return document;
    });
    return result;
  }

  async leaseNext(
    ownerUid: string,
    now = Math.trunc(this.now()),
  ): Promise<OutboxItem | null> {
    this.assertOwner(ownerUid);
    let leased: OutboxItem | null = null;
    await this.updateDocument((document) => {
      const eligible = document.items
        .filter((item) => item.ownerUid === ownerUid && (
          ((item.status === 'queued' || item.status === 'retry-wait')
            && item.nextAttemptAt <= now)
          || (item.status === 'sending'
            && item.leaseUntil !== null
            && item.leaseUntil <= now)
        ))
        .sort((left, right) => left.createdAt - right.createdAt
          || left.id.localeCompare(right.id))[0];
      if (eligible === undefined) return document;
      eligible.status = 'sending';
      eligible.attempts += 1;
      eligible.updatedAt = now;
      eligible.leaseUntil = now + this.leaseMs;
      leased = structuredClone(eligible);
      return document;
    });
    return leased;
  }

  async retry(
    id: string,
    ownerUid: string,
    error: unknown,
    now = Math.trunc(this.now()),
  ): Promise<OutboxItem> {
    const classification = classifyOutboxError(error);
    return this.mutateOwned(id, ownerUid, (item) => {
      if (item.status !== 'sending') {
        throw new Error(`La operacion ${id} no tiene un lease activo.`);
      }
      item.updatedAt = now;
      item.leaseUntil = null;
      item.lastError = {
        code: classification.code.slice(0, 128),
        message: classification.message,
        retryable: classification.category === 'retry' || classification.category === 'auth',
        at: now,
      };

      if (classification.category === 'retry') {
        item.status = 'retry-wait';
        item.nextAttemptAt = now + calculateOutboxBackoff(item.attempts, {
          baseDelayMs: this.baseDelayMs,
          maxDelayMs: this.maxDelayMs,
          random: this.random,
          retryAfterMs: classification.retryAfterMs,
        });
      } else if (classification.category === 'auth') {
        item.status = 'blocked-auth';
        item.nextAttemptAt = now;
      } else if (classification.category === 'conflict') {
        item.status = 'blocked-conflict';
        item.nextAttemptAt = now;
      } else {
        item.status = 'failed-permanent';
        item.nextAttemptAt = now;
      }
    });
  }

  async markAwaitingConfirmation(
    id: string,
    ownerUid: string,
    now = Math.trunc(this.now()),
  ): Promise<OutboxItem> {
    return this.mutateOwned(id, ownerUid, (item) => {
      if (item.status !== 'sending') {
        throw new Error(`La operacion ${id} no tiene un lease activo.`);
      }
      item.status = 'awaiting-confirmation';
      item.updatedAt = now;
      item.nextAttemptAt = now;
      item.leaseUntil = null;
      item.lastError = null;
    });
  }

  async requeue(
    id: string,
    ownerUid: string,
    now = Math.trunc(this.now()),
  ): Promise<OutboxItem> {
    return this.mutateOwned(id, ownerUid, (item) => {
      if (item.status === 'sending') {
        throw new Error(`La operacion ${id} conserva un lease activo.`);
      }
      item.status = 'queued';
      item.updatedAt = now;
      item.nextAttemptAt = now;
      item.leaseUntil = null;
      item.lastError = null;
    });
  }

  async unblockAuth(
    ownerUid: string,
    now = Math.trunc(this.now()),
  ): Promise<number> {
    this.assertOwner(ownerUid);
    let count = 0;
    await this.updateDocument((document) => {
      for (const item of document.items) {
        if (item.ownerUid !== ownerUid || item.status !== 'blocked-auth') continue;
        item.status = 'queued';
        item.updatedAt = now;
        item.nextAttemptAt = now;
        item.leaseUntil = null;
        count += 1;
      }
      return document;
    });
    return count;
  }

  async releaseExpiredLeases(now = Math.trunc(this.now())): Promise<number> {
    let count = 0;
    await this.updateDocument((document) => {
      for (const item of document.items) {
        if (
          item.status !== 'sending'
          || item.leaseUntil === null
          || item.leaseUntil > now
        ) continue;
        item.status = 'queued';
        item.updatedAt = now;
        item.nextAttemptAt = now;
        item.leaseUntil = null;
        count += 1;
      }
      return document;
    });
    return count;
  }

  async acknowledge(id: string, ownerUid: string): Promise<boolean> {
    this.assertOwner(ownerUid);
    let acknowledged = false;
    await this.updateDocument((document) => {
      const index = document.items.findIndex((item) => item.id === id);
      if (index === -1) return document;
      const item = document.items[index];
      if (item === undefined) return document;
      if (item.ownerUid !== ownerUid) throw new OutboxOwnershipError(id, ownerUid);
      if (item.status !== 'sending' && item.status !== 'awaiting-confirmation') {
        throw new Error(
          `La operacion ${id} no esta enviandose ni espera confirmacion.`,
        );
      }
      document.items.splice(index, 1);
      acknowledged = true;
      return document;
    });
    return acknowledged;
  }

  private async mutateOwned(
    id: string,
    ownerUid: string,
    mutate: (item: OutboxItem) => void,
  ): Promise<OutboxItem> {
    this.assertOwner(ownerUid);
    let result: OutboxItem | null = null;
    await this.updateDocument((document) => {
      const item = document.items.find((candidate) => candidate.id === id);
      if (item === undefined) throw new Error(`No existe la operacion ${id}.`);
      if (item.ownerUid !== ownerUid) throw new OutboxOwnershipError(id, ownerUid);
      mutate(item);
      result = structuredClone(item);
      return document;
    });
    if (result === null) throw new Error(`No existe la operacion ${id}.`);
    return result;
  }

  private async readDocument(): Promise<OutboxDocument> {
    return (await this.repository.read<OutboxDocument>(
      Outbox.KEY,
      isOutboxDocument,
    )) ?? emptyDocument();
  }

  private async updateDocument(
    mutate: (document: OutboxDocument) => OutboxDocument,
  ): Promise<void> {
    await this.repository.update<OutboxDocument>(
      Outbox.KEY,
      (current) => mutate(current ?? emptyDocument()),
      isOutboxDocument,
    );
  }

  private assertNewItem(item: NewOutboxItem): void {
    if (!isValidId(item.id)) throw new Error('La idempotency key del outbox no es valida.');
    this.assertOwner(item.ownerUid);
    if (!isValidKind(item.kind)) throw new Error('El kind del outbox no es valido.');
    if (!isSafeInteger(item.createdAt)) throw new Error('createdAt del outbox no es valido.');
    assertPayload(item.payload);
  }

  private assertOwner(ownerUid: string): void {
    if (!isValidOwner(ownerUid)) throw new Error('El ownerUid del outbox no es valido.');
  }
}
