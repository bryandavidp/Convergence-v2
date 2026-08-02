# Roadmap de migración — Convergence v2

Actualizado: 2026-08-01

Documento canónico de planificación. El detalle ejecutado se anota en
`docs/PROGRESS.md`.

## Objetivo y estrategia

Entregar una única base de producto que mantenga la PWA, genere aplicaciones
nativas Android/iOS y soporte cuenta, progreso en nube, rankings, salas y
multijugador. La estrategia es de **paridad primero y sustitución por capas**:
el juego 2.37.1 continúa ejecutándose mientras cada dependencia del navegador
se mueve detrás de un adaptador y cada regla relevante se extrae a código puro.

No se hará una reescritura visual ni un cambio de framework en el camino
crítico. Capacitor permite reutilizar HTML/CSS/JS y es la vía más rápida con
menor riesgo funcional.

## Resumen

| Fase | Estado | Duración orientativa | Salida verificable |
|---|---|---:|---|
| 0. Aislamiento y baseline | Completada | 1–2 días | Repo independiente y 343/343 tests |
| 1. Toolchain reproducible | `validate:full` verde desde shell limpio; falta CI | 2–4 días | Node 22, lockfile y `npm run validate` verde |
| 2. Shell nativo inicial | APK debug 2.37.3 reproducible; faltan matriz manual, dispositivo real e iOS | 3–5 días | PWA + Android instalado + proyecto iOS generado |
| 3. Capa de plataforma y storage | Hardening automatizado verde; faltan lectura dual y matriz manual | 1–2 semanas | mismo perfil sobre web/Preferences, migración reversible |
| 4. Núcleo determinista y RunSave v2 | **Reabierta**: Contrarreloj extraído con paridad real; faltan 6 modos | 2–4 semanas | reglas puras, estado RNG y replays reproducibles |
| 5. Firebase local, Auth y progreso | Perfil en nube con CAS validado contra emulador; faltan UI de conflicto, App Check y despliegue | 2–3 semanas | emuladores, cuenta y sincronización offline segura |
| 6. Rankings por modo | **Bloqueada por la fase 4** (desbloqueada solo para Contrarreloj) | 1–2 semanas | tablas verificadas por modo/periodo |
| 7. Salas y lobby en tiempo real | Pendiente | 2–3 semanas | crear/unirse/listo/presencia/reconexión |
| 8. Partida multijugador | Pendiente | 3–6 semanas | comandos ordenados, snapshots, rejoin y cierre |
| 9. Servicios nativos y hardening | Pendiente | 2–4 semanas | push, App Check, observabilidad y seguridad |
| 10. Beta y publicación | Pendiente | 2–4 semanas | PWA, Play y TestFlight con gates de calidad |

Las duraciones son esfuerzo orientativo para un equipo pequeño y pueden
solaparse. El multijugador competitivo plenamente autoritativo puede requerir
un árbitro persistente en Cloud Run; se decidirá con métricas del prototipo.

## Próximo hito activo

**Cerrar la fase 4**: extraer los seis modos que faltan con fixtures de paridad
contra el motor legacy, igual que se hizo con Contrarreloj, y hacer que cliente
y backend ejecuten ese mismo núcleo. Es el cuello de botella del roadmap: bloquea
los rankings de la fase 6 y la validación determinista de la fase 8.

El perfil en nube ya está cerrado de punta a punta y verificado contra Emulator
Suite: revisión autoritativa, compare-and-set, recibos idempotentes, fusión
monótona de marcas y conflicto explícito que nunca sobrescribe. Contrarreloj
puntúa desde el núcleo compartido en cliente y backend.

**Nada está desplegado en cloud** salvo las Firestore Rules. Las siete callables
existen solo en el repositorio. Antes del primer despliegue de Functions hacen
falta presupuesto y alertas, TTL verificado y App Check en monitor.

La APK 2.37.3 es debug-signed para pruebas: no es beta ni release de tienda.
Siguen pendientes la matriz manual en dispositivo real y todo iOS, bloqueado por
falta de acceso a macOS.

## Fase 0 — Aislamiento y baseline

Estado: **completada**

- [x] Ignorar `/Convergence v2/` en el repositorio actual.
- [x] Inicializar `Convergence v2` como repositorio Git independiente.
- [x] Copiar el cliente 2.37.1 sin alterar rutas ni runtime.
- [x] Copiar tests y fixtures históricos requeridos.
- [x] Copiar la documentación canónica del design system y 127 screenshots.
- [x] Confirmar 343/343 pruebas.
- [x] Separar documentos históricos y marcarlos como no contractuales.

