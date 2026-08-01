# Configuración guiada e información necesaria

No envíes contraseñas, claves privadas, archivos de firma ni tokens por chat.
Cuando una fase necesite un archivo sensible, se colocará localmente en una ruta
ignorada por Git y se verificará sin mostrar su contenido.

## Paso completado — Node LTS

El proyecto homologa Node 22.23.2 y npm 10.9.8. La versión quedó instalada con
fnm, `npm ci` terminó normalmente y `npm run validate` pasó completo.

Comprobación al abrir una terminal nueva:

```powershell
fnm use 22.23.2
node --version
npm --version
npm run check:node
```

## Paso completado — Gate 1: identidad de la app

- Nombre visible: `Convergence`.
- Application/bundle ID: `com.deploy21.convergence`.
- Orientación: solo vertical.
- Android generado y sincronizado; iOS queda para macOS.

El ID se considera permanente y no debe cambiar tras publicar.

## Paso completado — toolchain y base Android

Android Studio, JBR 21, Platform/Build-Tools 36, Platform-Tools, Command-line
Tools y Emulator están instalados y pasan:

```powershell
npm run check:android
```

También se instaló la imagen Android 16/API 36, se creó
`Convergence_API_36` y quedaron verdes APK, unit test, lint, test instrumentado
y arranque portrait. El bridge P0 base también está activo; no necesitas enviar
nada para continuar con su hardening.

## Paso completado — Firebase local y tests de seguridad

La suite local completa ya arranca con el proyecto ficticio
`demo-convergence-v2`. Están verdes `emulators:smoke`, 21 tests allow/deny, una
invariante TTL/índices, 9 tests handler y 10 de Functions Emulator. No se usaron
credenciales ni un proyecto cloud.

## Paso completado — Auth local

Auth anónima ya está conectada a Emulator Suite mediante una build web separada,
demo-only y loopback-only. Login, token, observer, logout y proceso nuevo están
cubiertos sin conectar un proyecto real ni modificar el build productivo.

## Paso completado — conexión controlada de Firebase `dev`

La guía operativa completa está en
[FIREBASE_DEV_SETUP.md](./FIREBASE_DEV_SETUP.md). Ya están confirmados:

- proyecto `convergence-d1a35` (`98627547554`), nombre visible `Convergence`;
- Firestore `(default)` en `europe-west1`;
- RTDB activa y cerrada en `europe-west1`;
- alias local `dev`, sin cambiar el destino seguro `demo-convergence-v2`;
- Firebase CLI autorizada;
- apps Web y Android registradas y configuraciones locales ignoradas;
- Analytics activo y Auth Anonymous habilitada;
- Auth cloud-dev verificada y Firestore cerrado con las reglas versionadas.

El único despliegue cloud realizado fue `firestore:rules`, después de la
autorización explícita del propietario. RTDB continúa con reglas cloud
deny-all; las reglas granulares locales aún no se han desplegado. Functions,
Storage, índices y Hosting no se han desplegado.

No envíes correo, contraseña, tokens ni cuentas de servicio. La sesión de CLI y
las configuraciones cliente permanecen localmente en esta máquina.

## Paso actual — UX de perfil y decisiones previas al backend cloud

La vertical local `cv_meta` v10 ya incluye preview, confirmación explícita,
commit, revisión, outbox y prueba en navegador. No necesitas enviar ninguna
credencial para ejecutarla. Para preparar después el primer backend cloud
necesito solo:

1. mercado inicial: España/UE o global;
2. presupuesto mensual orientativo y responsables de alertas;
3. si activamos ya la protección contra borrado de Firestore;
4. disponibilidad de un Mac/Xcode para iniciar la plataforma iOS.

## Gate 2 — Firebase

`dev` ya está conectado; `staging` y `prod` se crearán como proyectos distintos.
Antes de abrir servicios autoritativos se pedirá:

1. disponer de una cuenta Google propietaria, sin compartir sus credenciales;
2. IDs deseados para `staging` y `prod`, públicos y globalmente únicos;
3. región de usuarios principal y requisitos legales;
4. presupuesto mensual orientativo y correo para alertas;
5. estrategia de upgrade desde anónimo a Google/Apple;
6. decisión sobre alias público del jugador;
7. estimación de usuarios activos y concurrencia.

Te guiaré pantalla por pantalla en Firebase Console. Nunca se solicitará una
service account privada. Los archivos nativos viven solo en rutas ignoradas:

- Android: `google-services.json` se guardará en
  `apps/client/android/app/` y está ignorado.
- iOS: `GoogleService-Info.plist` se guardará en
  `apps/client/ios/App/App/` y está ignorado.

Auth y reglas ya se validan primero en Emulator Suite. App Check, Functions y
cualquier ruta mutable repetirán ese gate antes de un deploy cloud.

Prerrequisito local: JDK 21 accesible mediante `java -version`. Firebase CLI
15 ya no soporta runtimes Java anteriores. No es necesario crear un proyecto de
nube para instalar Java o ejecutar `demo-convergence-v2`.

## Gate 3 — Android

Datos/acciones que se pedirán:

1. instalar Android Studio 2025.2.1+ con JDK y SDK 36;
2. confirmar `JAVA_HOME`/SDK mediante salidas de diagnóstico, no capturas con
   información sensible;
3. conectar un dispositivo o crear un emulador API 36;
4. app Firebase ya registrada con el application ID final;
5. obtener SHA-1/SHA-256 desde Gradle para Auth/App Check.

La firma release se crea al final. Su contraseña y keystore nunca se comparten
ni se versionan.

## Gate 4 — iOS

Requiere macOS y Xcode 26+. Se pedirá:

1. Apple Team ID (no es secreto);
2. bundle ID definitivo;
3. registrar App ID y capacidades necesarias;
4. abrir el proyecto generado en Xcode;
5. añadir `GoogleService-Info.plist` localmente;
6. configurar APNs/App Check siguiendo la consola.

Las claves APNs `.p8`, certificados y perfiles se gestionan localmente o en un
secret manager; no deben enviarse por chat.

## Gate 5 — Producción

Antes de cualquier despliegue se solicitará confirmación explícita del proyecto
y entorno objetivo. También deberán existir:

- URL de privacidad y soporte;
- política de borrado/exportación de cuenta;
- alertas de presupuesto;
- backups/retención definidos;
- tests de reglas y migraciones verdes;
- cuentas de tiendas y responsables de release.
