# Configuración guiada de Firebase `dev`

Estado: **proyecto enlazado, clientes Web/Android registrados, Auth anónima
validada y Firestore cerrado con reglas versionadas**. La PWA estable,
Capacitor y Hosting continúan consumiendo `apps/client/dist`, que no incluye el
runtime cloud. La integración real vive en un artefacto de desarrollo separado
y no versionado.

Este documento registra qué está activo en nube, qué se ha desplegado y qué
decisiones necesito del propietario antes de abrir el siguiente gate.

## Estado confirmado — 2026-08-01

| Dato | Valor | Estado |
|---|---|---|
| Nombre visible | `Convergence` | Tratar exclusivamente como entorno `dev` |
| Project ID | `convergence-d1a35` | Confirmado |
| Project number | `98627547554` | Confirmado |
| Cloud Firestore `(default)` | `europe-west1` (Bélgica) | Activo; ruleset v2 desplegado y comprobado |
| Realtime Database | `convergence-d1a35-default-rtdb`, `europe-west1` | Activa y cerrada en nube con `.read/.write = false` |
| URL RTDB | `https://convergence-d1a35-default-rtdb.europe-west1.firebasedatabase.app/` | Confirmada |
| Functions | `europe-west1` | `health` + preview/commit legacy locales; ninguna desplegada |
| Alias Firebase CLI | `dev` → `convergence-d1a35` | Local e ignorado; `default` sigue siendo demo |
| Firebase CLI | Sesión autorizada | Proyecto y apps verificados |
| Web | `Convergence Web Dev` | App ID `1:98627547554:web:8d293cfb4a8a99b6cd82fb` |
| Android | `Convergence Android Dev` | App ID `1:98627547554:android:5038798bb72eb7b1cd82fb`; package correcto |
| iOS | `com.deploy21.convergence` | Pendiente de registrar y validar desde macOS/Xcode |
| Authentication | Anonymous | Activa; login y borrado de cuenta smoke verificados |
| Google Analytics | Activado en el proyecto | El bundle Web cloud-dev no importa el SDK Analytics |
| App Check | — | Pendiente; requisito previo a Functions cloud |

## Reglas de seguridad operativa

- No enviar ni versionar cuentas de servicio, claves privadas, contraseñas,
  tokens de Firebase CLI, keystores, certificados APNs ni perfiles de firma.
- `firebase-config.dev.json` y `google-services.json` son configuración cliente,
  no credenciales de servidor. Aun así permanecen locales e ignorados para
  separar entornos y evitar configuraciones accidentales.
- No ejecutar `firebase init`: `firebase.json` ya es la fuente versionada.
- No ejecutar un `firebase deploy` genérico. Cada cambio cloud debe indicar
  proyecto, servicio, comando exacto y autorización del propietario.
- `dev`, `staging` y `prod` serán proyectos Firebase distintos.
- Los documentos bajo `leaderboards/{board}/entries` son públicos por diseño;
  nunca deben contener telemetría privada, señales antifraude ni datos secretos.

## Despliegue cloud autorizado y registrado

El propietario autorizó expresamente cerrar Firestore con «adelante, puedes
cerrar firestore». Antes del cambio pasaron 21/21 tests de reglas con JDK 21.
Se ejecutó únicamente:

```powershell
npm exec -- firebase deploy --only firestore:rules --project dev --non-interactive
```

Resultado:

- ruleset de Cloud Firestore publicado correctamente;
- lectura anónima de `publicConfig` y entries de rankings: permitida por diseño;
- `users`, `rooms`, `matches`, `internal` y la colección padre de rankings:
  HTTP 403 sin Auth;
- ningún deploy de índices, RTDB, Storage, Functions o Hosting.

La instancia RTDB ya venía cerrada. Una consulta de solo lectura a sus reglas
cloud devolvió únicamente `.read: false` y `.write: false`. Las reglas más
granulares versionadas en `firebase/database.rules.json` pasan 9/9 tests
locales, pero **todavía no están desplegadas**.

## Bloque 0 — decisiones del propietario

- [x] Project ID de desarrollo: `convergence-d1a35`.
- [x] Firestore y RTDB: `europe-west1`.
- [x] Google Analytics: activado.
- [x] Auth inicial: solo Anonymous.
- [ ] Confirmar mercado inicial: España/UE o global.
- [ ] Indicar presupuesto mensual orientativo de `dev` y responsables de las
      alertas. Una alerta informa; no es un límite automático de gasto.
- [ ] Decidir si activamos protección contra borrado de Firestore antes de
      almacenar datos de prueba valiosos.

No necesito datos bancarios, contraseña ni acceso a tu cuenta.

## Bloque 1 — proyecto y enlace local — completado

El alias local ignorado conserva dos barreras:

- `default` → `demo-convergence-v2`, solo emuladores;
- `dev` → `convergence-d1a35`, siempre acompañado de `--project dev`.

Se verificaron sin mostrar tokens:

```powershell
npm exec -- firebase login:list
npm exec -- firebase projects:list
npm exec -- firebase apps:list --project dev
```

