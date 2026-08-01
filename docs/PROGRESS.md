# Registro de progreso

Este documento es append-only: cada sesión añade evidencia, decisiones,
pendientes y riesgos. El estado resumido vive en `ROADMAP.md`.

## 2026-07-31 — Inicio de Convergence v2

### Completado

- Se añadió `/Convergence v2/` al `.gitignore` del repositorio actual.
- Se creó `Convergence v2` como repositorio Git anidado con rama `main`.
- Se copió el frontend 2.37.1 a `apps/client/web` sin modificar su runtime.
- Se copiaron tests, herramientas, fuentes, imágenes y fixtures requeridos.
- Se copió completa la fuente visual canónica `docs/design-system`, incluidas
  127 capturas de 390×844.
- Se movieron documentos útiles pero antiguos a `docs/legacy-reference`.
- Se creó el build estático por allowlist hacia `apps/client/dist`.
- Se creó el monorepo npm con cliente, Functions, contratos y game-core.
- Se fijaron Capacitor 8.4.2 y plugins oficiales major 8.
- Se fijaron Firebase web 12.17.0, Admin 14.2.0, Functions 7.3.2 y CLI 15.25.0.
- Se definieron adaptadores Web/Capacitor para storage, haptics, share y red.
- Se añadió repositorio JSON y outbox idempotente, aún no conectados al legacy.
- Se extrajo Mulberry32 compatible con snapshot/restore y un puerto de replay.
- Se añadieron schemas v1 para salas, comandos, snapshots y rankings.
- Se creó Firebase Emulator Suite y reglas cerradas por defecto.
- Se creó una Function `health` protegida por Auth + App Check.
- Se generó `package-lock.json` con las versiones exactas del scaffold.
- Se activó `engine-strict` para impedir futuras instalaciones accidentales con
  un Node distinto del homologado.

### Evidencia

- `node --test "apps/client/web/tests/*.test.js"`:
  **343 tests, 343 pass, 0 fail**.
- `npm test`: **350 tests totales, 350 pass, 0 fail**
  (343 legacy + 3 contratos + 4 game-core).
- `npm run build`: cliente, contratos, game-core y Functions compilan.
- `npm run typecheck`: todos los workspaces pasan después de ajustar la config
  a la API real de Capacitor 8.
- `npm run smoke:web`: el build responde HTTP 200 y carga el HTML esperado.
- `npx cap doctor`: Capacitor Core/CLI/Android/iOS alineados en 8.4.2.
- Los nueve archivos de shell principales coinciden por SHA-256 con el proyecto
  actual; los tres MD entregados coinciden con `docs/design-system`.
- El snapshot conserva versión/cache 2.37.1 y `cv_meta` schema 10.
- Los documentos suministrados en `Desktop/1234` son idénticos a los canónicos
  copiados desde `docs/design-system`.

### Pendiente inmediato

- Cambiar Node 23.4.0 a Node 22.23.2 LTS.
- Reinstalar dependencias normalmente con el runtime homologado.
- Ejecutar `npm run validate` y corregir cualquier incompatibilidad real.
- Reauditar dependencias antes de habilitar un backend desplegable.
- Confirmar application/bundle ID antes de generar `android/` e `ios/`.
- Añadir CI una vez exista el primer commit del repositorio v2.

### No realizado deliberadamente

- No se ha conectado ningún módulo TypeScript a `web/index.html`.
- No se ha creado ni enlazado ningún proyecto Firebase real.
- No se han generado plataformas nativas con un ID provisional.
- No se ha desplegado ni publicado nada.
- No se han tocado los cambios preexistentes del repositorio original.

### Riesgos conocidos

- Node 23 es una rama impar no soportada por el toolchain objetivo.
- `npm install` normal falla en el postinstall de `@firebase/util` bajo Node 23.
  Para verificar código se usó temporalmente `npm install --ignore-scripts`;
  emuladores/CLI no se consideran validados con esa instalación.
- El audit del lockfile reporta 24 avisos transitivos (17 high, 7 moderate);
  13 aparecen también con `--omit=dev`. npm solo propone downgrades mayores
  incompatibles para parte del árbol Firebase, por lo que no se ejecutó
  `audit fix --force`. Es un gate explícito previo a despliegue.
