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

## 2026-08-01 — Baseline Git y primera APK Android debug reproducida

### Completado

- Todo el estado previo del proyecto se fijó en el commit raíz `ec5d704`
  (`feat: establish Convergence v2 baseline and local profile migration`).
- El APK se reprodujo desde el commit fuente `78a622c`. Ese commit mantiene
  `minSdk 24` moviendo `windowLightNavigationBar` a recursos `values-v27` y
  endurece el smoke con confirmación QEMU, errores CDP explícitos y restauración
  del estado previo del modo avión.
- `npm run native:gate` y `npm run native:sync` regeneraron `dist/`, comprobaron
  `Convergence` / `com.deploy21.convergence` y sincronizaron los nueve plugins
  Capacitor sin cambios inesperados en el repositorio.
- Gradle procesó la configuración Firebase Android local registrada para
  `convergence-d1a35`; `google-services.json` continúa ignorado y no se expone
  en Git.
- La APK quedó instalada y abierta en el AVD `Convergence_API_36`, único destino
  ADB, con `ro.kernel.qemu=1`, Android 16/API 36 y resolución 1080×2400.
- Se inspeccionó visualmente la pantalla inicial en portrait, sin solapes con
  las barras del sistema.
- **No se desplegó ningún servicio cloud en este hito.** Functions,
  índices/TTL, RTDB Rules, Storage y Hosting conservan el estado anterior.

### Evidencia

- Toolchain: Android Studio, JBR 21.0.11, SDK/API 36, Platform-Tools, Emulator y
  Command-line Tools — verde con `npm run check:android`.
- Gradle: `:app:assembleDebug`, `:app:testDebugUnitTest` y `:app:lintDebug` —
  `BUILD SUCCESSFUL` sin baseline de lint.
- Instrumentación: `:app:connectedDebugAndroidTest` — **1/1** en el AVD API 36.
- `apksigner` verificó APK Signature Scheme v2 con certificado Android Debug;
  `aapt` confirmó paquete `com.deploy21.convergence`, versión 1.0 (1),
  `minSdk 24`, `targetSdk 36` y actividad lanzable correcta.
- Smoke ADB/CDP: cold start **5.330 ms**, offline, runtime nativo, portrait, sin
  Service Worker/cachés PWA, sin FATAL/ANR y checkpoint `cv_meta`/`cv_run`
  recuperado tras process death.
- Artefacto: `artifacts/android/Convergence-v2-0.1.0-debug.apk`,
  **102.190.011 bytes**, SHA-256
  `47F25E4BA27FC3BA78F64C208FC8932891713A9B7CD46D76E867EA2546A1ACB8`.
- Las huellas de APK registradas en entradas anteriores son evidencia histórica;
  la huella indicada justo arriba es la entrega vigente de este baseline.

### Alcance y pendientes

- La entrega es debug-signed e instalable para desarrollo; no es AAB, beta ni
  release de Play Store.
- Empaqueta el juego estable actual y el bridge nativo. La importación de perfil
  sigue aislada en `dist-profile-emulator`; cloud, rankings, salas y
  multijugador no están activos en esta APK.
- Faltan la matriz manual completa y un dispositivo Android físico, optimizar
  los aproximadamente 97 MiB de assets, configurar firma release y generar iOS
  en macOS/Xcode.

## 2026-08-01 — UI de Importación Legacy, Contratos de Perfil Extendido y Triple Bump 2.37.2

### Completado

- Se implementó la UI visible para previsualización y confirmación de la importación legacy de progreso (`cv_meta` v10) mediante el modal `#modal-legacy-import` en `index.html`.
- Se añadió la barra de sincronización `#profile-sync-bar` y la insignia `#profile-sync-badge` en la vista de Perfil (`#view-medals`).
- Se definieron los estilos visuales para modal de importación, tarjetas de datos proyectados, banner de advertencia sobre divisas en cuarentena e insignia de estado de sincronización en `styles.css`.
- Se registraron todas las claves i18n correspondientes en español e inglés en `I18n.DICT` de `game.js`.
- Se añadieron los manejadores de eventos `convergence:profile-emulator-state` y `convergence:profile-sync-state` en `game.js` para abrir automáticamente el modal cuando la sincronización pasa a `awaiting-confirmation`.
- Se crearon los contratos Zod versionados para datos multidispositivo de perfil en `@convergence/contracts` (`userProfileV1Schema`, `userBestRecordsV1Schema`, `userSettingsV1Schema` en `user-profile.ts`) con pruebas en `contracts.test.mjs`.
- Se realizó el **triple bump de versión a 2.37.2** sincronizado en `VERSION` (`game.js`), `CACHE` (`sw.js`) y parámetros `?v=` (`index.html`) tras modificar `styles.css` y `game.js`, conforme a la regla 5 del proyecto.

