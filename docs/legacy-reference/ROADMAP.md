# Roadmap — Convergence

> Plan de trabajo derivado del análisis exhaustivo del código (`v1.7.1`). Cubre: bugs detectados, deuda pendiente de los alcances iniciales, mejoras de arquitectura/funcionales/diseño/usabilidad/seguridad, y el diseño de la arquitectura de nube necesaria para las funciones online. Cada ítem lleva **dificultad**, **beneficio** y **prioridad** para poder ejecutarlo paso a paso.
>
> Documentos de referencia: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (dónde está cada cosa) · [`MIGRATION_SPEC.md`](./MIGRATION_SPEC.md) (fórmulas/datos exactos) · [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) (visual) · [`REQUIREMENTS.md`](./REQUIREMENTS.md) (qué debe cumplirse) · [`GAME_MODES_MASTER_PLAN.md`](./GAME_MODES_MASTER_PLAN.md) (auditoría y plan de mejora de los modos de juego, tareas GM-*).

## Cómo leer este roadmap

- **Dificultad:** 🟢 Baja (horas) · 🟡 Media (días) · 🔴 Alta (semanas / requiere infraestructura).
- **Beneficio:** ⭐ Bajo · ⭐⭐ Medio · ⭐⭐⭐ Alto (impacto en jugador, mantenibilidad o riesgo evitado).
- **Prioridad:** P0 (bug/riesgo, hacer ya) · P1 (siguiente iteración) · P2 (medio plazo) · P3 (largo plazo / opcional).
- Regla operativa del repo: cualquier cambio en `game.js`/`styles.css` exige subir `?v=` en `index.html` + `CACHE` en `sw.js` — automatizado con `tools/bump-version.sh` (ver `CLAUDE.md`).

**Estado:**
- ✅ **Fase A completada** (v1.7.2): 1.1 (fix booster ×2), 1.2, 1.4, 1.5, 1.7 (`tools/bump-version.sh`), 2.1 (tests del núcleo, `tests/`), 2.3 (ESLint + CI), 5.3/5.4 (confirmación doble-toque en salir/comprar), 6.1 (CSP), 6.2 (`esc()` global consolidado), 7.3 (flujo de release).
- ✅ **Fase B completada en su núcleo** (v1.8.0): 2.6 (PRNG mulberry32 seedeable, `RNG`, semilla por partida en `State.seed`), 2.5 (guardado/reanudación de partida, `RunSave` + botón "Continuar partida"; v1 excluye supervivencia/tutorial), 3.1 (cofre premium por 25 gemas), 3.2 (reroll de misión diaria por 1 ticket), 4.1 (vuelo de convergencia hacia la casilla tocada, `.fly-glyph`). 32 tests en CI.
- ✅ **Fase B ampliada** (v1.9.0): 3.3 (Reto del día: tablero de Contrarreloj seedeado por fecha, igual para todos; mejor marca diaria en `Meta.dailyRun`; +5 💎 el primer intento del día), 3.9 (compartir con semilla: el enlace de compartir en modos de puntuación lleva `?challenge=SEED` y reproduce el mismo tablero en el receptor), 5.6 (aviso "sin jugadas ahora mismo" con throttle), 5.2 parcial (el aviso también se anuncia a lector de pantalla).
- ✏️ Corrección al roadmap: **5.1 (teclado en tablero) ya estaba implementado** en el código original (`Input.init`: roving tabindex + flechas + Enter/Espacio) — el análisis inicial lo pasó por alto; no hay trabajo pendiente ahí.
- ⏳ Pendiente que NO requiere decisión del propietario: 2.4 (JSDoc/@ts-check, barrido gradual), 2.2 (partición en ES modules — Fase C, refactor grande), 3.4/3.10 (mecánica infected + mundo 6), 4.4/4.5, 5.5/5.7.
- 🔒 Bloqueado hasta decisión del propietario: 7.1 (telemetría — necesita endpoint), 8.1+ (hosting/proveedor de nube → habilita 8.2 API, 3.6 leaderboard online, 8.3 sync, 8.4 multijugador).

