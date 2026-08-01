# ADR 0005 — Importación acotada de progreso legacy v1

Fecha: 2026-08-01
Estado: aceptado e implementado localmente; promoción autoritativa pendiente

## Contexto

El runtime legacy persiste todo el metajuego en `cv_meta`. En
`apps/client/web/game.js`, `Meta` declara el esquema 10 y guarda el objeto
completo con `JSON.stringify`. La carga solo hace un `Object.assign` superficial
contra defaults y después normaliza algunos campos; por tanto, `_v: 10` no
equivale a un schema cerrado ni garantiza que todos los subárboles sean válidos.

El inventario observado incluye estos campos de primer nivel:

- Base: `_v`, `xp`, `level`, `games`, `totalRemoved`, `xpBoostUntil`,
  `achievements`, `stats`, `modes`, `mastery` y `zen`.
- Calendario: `daily`, `weekly`, `streak`, `reward`, `dailyChest` y `dailyRun`.
- Modos: `adventure`, `worlds`, `survBest`, `survBestWave`, `survBestWaves` y
  `surv`.
- Economía e inventario: `coins`, `gems`, `tickets`, `chests`, `boosterStock`,
  `boards`, `cosmetics`, `chestInventory`, `chestUnlock`, `chestSlots`,
  `chestSeq`, `chestPipeline`, `chestReady` y `chestNotifiedReady`.

`dailyRun`, `surv`, `survBestWaves` y `zen` no están en el objeto `def` inicial:
aparecen mediante migraciones tolerantes o al jugar. También hay campos que
cambian de forma con el tiempo. Por ejemplo, `dailyRun` puede incorporar
`history`, `streakRewarded`, `chestPoint` y `ghost`; `modes[mode]` puede contener
`best`, `plays` y `ghost`; `adventure` añade `seen`.

Formas anidadas observadas, sin convertirlas todavía en una lista de confianza:

- `stats`: `{totalScore, bestCombo, totalTime}`; `modes[mode]`:
  `{best, plays, ghost?}`, donde el ghost es un array de hasta 60 scores.
- `daily`: `{date, id?, progress?, done?}`; `weekly`:
  `{week, id, progress, done}`; `streak`: `{count, date}`; `reward`:
  `{date, day}`.
- `dailyRun`: `{date, best, plays, history?, streakRewarded?, chestPoint?,
  ghost?}`; el historial es un mapa fecha→medalla podado a 60 entradas.
- `worlds[worldId].levels[level]`: estrellas; `adventure`:
  `{maxLevel, seen?}`; `zen`: `{flowers}`.
- `surv`: acumuladores `totalWaves`, `totalBosses`, `runs`, `masterRounds`;
  mapas `feats`, `boonsSeen`, `mutsWon`; `weekBest: {week, wave, mut}` y
  `bossDex[bossId]: {seen, kills, flawless, maxLvl}`.
- `cosmetics`: selección `theme`, `skin`, `fx`, `avatarIcon`, `avatarBorder`,
  `iconPack` y mapas de propiedad `owned`, `avatarIcons`, `avatarBorders`,
  `iconPacks`; `boards`: `{owned, equipped}`.
- `chestInventory[]`: al menos `{uid, type, source, earnedAt, durationMs}` y,
  según tipo, snapshots `choice` o `event`; `chestUnlock` añade `startedAt`,
  `endsAt`, `durationMs` y a veces `auto`.

## Decisión

Se define `LegacyProgressImportV1` como un sobre estricto con:

- `protocolVersion: 1`;
- `idempotencyKey`;
- `baseRevision`, entero seguro y no negativo;
- `legacySchemaVersion: 10`;
- `payload`, objeto JSON con `_v: 10`.

El sobre no acepta `uid`, `userId`, `authUid` ni ningún campo adicional. El UID
de cuenta se obtiene exclusivamente del token Firebase Auth verificado por el
servidor. Los `chestInventory[].uid` sí forman parte del payload histórico: son
identificadores locales de cofres, no identidades de seguridad.

El payload permanece opaco en esta fase para no inventar una forma que el
runtime no cumple. El contrato sí limita su superficie: máximo 256 KiB, 32
niveles y 20.000 nodos; solo JSON finito; objetos/arrays sin prototipos
personalizados, accesores, campos ocultos, ciclos, referencias compartidas ni
claves `__proto__`, `prototype` o `constructor`.

Validar el sobre no autoriza la importación. Las Functions implementadas
comprueban Auth, App Check, idempotencia y revisión en transacciones; el resultado
se conserva como reclamación no verificada, no como fusión autoritativa.

## Implementación local adoptada

- `previewLegacyProgressImport` recibe el payload una sola vez, deriva
  `operationId` de UID + idempotency key, aplica catálogos/clamps y devuelve una
  proyección, warnings y un `planHash` inmutable.
- La preview dura 15 minutos, solo puede existir una activa por UID y se limita
  a tres creaciones por hora. Un tombstone estable conserva los hashes de la key;
  el raw se guarda como JSON canónico en otro documento interno con TTL.
- `commitLegacyProgressImport` no vuelve a recibir el payload ni un UID: exige
  la confirmación exacta del plan, revalida revisión y crea un receipt en la
  misma transacción.
