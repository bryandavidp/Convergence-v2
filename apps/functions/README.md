# Backend Firebase — Convergence v2

Backend serverless compartido por PWA, Android e iOS. Cloud Functions v2 es la
frontera autoritativa; Firestore guarda datos durables, Realtime Database
gestiona presencia/lobby caliente y Storage permanece cerrado hasta definir
límites y validación.

El proyecto `dev` (`convergence-d1a35`) está enlazado. Desde el 2026-08-02 hay
desplegados Functions, Hosting, reglas de Firestore, índices y reglas de Storage.
Solo siguen sin desplegar las RTDB Rules: la instancia cloud es deny-all y así
se queda hasta que entren presence/salas.

## Estado operativo

| Área | Estado actual |
|---|---|
| Functions | Node 22 + ESM; 10 callables v2 desplegadas en `europe-west1` |
| Auth/App Check | Todas exigen Auth. App Check en fase Monitor: `enforceAppCheck: false` en código para que mande la consola sin bloquear a nadie mientras se miden métricas |
| Firestore | Ruleset e índices desplegados en `dev`; escrituras cliente cerradas |
| RTDB | Cloud deny-all; ruleset granular de presence/rooms solo local |
| Storage | Ruleset desplegado; lectura y escritura completamente cerradas |
| Emuladores | Suite completa validada con Node 22/JDK 21 y smoke reproducible |
| Tests | 9 handler + 10 Functions Emulator + 6 Auth E2E + 22 reglas/TTL |
| Nube | Alias `dev` activo; Functions, Hosting, reglas, índices y Storage desplegados; RTDB no |

El backend sigue aislado de `web/index.html` y del build productivo. La variante
`dist-profile-emulator` prueba identidad, preview, confirmación y commit contra
servicios locales; no existen aún perfil cloud general, rankings o multiplayer.

## Artefacto de despliegue

`package.json` **no declara `@convergence/contracts` ni `@convergence/game-core`**
como dependencias, y es deliberado. Firebase sube solo el directorio `source` de
`firebase.json` (`apps/functions`), sin `node_modules`, y ejecuta `npm install`
contra el registro público: esos dos paquetes son del workspace, no están
publicados, y el despliegue se caía en Cloud Build antes de arrancar.

`scripts/bundle-deploy.mjs` los inlinea con esbuild (junto a `zod`) en
`lib/index.js`, dejando como externos solo lo que el runtime de Functions sí
resuelve: `firebase-admin` y `firebase-functions`. El script aborta si algún
`import` de `@convergence/*` sobrevive al bundle, para que el fallo salga aquí y
no a mitad de un despliegue.

```powershell
npm run build:functions:deploy   # tsc (typecheck real) + bundle
```

Es el `predeploy` de Functions en `firebase.json`, así que un `firebase deploy`
siempre parte del bundle recién generado. Para desarrollo local y tests nada
cambia: `npm run build` sigue emitiendo el `lib/` normal de tsc y la resolución
de los paquetes del workspace la dan los symlinks de npm workspaces.

A la inversa, `@firebase/app` **sí** figura en `dependencies` aunque el código no
lo importe: `firebase-admin` carga `@firebase/database-compat`, que lo declara
como peer *opcional*, así que npm no lo instala solo. En local existía únicamente
porque `@convergence/client` depende del SDK `firebase` completo y npm lo elevaba
a la raíz del workspace. En la nube solo se instalan las dependencias de este
paquete, así que faltaba y **los nueve contenedores morían al arrancar** con
`Cannot find module '@firebase/app'`. Depender del hoisting de otro workspace es
invisible hasta que despliegas.

## Responsabilidades

- **Functions:** Auth/App Check, validación Zod, idempotencia, transacciones,
  validación de runs y escrituras autoritativas.
- **Firestore:** perfil/progreso, auditoría de operaciones, resultados
  verificados y leaderboards materializados.
- **Realtime Database:** presence, lobby, ready/countdown y snapshots calientes;
  nunca economía o resultado final.
- **Storage:** futuro para replays grandes o avatares; cerrado hasta definir
  tamaño, MIME, retención y análisis.
- **`@convergence/contracts`:** schemas versionados compartidos. El UID
  autoritativo siempre procede de `request.auth.uid`.
- **`@convergence/game-core`:** futuro validador determinista sin Firebase,
  DOM ni Capacitor.

Consulta [Arquitectura](../../docs/ARCHITECTURE.md) y
[Modelo de datos](../../docs/DATA_MODEL.md).

## Estructura

```text
apps/functions/
├─ src/
│  ├─ config/runtime.ts   región y límites globales
│  ├─ legacy-progress.ts  política, proyección y store transaccional
│  └─ index.ts            exports de Cloud Functions
├─ test/                  handlers, importación E2E y runner demo aislado
├─ lib/                   JavaScript generado; ignorado por Git
├─ .env.example           configuración local documentada
├─ package.json
└─ tsconfig.json

firebase/
├─ firestore.rules
├─ firestore.indexes.json
├─ database.rules.json
└─ storage.rules
```

`firebase.json`, en la raíz, conecta Functions, reglas, Hosting y puertos de
emuladores.

