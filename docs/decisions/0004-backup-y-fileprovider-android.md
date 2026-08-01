# ADR 0004 — Backup local y FileProvider Android

Fecha: 2026-08-01
Estado: aceptada

## Contexto

Convergence v2 mantiene temporalmente el perfil y la partida en dos almacenes
locales: WebView `localStorage` y Capacitor Preferences. Android Backup podría
restaurarlos desde instantes diferentes y reintroducir progreso o economía
obsoletos antes de que exista una reconciliación cloud autoritativa.

El proyecto Capacitor generado también exponía todo el almacenamiento externo
mediante `FileProvider`, aunque el bridge actual solo comparte texto.

## Decisión

- Desactivar `android:allowBackup` durante la migración local.
- Permitir al `FileProvider` únicamente `cache/share/`.
- Mantener el provider como no exportado y conceder acceso solo mediante URI
  temporal cuando en el futuro se compartan adjuntos.
- Hacer fallar `npm run check:android` si vuelve a habilitarse el backup o se
  introduce un `external-path` amplio.

## Consecuencias

Desinstalar o borrar los datos de la aplicación elimina el progreso local. Esta
limitación es explícita y se retirará solo cuando Firebase Auth, sincronización,
versionado y resolución de conflictos hayan superado sus gates. Compartir texto
continúa funcionando; un futuro archivo deberá copiarse primero a `cache/share/`.
