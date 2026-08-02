import type {
  UserBestRecordsDocumentV1,
  UserBestRecordsWriteV1,
  UserProfileDocumentV1,
  UserProfileWriteV1,
} from '@convergence/contracts';
import {
  userBestRecordsDocumentV1Schema,
  userBestRecordsWriteV1Schema,
  userProfileDocumentV1Schema,
  userProfileWriteV1Schema,
} from '@convergence/contracts';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { canonicalJson, sha256 } from './legacy-progress.js';

/**
 * Un recibo por operación mantiene la escritura idempotente: si el cliente
 * reintenta tras un corte de red, se devuelve el documento ya aplicado en vez
 * de aplicar el cambio dos veces. Caducan porque solo protegen del reintento.
 */
export const USER_PROFILE_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;

export type UserProfileLane = 'profile' | 'records';

/**
 * Los documentos cuelgan de `users/{uid}` a propósito: ese subárbol ya tiene
 * reglas verificadas que conceden lectura solo al propietario y niegan toda
 * escritura desde el SDK cliente. Las mutaciones entran por estas callables con
 * Admin SDK, que no pasa por reglas. Colecciones nuevas de primer nivel habrían
 * exigido reglas nuevas sin cobertura.
 */
const LANE_COLLECTION: Record<UserProfileLane, string> = {
  profile: 'cloudProfile',
  records: 'cloudRecords',
};

const RECEIPTS_COLLECTION = 'cloudReceipts';
const LANE_DOCUMENT = 'current';

export interface PreparedProfileWrite<TBody> {
  uid: string;
  lane: UserProfileLane;
  operationId: string;
  ownerHash: string;
  baseRevision: number;
  body: TBody;
  bodyFingerprint: string;
  now: number;
}

export interface UserProfileStore {
  putProfile(input: PreparedProfileWrite<UserProfileWriteV1['profile']>):
  Promise<UserProfileDocumentV1>;
  putRecords(input: PreparedProfileWrite<UserBestRecordsWriteV1['records']>):
  Promise<UserBestRecordsDocumentV1>;
  getProfile(uid: string): Promise<UserProfileDocumentV1 | null>;
  getRecords(uid: string): Promise<UserBestRecordsDocumentV1 | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidArgument(message: string, issues: unknown): HttpsError {
  return new HttpsError('invalid-argument', message, { issues });
}

function assertNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpsError('internal', 'El reloj del servicio es inválido.');
  }
  return value;
}

/** La operación se deriva del UID autenticado: el cliente no elige su espacio. */
export function deriveProfileOperationId(
  uid: string,
  lane: UserProfileLane,
  idempotencyKey: string,
): string {
  return sha256(`${uid}\0${lane}\0${idempotencyKey}`);
}

function parseWrite<TSchema extends {
  safeParse(input: unknown): { success: boolean; data?: unknown; error?: unknown };
}>(schema: TSchema, label: string, input: unknown): unknown {
  const result = schema.safeParse(input) as {
    success: boolean;
    data?: unknown;
    error?: { issues: { path: unknown[]; message: string }[] };
  };
  if (!result.success) {
    throw invalidArgument(`${label} inválido.`, (result.error?.issues ?? [])
      .slice(0, 20)
      .map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })));
  }
  return result.data;
}

function assertRevision(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new HttpsError('internal', 'El documento contiene una revisión inválida.');
  }
  return Number(value);
}

function conflictForRevision(expected: number, received: number): HttpsError {
  return new HttpsError(
    'aborted',
    'La revisión cambió; vuelve a leer el documento antes de escribir.',
    { expectedRevision: expected, receivedRevision: received },
  );
}

function assertOwner(data: Record<string, unknown>, expectedOwnerHash: string): void {
  if (data.ownerHash !== expectedOwnerHash) {
    throw new HttpsError('internal', 'Colisión de identidad en el perfil.');
  }
}

class FirestoreUserProfileStore implements UserProfileStore {
  async putProfile(
    input: PreparedProfileWrite<UserProfileWriteV1['profile']>,
  ): Promise<UserProfileDocumentV1> {
    return this.put(input, (revision, body) => userProfileDocumentV1Schema.parse({
      revision,
      profile: body,
    }));
  }

  async putRecords(
    input: PreparedProfileWrite<UserBestRecordsWriteV1['records']>,
  ): Promise<UserBestRecordsDocumentV1> {
    return this.put(input, (revision, body) => userBestRecordsDocumentV1Schema.parse({
      revision,
      records: body,
    }));
  }

  async getProfile(uid: string): Promise<UserProfileDocumentV1 | null> {
    return this.get(uid, 'profile', (revision, body) => userProfileDocumentV1Schema.parse({
      revision,
      profile: body,
    }));
  }

  async getRecords(uid: string): Promise<UserBestRecordsDocumentV1 | null> {
    return this.get(uid, 'records', (revision, body) => userBestRecordsDocumentV1Schema.parse({
      revision,
      records: body,
    }));
  }

