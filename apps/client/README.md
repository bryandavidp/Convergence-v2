# Frontend — PWA, Android e iOS

Este workspace conserva Convergence 2.37.1 como snapshot ejecutable y lo carga
tras un bridge mínimo Web/Capacitor. El gameplay continúa saliendo de `web/`;
solo las dependencias de plataforma se sustituyen de forma incremental.

## Estado actual

- `web/` mantiene el HTML/CSS/JS legacy, `cv_meta` schema 10, la PWA y
  **343/343 pruebas**.
- `src/` contiene adaptadores TypeScript. El build normal no los carga ni los
  copia a `dist/`; las variantes ignoradas bundlean solo la integración
  necesaria para pruebas explícitas.
- `dist/` es una salida generada, ignorada por Git y consumida por Hosting y
  Capacitor.
- `android/` está generado y sincronizado con
  `com.deploy21.convergence`; su gate automatizado API 36 está verde e `ios/`
  se generará en macOS.
- Preferences, App, Haptics, Share y Network ya intervienen solo en nativo.
  Auth anónima funciona contra Emulator Suite y contra Firebase `dev` en
  artefactos aislados. `dist-profile-emulator/` conecta Auth + Functions y
  valida preview/confirmación/commit con outbox durable. Perfil cloud, App
  Check, push, notificaciones y la UI visible siguen pendientes.

Estado global: [ROADMAP.md](../../ROADMAP.md),
[PROGRESS.md](../../docs/PROGRESS.md) y
[SETUP_INPUTS.md](../../docs/SETUP_INPUTS.md).

## Arquitectura

```text
web/ ── build-static.mjs ──> dist/ ──> servidor PWA / Firebase Hosting
                                  └──> cap sync ──> android/ / ios/

src/online/auth-emulator-bootstrap.ts ── esbuild ──> dist-emulator/
                                                    └──> Auth 127.0.0.1:9099

src/online/cloud-dev-auth-bootstrap.ts ── esbuild ──> dist-cloud-dev/
                                                      └──> Firebase Auth dev

src/online/profile-emulator-bootstrap.ts ── esbuild ──> dist-profile-emulator/
                                                         └──> Auth + Functions local

src/
├─ bootstrap.ts              estado del bridge; no es un entrypoint activo
├─ platform/contract.ts      interfaces storage/haptics/share/network
├─ platform/web.ts           localStorage y APIs Web
├─ platform/capacitor.ts     Preferences y plugins Capacitor
├─ storage/                  repositorio JSON y outbox
└─ online/
   ├─ firebase-auth-client.ts       factory Auth-only demo/emulator
   ├─ firebase-cloud-dev-config.ts  allowlist exacta del proyecto/app Web dev
   ├─ firebase-cloud-auth-client.ts Auth cloud persistente + smoke efímero
   ├─ cloud-dev-auth-bootstrap.ts   arranque paralelo y evento de estado
   ├─ anonymous-auth-session.ts     sesión anónima y observer
   ├─ firebase-profile-emulator-client.ts  factory local Auth/Functions
   ├─ legacy-progress-transport.ts  transporte callable validado
   ├─ legacy-progress-sync.ts       réplica, preview/confirmación y outbox
   └─ profile-emulator-bootstrap.ts API/eventos del harness local
```

`web/game.js` sigue siendo el runtime real. `tsconfig.json` usa `noEmit` y el
bundler solo se usa en los carriles de desarrollo: nunca modifica
`web/index.html`, la configuración Hosting ni el directorio que sincroniza
Capacitor. Los tests cloud escriben en `test/.tmp`, no en la preview real.

## Requisitos e instalación

Las dependencias se instalan una sola vez desde la raíz del monorepo:

- Node.js 22.23.2;
- npm 10.9.8;
- Android: Android Studio 2025.2.1+, SDK 36 y JDK/JBR 21;
- iOS: macOS con Xcode 26+.

```powershell
npm ci
npm run validate
```

No crear un lockfile o `node_modules` independiente dentro del cliente.
`validate` es el gate completo; el typecheck aislado no lo sustituye.

## Iniciar el frontend

Desde la raíz de `Convergence v2`:

```powershell
npm run dev:web
```