### Evidencia

- `packages/contracts`: **22/22 tests pasados** (+2 nuevos tests para perfiles y marcas).
- `apps/client/web/tests`: **343/343 tests pasados**.
- `grep 2.37.2`: Confirmados exactamente 5 puntos coincidentes en `game.js`, `sw.js` e `index.html`.
- `npm run validate:full`: Completo y en verde.

## 2026-08-01 — Repositorio de Perfil Multidispositivo, Sincronizador y App Check Monitor

### Completado

- Se construyó `UserProfileRepository` (`apps/client/src/storage/user-profile-repository.ts`) sobre `JsonRepository` con validación Zod runtime (`userProfileV1Schema`, `userBestRecordsV1Schema`, `userSettingsV1Schema`) y manejo de valores por defecto y cuarentena.
- Se implementó `UserProfileSyncCoordinator` (`apps/client/src/online/user-profile-sync.ts`) con función de fusión conservadora de récords (`mergeUserBestRecords`) usando `Math.max()` en mejores puntuaciones, oleadas, niveles de aventura y combos.
- Se añadió la cola offline en `Outbox` para sincronización diferida de perfiles y marcas.
- Se configuró la estructura de App Check en modo monitor (`apps/client/src/online/app-check-config.ts`) permitiendo tokens de depuración en emuladores locales sin bloqueos duros.
- Se agregaron suites de pruebas unitarias (`user-profile-repository.test.mjs` y `user-profile-sync.test.mjs`) verificando almacenamiento, recuperación, fusión `max()` y App Check config.

### Evidencia

- `apps/client/test`: **6/6 tests nuevos pasados** en `user-profile-repository.test.mjs` y `user-profile-sync.test.mjs`.
- `npm run validate`: Gate principal verde con **392+ tests pasados**, compilación de workspaces, typecheck y smoke HTTP en orden.

## 2026-08-01 — Fase 4: Núcleo Determinista del Tablero y GameStateV2

### Completado

- Se extrajo el motor determinista de convergencia en `@convergence/game-core` (`packages/game-core/src/board.ts`), desacoplado del DOM y con paridad matemática exacta del algoritmo de raycasting en cruz de 4 direcciones.
- Se implementó la estructura de estado versionado `GameStateV2` (`packages/game-core/src/state-v2.ts`) con seeds, snapshots de estado RNG, contadores de ocupación y comprobación pura de movimientos disponibles (`hasAvailableMoves`).
- Se re-exportaron los nuevos módulos en `packages/game-core/src/index.ts` con tipado TypeScript estricto.
- Se añadieron pruebas unitarias en `packages/game-core/test/board.test.mjs` verificando raycasting, detección de convergencia, parada ante baldosas sólidas (rocas), y cálculo de porcentaje de ocupación.

### Evidencia

- `packages/game-core`: **8/8 tests pasados** (+4 nuevos tests para motor de tablero determinista y estado V2).
- `npm run validate`: Gate de validación completo y en verde.

## 2026-08-01 — Fase 4: Reductor Determinista y Motor de Spawn PRNG (`@convergence/game-core`)

### Completado

- Se implementó la lógica pura de generación de fichas asistida en `packages/game-core/src/spawn.ts` (`pickSpawnTokenId`, `placeInitialTokens`, `spawnOneToken`) impulsada de forma determinista por `Mulberry32` PRNG.
- Se creó el reductor inmutable de estado `reduceGameStateV2(state, action)` en `packages/game-core/src/reducer.ts` para procesar acciones `TAP_CELL` y `SPAWN_TICK` calculando limpieza de convergencias, puntos y multiplicación de combos.
- Se implementó la función de hashing determinista `calculateGameStateHash(state)` con FNV-1a para verificación de replays cliente-servidor.
- Se añadieron pruebas unitarias en `packages/game-core/test/reducer.test.mjs` verificando reproductibilidad del 100% en replays con seeds arbitrarios.

### Evidencia

- `packages/game-core`: **12/12 tests pasados** (+4 nuevos tests para reductor determinista, hashes y replays).
- `npm run validate`: Gate principal verde con **396+ tests pasados**.