## Dependencias

| Paquete | Versión | Uso |
|---|---:|---|
| `firebase-functions` | 7.3.2 | Callables v2 y opciones de runtime |
| `firebase-admin` | 14.2.0 | Acceso autoritativo desde backend |
| `@firebase/app` | 0.16.0 | Peer opcional que `firebase-admin` necesita en la nube |
| `@convergence/contracts` | 0.1.0 | Validación de payloads; se inlinea en el bundle, no se declara |
| Firebase CLI, raíz | 15.25.0 | Build local, emuladores y futuro deploy |
| TypeScript compatible, raíz | 6.0.2 | Compilación ESM mediante `tsc6` |

Functions declara runtime `nodejs22` en `firebase.json` y
`engines.node: 22` en su paquete.

## Requisitos

Ejecutar desde la raíz de `Convergence v2`:

- Node 22.23.2;
- npm 10.9.8;
- JDK 21 accesible en `PATH` para Firestore/RTDB Emulator;
- dependencias instaladas mediante `npm ci`.

```powershell
node --version
npm --version
java -version
npm run check:node
```

No se necesita service account para desarrollo local.

`LegacyProgressImportV1` limita el sobre de `cv_meta` v10, idempotencia,
revisión y superficie JSON. Las Functions ya crean una preview y registran una
reclamación transaccional, pero no confían en economía, cofres o puntuaciones ni
promocionan la reclamación a progreso autoritativo.

## Build, typecheck y tests

```powershell
npm run build:contracts
npm run build:functions
npm run typecheck --workspace @convergence/functions
npm run test --workspace @convergence/functions
```

El build compila `src/` a `lib/`. Hay 9 pruebas directas de handlers/política y
10 casos reales de callable: Auth/App Check de `health`, seguridad, preview,
commit, idempotencia, revisión, caducidad, límite de una importación y aislamiento
por UID, concurrencia y cuota. El runner arranca Functions + Firestore y rechaza
IDs sin prefijo `demo-`.

Para validar todo el repositorio:

```powershell
npm run validate
npm run test:auth:emulator
npm run test:backend
# o ambos gates:
npm run validate:full
```

## Iniciar Emulator Suite

```powershell
npm run emulators
```

El comando construye el monorepo y arranca todos los servicios con el ID
ficticio `demo-convergence-v2`. El prefijo `demo-` impide tratarlo como un
proyecto real; no cambiarlo por un alias de nube durante pruebas. Detener con
`Ctrl+C`.

| Servicio | URL/puerto local |
|---|---:|
| Emulator UI | http://127.0.0.1:4000 |
| Hosting | http://127.0.0.1:5000 |
| Functions | 5001 |
| Firestore | 8080 |
| Realtime Database | 9000 |
| Auth | 9099 |
| Storage | 9199 |

El estado puede exportarse mientras la suite está activa:

```powershell
npm run emulators:export
```

Se guarda en `.emulator-data/`, que está ignorado por Git.

Para un gate no interactivo que arranca, comprueba y detiene la suite:

```powershell
npm run emulators:smoke
```

Valida los puertos de Auth, Functions, Firestore, RTDB, Hosting y Storage,
comprueba la web alojada y exige que `health` rechace acceso anónimo. Los tests
de comportamiento completos se ejecutan aparte con `npm run test:backend`.

Si solo se quiere comprobar que Functions descubre sus exports y aún no hay
Java:

```powershell
npm run build:contracts
npm run build:functions
npm exec firebase -- emulators:start --only functions --project demo-convergence-v2
```

Eso no prueba Auth, reglas ni integraciones. Una Function que usa otro servicio
debe probarse con ese servicio emulado para evitar cualquier acceso accidental
a nube.

## Callables actuales

### `health`

- Tipo: Firebase callable v2; no es una ruta REST.
- Región provisional: `europe-west1`.
- Seguridad: Auth obligatoria y `enforceAppCheck: true`.
- Límites globales: 256 MiB, 30 segundos y máximo 10 instancias.
- Respuesta:

```json
{
  "ok": true,
  "service": "convergence-v2",
  "protocolVersion": 1,
  "serverTime": 0
}
```

En local la Function se anuncia en:

```text
http://127.0.0.1:5001/demo-convergence-v2/europe-west1/health
```

Debe invocarse con `httpsCallable` desde un SDK conectado a Auth, App Check y
Functions Emulator; abrir la URL o hacer un GET no reproduce el protocolo
callable.

### `previewLegacyProgressImport`

- Entrada: `LegacyProgressImportV1` con `cv_meta` schema 10, revisión base e
  idempotency key; no acepta UID.
- Deriva identidad y `operationId` desde `request.auth.uid`, valida App Check,
  límites JSON, catálogos y clamps.
- No crea ni modifica `users/{uid}`. Crea un tombstone idempotente y guarda el
  raw canónico en un documento TTL separado; devuelve proyección y `planHash`.
- Permite una preview activa, hasta tres nuevas por hora y 15 minutos para
  confirmar.

### `commitLegacyProgressImport`

- Entrada: identificadores/hash del plan y `confirmation: true`; no recibe UID
  ni vuelve a recibir el payload.