- `RunSave` legacy no guarda el estado RNG y excluye Supervivencia,
  Contrarreloj/Reto y Tutorial.
- Leaderboard y multiplayer actuales son locales/placeholder; no existe backend.
- El checkout actual es `mock-auto`; pagos reales están fuera de esta fase.
- La documentación legacy contiene versiones, schema y conteos obsoletos.

## 2026-08-01 — Homologación del entorno y documentación operativa

### Completado

- Se confirmó la instalación de Node 22.23.2 mediante fnm y npm 10.9.8.
- Se ejecutó una instalación limpia normal con `npm ci`; los postinstall
  finalizaron correctamente y ya no fue necesario `--ignore-scripts`.
- Se ejecutó el gate completo `npm run validate` en verde.
- Se estrecharon los engines a Node `>=22.23.2 <23` y npm
  `>=10.9.8 <11`.
- Se añadieron comandos de auditoría reproducibles y un diagnóstico de
  Capacitor.
- `npm run emulators` construye ahora el monorepo antes de arrancar la suite.
- Functions lee `FUNCTION_REGION` del entorno con fallback provisional a
  `europe-west1`.
- Se documentó el funcionamiento, instalación, arranque, dependencias,
  configuración y límites en los README de raíz, frontend y backend.

### Evidencia

- Runtime usado: Node **22.23.2** y npm **10.9.8**.
- `npm ci`: instalación normal completada, **894 paquetes** añadidos.
- `npm run validate`: typecheck de todos los workspaces, **350/350 pruebas**
  (343 legacy + 3 contratos + 4 game-core), build completo y smoke HTTP 200.
- `npx cap doctor`: Core, CLI, Android e iOS alineados en **8.4.2**.
- Functions Emulator, en modo `--only functions`, cargó `health` con
  **Node 22** y `demo-convergence-v2`, ejecutó el comando de prueba y se cerró
  limpiamente.
- El nuevo `npm run native:gate` rechazó
  `com.example.convergencev2` y pasó con un ID reverse-DNS temporal, sin
  generar Android/iOS.
- `npm audit`: **11 moderate, 0 high, 0 critical**.
- `npm audit --omit=dev`: **7 moderate, 0 high, 0 critical**.

El conteo anterior de 24 avisos, incluidos 17 high bajo Node 23/npm 11, queda
superado por esta instalación homologada. No se ejecutó
`npm audit fix --force`: npm propone downgrades mayores incompatibles para
parte del árbol Firebase. Los avisos moderate continúan como revisión previa a
despliegue.

### Estado del entorno

- `fnm list` marca Node 22.23.2 como versión predeterminada.
- La sesión de Codex se abrió antes del cambio y conserva un `PATH` heredado;
  para la verificación se antepuso explícitamente el binario de Node 22. Una
  sesión nueva debe comprobarse con `node --version` antes de trabajar.
- Firebase CLI está instalado localmente en el proyecto.
- `java` todavía no está disponible en `PATH`; el Emulator Suite completo
  no se considera validado hasta disponer de JDK 21.

### Pendiente inmediato

- Confirmar nombre visible, application/bundle ID y orientación de la app.
- Generar Android con el identificador definitivo y ejecutar la matriz de
  paridad.
- Instalar o exponer JDK 21 y arrancar el Emulator Suite completo.
- Añadir tests de reglas y Functions antes de abrir cualquier escritura.
- Añadir CI tras el primer commit de v2.

## 2026-08-01 — Identidad permanente y shell Android

### Completado

- Se confirmó `Convergence` como nombre visible.
- Se fijó `com.deploy21.convergence` como application/bundle ID permanente,
  sin fallback ni override de entorno.
- Se generó `apps/client/android` con Capacitor 8.4.2.
- `cap add android` copió el artefacto web y descubrió los nueve plugins
  Capacitor instalados.