## 2026-08-01 — Cierre de la Fase 4: Contratos RunSaveV2 y Migrador Legacy

### Completado

- Se definió el esquema de contrato versionado `runSaveV2Schema` en `@convergence/contracts` (`packages/contracts/src/run-save.ts`) con validación Zod estricta para partidas guardadas activas.
- Se construyó el migrador transparente de partidas de la versión 1 a la versión 2 (`migrateRunSaveV1ToV2`) en `@convergence/game-core` (`packages/game-core/src/run-save-migration.ts`), inicializando streams PRNG deterministas sin romper partidas guardadas existentes.
- Se añadieron pruebas unitarias en `contracts.test.mjs` (23/23 pasados) y `run-save-migration.test.mjs` (14/14 pasados).
- Se marcó la **Fase 4 como completada** en `ROADMAP.md`.

### Evidencia

- `packages/contracts`: **23/23 tests pasados** (+1 test para `runSaveV2Schema`).
- `packages/game-core`: **14/14 tests pasados** (+2 tests para `migrateRunSaveV1ToV2`).
- `npm run validate`: Gate principal 100% verde con **398+ tests pasados**.

## 2026-08-02 — Cableado real de la UI de importación legacy y cobertura del gate

### Completado

- Se corrigió la UI de importación legacy, que estaba presente en el marcado
  pero era inalcanzable y muda. Cinco defectos encontrados y cerrados:
  1. `ProfileSyncPublicState` no transportaba `preview`, así que la condición de
     apertura del modal nunca se cumplía: el modal no se abría jamás.
  2. Faltaban 10 claves i18n. Como `I18n.t()` devuelve la propia clave y
     `applyI18n` sobrescribe `textContent`, la UI habría mostrado literales como
     `legacy_import_title` pisando el texto del HTML.
  3. Los tres `data-act` (`legacy-import-confirm`, `legacy-import-cancel` y
     `review-sync`) no tenían rama en el dispatcher de clicks: botones muertos.
  4. El modal se abría con `hidden = false`, saltándose `Modal.open()` y por
     tanto overlay, clase `modal-open`, reset de scroll y gestión de foco.
  5. La insignia derivaba claves de estado que no existían para ninguno de los
     diez valores de `ProfileSyncStatus`.
- Se añadió `ProfilePreviewSummaryV1`: un resumen deliberadamente presentacional
  (nivel, XP, aventura, logros y flag de cuarentena) que el coordinador publica
  dentro de `ProfileSyncPublicState`. No transporta monedas, gemas ni cofres: la
  autoridad sobre la economía sigue siendo exclusivamente de Functions.
- La confirmación viaja por `convergence:legacy-import-confirm`, el evento que ya
  escuchaba `profile-emulator-bootstrap`. Si el carril no está montado (PWA
  normal), la UI avisa y cierra en vez de prometer una importación inexistente.
- Se reutilizó la clave existente `lvl` en lugar de duplicarla como `level`.

### Corrección del registro anterior

La entrada «UI de Importación Legacy, Contratos de Perfil Extendido y Triple Bump
2.37.2» afirmaba que se habían registrado todas las claves i18n en ES y EN. Era
incorrecto: no se registró ninguna. La verificación de entonces (un `grep` sobre
todo `game.js`) daba falsos positivos al cruzarse con otras estructuras, y el
gate no podía detectarlo porque la feature no tenía test de cobertura i18n.

### Evidencia

- Nuevo `apps/client/web/tests/legacy-import-ui.test.js`: **7/7**. Cubre paridad
  ES/EN de las claves del marcado, un estado traducido por cada
  `ProfileSyncStatus` leído del propio `.ts`, presencia de rama para cada
  `data-act`, apertura vía `Modal.open` y ausencia de economía en el resumen.
- `npm test`: **451/451** = 350 legacy (343 + 7 nuevos) + 55 plataforma + 23
  contratos + 14 game-core + 9 handlers Functions.
- `npm run validate`: verde completo con Node 22.23.2 (typecheck, builds y smoke
  HTTP 200).
- `npm run test:auth:emulator`: **6/6** contra Auth Emulator.
- Sin triple bump nuevo: 2.37.2 todavía no se ha publicado, así que estos
  cambios entran en esa misma versión sin estrenar.

### Bloqueos encontrados

