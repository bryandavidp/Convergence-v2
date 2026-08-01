# Convergence v2

Convergence v2 es la migración independiente del juego actual a una única base
de producto para PWA, Android, iOS y servicios online. La estrategia es
incremental: conservar primero el comportamiento probado de Convergence 2.37.1
y sustituir después, por capas y con rollback, sus dependencias del navegador.

Este directorio es un repositorio Git propio y está ignorado por el repositorio
original. Frontend, backend, contratos, reglas, documentación y futuras
plataformas nativas viven aquí.

## Estado actual

- El cliente web 2.37.1 funciona desde `apps/client/web` y mantiene
  **343/343 pruebas legacy**.
- El gate normal supera **425/425 pruebas**, typecheck, build y smoke HTTP.
- El gate backend adicional supera **38/38 pruebas** de Auth, Functions, reglas y TTL
  sobre emuladores Firebase.
- El mismo artefacto web está preparado para empaquetarse con Capacitor 8.
- El bridge nativo ya conecta runtime, lifecycle, back, safe areas, Preferences,
  háptica, compartir y red. Serializa los guardados y crea checkpoints iniciales,
  cada 10 segundos y al pasar a background.
- Firebase Functions, reglas e índices están preparados para desarrollo local.
  El proyecto `dev` está conectado, Auth anónima funciona en un artefacto cloud
  separado y Firestore ya aplica el ruleset versionado. No se han desplegado
  Functions, RTDB Rules, Storage, índices ni Hosting.
- La importación legacy `cv_meta` ya recorre preview, confirmación explícita,
  commit transaccional y perfil revisionado contra Emulator Suite. El outbox es
  durable y está ligado al UID; economía, cofres y rankings quedan excluidos.
- Android está generado y sincronizado con `com.deploy21.convergence`,
  categoría game y orientación vertical.
- El APK debug compila con JDK 21/SDK 36; unit test, lint, test instrumentado y
  arranque en emulador Android 16/API 36 están verdes.
- iOS aún no se ha generado; requiere la fase de trabajo en macOS/Xcode.
- La Emulator Suite completa, reglas, callables y E2E de Auth/perfil pasan
  localmente. Faltan la UI visible de importación, App Check cloud y desplegar
  Functions cuando se autorice.

El plan canónico está en [ROADMAP.md](./ROADMAP.md) y la evidencia de cada
sesión en [docs/PROGRESS.md](./docs/PROGRESS.md).

## Cómo funciona

La aplicación se divide en cinco capas:

1. **Cliente estable:** `apps/client/web` contiene el HTML, CSS, JavaScript,
   PWA, assets y tests del juego actual.
2. **Bridge de migración:** `apps/client/src` prepara puertos de plataforma,
   almacenamiento, outbox y Firebase. Auth solo se carga en variantes de
   desarrollo explícitas; el build estable sigue aislado.
3. **Código compartido:** `packages/contracts` valida datos de red con Zod y
   `packages/game-core` aloja reglas deterministas reutilizables.
4. **Backend:** `apps/functions` contiene Functions v2 autoritativas.
5. **Datos:** Firestore conserva datos durables; Realtime Database se reserva
   para presencia, lobby y estado caliente; Storage permanece cerrado hasta
   definir sus límites.

El flujo actual y el futuro quedan separados deliberadamente:

```text
apps/client/web ── copia controlada ──> apps/client/dist ──> PWA / Capacitor

apps/client/src ── bridge futuro ──> contracts + game-core + Firebase
                                             └──> Functions / Firestore / RTDB

apps/client/src/online ── esbuild debug ──> apps/client/dist-emulator
                                              └──> Auth Emulator (loopback)

apps/client/src/online ── esbuild cloud-dev ──> apps/client/dist-cloud-dev
                                                └──> Firebase Auth dev

apps/client/src/online ── esbuild profile ──> apps/client/dist-profile-emulator
                                             └──> Auth + Functions Emulator
```

El primer flujo sigue siendo el runtime real. El segundo compila y se prueba de
forma aislada; las tres variantes de desarrollo nunca son el directorio de
Hosting o Capacitor estable.

## Estructura

