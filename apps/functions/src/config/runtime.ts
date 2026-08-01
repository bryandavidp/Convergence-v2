import { setGlobalOptions } from 'firebase-functions/v2';

/**
 * Región provisional para desarrollo europeo. No se desplegará hasta confirmar
 * la localización definitiva de Firestore/RTDB y las necesidades de latencia.
 */
export const FUNCTION_REGION =
  process.env.FUNCTION_REGION ?? 'europe-west1';

setGlobalOptions({
  region: FUNCTION_REGION,
  maxInstances: 10,
  timeoutSeconds: 30,
  memory: '256MiB',
});