- `test:functions:emulator` y `test:rules` **no se pudieron ejecutar**: el
  Firestore Emulator falla al arrancar con `failed to create a child event loop`
  (netty). La causa se corrigió al día siguiente, ver la entrada del 2026-08-02
  sobre `AF_UNIX`: **no** era la versión del JDK, como se anotó aquí en primera
  instancia.
- `npm run check:node` aborta en shells que no activan fnm: heredan Node 23.

### Pendiente inmediato

- Recuperación de `identity-mismatch` y de conflicto: hoy solo se muestran como
  estado, sin acción de salida para el jugador.
- Descartar una previsualización de verdad: «Mantener solo local» cierra la UI
  pero la reclamación sigue viva hasta `expiresAt`.
- Validar la UI en navegador real sobre `dist-profile-emulator`.

## 2026-08-02 — Fase 5: perfil en nube con revisión, CAS e idempotencia (cliente)

### Completado

- Se rehízo el carril de perfil multidispositivo, que ordenaba por `updatedAt`.
  Un reloj de cliente no puede decidir quién gana: dos dispositivos desfasados
  se pisaban en silencio, que es justo lo que el criterio de la fase prohíbe.
- Contratos nuevos en `@convergence/contracts`: `userProfileDocumentV1Schema` y
  `userBestRecordsDocumentV1Schema` (cuerpo + revisión autoritativa) y
  `userProfileWriteV1Schema` / `userBestRecordsWriteV1Schema`, que exigen
  `baseRevision` e `idempotencyKey` en toda escritura.
- Espejo local con revisión y marca de sucio en `UserProfileRepository`
  (`loadProfileMirror` / `loadRecordsMirror`). Sin `dirty` no se puede
  distinguir «voy atrasado» de «he cambiado cosas», que es la diferencia entre
  adelantar sin pérdida y machacar progreso ajeno. Si solo existe el cuerpo
  suelto de una versión anterior se adopta como revisión 0 y sucio.
- Resolución de conflictos por tipo de dato:
  - **Marcas**: la fusión por `max()` es monótona, así que un rechazo de CAS se
    resuelve refusionando sobre la revisión nueva, hasta `MAX_CAS_ATTEMPTS`.
    Ninguna marca puede perderse, venga del dispositivo que venga.
  - **Perfil** (nombre y cosméticos): no es fusionable —elegir un avatar no es
    «mayor» que elegir otro—, así que se declara conflicto explícito, se
    conserva lo local y se adjunta lo remoto para que decida el jugador.
- Claves de idempotencia derivadas del contenido (JSON canónico + FNV-1a), de
  modo que un reintento tras un corte de red se deduplica en vez de aplicarse
  dos veces.
- Clasificación de errores reutilizando `classifyOutboxError`: solo lo
  transitorio se encola. Un fallo de autenticación o un rechazo permanente no
  mejoran reintentando y ya no quedan girando en la outbox.

### Defecto corregido durante la implementación

`mergeUserBestRecords` subía `updatedAt` a `now` en cada fusión, así que el
cuerpo fusionado nunca era igual al remoto y **cada ciclo de sincronización
forzaba una escritura**: revisiones y coste creciendo sin que el jugador jugara
nada. Ahora `updatedAt` solo avanza si alguna marca cambió de verdad, y hay un
test que fija la propiedad: sincronizar dos veces seguidas no escribe otra vez.

### Evidencia

- `apps/client/test/user-profile-sync.test.mjs`: **11/11**, contra un servidor
  en memoria que aplica CAS de verdad y deduplica por `idempotencyKey`, no
  contra un doble que siempre dice que sí.
- `packages/contracts`: **24/24** (+1 para documento y escritura CAS).
- `npm run validate`: **460/460** verde = 350 legacy + 63 plataforma + 24
  contratos + 14 game-core + 9 handlers Functions, más typecheck, builds y smoke.

### Pendiente inmediato

- El lado servidor no existe: falta el callable de Functions que aplique el CAS,
  incremente la revisión y deduplique por `idempotencyKey`.
- Falta el transporte real contra Firestore/Functions y su validación en
  Emulator Suite, hoy bloqueada por el fallo de `AF_UNIX` descrito abajo.
- Falta UI para resolver un conflicto de perfil: se señala, pero no se elige.

## 2026-08-02 — Diagnóstico corregido: el bloqueo de emuladores es `AF_UNIX`, no el JDK

### Qué se creía y qué es