---

## 1. P0 — Bugs detectados y quick wins

Confirmados leyendo el código; arreglables de forma aislada y con riesgo mínimo.

| # | Ítem | Detalle | Dif. | Ben. |
|---|---|---|---|---|
| 1.1 | **Bug: booster ×2 roto en Supervivencia** | `game.js:2124` llama `Boards.fx().x2Boost`, pero `Boards` no define `fx()` → `TypeError` al activar el booster x2 (el efecto nunca se aplica). Fix mínimo: `(Boards.fx?.().x2Boost || 1)` o eliminar el hook fantasma y dejar `11000` fijo. Añadir `fx()` real si se quiere que los skins den bonus (ojo: contradice el "cosmético puro" — decisión de diseño). | 🟢 | ⭐⭐⭐ |
| 1.2 | **Limpiar `UI_SYSTEM` de `sw.js`** | Precachea 22 PNG de `img/ui-system/` que no existen en el repo ni se usan en CSS. No rompe (está en `.catch()`), pero genera 22 requests 404 en cada instalación del SW. Borrar la lista o añadir los assets si se van a usar. | 🟢 | ⭐ |
| 1.3 | **Tile `infected` sin lógica** | Definido en `Tiles.DEFS` ("se propaga si no la limpias") con clase CSS ya lista, pero sin lógica de propagación en ningún modo. Decidir: implementarlo (mecánica nueva barata, ver §3.4) o retirarlo del registro. | 🟢 | ⭐ |
| 1.4 | **Campo `cost` muerto en `Boosters.DEFS`** | Los costes (80/60/90/100/70) no se gastan en ninguna parte. Eliminarlos o conectarlos a la compra de boosters pre-partida (§3.2, sumidero de monedas que falta). | 🟢 | ⭐ |
| 1.5 | **Typo anotado `--time: #ff6 b9`** | `styles.css:24` — inofensivo (está corregido en la línea siguiente y comentado), pero es ruido; borrar la línea inválida. | 🟢 | ⭐ |
| 1.6 | **Fallback para `color-mix()`** | Dependencia dura sin `@supports`; en navegadores sin soporte (Safari <16.2) los acentos tintados desaparecen. Añadir colores base de fallback antes de cada `color-mix` crítico o un aviso de navegador no soportado. | 🟢 | ⭐⭐ |
| 1.7 | **Documentar/automatizar el bump de versión** | Ya documentado en `CLAUDE.md`; añadir un script `tools/bump-version.sh` (sed sobre `index.html` + `sw.js` + `VERSION` en `game.js`) para eliminar el error humano del paso más olvidable del repo. | 🟢 | ⭐⭐ |

---

## 2. Mejoras de arquitectura (código cliente)

El IIFE único de ~4000 líneas funciona, pero es el mayor límite de mantenibilidad y de testabilidad. Estrategia: **evolución incremental, no big-bang** — el juego está vivo y sin tests, así que primero red de seguridad, luego partición.