- Un retry devuelve `already-committed` sin incrementar de nuevo la revisión.
  Una key reutilizada con otro contenido, una revisión obsoleta, una preview
  caducada o una segunda importación se rechazan explícitamente.
- El perfil recibe solo `legacyImport` y `legacyClaim` marcados
  `untrusted-client`, `unverified` y `quarantined`. No se escriben monedas,
  gemas, tickets, cofres, premios o resultados ranked.
- La policy versionada es `legacy-cv-meta-v10/1`; la idempotency key solo admite
  `[A-Za-z0-9_-]` y entre 12 y 96 caracteres. Fingerprints y `planHash` son
  SHA-256 sobre representaciones canónicas.
- El raw confirmado tiene una retención máxima diseñada de 7 días. TTL y la
  exención de índice del raw están versionados, pero aún no activos en cloud.
- El tombstone sin payload sobrevive al TTL, por lo que la misma UID/key nunca
  puede recrearse con otro contenido. Se eliminará con la cuenta según la futura
  política de borrado.

El cliente local usa un outbox durable ligado al UID y separa preview de commit
mediante un estado `awaiting-confirmation`. La confirmación visible de producto
todavía debe diseñarse; el API/evento actual solo se expone en
`dist-profile-emulator`.

## Propiedad y reconciliación futura

### Servidor-autoritativo

- UID, `revision`, historial de importaciones e idempotencia.
- `coins`, `gems`, `tickets`, `chests`, `boosterStock`, slots, secuencia,
  inventario y temporizadores de cofres.
- Compras, consumos, premios, derechos premium, resultados verificados y
  rankings.

El snapshot local es una reclamación de migración, nunca una escritura directa
sobre estos valores.

### Monotónicos

Estas estrategias son propuestas para una promoción futura. La implementación
actual no ejecuta `max` ni unión sobre progreso autoritativo: guarda una
proyección no verificada.

Los máximos pueden combinarse con `max`: récords por modo, `stats.bestCombo`,
`survBest`, `survBestWave`, valores de `survBestWaves`, estrellas por nivel,
`adventure.maxLevel`, `surv.bossDex[*].maxLvl` y mejores marcas diarias.

Los acumuladores (`games`, `totalRemoved`, `stats.totalScore`, `stats.totalTime`,
`modes[*].plays`, `surv.runs`, `surv.totalWaves`, `surv.totalBosses` y contadores
del bestiario) son monotónicos pero **no deben sumarse entre snapshots**: ambos
pueden describir periodos solapados. Hasta disponer de eventos verificables, el
merge conservador es `max`, aceptando posible infracómputo.

### Conjuntos-unión

Pueden tratarse como unión tras validar IDs contra catálogos del servidor:

- logros desbloqueados;
- tableros y cosméticos poseídos, avatar icons/borders e icon packs;
- capítulos de aventura vistos;
- `surv.feats`, `surv.boonsSeen` y `surv.mutsWon`.

Las fechas asociadas son metadatos no confiables; conservar la primera fecha
requiere una regla explícita y validación temporal.

### Conflicto explícito

Requieren una decisión de producto o evidencia transaccional, no un merge
automático:

- el par `level`/`xp` y `xpBoostUntil`;
- toda economía consumible y el pipeline de cofres;
- rachas actuales de Clásico, perfectos, login y reto diario;
- misión diaria/semanal, claims de recompensa e historiales diarios;
- preferencias equipadas si difieren entre dispositivos;
- ghosts y estados temporales de cofres;
- `surv.weekBest`, cuyo significado depende de la semana.

## Campos dudosos hallados

- `chests` duplica la longitud de `chestInventory`, pero el legacy aún lo trata
  como contador canónico; pueden divergir antes de que `ensureChestInventory`
  repare el estado.
- `chestSeq` empieza limitado a 1.000.000.000 durante la migración, pero
  `freshChestUid` después lo permite crecer hasta `Number.MAX_SAFE_INTEGER`.
- `xp` es progreso dentro del nivel, no XP vitalicio; comparar solo `xp` entre
  dispositivos es incorrecto.
- `mastery.classicPerfect` y `mastery.winStreak` pueden disminuir a cero, mientras
  `bestClassicPerfect` sí es monotónico.
- `weekly.progress` a veces suma y a veces usa un máximo según el reto.
- `dailyRun.history` se poda a 60 entradas, pero `dailyStreak` inspecciona hasta
  90 días; la ventana efectiva depende del historial conservado.
- `cosmetics.owned` se usa principalmente para temas aunque su nombre parece
  genérico; tableros, avatares, bordes y packs viven en mapas separados.
- Los `uid` de cofres se generan con hora local y secuencia, así que no son
  globalmente únicos ni deben reutilizarse como claves autoritativas cloud.
- `worlds[*].reward` representa un claim local y nunca se promociona a premio o
  economía autoritativa.
- `cv_best`, `cv_profile`, `cv_user` y las claves sueltas de settings quedan
  fuera de `LegacyProgressImportV1`; necesitarán contratos y políticas propios
  si se decide migrarlas.

## Consecuencias

Esta decisión habilita transporte, preview, confirmación e idempotencia sin
afirmar que la economía local sea cierta. La siguiente decisión deberá definir
si alguna parte de la proyección se promociona a progreso autoritativo, cómo se
resuelven dos dispositivos y qué UX explica conflictos y recuperación.
