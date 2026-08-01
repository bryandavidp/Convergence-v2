# Modelo de datos propuesto

Estado: diseño evolutivo. Las colecciones de importación funcionan solo contra
Emulator Suite; las Functions no están desplegadas en cloud.

## Firestore — datos durables

```text
users/{uid}
  publicProfile
  progression
  economy
  settings
  revision
  schemaVersion
  createdAt / updatedAt

  legacyImport
    status: quarantined
    authority: untrusted-client
    verification: unverified
    payloadFingerprint / policyVersion / operationId

  legacyClaim
    authority: untrusted-client
    verification: unverified
    projection

users/{uid}/devices/{deviceId}
users/{uid}/operations/{idempotencyKey}  # diseño futuro; no son los receipts v1

rooms/{roomId}
  codeHash
  ownerId
  memberIds[]
  mode
  status
  createdAt / expiresAt

matches/{matchId}
  roomId
  memberIds[]
  protocolVersion
  gameVersion
  seed
  status
  startedAt / finishedAt

matchResults/{resultId}
  matchId
  userId
  mode
  score
  verified
  replayHash
  finishedAt

leaderboards/{boardId}/entries/{uid}
  displayName
  score
  verified
  updatedAt

# Colecciones internas; ningún acceso desde cliente
legacyImportPreviews/{operationId}
legacyImportPayloads/{operationId}
legacyImportReceipts/{operationId}
legacyImportPreviewLocks/{ownerHash}
```

`legacyImportPreviews` es un tombstone sin raw que conserva fingerprints y plan
para impedir reutilizar una idempotency key aunque el payload haya caducado.
`legacyImportPayloads` conserva el original únicamente como string JSON canónico,
no indexado ni como mapa consultable. El preview permite commit durante 15
minutos; el raw no confirmado se marca para borrado y, tras commit, queda en
cuarentena hasta 7 días. El receipt evita volver a incrementar la revisión.

`firestore.indexes.json` versiona TTL sobre `legacyImportPayloads.deleteAt` y
excluye `payloadJson` de índices. Esa policy no estará activa en cloud hasta un
futuro deploy explícito de índices; Functions no se desplegarán antes de ello.

`boardId` codifica modo y periodo, por ejemplo
`supervivencia:weekly:2026-W31`. Los nombres públicos serán alias moderables,
no correos ni identificadores externos. La entry completa es legible sin Auth:
señales antifraude, replay privado, IP, email y auditoría interna deben vivir en
otra colección accesible solo por backend.

## Realtime Database — estado caliente

```text
presence/{uid}
  state
  lastChanged

rooms/{roomId}
  memberIds/{uid}: true
  lobby/revision
  lobby/status
  lobby/members/{uid}

matches/{matchId}
  memberIds/{uid}: true
  meta
  commands/{sequence}
  snapshots/{sequence}
  acknowledgements/{uid}
```

Los clientes no escriben directamente `rooms` ni `matches` en el scaffold
inicial. Presence es el único write de baja confianza permitido y nunca decide
premios, score o estado final.

## Invariantes

- Todos los documentos persistentes incluyen schema/protocol version.
- Timestamps autoritativos los asigna el servidor.
- Operaciones económicas y claims son idempotentes.
- Cada cuenta admite una sola importación legacy v1; el UID y `operationId` se
  derivan de Auth y la idempotency key, nunca de un UID enviado por el cliente.
- Una reclamación legacy permanece `untrusted-client`/`unverified` y no alimenta
  economía, premios ni leaderboards.
- Un jugador solo lee perfil propio y partidas a las que pertenece.
- El backend es el único escritor de rankings.
- Las salas tienen expiración y limpieza automática.
- Los datos de una partida registran `gameVersion` para escoger el validador.
- Se limita tamaño, frecuencia y profundidad antes de abrir cualquier regla.

## Pendientes antes del schema definitivo

- Capacidad y reglas exactas del primer modo multijugador.
- Política de nombres públicos y moderación.
- Retención de comandos/replays y derecho de borrado.
- Región de datos y requisitos legales.
- Política autoritativa posterior para convertir —o descartar— cada campo de la
  proyección legacy; hoy solo se conserva como reclamación no verificada.
- Volumen esperado de usuarios concurrentes y presupuesto.