| # | Ítem | Detalle | Dif. | Ben. | Prio |
|---|---|---|---|---|---|
| 2.1 | **Suite de tests del núcleo puro** | `Engine` (convergencia, spawns, pools) y las fórmulas de `Config`/scoring son funciones casi puras: extraíbles a tests sin tocar el DOM. Node + `node:test` (sin dependencias, coherente con la filosofía del repo) ejecutando `game.js` con un DOM stub, o extrayendo el engine primero (2.2). Cubrir: `converging()` con tiles sólidos, `poolForLevel` (invariante anti-confusión), tabla de combos, clear-assist, fórmulas de recompensa. **Prerequisito de todo lo demás.** | 🟡 | ⭐⭐⭐ | P1 |
| 2.2 | **Partición en ES Modules** | Trocear el IIFE en módulos ES (`engine.js`, `modes/`, `meta.js`, `render.js`, `audio.js`, `i18n.js`...) con `<script type="module">`. Sin bundler sigue funcionando servido estático (los navegadores objetivo ya soportan modules). Mantener `window.__cv` como fachada de debug. Hacerlo módulo a módulo, empezando por los que ya son puros (`Config`, `Icons`, `Engine`, `I18n.DICT`). | 🔴 | ⭐⭐⭐ | P2 |
| 2.3 | **Linter + formateo + CI** | ESLint (config plana mínima) + Prettier + GitHub Actions que corra lint y los tests de 2.1 en cada push. El bug 1.1 (`Boards.fx` inexistente) lo habría cazado un linter con chequeo de tipos ligero (`// @ts-check` + JSDoc). | 🟢 | ⭐⭐⭐ | P1 |
| 2.4 | **JSDoc + `@ts-check`** | Tipado gradual sin migrar a TypeScript ni añadir build: anotar `State`, `MetaData`, firmas de `Engine`/`Game`. Detecta en el editor errores como 1.1 y roturas del esquema `cv_meta`. | 🟡 | ⭐⭐ | P1 |
| 2.5 | **Guardado de partida en curso** | Hoy cerrar la app pierde el tablero activo (solo persiste `Meta`). Serializar `State` (board, tiles, score, combo, modo, timers) a `localStorage` en `visibilitychange`/`pagehide` y ofrecer "Continuar partida" al volver. Muy valorado en móvil (interrupciones constantes). | 🟡 | ⭐⭐⭐ | P1 |
| 2.6 | **PRNG seedeable** | Sustituir `Math.random()` por un PRNG inyectable (mulberry32, 10 líneas). Habilita: tests deterministas (2.1), retos diarios con tablero idéntico para todos (§3.3), replays, y validación server-side anti-trampas (§7/§8). | 🟢 | ⭐⭐ | P1 |
| 2.7 | **Versionado automático de assets** | Sustituir el `?v=` manual por hash de contenido generado por el script 1.7 (o un mini-script de release). Elimina la clase entera de bug "SW sirviendo versión vieja". | 🟢 | ⭐⭐ | P2 |
| 2.8 | **Presupuesto de rendimiento formal** | Ya existe el gobernador de FX; añadir medición real: marcar con `performance.mark/measure` los caminos calientes (cascadas, spawn masivo) y un umbral en CI con Lighthouse CI (lab). | 🟡 | ⭐ | P3 |

---

## 3. Mejoras funcionales (features pendientes del alcance original)

Lo que el código ya insinúa (UI, campos de datos, placeholders) pero no está implementado — la deuda funcional real detectada en `REQUIREMENTS.md` §4.