```text
Convergence v2/
├─ apps/
│  ├─ client/
│  │  ├─ web/              snapshot ejecutable 2.37.1
│  │  ├─ src/              bridge, storage, sync y adaptadores por carril
│  │  ├─ scripts/          build y servidores estáticos
│  │  ├─ android/          proyecto Android nativo versionable
│  │  └─ dist/             salida generada, no versionada
│  └─ functions/
│     ├─ src/              backend Firebase Functions v2
│     └─ lib/              JavaScript generado, no versionado
├─ packages/
│  ├─ contracts/           schemas y DTO versionados
│  └─ game-core/           RNG, engine y replay sin DOM/Firebase
├─ firebase/               reglas e índices
├─ docs/
│  ├─ design-system/       fuente visual canónica y 127 capturas
│  ├─ decisions/           decisiones de arquitectura
│  └─ legacy-reference/    documentación histórica, no contractual
├─ firebase.json           servicios, puertos y Hosting local
├─ ROADMAP.md              fases, gates y pendientes
└─ package.json            comandos del monorepo
```

## Requisitos

### Desarrollo web y validación

- Node.js **22.23.2** LTS.
- npm **10.9.8**.

El proyecto aplica `engine-strict=true`, conserva versiones exactas y usa
`.nvmrc`. Node 23 y npm 11 no forman parte del entorno homologado.

### Backend local

- Los requisitos anteriores.
- JDK **21** accesible mediante `java` para Firestore y Realtime Database
  Emulator.

### Desarrollo nativo

- Android: Android Studio 2025.2.1 o superior, SDK 36 y JDK/JBR 21.
- iOS: macOS con Xcode 26 o superior.

Android se puede desarrollar desde Windows. Generar, firmar y publicar iOS
requiere un Mac.

## Primera instalación

Ejecutar desde la raíz de `Convergence v2`:

```powershell
fnm use 22.23.2
node --version
npm --version
npm ci
npm run validate
```

La salida esperada empieza por:

```text
v22.23.2
10.9.8
```

`npm ci` reproduce exactamente `package-lock.json`. Usar `npm install`
solo al añadir o actualizar deliberadamente una dependencia y versionar después
el cambio del lockfile.

Si una terminal abierta antes de instalar Node sigue mostrando otra versión,
cerrarla y abrir una nueva antes de ejecutar comandos. `npm run check:node`
ofrece un diagnóstico rápido.

## Iniciar el proyecto

### Solo frontend

```powershell
npm run dev:web
```