Criterio de salida: el clon se comporta como el juego actual y puede evolucionar
sin contaminar la rama del proyecto original.

## Fase 1 — Toolchain reproducible

Estado: **gate local completado; CI pendiente**

- [x] Crear workspaces para cliente, Functions, contratos y core.
- [x] Fijar versiones exactas de Capacitor 8 y Firebase.
- [x] Crear build estático por allowlist, sin bundlear el IIFE legacy.
- [x] Crear checks de Node y scripts de validación.
- [x] Instalar y seleccionar Node 22.23.2 LTS con npm 10.9.8.
- [x] Generar `package-lock.json` y reproducirlo con `npm ci` normal.
- [x] Ejecutar `npm run validate` completamente en verde.
- [x] Reauditar el árbol homologado: 11 moderate totales, 7 de producción y
      ningún high/critical.
- [ ] Revalidar advisories transitivos del SDK/CLI antes de cada despliegue.
- [ ] Confirmar tras reiniciar la sesión que PowerShell hereda fnm/Node 22. En
      shells no interactivos hay que activar fnm a mano: sin ello `check:node`
      encuentra Node 23 y aborta el gate.
- [x] Desbloquear los emuladores Java: `%TEMP%` rechaza el `connect` de los
      sockets AF_UNIX que Java NIO usa para el pipe de `Selector.open()`. Los
      emuladores reciben ahora un temporal propio y, si `java` no está en el
      PATH, el JDK homologado se localiza solo (`scripts/emulator-temp.mjs`).
- [ ] Averiguar qué intercepta `%TEMP%` (probablemente Defender u otro filtro):
      el síntoma sigue latente para cualquier otra herramienta Java del sistema.
- [ ] Añadir CI para Windows/Linux con artefactos de test.

Criterio de salida: una instalación limpia reproduce el mismo build y todas las
pruebas sin depender de paquetes globales.

## Fase 2 — Shell nativo inicial

Estado: **primer APK debug verificado; paridad manual e iOS pendientes**

- [x] Confirmar `Convergence` y `com.deploy21.convergence` como identidad.
- [x] Generar `apps/client/android` con Capacitor.
- [x] Bloquear Android en portrait y declarar categoría `game`.
- [x] Configurar SystemBars e identidad de tests/recursos nativos.
- [x] Instalar Android Studio 2025.2.1+, SDK 36 y confirmar JDK/JBR 21.
- [x] Generar APK debug y pasar unit tests, lint y test instrumentado en API 36.
- [x] Instalar y arrancar el APK en portrait sin excepciones nativas ni ANR.
- [ ] Probar arranque, rotación bloqueada si procede, safe areas, teclado, audio,
      pausa/reanudación y back button.
- [ ] Generar `apps/client/ios` en macOS con Swift Package Manager.
- [ ] Probar los mismos flujos en simulador y dispositivo real.
- [x] Definir la matriz funcional/visual contra los 127 goldens.
- [ ] Ejecutar y registrar la matriz en emulador y dispositivos reales.

Criterio de salida: el snapshot actual se ejecuta sin regresiones como PWA,
APK debug y app iOS debug.

Bloqueo externo: acceso a un Mac con Xcode para generar y validar iOS.

## Fase 3 — Plataforma y almacenamiento

Estado: **bridge P0 activo; hardening y matriz manual pendientes**

- [x] Definir contratos de storage, haptics, share y red.
- [x] Crear adaptadores base Web y Capacitor.
- [x] Endurecer repositorio JSON/outbox v2: schema runtime, cuarentena, owner
      UID, updates serializados, leases, backoff y estados de conflicto/Auth.
- [x] Añadir lifecycle y back al bridge; notificaciones/deep links quedan pendientes.
- [x] Crear un bridge mínimo con detección Web/Capacitor y fallback web.
- [x] Migrar `cv_meta` y `cv_run` a Preferences en nativo con escritura dual.
- [x] Serializar mutaciones y hacer checkpoint inicial, periódico, lifecycle y exit.
- [ ] Mantener lectura dual y rollback durante al menos una versión.
- [x] Probar JSON corrupto, carreras asíncronas y process death/relaunch.
- [ ] Añadir fixtures de upgrade desde schemas anteriores a 10.

