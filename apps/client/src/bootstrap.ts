/**
 * Punto de entrada futuro del runtime modular.
 *
 * No se carga todavía desde web/index.html: la fase inicial exige que el
 * snapshot 2.37.1 conserve paridad byte a byte y pase su suite completa.
 */
export const migrationBootstrapStatus = Object.freeze({
  legacyRuntimeConnected: false,
  firebaseConnected: false,
  nativePlatformsGenerated: false,
});
