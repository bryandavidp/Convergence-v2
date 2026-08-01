# ADR 0007 — Auth cloud `dev` aislada del artefacto estable

Fecha: 2026-08-01
Estado: aceptado para desarrollo

## Contexto

Auth anónima ya estaba validada contra Emulator Suite, pero el siguiente paso
necesitaba comprobar configuración, red, persistencia y CSP contra un proyecto
Firebase real. Cargar el SDK en `apps/client/dist` habría cambiado a la vez la
PWA, Hosting local y el contenido sincronizado por Capacitor antes de disponer
de perfil, App Check y rollback.

El proyecto de desarrollo es `convergence-d1a35`; Web y Android comparten la
identidad de producto `Convergence`/`com.deploy21.convergence`, pero una sesión
anónima Web y una sesión anónima nativa no deben asumirse como la misma cuenta.
La vinculación entre dispositivos llegará mediante upgrade de cuenta y perfil
autoritativo.

## Decisión

Se añade un tercer artefacto explícito e ignorado:

- `dist`: PWA estable y única fuente de Hosting/Capacitor;
- `dist-emulator`: Auth local contra `127.0.0.1:9099`;
- `dist-cloud-dev`: Auth real contra `convergence-d1a35`.

`build:cloud-dev`:

1. regenera el baseline estático;
2. lee `firebase-config.dev.json`, nunca variables ambiguas;
3. valida el conjunto exacto de campos, Project ID/number, Web App ID,
   authDomain, RTDB, bucket, sender y measurement ID;
4. compara la huella SHA-256 de la API key pública registrada para impedir que
   metadatos correctos enruten Auth a otro proyecto;
5. inyecta únicamente las opciones necesarias por Firebase Auth;
6. genera un bundle ESM minificado y hasheado, sin sourcemap ni CDN;
7. amplía `connect-src` solo a Identity Toolkit y Secure Token;
8. no importa Analytics, Firestore, RTDB ni Functions.

El source JSON y `google-services.json` permanecen ignorados y no se copian al
artefacto. La API key no se imprime en logs.

## Persistencia y smoke

La sesión normal usa, en orden, IndexedDB, localStorage y memoria. El resolver
popup/redirect queda fuera mientras Auth sea solo anónima.

El smoke destructivo de navegador está limitado a loopback y usa:

- nombre de Firebase App único por ejecución;
- persistencia exclusivamente en memoria;
- estado inicial obligatoriamente sin usuario;
- la credencial devuelta por su propio `signInAnonymously`;
- borrado de esa misma credencial y de la app efímera.

Por tanto no puede borrar la identidad persistente de un desarrollador. El
smoke CLI usa igualmente una app única y elimina la cuenta que acaba de crear.
Ningún evento publica tokens; el marcador DOM de prueba contiene solo estado.

## Aislamiento de tests

Los tests de build comparten `dist`, por lo que la suite de plataforma se
ejecuta con concurrencia 1 en Windows. La variante con fixture se genera en
`apps/client/test/.tmp/dist-cloud-dev` y se elimina al finalizar; nunca
sobrescribe `dist-cloud-dev` real.

Gates automatizados:

- `dist` y `sw.js` no cambian tras crear una variante;
- Hosting y Capacitor continúan apuntando a `apps/client/dist`;
- solo existe un bundle modular esperado;
- CSP contiene únicamente los dos orígenes Auth;
- el grafo no contiene Analytics, Firestore, RTDB o Functions;
- no se copia configuración fuente ni sourcemaps;
- configuración incorrecta o API key de otra app falla antes de inicializar.

## Analytics y Android

Analytics está habilitado en Firebase Console, pero esta variante Web no
incluye `firebase/analytics` ni emite eventos Analytics. Android incluye
Firebase Messaging e Installations como dependencias transitivas del plugin
Capacitor Push reservado; no incluye `firebase-analytics`. Esto no equivale a
tener push funcional: consentimiento, permisos, tokens y backend siguen
pendientes.

## Estado de datos cloud

Tras autorización explícita se desplegó únicamente Firestore Rules. Las rutas
privadas devuelven 403 y `publicConfig`/entries de leaderboard son públicas por
diseño. Todo campo dentro de una entry es público y no almacenará señales
antifraude privadas.

RTDB cloud continúa con `.read: false` y `.write: false`. El ruleset granular de
presence/salas solo se desplegará cuando exista implementación y un nuevo gate.
Functions, Storage, índices y Hosting no se desplegaron.

## Consecuencias

Se puede desarrollar identidad real sin cambiar la PWA o los shells nativos.
El coste es mantener artefactos y scripts explícitos, pero su aislamiento es
comprobable y reversible.

Antes de integrar perfil o Functions cloud siguen siendo obligatorios App
Check, política de retención/upgrade de cuentas anónimas, presupuesto, cuotas,
restricciones de API key, tests y autorización del servicio exacto.