| # | Ítem | Detalle | Dif. | Ben. | Prio |
|---|---|---|---|---|---|
| 3.1 | **Sumidero de gemas** | Las gemas se acumulan sin poder gastarse (botón "comprar gemas" = toast "pronto"). Opciones baratas coherentes con la economía: continuar partida en Clásico/Aventura (gemas en vez de monedas), cofres premium (mejor tabla de probabilidad), compra de skins exclusivos, rerolls de misión diaria. Definir precios contra las tasas de generación documentadas en `MIGRATION_SPEC.md` §4. | 🟡 | ⭐⭐⭐ | P1 |
| 3.2 | **Sumidero de tickets + compra de boosters** | `spendTicket()` existe y no se usa. Diseño natural: los tickets dan entrada a un "desafío especial" (§3.3) y/o los boosters de Supervivencia se compran pre-partida con monedas usando los `cost` ya definidos (resuelve 1.4 a la vez). | 🟡 | ⭐⭐ | P1 |
| 3.3 | **Reto diario jugable** | Ya hay misión diaria pasiva; con el PRNG seedeado (2.6) se puede ofrecer un **tablero diario idéntico para todos** (semilla = fecha, mismo truco `hashStr` ya usado). Entrada con ticket, recompensa en gemas. Alto retorno de retención por coste moderado. | 🟡 | ⭐⭐⭐ | P1 |
| 3.4 | **Mecánica del tile `infected`** | Implementar la propagación prometida: cada N spawns, una celda infectada contagia a un vecino ortogonal; se limpia convergiendo adyacente (reutilizar `_crackRock` como patrón). Añadirlo como modificador de bioma de Aventura ("Pantano") o de mundo 6 de Clásico. | 🟡 | ⭐⭐ | P2 |
| 3.5 | **Multijugador real** | El placeholder "Próximamente" es la feature grande pendiente. Depende por completo de la arquitectura de nube (§8). Fase A: **asíncrono** (duelo contra el "fantasma" del tablero diario de otro jugador — no requiere tiempo real, solo API REST). Fase B: **tiempo real** (mismo tablero, WebSockets, ver §8.4). Empezar por A: 20% del esfuerzo, 80% de la percepción de "multijugador". | 🔴 | ⭐⭐⭐ | P2 (A) / P3 (B) |
| 3.6 | **Leaderboard online** | Hoy el leaderboard es local. Con el backend mínimo de §8.2: tabla global y semanal por modo. Requiere medidas anti-trampa (§7.3). | 🟡 (cliente) 🔴 (infra) | ⭐⭐⭐ | P2 |
| 3.7 | **Sincronización de progreso entre dispositivos** | `cv_meta` es el documento perfecto para sync (ya versionado con `_v`). Ver §8.3 para el diseño (login anónimo + merge). También resuelve "perdí mi progreso al borrar datos del navegador", la queja nº1 típica de PWAs sin backend. | 🔴 | ⭐⭐⭐ | P2 |
| 3.8 | **Notificaciones push** (recompensa diaria, "tu racha expira") | Web Push + service worker ya presente. Requiere backend mínimo para almacenar suscripciones (§8.2). Respetar quiet hours y opt-in explícito. | 🟡 | ⭐⭐ | P3 |
| 3.9 | **Compartir mejorado** | `Share` ya genera tarjeta canvas; añadir deep-link con el resultado (`?challenge=<seed>`) para que quien recibe pueda jugar el mismo tablero (requiere 2.6). Viralidad barata sin backend. | 🟢 | ⭐⭐ | P2 |
| 3.10 | **Mundo 6+ de Clásico** | La estructura de `Worlds.LIST` es data-driven: añadir mundos es barato (nuevo entry + mods + novedades + accent). Combinar con 3.4 para estrenar mecánica. | 🟢 | ⭐⭐ | P2 |

---

## 4. Mejoras de diseño (visual)

| # | Ítem | Detalle | Dif. | Ben. | Prio |
|---|---|---|---|---|---|
| 4.1 | **Animación de "convergencia" direccional** | Hoy los iconos desaparecen en su celda; el "viaje" hacia la celda tocada (la metáfora del nombre del juego) no se visualiza. Animar los glyphs deslizándose hacia el punto de convergencia antes del burst (WAAPI, transform-only, compatible con las reglas de rendimiento del CSS). Es la mejora de *game feel* de mayor impacto. | 🟡 | ⭐⭐⭐ | P1 |
| 4.2 | **Tema claro opcional** | El sistema de tokens ya soporta theming (los 6 temas comprables lo prueban); añadir un tema claro accesible como opción de Ajustes (no automático — el arte está pensado para oscuro). | 🟡 | ⭐ | P3 |
| 4.3 | **Skins de tablero: previsualización animada en tienda** | `.board-thumb` ya reutiliza los tokens; activar también la animación ambiental y un mini clear-burst en el hover/focus de la tarjeta para "vender" mejor el skin. | 🟢 | ⭐ | P3 |
| 4.4 | **Iconografía del catálogo: revisión de contraste** | Verificar los 12 colores × 9 skins de fondo de celda contra WCAG (especialmente `white #e8eefc` sobre skins claros como hielo/dorado). Ajustar `--cell-filled-bg` por skin si hace falta. | 🟢 | ⭐⭐ | P2 |
| 4.5 | **Onboarding visual del modo Aventura** | Los objetivos por nivel (score/survive/boss) se comunican solo con el banner; añadir una intro breve por capítulo (tarjeta de bioma con mods activos) reutilizando el patrón de `world-nov`. | 🟢 | ⭐⭐ | P2 |