Abre [http://127.0.0.1:4173](http://127.0.0.1:4173). Este servidor sirve
`apps/client/web` directamente, sin live reload y sin usar Firebase.

Para comprobar el artefacto final:

```powershell
npm run build:web
npm run preview --workspace @convergence/client
```

La preview queda en [http://127.0.0.1:4174](http://127.0.0.1:4174).

### Backend y servicios locales

Primero confirma:

```powershell
java -version
```

Después, en una segunda terminal:

```powershell
npm run emulators
```

El comando construye todo y arranca el proyecto ficticio
`demo-convergence-v2`; no accede a un proyecto Firebase real. La interfaz del
Emulator Suite queda en
[http://127.0.0.1:4000](http://127.0.0.1:4000) y Hosting local en
[http://127.0.0.1:5000](http://127.0.0.1:5000).

El cliente estable aún no se conecta automáticamente a estos emuladores. Ese
cableado productivo forma parte de la fase de progreso. Para probar el vertical
Auth local en dos terminales:

```powershell
npm run emulators
npm run build:auth:emulator
npm run preview:auth:emulator
```

La variante queda en [http://127.0.0.1:4175](http://127.0.0.1:4175), se conecta
exclusivamente a `127.0.0.1:9099` y no reemplaza `apps/client/dist`.

### Auth contra Firebase `dev`

Con `apps/client/firebase-config.dev.json` ya descargado en su ruta ignorada:

```powershell
npm run build:cloud:dev
npm run preview:cloud:dev
```

La preview queda en [http://127.0.0.1:4176](http://127.0.0.1:4176). Genera
`dist-cloud-dev`, valida de forma estricta el cliente Firebase registrado e
incluye solo Auth. Para un smoke de API que crea y elimina su propia cuenta
anónima:

```powershell
npm run smoke:cloud:auth
```

Estos comandos no despliegan Hosting ni modifican el directorio `dist` después
de generar su baseline estática.

## Comandos principales

| Comando | Qué hace |
|---|---|
| `npm run check:node` | Comprueba el runtime Node homologado |
| `npm run check:android` | Diagnostica Studio, Java 21, SDK 36, adb y emulador |
| `npm run emulators:smoke` | Arranca la suite demo, valida seis servicios y la apaga |
| `npm run dev:web` | Sirve el snapshot en el puerto 4173 |
| `npm run build` | Compila contratos/core/Functions y genera la web |
| `npm run typecheck` | Valida TypeScript en todos los workspaces |
| `npm run test:legacy` | Ejecuta las 343 pruebas del juego actual |
| `npm run test:platform` | Ejecuta 49 pruebas de plataforma, Auth, sync, outbox y builds aisladas |
| `npm run test:packages` | Ejecuta 20 pruebas de contratos y 4 de game-core |
| `npm run test:functions:unit` | Ejecuta 9 pruebas de handlers y política de importación |
| `npm run test:functions:emulator` | Prueba `health` e importación contra Functions + Firestore Emulator |
| `npm run test:auth:emulator` | Ejecuta el E2E anónimo real contra Auth Emulator |
| `npm run test:auth:browser` | Prueba en Chrome Auth disponible/caída sin bloquear el legacy |
| `npm run test:rules` | Ejecuta 21 allow/deny y la invariante TTL/índices |
| `npm run test:backend` | Ejecuta las 38 pruebas Auth, Functions, reglas y TTL |
| `npm run build:auth:emulator` | Genera la variante Auth local aislada |
| `npm run preview:auth:emulator` | Sirve la variante Auth local en el puerto 4175 |
| `npm run build:profile:emulator` | Genera la variante local de perfil/importación |
| `npm run preview:profile:emulator` | Sirve la variante de perfil en el puerto 4177 |
| `npm run test:profile:build` | Valida bundle, CSP y aislamiento del Profile Emulator |
| `npm run build:cloud:dev` | Genera la variante Auth cloud `dev` aislada |
| `npm run preview:cloud:dev` | Sirve la variante cloud en el puerto 4176 |
| `npm run smoke:cloud:auth` | Crea, valida y elimina una identidad anónima cloud de prueba |
| `npm run test:cloud:build` | Verifica bundle, CSP, configuración y aislamiento en salida temporal |
| `npm test` | Ejecuta las 425 pruebas del gate normal |
| `npm run smoke:web` | Sirve `dist` temporalmente y exige HTTP 200 |
| `npm run validate` | Gate local completo: entorno, tipos, tests, build y smoke |
| `npm run validate:full` | Añade Functions Emulator y Rules Emulator al gate normal |
| `npm run audit:gate` | Audita todo el árbol; falla desde severidad high |
| `npm run audit:prod` | Audita solo dependencias de producción |
| `npm run emulators` | Construye y arranca todos los emuladores |
| `npm run emulators:export` | Exporta el estado local a `.emulator-data` |
| `npm run native:doctor` | Comprueba la alineación de Capacitor |
| `npm run native:gate` | Valida appId, nombre y build antes de `cap add` |
| `npm run native:sync` | Construye cliente y sincroniza plataformas creadas |
| `npm run native:smoke:android` | Smoke destructivo solo para emulador: offline y process death |
| `npm run native:android` | Sincroniza y abre Android Studio |
| `npm run native:ios` | Sincroniza y abre Xcode; requiere macOS |

### Probar localmente la importación de perfil

Este carril usa únicamente el proyecto ficticio `demo-convergence-v2`; no lee
ni escribe Firebase cloud. Desde la raíz, abrir tres terminales:

```powershell
# Terminal 1: crear el artefacto aislado
npm run build:profile:emulator

# Terminal 2: Auth + Functions + Firestore locales
npm exec -- firebase emulators:start --only auth,functions,firestore `
  --project demo-convergence-v2

# Terminal 3: servir el cliente
npm run preview:profile:emulator
```

Abrir `http://127.0.0.1:4177`. La captura de `cv_meta` crea primero una preview
y se detiene en `awaiting-confirmation`. Mientras no exista una UI de producto,
el harness local se inspecciona y confirma desde DevTools:

```js
window.ConvergenceProfileMigration.state()
await window.ConvergenceProfileMigration.confirm()
```

La confirmación solo envía `operationId`, revisión y hash del plan; nunca vuelve
a enviar el payload. Detener servidor y emuladores con `Ctrl+C`.

No hay script de despliegue deliberadamente. Se añadirá solo después de probar
reglas, separar entornos, fijar presupuesto y recibir autorización explícita.

## Workspaces y dependencias principales

| Workspace | Responsabilidad | Dependencias principales |
|---|---|---|
| `@convergence/client` | PWA y shell Capacitor | Capacitor 8.4.2, plugins oficiales 8.x, Firebase Web 12.17.0 |
| `@convergence/functions` | API autoritativa serverless | Firebase Functions 7.3.2, Admin 14.2.0 |
| `@convergence/contracts` | Validación de payloads | Zod 4.4.3 |
| `@convergence/game-core` | Simulación determinista | Sin dependencias runtime |

La raíz aporta Firebase CLI 15.25.0, tipos de Node 22 y el paquete oficial de
compatibilidad TypeScript 6.0.2. Los comandos usan `tsc6` porque Capacitor 8
todavía consume APIs del compilador incompatibles con TypeScript 7.

Las versiones exactas viven en `package.json` y `package-lock.json`; no
instalar paquetes globales para sustituirlas.

## Configuración y secretos

- `apps/client/firebase-config.dev.json` contiene la configuración cliente Web
  descargada y está ignorado. Solo la lee `build:cloud:dev`.
- La identidad nativa permanente vive en
  `apps/client/capacitor.config.ts`: `com.deploy21.convergence`.
- `apps/functions/.env.example` documenta la región provisional.
- `.firebaserc` local e ignorado conserva los aliases `default` demo y `dev`.
- Los archivos `.env`, `.firebaserc`, credenciales Firebase, keystores,
  certificados y perfiles de firma están ignorados.

La configuración web de Firebase no es una clave privada, pero se mantiene local
para evitar mezclar entornos. Nunca compartir ni versionar service accounts,
claves APNs, contraseñas o archivos de firma.

## Calidad y seguridad

El gate mínimo antes de integrar cambios es:

```powershell
npm run validate
```

Baseline actual:

- 343 pruebas legacy;
- 49 pruebas de plataforma, Auth, outbox, sincronización y aislamiento;
- 20 pruebas de contratos, incluidos preview/commit de `cv_meta` v10;
- 4 pruebas de game-core;
- 9 pruebas unitarias/handler de Functions;
- 425 pruebas en el gate normal;
- 6 pruebas Auth, 10 de Functions, 21 allow/deny y 1 de TTL/índices;
- build completo;
- smoke web HTTP 200;
- Capacitor Core/CLI/Android/iOS alineados en 8.4.2.

El audit fechado vive en `docs/PROGRESS.md`. No se ejecuta
`npm audit fix --force`: puede proponer downgrades mayores incompatibles. Los
advisories se revisan por impacto y antes de cada despliegue.

Las reglas Firebase son deny-by-default y están cubiertas por 21 tests reales.
Firestore cloud ya usa ese ruleset; RTDB cloud sigue completamente cerrada y su
ruleset granular solo existe localmente. El cliente nunca podrá escribir
directamente economía, resultados verificados o rankings.

## Fuentes de verdad

Ante una contradicción se usa este orden:

1. código ejecutable y pruebas;
2. `docs/design-system/*`;
3. `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` y decisiones v2;
4. `docs/legacy-reference/*`, solo como contexto histórico.

Documentación principal:

- [Roadmap](./ROADMAP.md)
- [Arquitectura](./docs/ARCHITECTURE.md)
- [Modelo de datos](./docs/DATA_MODEL.md)
- [Configuración guiada](./docs/SETUP_INPUTS.md)
- [Alta guiada de Firebase dev](./docs/FIREBASE_DEV_SETUP.md)
- [Matriz de paridad nativa](./docs/NATIVE_PARITY_CHECKLIST.md)
- [Registro de progreso](./docs/PROGRESS.md)
- [Frontend](./apps/client/README.md)
- [Backend](./apps/functions/README.md)
- [Firebase local](./firebase/README.md)

## Próximo paso

Implementar la UI visible de preview/confirmación y ampliar el perfil más allá
de `cv_meta`. Después se configurará App Check en monitor para Web/Android antes
de plantear el primer deploy de Functions. La matriz manual Android, un
dispositivo físico y la plataforma iOS continúan como gates de beta. Todo
despliegue adicional requerirá diff, servicio exacto y nueva autorización.
