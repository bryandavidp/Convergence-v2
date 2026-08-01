import type { FirebaseOptions } from 'firebase/app';

export const FIREBASE_CLOUD_DEV_PROJECT_ID = 'convergence-d1a35';
export const FIREBASE_CLOUD_DEV_PROJECT_NUMBER = '98627547554';
export const FIREBASE_CLOUD_DEV_WEB_APP_ID =
  '1:98627547554:web:8d293cfb4a8a99b6cd82fb';
export const FIREBASE_CLOUD_DEV_AUTH_DOMAIN =
  'convergence-d1a35.firebaseapp.com';
export const FIREBASE_CLOUD_DEV_DATABASE_URL =
  'https://convergence-d1a35-default-rtdb.europe-west1.firebasedatabase.app';
export const FIREBASE_CLOUD_DEV_STORAGE_BUCKET =
  'convergence-d1a35.firebasestorage.app';

const ACCEPTED_FIELDS = new Set([
  'apiKey',
  'appId',
  'authDomain',
  'databaseURL',
  'measurementId',
  'messagingSenderId',
  'projectId',
  'projectNumber',
  'storageBucket',
  'version',
]);

export type FirebaseCloudDevOptions = Readonly<
  Required<Pick<
    FirebaseOptions,
    | 'apiKey'
    | 'appId'
    | 'authDomain'
    | 'databaseURL'
    | 'messagingSenderId'
    | 'projectId'
  >>
  & Pick<FirebaseOptions, 'storageBucket'>
>;

function assertPlainDataObject(input: unknown): asserts input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('La configuración Firebase cloud dev debe ser un objeto JSON.');
  }

  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('La configuración Firebase cloud dev debe ser un objeto JSON simple.');
  }

  if (Object.getOwnPropertySymbols(input).length !== 0) {
    throw new Error('La configuración Firebase cloud dev no admite campos Symbol.');
  }

  for (const [field, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(input),
  )) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new Error(`El campo Firebase cloud dev ${field} debe ser un dato JSON enumerable.`);
    }
    if (!ACCEPTED_FIELDS.has(field)) {
      throw new Error(`Campo Firebase cloud dev no permitido: ${field}.`);
    }
  }
}

function requiredString(
  input: Record<string, unknown>,
  field: string,
): string {
  const value = input[field];
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`El campo Firebase cloud dev ${field} debe ser un string no vacío y sin espacios externos.`);
  }
  return value;
}

function assertExact(field: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      `Destino Firebase cloud dev rechazado: ${field} no coincide con ${expected}.`,
    );
  }
}

/**
 * Reduce la configuración inyectada al subconjunto que necesita Firebase Auth.
 *
 * `measurementId`, `projectNumber` y `version` se toleran como metadatos de la
 * build, pero nunca se propagan al SDK. Cualquier otro campo o destino Firebase
 * se rechaza antes de inicializar una app o abrir una conexión de red.
 */
export function resolveFirebaseCloudDevConfig(
  input: unknown,
): FirebaseCloudDevOptions {
  assertPlainDataObject(input);

  const apiKey = requiredString(input, 'apiKey');
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(apiKey)) {
    throw new Error('El campo Firebase cloud dev apiKey no tiene el formato esperado.');
  }

  const appId = requiredString(input, 'appId');
  const authDomain = requiredString(input, 'authDomain');
  const databaseURLInput = requiredString(input, 'databaseURL');
  const databaseURL = databaseURLInput.endsWith('/')
    ? databaseURLInput.slice(0, -1)
    : databaseURLInput;
  const messagingSenderId = requiredString(input, 'messagingSenderId');
  const projectId = requiredString(input, 'projectId');

  assertExact('appId', appId, FIREBASE_CLOUD_DEV_WEB_APP_ID);
  assertExact('authDomain', authDomain, FIREBASE_CLOUD_DEV_AUTH_DOMAIN);
  assertExact('databaseURL', databaseURL, FIREBASE_CLOUD_DEV_DATABASE_URL);
  assertExact(
    'messagingSenderId',
    messagingSenderId,
    FIREBASE_CLOUD_DEV_PROJECT_NUMBER,
  );
  assertExact('projectId', projectId, FIREBASE_CLOUD_DEV_PROJECT_ID);

  if (input.projectNumber !== undefined) {
    const projectNumber = requiredString(input, 'projectNumber');
    assertExact(
      'projectNumber',
      projectNumber,
      FIREBASE_CLOUD_DEV_PROJECT_NUMBER,
    );
  }

  const storageBucketInput = input.storageBucket;
  let storageBucket: string | undefined;
  if (storageBucketInput !== undefined) {
    storageBucket = requiredString(input, 'storageBucket');
    assertExact(
      'storageBucket',
      storageBucket,
      FIREBASE_CLOUD_DEV_STORAGE_BUCKET,
    );
  }

  const selected: FirebaseCloudDevOptions = Object.freeze({
    apiKey,
    appId,
    authDomain,
    databaseURL,
    messagingSenderId,
    projectId,
    ...(storageBucket === undefined ? {} : { storageBucket }),
  });

  return selected;
}