## 5. Mejoras de usabilidad y accesibilidad

| # | Ítem | Detalle | Dif. | Ben. | Prio |
|---|---|---|---|---|---|
| 5.1 | **Navegación completa por teclado en el tablero** | Las celdas aceptan `:focus-visible` pero no hay movimiento por flechas ni activación consistente. Implementar roving tabindex en el grid (`role="grid"` ya está en el HTML). | 🟡 | ⭐⭐ | P2 |
| 5.2 | **Anunciar eventos de juego al lector de pantalla** | `#sr-status` existe; auditar que convergencias, combos, oleadas y fin de partida se anuncien de verdad (hoy el uso es parcial). | 🟢 | ⭐⭐ | P2 |
| 5.3 | **Confirmación al salir de partida** | `btn-quit` sale al menú sin confirmar; en Supervivencia con oleada alta es pérdida dolorosa. Añadir confirmación (o "mantener pulsado para salir"). | 🟢 | ⭐⭐ | P1 |
| 5.4 | **Deshacer el gasto accidental en tienda** | Compra con un solo tap sin confirmación. Añadir paso de confirmación con el precio visible (patrón ya existente en revive). | 🟢 | ⭐⭐ | P1 |
| 5.5 | **Estado vacío/primera vez en pantallas secundarias** | Cofres a 0, logros sin desbloquear, leaderboard vacío: añadir estados vacíos con CTA ("gana cofres sobreviviendo 10 oleadas") en vez de listas vacías. | 🟢 | ⭐ | P3 |
| 5.6 | **`hasMoves()` como aviso, no como derrota** | Cuando no hay movimiento posible y la ocupación es alta, avisar sutilmente ("espera al siguiente icono…") — hoy el jugador no sabe si está atascado o ciego. | 🟢 | ⭐⭐ | P2 |
| 5.7 | **Texto grande: auditoría real** | `largeText` sube el font-size raíz; auditar que chips/HUD/modales no rompan layout con 18.5px (overflow en `.g-chip`, `.econ-pill`). | 🟢 | ⭐ | P2 |

---

## 6. Mejoras de seguridad

Contexto: hoy la app es 100% cliente y sin datos personales, así que la superficie es pequeña — pero varios ítems se vuelven **críticos en cuanto exista backend** (§8).

