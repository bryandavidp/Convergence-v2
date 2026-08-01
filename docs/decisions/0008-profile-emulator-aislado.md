# ADR 0008 — Profile Emulator aislado

Fecha: 2026-08-01
Estado: aceptado e implementado localmente

## Contexto

La importación inicial de progreso necesita probar en un navegador real Auth,
App Check, callables, persistencia offline y confirmación sin introducir todavía
Firebase en la PWA o en el artefacto que empaqueta Capacitor. Reutilizar `dist`,
`dist-emulator` o `dist-cloud-dev` mezclaría responsabilidades y podría abrir
endpoints cloud accidentalmente.

## Decisión

Se crea `dist-profile-emulator`, una salida generada e ignorada que se compone
directamente desde la misma allowlist estática de `web/` y añade un único bundle
ESM con hash.

- Solo admite el proyecto ficticio `demo-convergence-v2`.
- Auth se conecta a `127.0.0.1:9099` y Functions a `127.0.0.1:5001` en
  `europe-west1`.
- La CSP añade exclusivamente esos dos orígenes de loopback.
- El bundle puede usar Firebase Auth, App Check y Functions. El build rechaza
  Analytics, Firestore, Realtime Database, Messaging y Storage.
- Firestore solo se alcanza detrás de callables mediante Admin SDK; el cliente
  no importa su SDK ni posee permisos de escritura.
- App Check usa un provider sintético sin firma únicamente en Emulator Suite.
  Ese token y esta factory no son válidos para cloud.
- Auth conserva el UID mediante IndexedDB, con fallback a localStorage y memoria,
  para probar recarga/process restart. Es deliberadamente distinto del smoke
  Auth cloud efímero.
- `dist`, `dist-emulator`, `dist-cloud-dev`, Hosting y `webDir` de Capacitor no
  se leen como entrada ni se modifican. Los tests comparan sus hashes.

El bootstrap publica solo estado, nunca el payload o tokens. Expone en este
harness `state`, `capture` y `confirm`, además de eventos sin datos sensibles.
El coordinador no sustituye el objeto `Meta` vivo: captura una copia inmutable de
`cv_meta`, espera confirmación explícita y sincroniza una reclamación separada.

## Consecuencias

La vertical puede validarse de extremo a extremo y con persistencia real sin
alterar el producto. El coste es mantener temporalmente otro artefacto y una API
de debug que deberá sustituirse por UI antes del rollout.

Esta decisión no autoriza ningún despliegue. App Check real, UX, activación TTL,
perfil multidispositivo y pruebas nativas/cloud conservan gates independientes.