- Se ejecutó `npm run native:sync` correctamente.
- Android quedó bloqueado en portrait y declarado con categoría `game`.
- SystemBars quedó configurado con insets CSS, barras visibles e iconos claros
  para el fondo oscuro.
- Se corrigieron los tests Android de plantilla para usar el package/ID real.
- Se ignoraron explícitamente properties locales de firma.
- Se creó `docs/NATIVE_PARITY_CHECKLIST.md` con gates funcionales, visuales,
  lifecycle, persistencia, rendimiento y seguridad.

### Evidencia

- Capacitor config, namespace, applicationId, package Java y strings coinciden
  en `com.deploy21.convergence`.
- Android generado: min SDK 24, compile/target SDK 36, AGP 8.13.0,
  Gradle wrapper 8.14.3 y Java source/target 21.
- `cap doctor android`: dependencias instaladas 8.4.2 alineadas y diagnóstico
  Android correcto.
- Tras generar y sincronizar Android, `npm run validate` continúa verde:
  **350/350 pruebas**, typecheck, build y smoke HTTP 200.
- Los assets/config generados por sync permanecen ignorados y se reconstruyen
  desde `apps/client/dist`.
- No existen `google-services.json`, keystores, APK/AAB ni propiedades de
  firma en el árbol.

### Pendiente inmediato

- Instalar Android Studio 2025.2.1+, JDK/JBR 21, SDK 36, Platform-Tools y
  Android Emulator.
- Ejecutar Gradle `assembleDebug`, unit tests y lint.
- Crear un emulador API 36 y ejecutar el smoke instrumentado.
- Ejecutar la matriz de paridad y corregir bridge nativo P0: Service Worker/PWA,
  back, lifecycle, safe areas y Preferences.
- Decidir backup y limitar FileProvider antes de distribuir una beta.
- Generar/configurar iOS cuando exista acceso a macOS/Xcode.

## 2026-08-01 — Auth anónima local y contrato de importación de progreso

### Completado

- Se creó una factory Auth-only que rechaza proyectos sin prefijo `demo-`,
  conecta Auth Emulator antes del login y mantiene la identidad de debug en
  memoria.
- La sesión anónima ofrece login coalescido, observer, logout y estado actual.
- `dist-emulator` añade un único bundle ESM Auth-only con hash y CSP limitada a
  `127.0.0.1:9099`; `dist`, Hosting, PWA y Capacitor siguen sin Firebase.
- El bootstrap publica `convergence:auth-emulator-state` y degrada a `error` sin
  bloquear `native-bridge.js` ni el juego.
- Se añadió E2E real de Auth Emulator: estado inicial, UID/token anónimo, misma
  sesión, proceso nuevo y logout.
- Se añadió smoke en Chrome real para los casos Auth disponible y caída, con
  inspección CDP, REST del emulador, CSP y red limitada a loopback.
- `LegacyProgressImportV1` define un sobre estricto para `cv_meta` schema 10:
  idempotency key, revisión base, UID derivado de Auth y límites de 256 KiB,
  profundidad y nodos.
- El contrato rechaza prototipos, getters, Symbols, campos ocultos, ciclos,
  arrays dispersos, valores no JSON y claves de prototype pollution sin ejecutar
  accesores.
- Los ADR 0005/0006 documentan la política de reconciliación y el aislamiento
  del build Auth. Se preparó la guía `FIREBASE_DEV_SETUP.md` sin crear nube.
- Tras un fallo transitorio de un worker legacy, el runner se limitó a ocho
  procesos paralelos; la repetición aislada y el gate completo confirmaron
  **343/343** sin cambios de gameplay.

### Evidencia

- `npm run validate:full`: **411/411** pruebas, typecheck, builds y smoke HTTP en
  verde; duración observada 83,7 s y cierre limpio de emuladores.
- Gate normal: **381/381** = 343 legacy + 20 plataforma/Auth/build + 12
  contratos + 4 game-core + 2 handler Functions.
- Gate backend: **30/30** = 6 Auth Emulator + 3 Functions Emulator + 21 reglas.
- Chrome 150: Auth conectada `authenticated` con UID anónimo presente en REST;
  Auth apagada `error`; en ambos casos legacy cargado, loader oculto, **0**
  violaciones CSP y ninguna petición HTTP(S)/WS fuera de loopback.