| # | Ítem | Detalle | Dif. | Ben. | Prio |
|---|---|---|---|---|---|
| 6.1 | **Content-Security-Policy** | No hay CSP. Añadir meta/cabecera: `default-src 'self'` + `img-src 'self' data:` (por los SVG data-URI del CSS y favicon). Sin dependencias externas, la política puede ser estrictísima. Nota: los estilos inline (`--icv2-url` en atributos `style`) exigen `style-src 'unsafe-inline'` o migrar a clases/`attr()` — documentar la decisión. | 🟢 | ⭐⭐ | P1 |
| 6.2 | **Sanitizar los usos de `innerHTML`** | El render dinámico usa template strings con `innerHTML` (menús, `data-i18n-html`, toasts). Hoy el único input del usuario es el nombre (16 chars) — verificar que **nunca** se interpola sin escapar (aparece en appbar/perfil/tarjeta de compartir). Añadir helper `esc()` y test. | 🟢 | ⭐⭐⭐ | P0/P1 |
| 6.3 | **Integridad del progreso local** | `cv_meta` es editable por consola (trivialmente "hackeable"). Para juego offline es aceptable; en cuanto haya leaderboard online (3.6) la puntuación **no puede confiar en el cliente**: validación server-side con replay de semilla (requiere 2.6) o al menos límites de plausibilidad (score máximo teórico por modo/duración, ya derivable de las fórmulas de `MIGRATION_SPEC.md` §6). | 🔴 | ⭐⭐⭐ | P2 (con 3.6) |
| 6.4 | **Cabeceras de seguridad del hosting** | Al definir hosting (§8.1): HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` mínima (denegar cámara/micrófono/geolocalización). | 🟢 | ⭐ | P2 |
| 6.5 | **Privacidad y cumplimiento** | Hoy no hay tracking (punto fuerte — mantenerlo). Si llega backend: login anónimo por defecto (§8.3), sin PII obligatoria, borrado de cuenta autoservicio, y política de privacidad visible antes de activar cualquier función online. | 🟡 | ⭐⭐ | P2 |
| 6.6 | **Rate limiting y abuso** (backend) | Toda API de §8: rate limit por IP+device, tokens con expiración corta, validación estricta de payloads (el esquema `cv_meta` ya está tipado en la spec). | 🟡 | ⭐⭐⭐ | P2 (con backend) |

---

## 7. Fiabilidad y operaciones (fuera del alcance inicial)

| # | Ítem | Detalle | Dif. | Ben. | Prio |
|---|---|---|---|---|---|
| 7.1 | **Telemetría de errores opt-in** | `ErrLog` ya captura errores en local (20 entradas). Añadir envío opt-in a un endpoint propio (o Sentry self-hosted si se acepta dependencia) para ver crashes reales de usuarios — hoy el bug 1.1 lleva en producción sin que nadie lo sepa. | 🟡 | ⭐⭐⭐ | P1 |
| 7.2 | **Analítica de producto mínima y anónima** | Eventos agregados (partidas por modo, retención de tutorial, uso de boosters) para decidir el balance con datos. Respetar 6.5: anónimo, opt-in, sin terceros. | 🟡 | ⭐⭐ | P3 |
| 7.3 | **Flujo de release documentado** | Checklist: tests (2.1) → bump (1.7) → tag git → deploy. Una GitHub Action de deploy a hosting estático cierra el ciclo. | 🟢 | ⭐⭐ | P1 |

---

## 8. Diseño de la arquitectura de nube

Diseño propuesto para las funciones online (3.5–3.8, 6.3). Principio rector: **el juego debe seguir siendo offline-first** — la nube es una capa opcional de valor añadido, nunca un requisito para jugar. Coherente con la filosofía del proyecto: empezar con lo mínimo operable y sin atarse a un proveedor.

### 8.1 Fase 0 — Hosting estático + CDN (sin backend)

```
[Navegador PWA] ⇄ [CDN/hosting estático]     (Cloudflare Pages / Netlify / GitHub Pages)
```
- La app tal cual, con HTTPS, cabeceras de seguridad (6.4), CSP (6.1) y deploy automático (7.3).
- Coste ~0. Es el estado que debería formalizarse **ya** (hoy el repo no declara hosting).

### 8.2 Fase 1 — Backend mínimo (leaderboard + telemetría + push)

```
[PWA] ⇄ [CDN estático]
   ⇘ HTTPS/JSON
    [API pequeña: 4-6 endpoints]  ⇄  [BD gestionada]