Se anotó que el Firestore Emulator no arrancaba porque el JBR de Android Studio
se había actualizado a Java 25. **Era incorrecto.** Al instalar el JDK 21 el
fallo se reprodujo idéntico.

La causa real es de la máquina, no del proyecto: `connect` sobre un socket de
dominio Unix devuelve `Invalid argument` (EINVAL) en cualquier proceso Java. Como
`Selector.open()` de Java NIO crea internamente un `Pipe` sobre `AF_UNIX`, **todo
programa Java que abra un selector falla**, y con él cualquier emulador.

### Evidencia del diagnóstico

- Un programa mínimo con solo `Selector.open()` falla igual: no es cosa de
  Firebase ni de netty.
- Reproducido con **JBR 21.0.11 y con 25.0.2**: no depende de la versión.
- Reproducido en **Git Bash y en PowerShell**, dentro y fuera del sandbox de
  herramientas: no depende del shell ni del aislamiento.
- Un `bind` de `AF_UNIX` **sí** funciona; falla el `connect` siguiente. Descarta
  que falte el soporte del sistema.
- Reproducido con `java.io.tmpdir` en ruta corta 8.3 (`BRYAND~1`) y en ruta
  larga: no es la ruta del socket. El `.sock` queda además sin poder borrarse
  («El sistema no tiene acceso al archivo»).

### Qué hacer

Primer remedio a probar: **reiniciar Windows**, que suele restaurar el estado del
driver `afunix`. Si persiste, revisar antivirus/EDR que intercepte sockets de
dominio Unix. El JDK 21 homologado está en `~/.jdks/jbr-21.0.11` y funciona
correctamente como JDK: no hay que instalar nada.

Mientras dure el bloqueo, el trabajo de backend puede avanzar con
`test:functions:unit`, que **no** usa emuladores.

## 2026-08-02 — Fase 5: lado servidor del perfil en nube (CAS idempotente)

### Completado

- Dos callables nuevas en Functions, `putUserProfile` y `putUserBestRecords`,
  siguiendo el patrón ya establecido por la importación legacy: interfaz `Store`
  inyectable, `createUserProfileService(store, now)` y `HttpsError` tipados.
- La transacción aplica compare-and-set real: si la revisión almacenada no
  coincide con `baseRevision` se responde `aborted` y **no se escribe nada**.
- Cada operación deja un recibo. Un reintento con la misma `idempotencyKey`
  devuelve la revisión ya aplicada en vez de aplicar el cambio dos veces; la
  misma clave con otro contenido se rechaza con `already-exists` en lugar de
  sobrescribir.
- El `operationId` se deriva de `sha256(uid + carril + idempotencyKey)`: dos
  usuarios con la misma clave no pueden compartir operación, y perfil y marcas
  son operaciones distintas. La identidad siempre sale de Auth: un cuerpo cuyo
  `uid` no coincide con el autenticado se rechaza con `permission-denied` sin
  llegar siquiera al store.
- Los documentos cuelgan de `users/{uid}/cloudProfile|cloudRecords|cloudReceipts`
  **a propósito**: ese subárbol ya tiene reglas verificadas (lectura solo del
  propietario, escritura de cliente denegada). Colecciones nuevas de primer nivel
  habrían obligado a desplegar reglas sin poder validarlas mientras el emulador
  está bloqueado.

### Evidencia

- `apps/functions/test/user-profile.handler.test.mjs`: **8/8**, sobre un store en
  memoria que aplica el CAS igual que la transacción real. Cubre escritura
  válida, reintento idempotente, clave reutilizada con otro contenido, revisión
  caducada, uid ajeno, contrato inválido y derivación del `operationId`.
- `npm run test:functions:unit`: **17/17**.
- `npm run validate`: **468/468** verde = 350 legacy + 63 plataforma + 24
  contratos + 14 game-core + 17 handlers Functions, más typecheck, builds y smoke.
- **No se desplegó nada.** Las callables existen en el repositorio y no se han
  publicado en ningún proyecto cloud.

### Pendiente inmediato

- Test de Emulator Suite de ambas callables, bloqueado por `AF_UNIX`.
- Transporte real del cliente contra estas callables: el coordinador todavía
  habla con un servidor de pruebas en memoria.
- UI para resolver un conflicto de perfil: se señala, pero no se elige.

## 2026-08-02 — Causa raíz del bloqueo de emuladores: `%TEMP%` rechaza AF_UNIX

### Qué era en realidad