- Bundle Auth-only observado: 108.889 bytes, sin Firestore, RTDB, Functions,
  CDN ni sourcemap. El nombre cambia con el contenido mediante hash.
- `npm run audit:gate`: 11 moderate, 0 high/critical. Producción: 7 moderate,
  0 high/critical. No se aplicaron downgrades forzados.

### Decisiones de progreso

- Economía, cofres, inventario consumible, resultados verificados y rankings
  serán servidor-autoritativos; `cv_meta` local solo formula una reclamación de
  importación.
- Récords pueden fusionarse con `max`; acumuladores usan `max` conservador para
  no duplicar periodos; ownership/logros requieren catálogo + unión; XP,
  equipamiento, rachas y temporales producen conflicto explícito.
- La próxima Function primero previsualizará el conflicto y solo después hará un
  commit idempotente/transaccional. No habrá last-write-wins silencioso.

### Pendiente inmediato

- Implementar preview/commit de importación legacy y perfil/outbox contra
  Emulator Suite.
- Completar el Bloque 0 de `FIREBASE_DEV_SETUP.md` con Project ID, mercado,
  región y presupuesto antes de crear Firebase `dev`.
- Mantener Auth cloud y cualquier deploy bloqueados hasta completar ese gate.
- Completar matriz manual Android/dispositivo físico y preparar iOS en macOS.

## 2026-08-01 — Process death, seguridad Android y tests backend

### Completado

- Las mutaciones de Preferences se serializan; una escritura lenta ya no puede
  sobrescribir un checkpoint posterior.
- El bridge hace checkpoint y flush tras lifecycle, `visibilitychange`,
  `freeze`, `pagehide` y salida explícita, sin copiar JSON corrupto.
- `RunSave` crea un snapshot inicial diferido y otro cada 10 segundos para
  limitar la ventana de pérdida ante un kill sin evento de lifecycle.
- Se añadieron pruebas de background, relaunch, carreras asíncronas, flush al
  salir y checkpoints periódicos: plataforma **10/10**.
- El smoke Android por ADB/CDP arranca el APK sin red, valida runtime nativo,
  portrait, ausencia de PWA/errores fatales y recupera una run real después de
  borrar la copia WebView y forzar la muerte del proceso.
- Android Backup quedó desactivado hasta disponer de reconciliación cloud y el
  FileProvider se restringió a `cache/share/`; `check:android` vigila ambas
  decisiones.
- Functions suma 2 tests directos y 3 tests de protocolo Emulator para Auth y
  App Check.
- Firestore, RTDB y Storage suman **21/21** tests allow/deny sobre el proyecto
  ficticio `demo-convergence-v2`.

### Evidencia

- `npm run validate:full`: **386/386** pruebas entre gate normal y backend,
  typecheck, build y smoke HTTP; todos los emuladores se cerraron limpiamente.
- Legacy: **343/343** tras añadir el checkpoint periódico.
- Functions: handler **2/2**; callable Emulator **3/3** con Node 22.
- Rules: Firestore **9/9**, RTDB **9/9**, Storage **3/3**.
- Android offline/process death: cold start observado entre **2,4 y 3,2 s** en
  `Convergence_API_36`; sin FATAL EXCEPTION ni ANR.
- APK debug actual: 101.754.873 bytes, SHA-256
  `3FFB0933F04A17D21A8A17B0AB26EFA6B6461FED6D35484FBBDC15273344EF98`.
- `npm run audit:gate`: sin vulnerabilidades high/critical; permanecen 11
  moderate ya inventariadas.

### Hallazgo de arquitectura

Las reglas Firestore permiten a un miembro leer `rooms/{id}` y `matches/{id}`
por ruta directa, pero rechazan listar salas incluso con `array-contains uid`.
Antes del lobby se necesita una materialización por usuario o un flujo de acceso
por código; no se abrirá la colección completa para resolverlo.

### Pendiente inmediato