- Revalida owner, política, revisión, plan y caducidad dentro de una transacción.
- Incrementa `revision` una sola vez y guarda `legacyClaim` como
  `untrusted-client`, `unverified` y `quarantined`.
- Es idempotente: un retry exacto responde `already-committed`; otra petición
  con la misma key, una revisión obsoleta o una segunda importación se bloquean.

Ninguna de estas callables está desplegada. Solo están disponibles en local en
`europe-west1` bajo el proyecto demo.

## Configuración

- `firebase.json` es la fuente de puertos, reglas, índices, Hosting y
  predeploy.
- `src/config/runtime.ts` usa `FUNCTION_REGION` si existe y
  `europe-west1` como fallback provisional.
- `.env.example` documenta esa variable; el `.env` real está ignorado.
- `.firebaserc` local e ignorado conserva `default` en el proyecto demo y `dev`
  en `convergence-d1a35`; `staging` y `prod` aún no existen.

Cliente, Firestore, RTDB y Functions están alineados en `europe-west1`. No
existe script `deploy` deliberadamente; cada cambio cloud requiere un comando
con selector de servicio y autorización explícita.

## Seguridad actual

- Firestore permite lectura pública de `publicConfig` y leaderboards, nunca
  su escritura desde cliente.
- Cada campo de una entry de leaderboard es público; las señales antifraude y
  auditoría privada deben vivir en otra ruta exclusivamente backend.
- Cada usuario solo lee `users/{uid}` y sus subcolecciones; toda mutación pasa
  por Admin SDK.
- Rooms/matches de Firestore solo se leen si el usuario figura en
  `memberIds`.
- El ruleset RTDB **versionado/local** permite al usuario escribir únicamente
  `presence/{suUid}`; rooms/matches no admiten escritura cliente. RTDB cloud
  continúa totalmente cerrada hasta implementar ese vertical.
- Storage aplica deny-all.
- Admin SDK solo pertenece al backend.
- Las colecciones `legacyImportPreviews`, `legacyImportPayloads`,
  `legacyImportReceipts` y `legacyImportPreviewLocks` caen en deny-all.
- La importación permite una sola reclamación por UID. El raw confirmado se
  marca con `deleteAt` a siete días y las previews no confirmadas caducan a los
  15 minutos. TTL y exención de índice están versionados, pero requieren un
  futuro deploy explícito de índices antes de desplegar Functions.

Presence no es autoritativa: hoy un usuario autenticado puede consultar una
ruta `presence/{uid}` y el propietario propone `lastChanged`. Antes de
activar salas se limitará visibilidad, se usará tiempo servidor y se añadirá
limpieza/TTL.

`maxInstances: 10` limita coste global, pero no es rate limiting por usuario.
Cada futura operación mutable requiere schema runtime, UID de Auth, idempotency
key, cuota, timestamp servidor, transacción y tests.

## Cobertura y tests pendientes antes de abrir datos

Ya están cubiertos allow/deny de usuarios, leaderboards, rooms, matches,
presence y Storage; `health` sin Auth/App Check; y la importación con payload
inválido, ownership, raw interno, duplicado idempotente, revisión obsoleta,
caducidad, segunda importación y aislamiento por UID. El gate backend está en
`npm run test:backend`; CI continúa pendiente.

Hallazgo actual: `rooms/{id}` y `matches/{id}` se leen directamente por miembro,
pero las reglas no permiten consultar la colección de salas, ni siquiera con
`array-contains`. Antes del lobby se materializará un índice por usuario o se
adoptará otra forma explícita de descubrimiento; no se abrirá la colección.

No se relajarán App Check o las reglas para facilitar una demo.

## Próximas callables propuestas

1. `applyProgressOperations`: perfil general, revisión y conflictos
   multidispositivo más allá de la importación inicial.
2. `submitRankedRun`: valida versión, seed, replay y hash con game-core.
3. `getLeaderboard`: top paginado, entrada propia y resultados verificados.
4. `createRoom`, `joinRoom`, `leaveRoom`, `setRoomReady`,
   `startRoom`: lifecycle autoritativo y materialización en RTDB.
5. `submitMultiplayerRun`: valida y cierra el resultado de una partida.
6. `deleteAccount`: elimina o anonimiza según política de retención.

Antes de congelar contratos de salas debe decidirse el alcance del primer modo.
Los schemas preliminares aceptan 2–8 miembros y rol spectator, pero esa amplitud
no implica que el MVP deba soportarla.

## Gate previo al primer despliegue

- CI, tests de Functions y reglas en verde.
- Proyectos `dev`, `staging`, `prod`, aliases y regiones confirmados.
- Firestore/RTDB creados en localización definitiva.
- Auth y App Check registrados para web, Android e iOS.
- TTL de `legacyImportPayloads.deleteAt` desplegado/verificado y raw sin índice.
- Presupuesto, alertas, logs, retención, borrado y moderación definidos.
- Auditoría de dependencias revisada bajo Node 22.
- Autorización explícita del usuario para el entorno exacto.

Hasta completar este gate, las Functions son locales y los datos cloud se
mantienen deny-by-default.