Abre [http://127.0.0.1:4173](http://127.0.0.1:4173). El servidor sirve
`web/` directamente con `Cache-Control: no-store`, sin build y sin live
reload. También expone fixtures y herramientas bajo `web/`, por lo que es
exclusivamente local.

Para probar exactamente el artefacto que usarán Hosting y Capacitor:

```powershell
npm run build:web
npm run smoke:web
npm run preview --workspace @convergence/client
```

La preview se abre en
[http://127.0.0.1:4174](http://127.0.0.1:4174).

### Auth local sin tocar producción

Con Auth Emulator levantado mediante `npm run emulators`, ejecutar:

```powershell
npm run build:auth:emulator
npm run preview:auth:emulator
```

La preview de desarrollo usa el puerto 4175. Genera un bundle Auth-only con
nombre hasheado, amplía CSP únicamente a `http://127.0.0.1:9099` y publica el
evento `convergence:auth-emulator-state`. Un fallo de Auth se informa como
estado `error`, pero no bloquea el bridge ni `game.js`.

El smoke completo abre Chrome por CDP, exige que no haya peticiones fuera de
loopback ni violaciones CSP y repite la carga con Auth Emulator apagado:

```powershell
npm run test:auth:browser
```

### Auth cloud `dev` sin tocar el artefacto estable

La configuración real vive en `firebase-config.dev.json`, ignorada por Git. El
build valida metadatos y huella de API key antes de crear la variante:

```powershell
npm run build:cloud:dev
npm run preview:cloud:dev
```

La preview usa el puerto 4176. `dist-cloud-dev/` añade un único bundle ESM
Auth-only y una CSP limitada a Identity Toolkit y Secure Token. No importa SDK
Web de Analytics, Firestore, RTDB o Functions; `dist/`, Hosting y Capacitor
siguen intactos.

El smoke de API real crea y elimina una app/identidad anónima propia:

```powershell
npm run smoke:cloud:auth
```

El smoke de navegador usa otra app Firebase con persistencia solo en memoria,
por lo que nunca borra la sesión normal de desarrollo.

## Scripts

| Script del workspace | Comportamiento |
|---|---|
| `dev` | Sirve `web/` en el puerto 4173 |
| `build` | Recrea `dist/` mediante una allowlist estática |
| `build:auth-emulator` | Genera `dist-emulator/` con Auth local y deja `dist/` intacto |
| `build:profile-emulator` | Genera `dist-profile-emulator/` con Auth + Functions locales |
| `build:cloud-dev` | Genera `dist-cloud-dev/` Auth-only con configuración cloud validada |
| `preview` | Sirve un `dist/` existente en el puerto 4174 |
| `preview:auth-emulator` | Sirve `dist-emulator/` en el puerto 4175 |
| `preview:profile-emulator` | Sirve `dist-profile-emulator/` en el puerto 4177 |
| `preview:cloud-dev` | Sirve `dist-cloud-dev/` en el puerto 4176 |
| `smoke:cloud-auth` | Crea, valida y elimina una cuenta anónima en `dev` |
| `smoke` | Arranca `dist/` en 4199, exige HTTP 200 y referencia a `game.js` |
| `typecheck` | Valida `capacitor.config.ts` y `src/**/*.ts`; no emite JS |
| `test:legacy` | Ejecuta las 343 pruebas de `web/tests/*.test.js` |
| `test:platform` | Ejecuta 49 pruebas de bridge, storage, outbox, sync, Auth y builds |
| `test:auth-emulator-build` | Valida guardas, bundle, CSP y aislamiento de producción |
| `test:profile-emulator-build` | Valida Profile Emulator, CSP y aislamiento de salidas |
| `test:cloud-dev-build` | Valida la variante cloud en `test/.tmp` sin sobrescribir la preview real |
| `native:doctor` | Comprueba versiones y configuración de Capacitor |
| `native:gate` | Muestra y valida appId, nombre, webDir y `dist/index.html` |
| `native:add:android` | Genera `android/` una sola vez |
| `native:add:ios` | Genera `ios/` una sola vez y requiere macOS |
| `native:sync` | Construye el cliente y ejecuta `cap sync` |
| `android` | Sincroniza y abre Android Studio |
| `ios` | Sincroniza y abre Xcode |

Ejemplo de ejecución directa:

```powershell
npm run test:legacy --workspace @convergence/client
npm run typecheck --workspace @convergence/client
```

`native:sync` solo construye este workspace; no compila Functions ni todos los
paquetes. Antes de integrar o entregar cambios usar `npm run validate` en la
raíz.

## Profile Emulator

Es una variante de desarrollo separada. No modifica `dist`, Hosting, PWA ni el
directorio que sincroniza Capacitor. Requiere que contratos y Functions estén
compilados y que Auth/Functions/Firestore Emulator estén activos:

```powershell
# raíz del repositorio
npm run build:profile:emulator
npm exec -- firebase emulators:start --only auth,functions,firestore `
  --project demo-convergence-v2

# otra terminal
npm run preview:profile:emulator
```

En `http://127.0.0.1:4177`, el bridge captura cambios de `cv_meta` sin exponer el
JSON en eventos. El estado público se consulta con
`window.ConvergenceProfileMigration.state()` y, únicamente para este harness,
se confirma con `await window.ConvergenceProfileMigration.confirm()`.

La API de debug también ofrece `capture()`. El bootstrap publica
`convergence:profile-emulator-state`, escucha
`convergence:legacy-import-confirm` y reacciona al evento interno de cambio de
storage que contiene solo `{ key }`. Ninguno transporta payload, UID o token y
el coordinador nunca sobrescribe el objeto `Meta` vivo.

La sesión Auth usa persistencia durable independiente, la réplica/outbox está
ligada al UID y una identidad distinta entra en `identity-mismatch` sin procesar
la cola anterior. Red caída conserva operaciones; errores transitorios usan
backoff/`Retry-After`; Auth, conflictos y errores permanentes quedan bloqueados
en estados explícitos.

## Contrato del build

`scripts/build-static.mjs` elimina únicamente `apps/client/dist`, con una
guarda de ruta, y copia estas entradas desde `web/`:

```text
index.html
styles.css
game.js
sw.js
manifest.webmanifest
apple-touch-icon.png
icon-192.png
icon-512.png
icon-maskable.png
fonts/
img/
```

El proceso:

- no transpila, bundlea, minifica, hashea ni hace tree-shaking;
- no inyecta variables de entorno;
- no copia `src/`, tests, tools, mockups/docs, ESLint ni scripts;
- falla si falta cualquier entrada de la allowlist;
- borra cualquier edición manual de `dist/` en el siguiente build.

Actualmente `img/` se copia completo para proteger la paridad: el artefacto
observado ronda los 97 MB y contiene más de 4.200 imágenes. Reducirlo exige una
auditoría automatizada de referencias y del comportamiento offline.

Si se añade un archivo runtime fuera de `img/` o `fonts/`, debe incorporarse
explícitamente a la allowlist. El futuro bundle de `src/` también tendrá una
entrada explícita; copiar todo el workspace mezclaría runtime y fixtures.

## Versionado de la PWA

El snapshot sincroniza la versión entre:

- `VERSION` en `web/game.js`;
- query strings de CSS/JS en `web/index.html`;
- `CACHE` y URLs base en `web/sw.js`.

`web/tools/bump-version.sh X.Y.Z` automatiza el cambio y valida consistencia,
pero necesita Bash/Git Bash/WSL. Tras cualquier cambio de runtime:

```powershell
npm run test:legacy
npm run build:web
npm run smoke:web
```

Antes de una publicación también debe revisarse la identidad y el scope
`/convergence/` del manifest legacy.

## Dependencias

Todas las versiones están fijadas en `package.json` y
`package-lock.json`.

| Grupo | Paquetes | Estado real |
|---|---|---|
| Capacitor base | Core/CLI/Android/iOS 8.4.2 | `webDir: dist`; Android activo, iOS pendiente de macOS |
| Bridge activo | App 8.1.1, Haptics 8.0.2, Network 8.0.1, Preferences 8.0.1, Share 8.0.1 | Conectados en nativo con fallback web |
| Plugins reservados | Local Notifications 8.2.1, Push 8.1.2, Splash 8.0.2, Status Bar 8.0.3 | Splash/SystemBars base activos; notificaciones pendientes |
| Firebase Web | `firebase` 12.17.0 | Auth cloud-dev; Auth/App Check/Functions solo en Profile Emulator; sin SDK Firestore/RTDB cliente |
| Bundler de debug | `esbuild` 0.28.1 | Genera variantes Auth/profile aisladas; no transforma el legacy |
| Contratos | `@convergence/contracts` 0.1.0 | Valida transporte y respuestas de importación; gameplay legacy no lo importa |

TypeScript y los tipos de Node se aportan desde la raíz del monorepo.

## Configuración local

`capacitor.config.ts` define actualmente:

- `appName: Convergence`;
- `appId: com.deploy21.convergence`, permanente para Android/iOS;
- `webDir: dist`;
- fondo inicial `#070b1c` para evitar el destello blanco del WebView;
- esquema HTTPS en Android;
- sin override de identidad mediante variables de entorno.

La identidad puede comprobarse junto al artefacto web con:

```powershell
npm run native:gate
```

Las variables `CONVERGENCE_FIREBASE_*` de `.env.example` siguen reservadas y no
se leen. `build:cloud-dev` usa exclusivamente `firebase-config.dev.json`; valida
IDs, destinos y fingerprint sin imprimir la API key. La CSP estable conserva
`connect-src 'self'`; solo las variantes ignoradas abren los endpoints Auth
exactos que necesitan.

Nunca versionar o enviar por chat keystores, service accounts, claves APNs,
contraseñas o perfiles. Los archivos nativos Firebase están ignorados en:

```text
android/app/google-services.json
ios/App/App/GoogleService-Info.plist
```

## Flujo nativo

### Gate previo

Nombre, ID y orientación ya están confirmados. Antes de sincronizar o generar
otra plataforma:

```powershell
npm run validate
npm run native:doctor
npm run native:gate
```

### Generación única

Android ya fue generado. No volver a ejecutar `cap add android`; para
actualizarlo se usa `cap sync`.

iOS, exclusivamente en macOS:

```powershell
npm run build:web
npm run native:add:ios --workspace @convergence/client
```

`android/` es código fuente versionado y `ios/` lo será al generarse. Sus
builds, preferencias de usuario, credenciales y configuraciones locales
continúan ignorados.
`cap add` no se repite para actualizar una plataforma existente.

### Configuración Android generada

- namespace/application ID: `com.deploy21.convergence`;
- orientación: `portrait`;
- categoría de aplicación: `game`;
- SystemBars: insets CSS, barras visibles y estilo `DARK`;
- min SDK 24; compile/target SDK 36;
- Android Gradle Plugin 8.13.0 y wrapper Gradle 8.14.3;
- Java source/target 21 en el proyecto Capacitor;
- nueve plugins Capacitor descubiertos y sincronizados.
- backup del progreso local desactivado hasta disponer de reconciliación cloud;
- FileProvider restringido a `cache/share/`.

El proyecto compila con JBR 21 y SDK 36. `assembleDebug`, unit test, lint y el
test instrumentado pasan en `Convergence_API_36`; el APK también se instala,
abre en portrait y no produce excepciones fatales nativas. Los assets y config
generados por `cap sync` siguen ignorados y se regeneran desde `dist/`.

Gate Gradle reproducible desde `android/`:

```powershell
./gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
./gradlew.bat :app:connectedDebugAndroidTest
```

Con el AVD API 36 arrancado, el smoke de runtime reinstala y limpia únicamente
la app del emulador, activa modo avión, comprueba el WebView por CDP y fuerza un
relaunch recuperando `cv_meta`/`cv_run` desde Preferences:

```powershell
npm run native:smoke:android
```

El script rechaza dispositivos físicos para no borrar datos reales.

### Ciclo habitual

```powershell
npm run native:sync
npm run native:android
# o, en macOS:
npm run native:ios
```

`cap sync` copia `dist/` y actualiza plugins, pero no firma, publica ni
despliega. Permisos, capabilities, deep links, push, Firebase nativo, iconos y
splash se configurarán y validarán en sus fases.

Para llegar desde Android Emulator a servicios del PC se usará `10.0.2.2`;
iOS Simulator puede usar `127.0.0.1`.

## Límites y riesgos conocidos

No considerar todavía este scaffold una app nativa terminada:

1. `cv_meta` y `cv_run` usan lectura/replicación dual, cola serial y checkpoints
   cada 10 segundos; el resto de claves legacy continúa únicamente en
   `localStorage`.
2. El perfil/importación consume Functions y Firestore solo en
   `dist-profile-emulator`; el artefacto estable y cloud-dev siguen sin esa
   integración.
3. Push y notificaciones locales siguen sin integrar y requieren consentimiento.
   Android incluye dependencias Firebase Messaging/Installations por el plugin
   Push reservado; no incluye `firebase-analytics`.
4. El warning temprano de SystemBars al inyectar CSS se origina en Capacitor;
   Android aplica padding nativo y el layout verificado no solapa las barras.
5. `JsonRepository` y `Outbox` ya validan schema, aíslan JSON corrupto,
   serializan updates, aplican leases/backoff y protegen ownership. Falta una UX
   de recuperación para `identity-mismatch` antes de activarlos en producción.
6. `RunSave` legacy no conserva el estado RNG ni cubre todos los modos.
7. Multiplayer, rankings online y pagos reales no existen en este runtime.
8. iOS, firma, cuentas de tienda y pipeline de publicación siguen pendientes.

La aceptación nativa sigue la
[matriz de paridad](../../docs/NATIVE_PARITY_CHECKLIST.md) y exige dispositivo
real: arranque offline, pausa/reanudación, audio, safe areas, back button,
persistencia tras reinicio, accesibilidad, compartir, háptica y ausencia de
recursos 404. Tests y smoke son necesarios, pero no suficientes.

## Regla de contribución

- Cambio de paridad en `web/`: pruebas legacy, build, smoke y comparación con
  [el design system canónico](../../docs/design-system/DESIGN_SYSTEM.md).
- Código nuevo: `src/`, contrato explícito, feature flag y ruta de rollback.
- Cambio nativo: build, `cap sync` y prueba en dispositivo.
- Ante contradicciones: código/pruebas, design system, arquitectura v2 y al
  final documentación legacy.