- Conectar Auth anónima y perfil/outbox primero contra Emulator Suite.
- Completar los cinco modos, audio y comparación visual en Android real.
- Preparar con el usuario región, presupuesto, proveedores e ID del proyecto
  Firebase `dev`; no desplegar todavía.

## 2026-08-01 — Bridge nativo P0 conectado

### Completado

- Se añadió `native-bridge.js` como cargador previo del mismo `game.js` legacy.
- Web conserva el arranque y APIs actuales; Android/iOS detectan Capacitor antes
  de inicializar PWA.
- En nativo se desregistran Service Workers/cachés `cv-*` y se oculta el flujo
  de instalación/actualización PWA.
- `cv_meta` y `cv_run` se hidratan desde Preferences antes de evaluar el juego y
  mantienen escritura dual; JSON nativo corrupto se aísla y recupera desde la
  copia WebView válida.
- `App.appStateChange` pausa/guarda/suspende audio en background y nunca reanuda
  gameplay automáticamente.
- `App.backButton` comparte jerarquía de navegación y solo sale desde la raíz
  tras una segunda pulsación.
- Share, Haptics y Network usan plugins nativos con fallback web.
- Todos los usos de safe area priorizan las variables de SystemBars con fallback
  a `env()`, y las barras Android adoptan los fondos oscuros del design system.

### Evidencia

- Nuevo gate: **3/3 pruebas de plataforma**; total del monorepo **353/353**
  (343 legacy + 3 plataforma + 3 contratos + 4 game-core).
- El gate legacy permaneció **343/343** tras conservar sus contratos versionados
  y la jerarquía Escape existente.
- Inspección CDP del WebView API 36: `runtime=native`, App/Preferences presentes,
  `game.js` cargado, pantalla estable y botón Instalar oculto.
- Preferences real devolvió `cv_meta` schema 10 al bridge tras reinstalar el APK.
- Back real: primera pulsación mantuvo `MainActivity`; la segunda volvió al
  launcher; no hubo FATAL EXCEPTION ni ANR.
- Captura de arranque en frío en API 36 confirmó portrait, fondo oscuro desde
  el primer render y contenido separado de las barras del sistema.
- Gradle volvió a pasar assemble con el bridge empaquetado. APK final debug:
  102.495.331 bytes, SHA-256
  `A6501462326C5811667D4A72B0C248892B2233AA01BA9654B14BB550DE5945CB`.

### Riesgo conocido

Capacitor 8.4.2 registra avisos tempranos al intentar inyectar safe-area CSS
antes de crear el DOM. Después aplica padding nativo (WebView 839 CSS px frente
a 915 px de pantalla) y publica variables a 0, por lo que no existe solape en
el emulador. Se revalidará en API 24–28 y dispositivo físico antes de beta.

### Pendiente inmediato

- Añadir checkpoint periódico/atómico para process death y probar una run real
  background → kill → relaunch.
- Ejecutar modos, audio, teclado y diferencias visuales contra los goldens.
- Añadir tests allow/deny de Firebase Rules y tests funcionales de Functions.

## 2026-08-01 — Primer diagnóstico del toolchain Android

### Detectado

- Android Studio instalado en `C:\Program Files\Android\Android Studio`.
- Android SDK, Build-Tools 36.0.0, Platform-Tools/`adb` y Emulator presentes.
- Android Platform 37 instalado, pero falta Platform 36 requerido por el
  proyecto.
- Command-line Tools no está instalado.
- El Android Studio actual incluye JBR 25.0.2, no JBR 21.
- Gradle wrapper 8.14.3 se descargó y `gradlew --version` arrancó con JBR 25.

### Bloqueo reproducido

`assembleDebug` falla antes de configurar el proyecto con
`Unsupported class file major version 69`; Gradle/Groovy no puede procesar el
bytecode de Java 25. Se mantiene JDK 21 como runtime homologado del build.

### Siguiente acción

- Descargar/seleccionar JDK 21 como Gradle JDK.
- Instalar Android Platform 36 y Command-line Tools desde SDK Manager.
- Reejecutar `npm run check:android` y, si queda verde, compilar APK, tests y
  lint.