## Bloque 2 — clientes Web y Android — completado

Los clientes se registraron mediante Firebase CLI, sin activar Hosting:

- Web: `Convergence Web Dev`;
- Android: `Convergence Android Dev`, package exacto
  `com.deploy21.convergence`.

Configuración local:

```text
apps/client/firebase-config.dev.json
apps/client/android/app/google-services.json
```

Ambos archivos están ignorados. El build Web valida proyecto, número, App ID,
dominios, RTDB, bucket y la huella exacta de la API key antes de generar nada;
nunca imprime la key. Gradle `:app:processDebugGoogleServices` pasó con JBR 21.

iOS sigue pendiente. Se registrará con bundle ID
`com.deploy21.convergence`; `GoogleService-Info.plist` quedará en su ruta
ignorada y la compilación se hará en macOS/Xcode.

## Bloque 3 — Auth anónima cloud — completado para desarrollo Web

La variante cloud se genera y sirve así, desde la raíz:

```powershell
npm run build:cloud:dev
npm run preview:cloud:dev
```

Queda en `http://127.0.0.1:4176` y usa `apps/client/dist-cloud-dev`, nunca el
directorio estable. Incluye solo Firebase Auth y permite en CSP únicamente los
orígenes de Identity Toolkit y Secure Token. No importa Analytics, Firestore,
RTDB ni Functions.

El smoke automatizado de API crea una app Firebase única, inicia sesión de
forma anónima, obtiene un token válido y elimina esa misma cuenta:

```powershell
npm run smoke:cloud:auth
```

También se validó el flujo real en navegador. El modo destructivo local usa una
app diferente con persistencia solo en memoria y solo borra la identidad creada
en esa ejecución; no puede tocar la sesión persistente de desarrollo.

## Bloque 4 — datos y reglas — estado actual

- [x] Firestore creado en `europe-west1`.
- [x] Firestore rules desplegadas y verificadas externamente.
- [x] RTDB creada en `europe-west1` y totalmente cerrada en nube.
- [x] 21/21 tests locales: Firestore 9, RTDB 9 y Storage 3.
- [x] Versionar TTL de `legacyImportPayloads.deleteAt` y excluir `payloadJson`
      de índices; la invariante local está cubierta por test.
- [ ] Desplegar esa configuración de índices/TTL antes de activar las callables
      de importación; no forma parte del deploy previo de Rules.
- [ ] Desplegar reglas RTDB granulares solo al implementar presence/salas.
- [ ] Mantener Storage fuera de uso hasta definir tipos, tamaño, retención y
      validación backend.
- [ ] Activar protección contra borrado de Firestore cuando corresponda.

## Bloque 5 — facturación, límites y primer backend cloud

La vertical local de perfil/importación ya está completada por capas: contratos,
Functions transaccionales, outbox ligado al UID, artefacto aislado y E2E en
navegador contra Auth + Functions + Firestore Emulator. No cambió ningún
servicio cloud.

Antes de desplegar Functions:

1. acordar presupuesto mensual de `dev`;
2. crear alertas escalonadas, por ejemplo 50 %, 80 %, 100 % y 120 %;
3. mantener `maxInstances`, cuotas por usuario y alertas de errores;
4. [completado] validar el vertical de perfil/importación en Emulator Suite;
5. desplegar/verificar primero la policy TTL de la cuarentena;
6. configurar App Check en monitor para Web y Android;
7. ejecutar `npm run validate:full` y revisar el diff exacto;
8. solicitar autorización indicando proyecto, servicios y comando.

No se desplegarán Functions, Hosting ni datos durante este bloque sin esa nueva
autorización.

## Bloque 6 — App Check, proveedores permanentes e iOS

Orden previsto:

1. registrar y compilar iOS cuando haya acceso a un Mac;
2. configurar App Check Web y Play Integrity en modo monitor;
3. observar clientes legítimos y corregir la integración;
4. habilitar enforcement servicio por servicio;
5. implementar upgrade de anónimo a Google/Apple sin duplicar el perfil;
6. probar reautenticación, pérdida de dispositivo y borrado de cuenta.

## Qué necesito del propietario para el siguiente gate

Respóndeme solo con:

1. mercado inicial: `España/UE` o `global`;
2. presupuesto mensual orientativo para `dev`;
3. si quieres activar ya la protección contra borrado de Firestore;
4. si dispones ahora de un Mac con Xcode para iniciar iOS.

Mientras tanto se puede avanzar sin acceso adicional a Firebase con la UI de
confirmación, perfil multidispositivo, core y contratos de rankings/salas. No
envíes credenciales ni archivos de firma.

## Referencias oficiales

- [Firebase CLI](https://firebase.google.com/docs/cli)
- [Añadir Firebase a una app web](https://firebase.google.com/docs/web/setup)
- [Auth anónima en Web](https://firebase.google.com/docs/auth/web/anonymous-auth)
- [Localizaciones de Firestore](https://firebase.google.com/docs/firestore/locations)
- [Localizaciones de Realtime Database](https://firebase.google.com/docs/database/locations)
- [Planes y alertas de facturación](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