Criterio de salida: cerrar/actualizar la app no pierde progreso y el juego no
conoce directamente si corre en navegador, Android o iOS.

## Fase 4 — Núcleo determinista y RunSave v2

Estado: **reabierta** — se marcó completada el 2026-08-01 sobre un esqueleto que
no reproduce las reglas del juego y que no usa nadie. Ver la entrada del
2026-08-02 en `docs/PROGRESS.md`.

- [x] Extraer Mulberry32 compatible y añadir snapshot/restore del stream.
      Verificado contra la secuencia del runtime 2.37.1.
- [x] Definir el puerto de engine y el sobre de replay.
- [x] Inventariar todos los usos de RNG: gameplay, metaeconomía y FX.
- [x] Diseñar `GameStateV2` serializable, estricto y versionado (`runSaveV2Schema`).
- [x] Migrar RunSave v1 a v2 incluyendo estado RNG (`migrateRunSaveV1ToV2`).
- [~] Extraer reglas por verticales pequeñas. Hecho: tablero (`board.ts`),
      convergencia, spawn asistido por PRNG (`spawn.ts`) y **Contrarreloj
      completo** (`modes/time-attack.ts`). Faltan los otros seis modos.
- [~] Reproducir la fórmula de puntuación real. Hecha para Contrarreloj con los
      siete factores, hitos, sprint, fiebre, bono de tablero vacío, cristales,
      cápsulas de tiempo y penalización por fallo. El reductor genérico
      (`reducer.ts`) sigue con su fórmula simplificada.
- [~] Crear fixtures legacy ↔ core de verdad. Hecho para Contrarreloj:
      `time-attack-parity.test.mjs` conduce partidas reales del motor legacy con
      reloj virtual y semilla fija en las tres dificultades, y compara toque a
      toque puntuación y reloj. Faltan los demás modos.
- [ ] Ejecutar el mismo core en cliente y validador de backend. Hoy **nadie**
      importa `@convergence/game-core`: el cliente sigue con el motor de
      `game.js` y Functions no lo usa.
- [ ] Eliminar el `if` sin cuerpo de `reducer.ts:75`, que detecta tablero
      bloqueado tras un tap y no hace nada.

Criterio de salida: semilla + estado + comandos producen el mismo resultado sin
DOM y pueden validarse/reproducirse en servidor **con la puntuación que el
jugador vio**.

## Fase 5 — Firebase local, Auth y progreso

Estado: **vertical local de importación/perfil completada; Functions cloud y UI
de confirmación pendientes**

- [x] Configurar Emulator Suite, reglas deny-by-default, índices y puertos.
- [x] Añadir Functions Node 22 y endpoint `health` protegido.
- [x] Definir contratos versionados y validación runtime.
- [x] Cargar `health` en Functions Emulator con Node 22 y proyecto `demo-`.
- [x] Instalar/exponer JDK 21 y arrancar Auth, Functions, Firestore, RTDB,
      Storage y Hosting con el proyecto `demo-convergence-v2`.
- [x] Añadir un smoke reproducible de puertos, Hosting y callable protegida.
- [x] Añadir 21 tests allow/deny, una invariante TTL/índices, 9
      handler/política y 10 Functions Emulator.
- [x] Crear una factory Auth-only que solo admite proyectos `demo-*` y conecta
      Auth Emulator antes de cualquier operación.
- [x] Probar login anónimo, token, eventos, logout y reinicio de proceso contra
      Auth Emulator.
- [x] Crear un build `dist-emulator` con bundle hash y CSP loopback, sin tocar el
      build/Hosting productivos.
- [x] Definir `LegacyProgressImportV1`: idempotencia, revisión base, límites JSON
      y UID derivado siempre de Auth.
- [x] Confirmar proyecto `dev` (`convergence-d1a35`) y Firestore en
      `europe-west1`.
- [x] Preparar alias local `dev`, manteniendo `demo-convergence-v2` como destino
      por defecto.
- [x] Autorizar Firebase CLI con la cuenta del propietario y verificar acceso.
- [x] Crear RTDB cerrada en `europe-west1` y registrar Web/Android.
- [x] Descargar y validar las configuraciones cliente en rutas ignoradas; pasar
      `processDebugGoogleServices` con JBR 21.
- [x] Crear `dist-cloud-dev` Auth-only, con configuración estricta, CSP mínima y
      smoke real que crea y elimina una cuenta anónima efímera.