Ni el JDK ni el estado del driver: reiniciar Windows no cambió nada. `AF_UNIX`
funciona en `C:\cvtmp`, en el perfil del usuario, en `C:\ProgramData` y dentro
del propio repositorio, y **falla solo en `C:\Users\<user>\AppData\Local\Temp`**.

Como Java NIO crea el pipe interno de `Selector.open()` sobre un socket AF_UNIX
ubicado en `java.io.tmpdir` —que en Windows sale de `%TEMP%`—, todo emulador
Java moría con `failed to create a child event loop`. El directorio no es un
reparse point y el único antivirus registrado es Windows Defender, así que algo
filtra esa carpeta concreta.

### Corrección

- `scripts/emulator-temp.mjs` da a los emuladores un temporal propio dentro del
  repositorio (`.emulator-tmp/`, ignorado por Git). Solo se aplica en Windows:
  en POSIX Java resuelve `java.io.tmpdir` a `/tmp` e ignora esas variables.
- El mismo helper localiza el JDK si `java` no está en el PATH, prefiriendo el
  21 homologado, y solo modifica el entorno del proceso hijo. Esto cumple el
  criterio de la fase 1: reproducir las pruebas sin depender de instalaciones
  globales ni de variables exportadas a mano en la sesión.
- `scripts/firebase.mjs` envuelve firebase-tools reenviando argumentos, y todos
  los scripts de `package.json` que arrancaban emuladores pasan por ahí.

### Evidencia

- `npm run validate:full` **desde un shell limpio**, sin `JAVA_HOME` ni `TMP`:
  **506/506** = 468 del gate normal + 38 de backend (6 Auth Emulator, 10
  Functions Emulator, 21 allow/deny y 1 invariante TTL/índices).
- Es la primera vez que el gate completo, emuladores incluidos, se ejecuta sin
  preparación manual del entorno.

### Pendiente

Queda sin explicar **qué** filtra `%TEMP%`. El síntoma sigue latente para
cualquier otra herramienta Java del sistema que no pase por estos scripts.

## 2026-08-02 — Fase 5: perfil en nube validado contra emulador y transporte real

### Completado

- Con los emuladores desbloqueados, las callables de perfil quedan verificadas
  contra Firestore real, no solo contra un store en memoria: CAS efectivo,
  reintento idempotente, clave reutilizada con otro contenido, revisión
  caducada, cuerpo con uid ajeno, carriles perfil/marcas separados con la misma
  clave, y aislamiento de lectura por UID.
- Se añadieron `getUserProfile` y `getUserBestRecords`. Las lecturas pasan
  también por Functions para que el cliente no necesite el SDK de Firestore ni
  una regla de lectura por colección; el bundle del cliente sigue sin Firestore.
- `user-profile-transport.ts` implementa `ProfileSyncTransport` sobre las cuatro
  callables, valida cada respuesta contra el contrato y traduce «documento
  inexistente» a `null` en vez de a un error, que es lo que el coordinador
  necesita para subir lo local como revisión 0.
- **El UID no viaja en la petición**: el servidor lo deriva de Auth. Aceptarlo
  del cliente permitiría pedir el perfil de otra persona; hay un test que lo fija.

### Defecto corregido: intermitencia en el gate de emulador

Al añadir un tercer fichero `*.emulator.test.mjs` empezó a fallar un test
**preexistente** de `health`. No era una regresión: `node --test` ejecuta los
ficheros en paralelo y tres golpeando a la vez el mismo Functions Emulator
provocaban contención. Se añadió `--test-concurrency=1`, la misma convención que
ya usaba `test:rules:run`. Verificado con tres pasadas consecutivas en verde.

### Evidencia

- `npm run validate:full`: **521/521** = 474 del gate normal (350 legacy, 68
  plataforma, 24 contratos, 14 game-core, 18 handlers) + 47 de backend (6 Auth
  Emulator, 19 Functions Emulator, 22 reglas e invariantes).
- **No se desplegó nada.** Las cuatro callables existen solo en el repositorio.

### Cableado del carril completo

`profile-emulator-bootstrap` monta ahora el `UserProfileSyncCoordinator` sobre el
transporte real y expone `window.ConvergenceCloudProfile`. Dos decisiones:

- El estado viaja en un evento propio (`convergence:cloud-profile-state`) en vez
  de reutilizar el de la importación legacy. Mezclarlos ocultaría un conflicto de
  perfil detrás del estado de una importación que ya terminó.
