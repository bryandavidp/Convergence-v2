# Firebase local y entorno `dev`

Este directorio contiene las reglas e índices versionados de Convergence v2.
El desarrollo normal usa Emulator Suite con el proyecto ficticio
`demo-convergence-v2`; el proyecto real `dev` solo se toca con comandos
explícitos que incluyan `--project dev`.

## Emulator Suite

```powershell
npm run emulators
```

La UI queda en `http://127.0.0.1:4000`. Firebase CLI 15 necesita JDK 21 para
Firestore y RTDB Emulator. La máquina actual está validada con JBR 21.0.11.

Gates automatizados:

```powershell
npm run emulators:smoke
npm run test:auth:emulator
npm run test:auth:browser
npm run test:rules
npm run test:functions:emulator
npm run test:backend
```

`test:rules` ejecuta 21 casos: 9 Firestore, 9 Realtime Database y 3 Storage.
`test:functions:emulator` arranca Functions + Firestore y cubre 10 casos de
`health` e importación legacy; `test:auth:emulator` cubre 6 comprobaciones de
sesión anónima/reinicio. Nada requiere credenciales ni accede a nube.

Las reglas son deny-by-default:

- Firestore publica solo `publicConfig` y entries de leaderboards; los perfiles
  son privados y todas las escrituras autoritativas pasan por Functions.
- Las colecciones internas de preview, raw TTL, receipts y rate locks no tienen
  regla propia y quedan cerradas por el fallback deny-all.
- RTDB local permite únicamente presence propia y lectura por miembro de una
  room/match; no permite escritura de sala o partida.
- Storage local aplica deny-all.

Todo campo guardado en una entry de leaderboard será público. Nunca colocar
allí telemetría antifraude, tokens, correo u otros datos privados.

Para probar la vertical local de perfil se construye un artefacto independiente
y se levantan solo los tres emuladores que necesita:

```powershell
npm run build:profile:emulator
npm exec -- firebase emulators:start --only auth,functions,firestore `
  --project demo-convergence-v2

# en otra terminal
npm run preview:profile:emulator
```

El cliente queda en `http://127.0.0.1:4177`; `dist`, Hosting y Capacitor no se
modifican. Consultar los README de raíz y frontend para el paso de confirmación.

## Proyecto cloud de desarrollo

| Recurso | Estado cloud |
|---|---|
| Alias `dev` | `convergence-d1a35` |
| Firestore | `europe-west1`; ruleset versionado desplegado |
| RTDB | `europe-west1`; reglas cloud totalmente cerradas |
| Auth | Anonymous habilitada y smoke real verde |
| Apps | Web y Android registradas |
| Functions | No desplegadas |
| Hosting | No desplegado |
| Storage/índices | No desplegados desde este repo |

`.firebaserc` está ignorado y conserva:

- `default` → `demo-convergence-v2`;
- `dev` → `convergence-d1a35`.

Las callables `previewLegacyProgressImport` y `commitLegacyProgressImport`
existen únicamente en código/emuladores. La tabla anterior y el historial cloud
no cambian por haber completado esta vertical local.

Comandos de consulta seguros:

```powershell
npm exec -- firebase login:list
npm exec -- firebase projects:list
npm exec -- firebase apps:list --project dev
npm exec -- firebase firestore:databases:list --project dev
```

La configuración cliente real también está ignorada:

```text
apps/client/firebase-config.dev.json
apps/client/android/app/google-services.json
```

## Historial de despliegues

El 2026-08-01, tras 21/21 tests de reglas y autorización explícita para cerrar
Firestore, se ejecutó únicamente:

```powershell
npm exec -- firebase deploy --only firestore:rules --project dev --non-interactive
```

La comprobación externa posterior dio acceso anónimo a `publicConfig` y entries
de leaderboards, y HTTP 403 a perfiles, salas, partidas, rutas internas y al
padre de leaderboards. La RTDB cloud conserva `.read: false` y `.write: false`;
las reglas granulares de este directorio aún no están desplegadas.

## Política de futuros cambios cloud

- No ejecutar `firebase init` ni `firebase deploy` sin selector.
- Ejecutar primero `npm run test:rules` y `npm run validate:full`.
- Revisar el diff y el servicio exacto.
- Pedir autorización indicando proyecto y comando completo.
- Desplegar una superficie cada vez y hacer comprobaciones allow/deny externas.

Functions requiere además App Check, presupuesto/alertas y un gate específico.