- [x] Desplegar exclusivamente Firestore Rules tras 21/21 tests y verificar
      allow/deny desde fuera; no desplegar Functions, RTDB, Storage ni Hosting.
- [ ] Desplegar las reglas RTDB granulares solo al entrar en presence/salas; la
      instancia cloud permanece deny-all.
- [ ] Confirmar presupuesto de `dev`; `staging` y `prod` seguirán siendo
      proyectos separados.
- [x] Probar las reglas actuales con Emulator Suite antes de permitir nuevas rutas.
- [x] Añadir Auth anónima local sin bloquear el juego legacy.
- [ ] Implementar upgrade de la identidad anónima a cuenta permanente.
- [ ] Definir estrategia para Apple/Google Sign-In nativo.
- [x] Implementar previsualización y commit transaccional de importación legacy
      contra Auth + Functions + Firestore Emulator; economía y cofres quedan en
      cuarentena y nunca se aceptan como autoritativos desde el cliente.
- [x] Exigir confirmación explícita entre preview y commit, revisión base,
      idempotencia por UID, una sola importación y cuota de preview.
- [x] Crear `dist-profile-emulator`, aislado de PWA/Capacitor/cloud, y validar en
      navegador real captura, confirmación, persistencia y recarga sin duplicado.
- [x] Definir los contratos del perfil en nube: documento con revisión
      autoritativa y escritura compare-and-set con `idempotencyKey`.
- [x] Implementar el lado cliente: espejo local con revisión y marca de sucio,
      fusión monótona de marcas que no puede perder récords, conflicto explícito
      de perfil que nunca sobrescribe, y clasificación de errores que solo encola
      lo transitorio.
- [x] Implementar el lado servidor en Functions: callables `putUserProfile` y
      `putUserBestRecords` con transacción CAS, incremento de revisión y recibo
      por operación para deduplicar reintentos. Los documentos cuelgan de
      `users/{uid}` para reutilizar reglas ya verificadas.
- [x] Añadir el test de Emulator Suite de las callables de perfil: CAS,
      idempotencia, clave reutilizada, revisión caducada, uid ajeno, carriles
      separados y aislamiento de lectura por UID.
- [x] Añadir callables de lectura `getUserProfile` / `getUserBestRecords` y el
      transporte real del cliente sobre las cuatro. El UID nunca viaja en la
      petición: el servidor lo deriva de Auth.
- [x] Montar el coordinador con el transporte real en `profile-emulator-bootstrap`,
      publicando su estado en un evento propio y sincronizando tras la
      importación para no competir con el primer CAS del mismo UID.
- [ ] Validar el carril de perfil en navegador real sobre `dist-profile-emulator`,
      como se hizo con la importación legacy.
- [ ] Diseñar la resolución de conflicto de perfil de cara al jugador: hoy se
      señala el conflicto y se conserva lo local, pero no hay UI para elegir.
- [x] Implementar repositorio validado y outbox durable por UID con leases,
      backoff, `Retry-After`, recuperación y conflictos explícitos.
- [x] Añadir UI visible de preview/confirmación conectada al coordinador:
      `#modal-legacy-import`, barra de estado en Perfil, claves i18n ES/EN y
      confirmación por `convergence:legacy-import-confirm`. El estado publicado
      incluye un resumen presentacional sin economía.
- [ ] Añadir recuperación de identidad (`identity-mismatch`) y de conflicto:
      hoy solo se muestran como estado en la insignia, sin acción de salida.
- [ ] Permitir descartar una previsualización; «Mantener solo local» cierra la
      UI pero la reclamación sigue viva hasta `expiresAt`.
- [ ] Incorporar las claves legacy fuera de `cv_meta` que se decidan importar
      (`cv_best`, `cv_profile` y settings), siempre con política explícita.
- [ ] Activar App Check en monitor para Web/Android; iOS se añadirá al disponer
      de macOS/Xcode.

Criterio de salida: un jugador puede iniciar sesión, jugar offline, recuperar
conectividad y conservar un único progreso coherente en dos dispositivos.

## Fase 6 — Rankings por modo

Estado: **bloqueada por la fase 4**

Decisión tomada el 2026-08-02: se ataca como vertical de **un solo modo** y con
**replay completo siempre** (el backend reejecuta cada run y solo acepta el score
si el hash coincide). Esa política depende por completo de que el núcleo
determinista reproduzca las reglas y la puntuación reales, que es justo lo que
la fase 4 no entregó. Construir las tablas antes sería publicar puntuaciones
«verificadas» por un validador que calcula un número distinto al que vio el
jugador.