- La sincronización arranca **después** de `coordinator.start()`, para que una
  migración legacy pendiente no compita con el primer CAS del mismo UID.

### Pendiente inmediato

- Validar el carril de perfil en navegador real sobre `dist-profile-emulator`,
  como ya se hizo con la importación legacy.
- UI para resolver un conflicto de perfil y recuperación de `identity-mismatch`.
- Activar App Check en monitor sobre un bootstrap real.

## 2026-08-02 — La fase 4 se reabre: el núcleo determinista no reproduce el juego

### Qué se descubrió

Al arrancar la fase 6 se eligió **replay completo siempre**: el backend reejecuta
cada run y solo acepta el score si el hash coincide. Antes de construir las
tablas se comprobó qué puede reproducir realmente `@convergence/game-core`, y la
respuesta invalida tres de las casillas marcadas en la fase 4.

1. **La puntuación no es la del juego.** El motor real calcula
   `removed * 10 * State.level` y lo multiplica por siete factores —combo,
   dificultad, modo, fiebre, multiplicador temporal, sprint y supervivencia—
   (`apps/client/web/game.js:9616`). El núcleo hace `celdas * 10 * combo`: sin
   nivel y sin ninguno de los otros factores.
2. **No hay ninguna regla de modo.** El reductor solo entiende `TAP_CELL` y
   `SPAWN_TICK`. No existen oleadas, temporizador, vidas ni objetivos, y
   `state.mode` únicamente viaja dentro del hash.
3. **No existen fixtures legacy ↔ core.** Los tests comparan el núcleo consigo
   mismo: determinismo del replay y estabilidad de su propio hash. El assert de
   puntuación (`score === 20`) fija la fórmula simplificada del núcleo, no la del
   juego. Nada contrasta contra el motor legacy.
4. **Nadie ejecuta el núcleo.** `grep` sobre `apps/` no encuentra un solo
   consumidor de `@convergence/game-core`: el cliente sigue con el motor de
   `game.js` y Functions no lo importa. La casilla «ejecutar el mismo core en
   cliente y validador de backend» no describe el repositorio.

También hay un `if` sin cuerpo en `packages/game-core/src/reducer.ts:75` que
detecta tablero bloqueado tras un tap y no hace nada.

### Qué sí es cierto de la fase 4

Mulberry32 con snapshot/restore está verificado contra la secuencia del runtime
2.37.1, el raycasting de convergencia y el spawn asistido por PRNG existen y
están probados, `GameStateV2`/`runSaveV2Schema` están definidos y el migrador
`migrateRunSaveV1ToV2` funciona. Es un esqueleto correcto; no es el juego.

### Decisión

La fase 4 se reabre y la fase 6 queda bloqueada tras ella. No se ha escrito ni
una línea de rankings: publicar puntuaciones «verificadas» por un validador que
calcula un número distinto al que vio el jugador sería peor que no tener tablas.
El orden correcto es extraer puntuación y reglas de modo con fixtures reales
contra el motor legacy, hacer que cliente y backend ejecuten ese mismo núcleo, y
solo entonces construir la vertical de ranking.






## 2026-08-02 — Fase 4: Contrarreloj extraído con paridad real contra el motor

### Completado

- `packages/game-core/src/modes/time-attack.ts` reproduce las reglas de
  Contrarreloj del motor 2.37.2, no una simplificación:
  - Puntuación con los siete factores: `removed*10*level` por multiplicador de
    combo, dificultad, modo (1.2), fiebre, temporal y sprint final.
  - Tabla de combo por tramos, ventana de continuidad por dificultad y bonos de
    hito en 10/20/30.
  - Fiebre a partir de combo 10, que entra **antes** de puntuar: el toque que la
    activa ya cobra ×1.25.
  - Sprint final ×1.5, que lee el reloj **antes** de sumar el tiempo ganado.
  - Tiempo por convergencia con decaimiento hasta el 8 % y tope duro de 90 s.
  - Bono de tablero vacío, que se cobra en el mismo toque y lee el reloj **ya**
    actualizado.
  - Cristal (+50) y cápsula de tiempo (+5 s con tope), penalización de 3 s.

### Fixtures de paridad de verdad