## 2026-08-01 — Toolchain Android, APK y Emulator Suite validados

### Completado

- `npm run check:android` confirmó Android Studio, JBR 21.0.11, SDK/API 36,
  Platform-Tools, Emulator y Command-line Tools.
- Se sincronizaron de nuevo el artefacto web y los nueve plugins Capacitor.
- Gradle generó el APK debug y pasó unit test y lint.
- Se instaló la imagen `system-images;android-36;google_apis;x86_64` y se creó
  el AVD `Convergence_API_36` (Pixel 7, Android 16/API 36, 1080×2400).
- El test instrumentado pasó dentro del emulador.
- El APK se instaló, abrió `com.deploy21.convergence/.MainActivity` en portrait
  y permaneció activo sin `FATAL EXCEPTION` ni ANR.
- Se añadió `npm run emulators:smoke` y se validó la Emulator Suite completa
  con el proyecto ficticio `demo-convergence-v2`.

### Evidencia

- Gradle: `assembleDebug`, `testDebugUnitTest` y `lintDebug` — **BUILD
  SUCCESSFUL**, 490 tareas; test unitario **1/1**.
- Lint: **0 fatal, 0 error, 18 warnings**; los avisos no bloqueantes proceden
  principalmente de dependencias/plugins Capacitor.
- Instrumentación: `connectedDebugAndroidTest` — **1/1**, Android 16/API 36.
- APK: versión 1.0 (`versionCode` 1), **97,04 MB**, SHA-256
  `B235E2EF2767437B491327581D2DDA5EE40CCE99DB346CBDEEDBDAC3045FF7C6`.
- Firebase smoke: Auth 9099, Functions 5001, Firestore 8080, RTDB 9000,
  Hosting 5000 y Storage 9199 accesibles; Hosting HTTP 200 y `health`
  anónima rechazada con HTTP 401. Los emuladores se cerraron limpiamente.

### Pendiente inmediato

- Ejecutar la matriz funcional/visual manual y corregir el bridge P0:
  Service Worker/PWA, back, lifecycle, safe areas y Preferences.
- Añadir tests allow/deny de reglas y tests funcionales de Functions.
- Validar en al menos un dispositivo Android físico antes de beta.
- Generar/configurar iOS cuando exista acceso a macOS/Xcode.

## 2026-08-01 — Proyecto Firebase `dev` identificado y enlace local preparado

### Completado

- El propietario creó/confirmó `convergence-d1a35`, project number
  `98627547554`, con nombre visible `Convergence`.
- Cloud Firestore `(default)` quedó confirmado en `europe-west1` (Bélgica).
- Se decidió crear Realtime Database también en `europe-west1`, en modo
  bloqueado, para alinear la primera vertical europea.
- `.firebaserc` local e ignorado registra `dev → convergence-d1a35`; el alias
  `default` continúa en `demo-convergence-v2` para evitar acciones cloud
  accidentales.
- `.firebaserc.example`, roadmap y guías se actualizaron con los identificadores
  públicos y los gates restantes.
- Firebase CLI local 15.25.0 está instalada. `login:list` confirmó que todavía
  no hay una cuenta autorizada.

### Decisiones de seguridad

- No ejecutar `firebase init`: `firebase.json` ya contiene la configuración
  revisada y podría ser sobrescrita por el asistente.
- No sustituir `demo-convergence-v2` en tests ni en la factory Auth local. La
  integración cloud tendrá factory/bootstrap y build de desarrollo separados.
- No desplegar Hosting, Functions, índices o reglas durante el enlace inicial.
- No solicitar cuentas de servicio, contraseñas ni tokens. El propietario
  completará `firebase login` directamente en su navegador.

### Pendiente inmediato del propietario

- Ejecutar `npm exec -- firebase login` en la raíz de `Convergence v2` y
  confirmar que terminó la autorización.
- Crear RTDB en Bélgica (`europe-west1`) con **locked mode** y facilitar solo su
  URL pública.
- Confirmar mercado inicial, presupuesto/alertas, Analytics y Auth anónima.

### Siguiente acción técnica