- [ ] Definir boards para cada modo: all-time, temporada, semana y diario.
- [ ] Enviar claims idempotentes con seed, versión y hash final.
- [ ] Validar runs deterministas en backend; rechazar versiones desconocidas.
- [ ] Materializar Top N y posición alrededor del jugador.
- [ ] Añadir paginación, alias seguro, moderación y borrado de cuenta.
- [ ] Separar score provisional de score verificado.
- [ ] Crear alertas de scores imposibles y límites de frecuencia.

Criterio de salida: ninguna puntuación autoritativa puede escribirse directamente
desde el SDK cliente y cada modo tiene una tabla consultable y paginada.

## Fase 7 — Salas y lobby en tiempo real

Estado: **pendiente**

- [ ] Implementar callables `createRoom`, `joinRoom`, `leaveRoom`,
      `setReady`, `startMatch` y `closeRoom`.
- [ ] Generar códigos cortos sin colisiones y con caducidad.
- [ ] Usar RTDB para presencia/lobby caliente y Firestore para metadatos/auditoría.
- [ ] Añadir roles owner/player/spectator, límites y transferir host.
- [ ] Diseñar reconexión, expulsión, abandono y limpieza de salas huérfanas.
- [ ] Probar dos y cuatro jugadores con latencia/pérdida simulada y carga
      sintética adicional.

Criterio de salida: varios jugadores pueden encontrarse, prepararse y arrancar
una sesión sin estados fantasma ni escrituras fuera de su sala.

## Fase 8 — Partida multijugador

Estado: **pendiente**

- [ ] Elegir el primer modo multijugador de alcance reducido.
- [ ] Secuenciar comandos por jugador con claves de idempotencia.
- [ ] Publicar snapshots compactos, hashes y acknowledgements en RTDB.
- [ ] Implementar optimistic UI, resync y rejoin desde último snapshot aceptado.
- [ ] Ejecutar validación determinista de checkpoints/resultados.
- [ ] Medir p50/p95 de latencia, ancho de banda y coste por partida.
- [ ] Decidir con datos si Firebase basta o el árbitro debe pasar a Cloud Run con
      WebSockets; mantener los contratos para no reescribir el cliente.
- [ ] Añadir abandono, empate, timeout, espectadores y cierre idempotente.

Criterio de salida: una partida completa sobrevive a reconexión, no duplica
acciones y produce el mismo resultado verificado para todos.

## Fase 9 — Servicios nativos y hardening

Estado: **pendiente**

- [ ] Push nativo con FCM/APNs y consentimiento explícito.
- [ ] Notificaciones locales de cofres respetando zona horaria/permisos.
- [ ] App Check: Play Integrity, App Attest/DeviceCheck y web.
- [ ] Crash reporting, performance traces y logging sin datos sensibles.
- [ ] Revisión de reglas, rate limits, abuso, costes y retención.
- [ ] Exportación/borrado de cuenta, privacidad, términos y soporte.
- [ ] Accesibilidad, reduced motion/FX, safe areas y dispositivos de gama baja.

Criterio de salida: checklist de seguridad/privacidad aprobado y cero secretos en
repositorio o logs.

## Fase 10 — Beta y publicación

Estado: **pendiente**

- [ ] CI de PWA, Android y iOS; firma solo en runners protegidos.
- [ ] Internal testing de Play y TestFlight con telemetría.
- [ ] Compatibilidad Android API 24–36 e iOS 15+.
- [ ] Pruebas de actualización desde PWA/versión nativa anterior.
- [ ] Rollout gradual con remote kill switches para online/multiplayer.
- [ ] Publicar PWA y después tiendas por anillos, con rollback documentado.

Criterio de salida: releases reproducibles, observables y reversibles en los tres
canales.

## Gates que nunca se omiten

- Paridad: las 343 pruebas legacy deben seguir verdes.
- Visual: cambios de UI se contrastan con `docs/design-system`.
- Datos: migraciones con copia/lectura dual, versionado y rollback.
- Seguridad: reglas de emulador antes de despliegue; Admin SDK solo en backend.
- Online: toda operación repetible lleva idempotency key.
- Multijugador: nunca se acepta score/estado final solo porque lo envía el cliente.
- Release: ninguna credencial, clave de firma o archivo APNs se versiona.