  private async get<TDocument>(
    uid: string,
    lane: UserProfileLane,
    build: (revision: number, body: unknown) => TDocument,
  ): Promise<TDocument | null> {
    const snapshot = await getFirestore()
      .collection('users').doc(uid)
      .collection(LANE_COLLECTION[lane]).doc(LANE_DOCUMENT)
      .get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (!isRecord(data)) {
      throw new HttpsError('internal', 'El documento existe sin datos.');
    }
    assertOwner(data, sha256(uid));
    return build(assertRevision(data.revision), data.body);
  }

  private async put<TBody, TDocument>(
    input: PreparedProfileWrite<TBody>,
    build: (revision: number, body: TBody) => TDocument,
  ): Promise<TDocument> {
    const firestore = getFirestore();
    const userRef = firestore.collection('users').doc(input.uid);
    const documentRef = userRef
      .collection(LANE_COLLECTION[input.lane])
      .doc(LANE_DOCUMENT);
    // El operationId ya incluye el carril, así que un solo subárbol de recibos
    // no puede mezclar perfil y marcas.
    const receiptRef = userRef.collection(RECEIPTS_COLLECTION).doc(input.operationId);

    return firestore.runTransaction(async (transaction) => {
      const [documentSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(documentRef),
        transaction.get(receiptRef),
      ]);

      if (receiptSnapshot.exists) {
        const receipt = receiptSnapshot.data();
        if (!isRecord(receipt)) {
          throw new HttpsError('internal', 'El recibo existe sin datos.');
        }
        assertOwner(receipt, input.ownerHash);
        // Misma clave con otro contenido no es un reintento: es otra operación.
        if (receipt.bodyFingerprint !== input.bodyFingerprint) {
          throw new HttpsError(
            'already-exists',
            'La idempotency key ya se usó con otro contenido.',
          );
        }
        return build(assertRevision(receipt.toRevision), input.body);
      }

      const current = documentSnapshot.exists ? documentSnapshot.data() : undefined;
      const currentRevision = isRecord(current) ? assertRevision(current.revision) : 0;
      if (currentRevision !== input.baseRevision) {
        throw conflictForRevision(currentRevision, input.baseRevision);
      }
      if (isRecord(current)) assertOwner(current, input.ownerHash);

      const toRevision = currentRevision + 1;
      transaction.set(documentRef, {
        schemaVersion: 1,
        ownerHash: input.ownerHash,
        revision: toRevision,
        body: input.body,
        bodyFingerprint: input.bodyFingerprint,
        updatedAtMillis: input.now,
      }, { merge: true });
      transaction.create(receiptRef, {
        schemaVersion: 1,
        lane: input.lane,
        operationId: input.operationId,
        ownerHash: input.ownerHash,
        bodyFingerprint: input.bodyFingerprint,
        fromRevision: currentRevision,
        toRevision,
        createdAtMillis: input.now,
        deleteAtMillis: input.now + USER_PROFILE_RECEIPT_TTL_MS,
      });

      return build(toRevision, input.body);
    });
  }
}

export function createUserProfileService(
  store: UserProfileStore = new FirestoreUserProfileStore(),
  now: () => number = Date.now,
) {
  function prepare<TBody extends { uid?: string }>(
    uid: string,
    lane: UserProfileLane,
    write: { idempotencyKey: string; baseRevision: number },
    body: TBody,
  ): PreparedProfileWrite<TBody> {
    // La identidad siempre sale de Auth. Un cuerpo que dice ser de otro UID es
    // un intento de escribir en el espacio ajeno, no un error de formato.
    if (body.uid !== undefined && body.uid !== uid) {
      throw new HttpsError(
        'permission-denied',
        'El documento no pertenece al usuario autenticado.',
      );
    }
    return {
      uid,
      lane,
      operationId: deriveProfileOperationId(uid, lane, write.idempotencyKey),
      ownerHash: sha256(uid),
      baseRevision: write.baseRevision,
      body,
      bodyFingerprint: sha256(canonicalJson(body)),
      now: assertNow(now()),
    };
  }

  return {
    async putProfile(uid: string, data: unknown): Promise<UserProfileDocumentV1> {
      const write = parseWrite(
        userProfileWriteV1Schema,
        'UserProfileWriteV1',
        data,
      ) as UserProfileWriteV1;
      return store.putProfile(prepare(uid, 'profile', write, write.profile));
    },

    async putRecords(uid: string, data: unknown): Promise<UserBestRecordsDocumentV1> {
      const write = parseWrite(
        userBestRecordsWriteV1Schema,
        'UserBestRecordsWriteV1',
        data,
      ) as UserBestRecordsWriteV1;
      return store.putRecords(prepare(uid, 'records', write, write.records));
    },

    // Las lecturas también pasan por Functions para que el cliente no necesite
    // el SDK de Firestore ni una regla de lectura propia por colección.
    async getProfile(uid: string): Promise<UserProfileDocumentV1 | null> {
      return store.getProfile(uid);
    },

    async getRecords(uid: string): Promise<UserBestRecordsDocumentV1 | null> {
      return store.getRecords(uid);
    },
  };
}

export const userProfileService = createUserProfileService();