- Verificar acceso de solo lectura a `convergence-d1a35` mediante CLI.
- Inventariar o registrar las apps Web y Android sin activar Hosting.
- Obtener su configuración oficial y construir un runtime cloud `dev` aislado,
  manteniendo intactas las builds legacy, Emulator, PWA y Capacitor actuales.

## 2026-08-01 — Auth cloud `dev` y cierre de Firestore

### Completado

- Firebase CLI quedó autorizada y se verificó acceso al proyecto
  `convergence-d1a35` sin mostrar tokens.
- Se confirmó RTDB activa en `europe-west1` y cerrada en nube con
  `.read: false`/`.write: false`.
- Se registraron `Convergence Web Dev` y `Convergence Android Dev`; no se activó
  Hosting. Sus App IDs y el package `com.deploy21.convergence` se validan de
  forma estricta.
- `firebase-config.dev.json` y `google-services.json` se descargaron a rutas
  ignoradas. Gradle `:app:processDebugGoogleServices` pasó con JBR 21.
- Se añadió `dist-cloud-dev`, separado de `dist`, Hosting y Capacitor. El bundle
  ESM importa solo Auth y su CSP permite exclusivamente Identity Toolkit y
  Secure Token.
- El build valida metadatos y la huella SHA-256 de la API key pública registrada
  sin imprimirla ni copiar el JSON fuente.
- Auth anónima cloud quedó verde por API y navegador real. El smoke crea y
  elimina su propia identidad en una Firebase App única y solo en memoria.
- Analytics está activo en el proyecto, pero el bundle Web cloud-dev no incluye
  el SDK Analytics. Android no incluye `firebase-analytics`; Messaging e
  Installations aparecen por el plugin Push reservado.
- Tras autorización explícita del propietario se desplegó **solo** Firestore
  Rules. Las lecturas privadas externas devuelven 403; `publicConfig` y entries
  de leaderboards permanecen públicas por diseño.
- Se documentó que todo campo de una entry de leaderboard es público y que las
  señales antifraude/telemetría privada deben vivir en otra colección.
- Se añadió el ADR 0007 y se actualizaron roadmap, arquitectura, modelo de
  datos, guías y README de raíz/frontend/backend/Firebase.

### Endurecimiento encontrado durante la validación

- Dos tests de build competían por `dist` en Windows y provocaban `EPERM`. La
  suite de plataforma ahora usa concurrencia 1.
- El test cloud escribía una API key de fixture sobre la preview real. Ahora
  compila en `apps/client/test/.tmp` y limpia esa salida.
- El primer smoke de navegador podía reutilizar una sesión anónima persistente.
  Ahora exige una app única, estado vacío y persistencia solo en memoria antes
  de borrar exactamente el usuario recién creado.
- La validación de configuración aceptaba una API key con formato correcto pero
  de otro proyecto. El build real exige la huella exacta de la app Web dev.

### Despliegue cloud registrado

Comando autorizado y ejecutado:

```powershell
npm exec -- firebase deploy --only firestore:rules --project dev --non-interactive
```

No se desplegaron índices, RTDB Rules, Storage, Functions o Hosting. Las reglas
RTDB granulares siguen exclusivamente en el repositorio/emuladores; la instancia
cloud permanece totalmente cerrada.

### Evidencia

- `npm run validate:full`: **419/419** pruebas, typecheck, builds y smoke HTTP.
- Gate normal: **389/389** = 343 legacy + 28 plataforma/Auth/builds + 12
  contratos + 4 game-core + 2 Functions unitarias.
- Gate backend: **30/30** = 6 Auth Emulator + 3 Functions Emulator + 21 reglas.
- Auth cloud unitario: **7/7**; aislamiento del build cloud: **1/1**.
- Navegador real: estado `deleted`, UI legacy en login, bundle hasheado correcto,
  CSP exacta y `game.js` cargado.
- Build real cloud-dev regenerada después de los tests con su configuración
  oficial; el test ya no puede sobrescribirla.
- `npm run audit:gate`: verde para severidad high; quedan 11 advisories moderate
  transitivos. No se aplicó `--force` porque propone cambios incompatibles.