`packages/game-core/test/time-attack-parity.test.mjs` instala un reloj virtual,
carga el motor legacy con `dom-stub`, juega partidas completas de Contrarreloj
con semilla fija en las tres dificultades y compara **toque a toque** la
puntuación y el reloj del motor contra la predicción del núcleo. Es la
comprobación que faltaba: hasta ahora los tests del núcleo solo lo validaban
contra sí mismo. Se añade además una comparación directa de cada constante
contra el `Config` legacy, que hace fallar el gate si alguna se desvía.

### Reglas que aparecieron al perseguir la paridad

Dos diferencias solo se descubrieron porque el test compara contra el motor real,
y ninguna estaba en el plan inicial de extracción:

1. El **bono de tablero vacío** entra dentro del delta de puntuación del toque
   que vacía el tablero (`chain` es 1-based y el combo se capa a 12).
2. La **cápsula de tiempo** detona por adyacencia y sube el reloj +5 s después
   del tiempo de la convergencia, lo que llevaba al tope duro y descuadraba la
   predicción.

### Evidencia

- `packages/game-core`: **21/21**, con paridad en fácil, normal y difícil.
- `npm run validate:full`: **528/528** = 481 del gate normal + 47 de backend.

### Pendiente

- Los otros seis modos siguen sin extraer, y `reducer.ts` conserva su fórmula
  simplificada y el `if` sin cuerpo de la línea 75.
- Nadie ejecuta todavía el núcleo en producción: el cliente sigue con `game.js` y
  Functions no lo importa. Hasta cerrar eso, la fase 6 sigue bloqueada.

## 2026-08-02 — Contrarreloj puntúa desde el núcleo en cliente y backend

### Completado

- **Cliente.** `scripts/build-game-core-browser.mjs` transpila el módulo de
  reglas a `apps/client/web/game-core.js`, un script clásico que publica
  `window.ConvergenceGameCore`. El cliente sigue siendo vanilla y sin bundler,
  así que esta es la única vía para compartir código real con el backend. El
  generador se niega a emitir si el módulo deja de ser autocontenido.
- `game.js` enruta por el núcleo la puntuación de convergencia, el tiempo
  ganado, la penalización por fallo y el bono de tablero vacío **solo en
  Contrarreloj**. Los otros seis modos siguen en su expresión histórica hasta
  que se extraigan, y si el núcleo no cargara el juego cae a esa expresión.
- **Backend.** `apps/functions/src/time-attack-score.ts` importa
  `@convergence/game-core` y recalcula la partida con las mismas funciones. El
  score que envía el cliente nunca se guarda: se compara con el recalculado y
  `accepted` solo es cierto si coinciden exactamente. Callable
  `verifyTimeAttackRun`.

### Defectos encontrados por el camino

1. **`native-bridge.js` cargaba `game.js?v=2.37.1`** con el resto del proyecto ya
   en 2.37.2. El triple bump documentado se dejaba un cuarto sitio, y era
   precisamente el que carga el juego: los usuarios habrían seguido con el
   runtime viejo desde caché. Ahora el bridge lee la versión del `<meta>` de
   `index.html`, que es el sitio que documenta el bump, y un test exige que el
   respaldo no se quede atrás.
2. **El backend no modelaba la cuenta atrás del reloj** entre jugadas. Como el
   sprint final (×1.5 con ≤10 s) depende del reloj, una partida que entrara en
   esa ventana se habría recalculado con menos puntos y se habría rechazado
   siendo legítima. Se descubrió solo al comparar contra una partida real.

### Evidencia

- `apps/functions/test/time-attack-score.handler.test.mjs` juega una partida
  real con el motor del cliente **sin** el núcleo cargado —es decir, con su
  expresión histórica— y la recalcula en el backend: cuadran el score y el reloj
  al punto. Es la prueba de que cliente y servidor puntúan igual de verdad.
- `apps/client/web/tests/game-core-wiring.test.js`: 8 tests que verifican el
  cableado con un núcleo espía, que los demás modos no pasan por él y que sin
  núcleo el juego sigue siendo jugable.
- `npm run validate:full`: **545/545** = 498 del gate normal + 47 de backend.
- Triple bump a **2.37.3** en `game.js`, `sw.js` e `index.html`, más el bridge y
  el nuevo `game-core.js`.

### Pendiente

- Quedan los otros seis modos por extraer. La fase 6 sigue bloqueada para ellos.
- La verificación actual recalcula a partir de los eventos que envía el cliente:
  todavía no reproduce tablero ni spawn, así que un cliente podría mentir sobre
  cuántos iconos convergió. El replay completo es trabajo de la fase 6.