```
- **Forma:** funciones serverless (Cloudflare Workers / Vercel Functions) o un contenedor único (Fly.io / Cloud Run). Para este volumen, serverless: coste por uso, sin ops.
- **BD:** una tabla clave-valor + una de puntuaciones basta (D1/SQLite gestionado, o Postgres pequeño). Esquema inicial: `players(id, created_at, push_sub?)`, `scores(player_id, mode, score, seed, replay_hash, week, created_at)`.
- **Endpoints:** `POST /score`, `GET /leaderboard?mode&week`, `POST /errlog` (7.1), `POST /push/subscribe` (3.8).
- **Cliente:** módulo `net.js` (aislado, tras la partición 2.2) con cola offline — los envíos fallidos se reintentan al recuperar red (Background Sync API con fallback).

### 8.3 Fase 2 — Identidad y sincronización de progreso

```
[PWA] ⇄ [API] ⇄ [BD: tabla meta_docs(player_id, doc jsonb, _v, updated_at)]
```
- **Identidad anónima primero:** al primer uso online se genera un `player_id` (UUID) + token; opcionalmente se vincula después a email/OAuth ("guarda tu progreso") sin exigirlo nunca para jugar.
- **Sync de `cv_meta`:** el documento ya está versionado (`_v`) y tiene semántica de merge natural — casi todos los campos son monótonos (máximos, contadores, fechas de desbloqueo): merge por campo con `max()`/unión de claves, no last-write-wins. Documentar la regla de merge campo a campo tomando el esquema de `MIGRATION_SPEC.md` §3.4 como contrato.
- **Conflictos:** resolución automática silenciosa (por la monotonicidad); solo pedir decisión al usuario si dos dispositivos divergen en `equipped`/cosméticos (trivial).

### 8.4 Fase 3 — Multijugador

- **3A. Asíncrono (primero):** duelos contra "fantasma" — mismo tablero (semilla compartida, requiere 2.6), el rival es la grabación de inputs de otro jugador. Solo necesita REST de la Fase 1 (`POST /match`, `GET /match/:id`). Cubre el modal "Multijugador" prometido con una fracción del coste.
- **3B. Tiempo real (después):** WebSockets con salas de 2 jugadores. Opciones: Durable Objects (Cloudflare) o un servicio Node/uWebSockets pequeño. Autoridad: **servidor semi-autoritativo** — el servidor genera la semilla y el calendario de spawns, los clientes envían taps con timestamp, el servidor valida contra el motor compartido (otra razón para extraer `Engine` puro en 2.2: poder ejecutarlo también en el server).
- **Anti-trampas:** validación por replay (semilla + lista de taps → recomputar score en servidor con el mismo `Engine`). Es la solución definitiva de 6.3 y es viable justamente porque el motor es determinista una vez seedeado.

### 8.5 Decisiones transversales de nube

| Tema | Recomendación |
|---|---|
| Proveedor | Empezar donde el estático: Cloudflare (Pages + Workers + D1 + Durable Objects cubre las 4 fases sin cambiar de proveedor). Alternativa equivalente: Vercel/Netlify + Supabase. |
| Entornos | `prod` + `preview` por rama (los hostings estáticos lo dan gratis). |
| Secretos | Solo en el panel del proveedor/CI; **nunca** en el repo (hoy no hay ninguno — mantenerlo). |
| Observabilidad | Logs del proveedor + 7.1; alarma simple de tasa de error de la API. |
| Coste estimado | Fases 0-2: 0–5 €/mes a escala indie. Fase 3B es el primer salto real de coste/complejidad. |

---

## 9. Orden de ejecución sugerido (fases)

**Fase A — Sanear (1-2 semanas de trabajo efectivo):**
1.1 → 6.2 → 1.2/1.4/1.5 → 2.3 (linter+CI) → 2.1 (tests del núcleo) → 1.7/7.3 (release script) → 6.1 (CSP) → 5.3/5.4.

**Fase B — Consolidar y retener (2-4 semanas):**
2.6 (PRNG) → 2.5 (guardar partida) → 2.4 (JSDoc) → 4.1 (animación de convergencia) → 3.1/3.2 (sumideros de economía) → 3.3 (reto diario) → 3.9 (compartir con semilla) → 7.1 (telemetría opt-in) → 8.1 (hosting formal).

**Fase C — Online mínimo (4-6 semanas):**
2.2 (ES modules, extraer `Engine`) → 8.2 (API mínima) → 3.6 (leaderboard) + 6.3/6.6 (anti-trampa/rate limit) → 8.3 (identidad + sync) → 3.7.

**Fase D — Multijugador y expansión (continuo):**
8.4-3A (duelos fantasma) → 3.5 completo → 3.4/3.10 (mundo nuevo + infected) → 3.8 (push) → 8.4-3B (tiempo real) → resto de P3.

> Criterio de corte entre fases: no empezar C sin los tests de 2.1 en verde en CI, y no empezar D sin la validación por replay de 6.3 diseñada — son los dos puntos donde saltarse el orden sale caro.