### Pendiente inmediato

- Implementar previsualización/commit de importación `cv_meta` v10 y perfil con
  revisión contra Emulator Suite.
- Implementar outbox idempotente, backoff y resolución explícita de conflictos.
- Confirmar mercado, presupuesto/alertas y protección contra borrado de
  Firestore.
- Configurar App Check en monitor antes del primer deploy de Functions.
- Registrar/compilar iOS cuando haya acceso a macOS/Xcode.

## 2026-08-01 — Vertical local de perfil e importación legacy

### Completado

- Se implementaron contratos estrictos para preview, proyección y commit de
  `cv_meta` schema 10. UID y `operationId` se derivan de Auth; el commit no
  vuelve a recibir payload ni identidad.
- `previewLegacyProgressImport` y `commitLegacyProgressImport` exigen Auth + App
  Check, revisión base, plan inmutable, confirmación explícita e idempotencia
  transaccional. Solo se permite una importación por cuenta, una preview activa
  y tres creaciones por hora/UID.
- El perfil guarda una reclamación `untrusted-client`/`unverified`; economía,
  cofres, premios y scores ranked no entran en `users/{uid}`.
- El raw se separó del tombstone: `legacyImportPreviews` conserva hashes para
  impedir reusar la key y `legacyImportPayloads` contiene JSON canónico con
  `deleteAt`. TTL sobre ese campo y la exclusión de índice de `payloadJson`
  quedaron versionados en `firestore.indexes.json`, aún sin deploy cloud.
- Se añadieron invariantes cruzadas de documentos internos, rechazo controlado
  de claves top-level extremas y fallo cerrado ante un profile schema futuro.
- `JsonRepository` y Outbox v2 incorporan validación runtime, cuarentena de JSON
  corrupto, owner UID, operaciones serializadas, leases, recuperación tras
  process death, backoff/jitter/`Retry-After` y estados terminales separados.
- El coordinador local captura una copia inmutable de `cv_meta`, nunca sustituye
  el `Meta` vivo y espera confirmación. El burst de guardados del primer arranque
  se coalesce en una sola preview.
- Se creó `dist-profile-emulator`, con bundle hasheado y CSP limitada a Auth
  `9099` y Functions `5001`; no modifica `dist`, Hosting ni Capacitor. El ADR
  0008 registra su aislamiento.

### Evidencia

- `npm run validate:full`: **463/463** pruebas, typecheck, builds, smoke HTTP y
  cierre limpio de emuladores.
- Gate normal: **425/425** = 343 legacy + 49 plataforma/Auth/sync/builds + 20
  contratos + 4 game-core + 9 handlers Functions.
- Gate backend: **38/38** = 6 Auth Emulator + 10 Functions Emulator + 21
  allow/deny + 1 invariante TTL/índices.
- Navegador real desde origen limpio: `awaiting-confirmation` → `synced`, revisión
  0 → 1 y recarga en `synced` sin segundo commit. Firestore mostró claim no
  verificado, ninguna moneda, tombstone sin raw, payload string con Timestamp TTL
  y receipt coincidente.
- Se probaron además concurrencia de previews, cuota, caducidad, tombstone tras
  borrado simulado por TTL, corrupción preview/receipt y schema futuro.
- **No se desplegó ningún servicio cloud en este bloque.** Firestore conserva
  únicamente el deploy previo de Rules; Functions, índices/TTL, RTDB Rules,
  Storage y Hosting siguen sin desplegarse.

### Pendiente inmediato

- Diseñar la UI visible de preview/confirmación, conflictos y recuperación de
  `identity-mismatch`; la API actual es solo un harness local.
- Definir el perfil multidispositivo y contratos para datos fuera de `cv_meta`
  (`cv_best`, `cv_profile`, `cv_user` y settings).
- Antes de Functions cloud: presupuesto/alertas, protección contra borrado,
  despliegue/verificación TTL, App Check en monitor y controles de abuso más allá
  de la cuota por UID anónimo.
- Continuar RunSave/core determinista, matriz Android e iOS desde macOS/Xcode.
