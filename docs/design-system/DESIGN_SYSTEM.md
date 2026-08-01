# Sistema de diseño y mapa completo de interfaz — Convergence

> Documento canónico de la interfaz existente a 30 de julio de 2026. Se ha
> contrastado `index.html`, `styles.css`, `game.js`, los catálogos de assets y
> la aplicación renderizada. No describe una propuesta futura: documenta el
> producto actual, versión `2.37.1`.

## 1. Alcance, evidencias y cifras

Esta carpeta cubre:

- las 4 pantallas de nivel superior;
- las 13 vistas internas del hub;
- los 6 modales de producto;
- los 3 overlays de selección, preparación y tutorial de jefe;
- los 6 modos visibles, sus lanzadores y sus variantes;
- navegación, economía, progresión, tablero, HUD, tiendas, personalización,
  colecciones, perfil, eventos, misiones, cofres y estados de resultado;
- estados habilitado, deshabilitado, seleccionado, bloqueado, listo,
  reclamado, abriendo, revelado, éxito, aviso y error;
- los flujos de primera visita, sesión recurrente, partida, compra,
  equipamiento, recompensa y retorno.

Resumen verificable:

| Fuente o evidencia | Cobertura |
|---|---:|
| `index.html` | 1.157 líneas; 82 controles estáticos |
| `styles.css` | 16.204 líneas; 126 custom properties; 166 `@keyframes`; 60 media queries únicas |
| `game.js` | 14.368 líneas; 70 plantillas dinámicas de `<button>` |
| Auditoría renderizada | 1.781 instancias de control, 122 firmas visuales, 65 estados nombrados |
| Capturas | 127 PNG, 390 × 844 px, 5,91 MiB |
| Assets en `img/` | 4.215 imágenes: 3.332 PNG, 816 SVG, 66 JPG y 1 WebP |
| Tipografía | Nunito Sans variable local, 571.240 bytes |

Documentos de esta carpeta:

- [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md): fundamentos, componentes,
  pantallas, modales, catálogos y flujos.
- [`CONTROL_AUDIT.md`](./CONTROL_AUDIT.md): ubicación y tamaño renderizado de
  botones, tabs, switches y demás controles.
- [`SCREENSHOT_INDEX.md`](./SCREENSHOT_INDEX.md): índice enlazado de las 127
  capturas.
- [`screenshots/mobile-390x844/`](./screenshots/mobile-390x844/): evidencia
  visual, ordenada por recorrido.

Las capturas se tomaron en un perfil local de QA aislado, a
`http://127.0.0.2:8080/index.html?dev`. Los saldos, récords y recompensas que se
ven son datos sintéticos. Las vistas latentes se identifican como tales; no se
presentan como navegación productiva.

## 2. Arquitectura visual

### 2.1 Capas de navegación

| Capa | Contenedor | Responsabilidad |
|---|---|---|
| Pantalla | `.screen` | Sustituye todo el viewport; se alterna con `hidden`. |
| Hub | `#hub-views > .hub-view` | Cambia el contenido central de Inicio y conserva cabecera y navegación. |
| Overlay | `.overlay`, `.pick-overlay`, `#boss-coach` | Bloquea la interacción inferior y ocupa el viewport. |
| Modal | `.modal` | Diálogo centrado con cabecera y acciones fijas; cuerpo desplazable. |
| Feedback | `.event-dock`, `.toasts`, `.combo`, `.flash` | Informa sin cambiar de ruta. |

`html`, `body` y `#app` ocupan todo el alto. El shell usa una cadena
`100vh` → `100dvh` → `-webkit-fill-available`, `overflow: hidden`,
`overscroll-behavior: none` y `touch-action: manipulation`. Las pantallas se
posicionan de forma absoluta con `inset: 0`.

### 2.2 Orden de profundidad

| Token | Valor | Uso |
|---|---:|---|
| `--z-board` | 1 | Tablero y contenido base |
| `--z-popup` | 5 | Popups de puntuación |
| `--z-combo` | 30 | Combo, multiplicador y llamadas de rango |
| `--z-toast` | 40 | Notificaciones |
| `#pick-overlay` | 74 | Selectores de bendición, ruta o reliquia |
| `--z-overlay` | 100 | Modales y overlays bloqueantes |

No se utiliza `backdrop-filter`; los velos son fondos sólidos/translúcidos para
evitar el coste de composición en iOS.

## 3. Tokens globales

Los 32 tokens raíz se definen en `:root`:

| Token | Valor | Finalidad |
|---|---|---|
| `--app-font` | `"Nunito Sans Game", "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif` | Stack único de producto |
| `--bg-0` | `#070b1c` | Fondo más profundo |
| `--bg-1` | `#0a1128` | Fondo principal y `theme-color` |
| `--bg-2` | `#101a3e` | Nebulosa superior |
| `--panel` | `#131e44` | Panel |
| `--panel-2` | `#18244f` | Panel elevado |
| `--line` | `rgba(120,150,255,.18)` | Divisor y borde tenue |
| `--line-strong` | `rgba(142,177,255,.34)` | Borde enfatizado |
| `--text` | `#eaf0ff` | Texto principal |
| `--muted` | `#9fb0e0` | Texto secundario |
| `--accent` | `#2f6bff` | Azul de marca |
| `--accent-2` | `#00d0ff` | Cian de acción/foco |
| `--score` | `#18e6e6` | Puntuación |
| `--level` | `#8f7bff` | Nivel y XP |
| `--time` | `#ff6cb0` | Tiempo/Contrarreloj |
| `--speed` | `#ffe14d` | Velocidad |
| `--good` | `#34e29b` | Éxito |
| `--warn` | `#ffb24d` | Aviso |
| `--bad` | `#ff5d73` | Error/peligro |
| `--gold` | `#ffd84d` | Monedas, estrellas y premio |
| `--surface-hi` | `rgba(42,58,124,.96)` | Superficie elevada |
| `--surface-mid` | `rgba(18,29,72,.98)` | Superficie media |
| `--surface-low` | `rgba(8,13,34,.42)` | Superficie baja |
| `--shadow-deep` | `0 28px 74px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.10)` | Sombra de modal |
| `--z-board` | `1` | Profundidad de tablero |
| `--z-popup` | `5` | Profundidad de popup |
| `--z-combo` | `30` | Profundidad de combo |
| `--z-toast` | `40` | Profundidad de toast |
| `--z-overlay` | `100` | Profundidad bloqueante |
| `--radius` | `16px` | Radio base |
| `--tap` | `44px` | Objetivo táctil base |
| `--tap-lg` | `52px` | CTA táctil grande |

El segundo bloque de tokens globales añade:

```css
--card-blue:   linear-gradient(160deg, #20428f, #122152);
--card-green:  linear-gradient(160deg, #1f7a45, #0f3a26);
--card-orange: linear-gradient(160deg, #9a5a22, #543012);
--card-red:    linear-gradient(160deg, #8a2331, #45141d);
--card-purple: linear-gradient(160deg, #4a2a8a, #25134e);
--grad-play:   linear-gradient(180deg, #38bdff, #1f6fe0 58%, #1657c6);
```

### 3.1 Familias de tokens locales

El CSS contiene 126 nombres de custom property. Además de los tokens raíz, se
agrupan así:

| Contexto | Tokens locales |
|---|---|
| Inicio | `--home-cyan`, `--home-blue`, `--home-violet`, `--home-ink`, `--home-avatar-size`, `--home-econ-height`, `--home-center-size`, `--home-mode-card-w`, `--home-mode-card-h`, `--home-mode-radius`, `--home-mode-overhang`, `--active-mode-accent` |
| Tablero | `--board-size`, `--board-frame`, `--board-pattern`, `--board-pattern-opacity`, `--board-pattern-size`, `--board-bg-animation`, `--board-border`, `--board-trim`, `--board-glow` |
| Celdas | `--cell-empty-bg`, `--cell-empty-border`, `--cell-filled-bg`, `--cell-filled-border`, `--cell-hover-bg`, `--clear-animation`, `--clear-burst`, `--clear-burst-animation` |
| HUD | `--hud-accent`, `--hud-surface-top`, `--hud-surface-bottom`, `--hud-border`, `--hud-lip`, `--hud-glow`, `--hud-highlight`, `--hud-radius-panel`, `--hud-radius-card` |
| Modal/vista | `--modal-accent`, `--view-accent` |
| Lanzador | `--ml-accent`, `--ml-accent-2`, `--ml-accent-soft`, `--mode-launch-top-space`, `--mode-launch-bottom-space` |
| Feedback | `--tc`, `--fbk-info`, `--fbk-warn`, `--fbk-threat`, `--fbk-cold`, `--fbk-boon`, `--mult-a`, `--mult-b`, `--mult-glow` |
| Jefes/pickers | `--boss-accent`, `--coach-accent`, `--coach-border`, `--coach-hot`, `--opt-accent`, `--opt-border` |
| Tienda | `--offer-a`, `--offer-b`, `--section-glow`, `--button-shadow`, `--empty-shadow` |
| Cofres | `--chest-panel`, `--chest-line`, más `--chest-accent` inyectado inline |
| Guía | `--guide-cyan`, `--guide-violet`, `--guide-mode-accent` |

Los acentos derivados usan `color-mix(in srgb, …)`. Es una dependencia real
del diseño; no existe un fallback de color completo para navegadores antiguos.

## 4. Color

### 4.1 Acentos por modo

| Modo | Acento | Uso visual |
|---|---|---|
| Tutorial | `#ffd23f` | Aprendizaje y objetivo inicial |
| Clásico | `#2f6bff` | Mapa, niveles y progreso |
| Aventura | `#7a5cff` | Biomas, rutas y reliquias |
| Contrarreloj | `#ff6cb0` | Reloj y presión |
| Supervivencia | `#ff5b6e` | Vidas, peligro, oleadas y jefes |
| Zen | `#9be15d` | Jardín, calma y flores |

### 4.2 Mundos de Clásico

Cada mundo tiene 50 niveles; el total visual es 250.

| Mundo | ID | Acento | Modificadores |
|---|---|---|---|
| Bosque Verde | `bosque` | `#3ad07f` | Cadenas |
| Desierto Dorado | `desierto` | `#ffb24d` | Rocas |
| Montaña Helada | `montana` | `#7ad7ff` | Hielo, telarañas |
| Cueva Misteriosa | `cueva` | `#a06bff` | Cristales, portales, barreras |
| Ciudad Neón | `neon` | `#ff5cf0` | Rush, bombas, cajas mágicas |

### 4.3 Biomas de Aventura

| Bioma | ID | Acento | Regla |
|---|---|---|---|
| Nebulosa | `nebula` | `#7a5cff` | Base |
| Cinturón de Asteroides | `asteroid` | `#ff9838` | Rocas |
| Campo de Hielo | `ice` | `#2bd4e6` | Hielo |
| Núcleo Ardiente | `core` | `#ff5b6e` | Rush |
| El Vacío | `void` | `#a06bff` | Escasez |
| Cristalia | `crystal` | `#19f0d0` | Cristales |

### 4.4 Convenciones semánticas

- Éxito y recompensa disponible: verde `--good`.
- Advertencia, coste y atención: naranja `--warn`.
- Error, daño y bloqueo crítico: rojo `--bad`.
- Recompensa premium: `--gold`.
- Información: `--accent-2` o `--fbk-info`.
- Hielo/congelación: `--fbk-cold`.
- Rareza de picker: common `#fff`, uncommon `#00d0ff`, rare `#b46cff`,
  epic `#ffd84d`; legendary se representa con oro/magenta según el catálogo.
- Monedas: dorado; gemas: cian; tickets/energía: violeta o amarillo eléctrico.

## 5. Tipografía

```css
@font-face {
  font-family: "Nunito Sans Game";
  src: url("../../fonts/NunitoSans-Variable.ttf") format("truetype");
  font-style: normal;
  font-weight: 200 1000;
  font-display: swap;
}
```

El archivo real se encuentra en `fonts/NunitoSans-Variable.ttf`; la ruta
anterior se muestra relativa a esta documentación, no es la declaración de
producción.

Reglas:

- 16 px es la base del navegador; no se fuerza otro tamaño global.
- 800–1000 es el peso de títulos, botones y cifras protagonistas.
- 600–700 se reserva a copy y etiquetas de soporte.
- Los números de HUD, economía y stats usan `font-variant-numeric:
  tabular-nums`.
- El texto principal es `--text`; los labels y metadatos usan `--muted`.
- Logo y títulos importantes usan texto con gradiente y
  `background-clip: text`.
- La escala es fluida mediante `clamp()`.

| Rol | Escala observada |
|---|---|
| Logo | `clamp(2rem, 8vw, 3rem)`; Inicio llega a `3.4rem` |
| Título de sección | `clamp(1.3rem, 5.3vw, 1.9rem)` |
| Score principal | `clamp(1.4rem, 7vw, 2.4rem)`, peso 900 |
| Score de resultado | `clamp(2rem, 9vw, 2.8rem)` |
| Glyph de celda | `clamp(.9rem, 5.2vmin, 2rem)` |
| Popup de puntuación | `clamp(1rem, 4.4vmin, 1.6rem)` |
| Rango de combo | `clamp(1.5rem, 7vmin, 2.6rem)` |
| Label compacto | `.52rem`–`.98rem` |

## 6. Geometría, superficies y elevación

### 6.1 Botón base

`.btn`:

```css
min-height: 44px;
border-radius: 16px;
padding: 13px 18px;
font-weight: 800;
box-shadow: 0 4px 0 rgba(0,0,0,.45),
            0 8px 14px rgba(0,0,0,.35);
```

El estado activo baja 3 px y reduce el labio. El estado deshabilitado reduce
opacidad y anula interacción. Variantes:

| Variante | Tratamiento |
|---|---|
| `.btn-primary` | Gradiente `#3d7bff → #1f5be6`; labio `#103a9e` |
| `.btn-ghost` | Blanco translúcido; labio negro |
| `.btn-lg` | CTA de 52–57 px o más |
| `.btn-sm` | Copy compacto; conserva 44 px cuando hay espacio |
| `.btn-icon` | Icono y etiqueta en fila |
| CTA de lanzador | Oro/naranja, alto 79 px aprox. dentro del modal |

### 6.2 Icon button, switch y toast

| Componente | Base CSS | Render 390 × 844 |
|---|---|---:|
| `.icon-btn` | 44 × 44, radio 12 | Pausa: 42 × 42; mapa: 44 × 44 |
| `.switch` | 52 × 30, radio 999 | Ajustes: 62 × 34 |
| `.toast` | padding 11 × 14, radio 14 | Ancho condicionado por mensaje |
| `.modal` | ancho `min(456px,100%)`, radio 22 | 354 px de ancho exterior |
| `.overlay` | `position:fixed; inset:0` | 390 × 844 |

El toast usa un token `--tc` y cambia fondo, borde, glow, icono y barra de
tiempo para `info`, `good`, `warn` y `bad`.

### 6.3 Objetivos táctiles pequeños

El token de producto es 44 px, pero la auditoría encontró excepciones reales:

| Control | Caja renderizada | Observación |
|---|---:|---|
| `hub-header-plus` | 27 × 27 | Disco `+` dentro de la wallet |
| `home-mode-dot` | 7 × 7 / 23 × 7 | Indicador y botón coinciden en tamaño |
| `mode-launch-info` | 24 × 24 | Acceso a detalle |
| `mode-launch-close` | 34 × 39 | Cierre en pestaña roja |
| `event-card-action` | 78 × 31 | Pill de acción |
| `btn-hint` | 34 × 34 | FAB de pista durante partida |

Son parte del estado actual y quedan registradas como deuda de área táctil; no
deben tomarse como nueva recomendación.

## 7. Responsive y anchos de pantalla

La aplicación es mobile-first y no usa container queries. La captura canónica
es 390 × 844, porque permite comparar todos los estados con una geometría
constante. El comportamiento de otros anchos se documenta directamente desde
la cascada CSS.

### 7.1 Tiers funcionales

| Rango | Comportamiento principal |
|---|---|
| ≤330 px | Último ajuste de emergencia en tienda/controles |
| 331–359 px | Teléfono muy estrecho; compacta launcher, cards y tipografía |
| 360–380 px | Teléfono compacto; reduce gutters, avatar y tablero |
| 381–460 px | Teléfono de referencia; una columna |
| 461–599 px | Teléfono grande; grids ganan columnas cuando caben |
| 600–683 px | Transición de tienda/colecciones |
| 684–719 px | Tier intermedio de cards y catálogos |
| 720–819 px | Tablet pequeña; mundos pasa a dos columnas |
| 820–900 px | Tablet 2:3; composición específica para 854 × 1280 |
| ≥901 px | Escritorio/tablet grande; más ancho útil y límites máximos |
| >960 px | Inicio deja de ser completamente `full-bleed` |

### 7.2 Breakpoints de anchura presentes

```text
330, 350, 355, 359, 360, 365, 370, 380, 400, 420, 430, 460,
479/480, 520, 560, 599/600/601, 620, 650, 683/684, 700,
719/720, 760, 819/820, 852/853, 900/901 y 960 px
```

### 7.3 Breakpoints de altura y orientación

```text
540, 560, 600, 640/641, 650, 680, 700, 720, 760, 820 y 900 px
```

- Landscape compacto se activa a `max-height:560px` y
  `max-height:540px`.
- Inicio tiene una composición horizontal específica a
  `min-width:900px and max-height:820px`.
- `prefers-reduced-motion: reduce` aparece en múltiples módulos.
- `hover:hover` es el único gate de hover del tablero.

### 7.4 Tablero responsive

Base:

```css
--board-size: min(96vw, 66svh, 620px);
```

Variantes relevantes:

- teléfono general: `min(98vw, 70svh, 620px)`;
- teléfono alto: `min(96vw, 72svh, 640px)`;
- ≥720 px: `min(84svh, 640px)`;
- Supervivencia aplica fórmulas propias para reservar HUD, peligro y boosters.

En 390 × 844 las celdas normales miden 41 × 41 px; el grid es 8 × 8, gap
máximo de 4–5 px y marco de 8 px en el tier móvil.

### 7.5 Safe areas

`env(safe-area-inset-*)` participa en:

- padding de cada pantalla;
- cabeceras, overlays y modales;
- bottom nav y tabs de mundos;
- FAB de pista;
- altura máxima del modal;
- espacios superior e inferior del lanzador.

## 8. Componentes globales

### 8.1 Inventario de estructura

| Componente | Selector | Dónde aparece | Responsabilidad |
|---|---|---|---|
| Fondo cósmico | `body`, `.stars` | Toda la app | Nebulosas, estrellas y continuidad entre pantallas |
| Pantalla | `.screen` | Nivel superior | Visibilidad, safe area y entrada `screen-in` |
| Hub router | `#hub-views`, `.hub-view` | Inicio | Sustitución del cuerpo sin desmontar shell |
| Overlay | `.overlay` | Modales | Velo bloqueante |
| Modal | `.modal` | Pausa, nivel, resultado, revive, pack | Header fijo, body scroll, footer fijo |
| Appbar | `.appbar`, `.hub-header` | Inicio y mundos | Perfil, economía, cofre y ajustes |
| Wallet | `.econ-pill`, `.wallet-pill` | Hub y partida | Monedas, gemas, energía; acceso a compra |
| Navegación global | `.bottom-nav`, `.bnav` | Hub | Eventos, Tienda, Inicio, Guía, Colecciones |
| Tabs de mundo | `.worlds-tabs`, `.tab` | Clásico | Estilos, Misiones, Jugar, Cofres, Clasificación |
| Botón base | `.btn` | Global | Acción primaria/secundaria |
| Icon button | `.icon-btn` | Global | Acción sin label visual |
| Switch | `.switch` | Ajustes | Toggle con `aria-checked` |
| Toast | `.toasts`, `.toast` | Partida/hub | Feedback temporal |
| Status SR | `#sr-status` | Global | `role=status`, `aria-live=polite` |

### 8.2 Cabecera de Inicio

La cabecera contiene:

- botón de perfil con avatar, borde equipado, badge de nivel, nombre y XP;
- wallet de monedas con botón `+`;
- wallet de gemas con botón `+`;
- energía/XP boost con botón `+`;
- botón de cofre y estado `Ninguno`, `¡Listo!` o `Abriendo · tiempo`;
- botón circular de Ajustes.

Medidas a 390 × 844:

| Pieza | Medida |
|---|---:|
| Botón de perfil | 252 × 70 |
| Botón de cofre | 105 × 89 |
| Ajustes | 37 × 37 |
| Cada `+` | 27 × 27 |
| Bottom-nav, cada celda | 71 × 91 |
| CTA recomendado | 359 × 50 |

### 8.3 Inicio y carrusel

`HomeModeCarousel` representa seis caras:

1. Clásico;
2. Aventura;
3. Contrarreloj;
4. Supervivencia;
5. Zen;
6. Multijugador, deshabilitado.

Componentes:

- `.home-mode-viewport`: cámara con perspectiva;
- `.home-mode-track`: anillo `preserve-3d`;
- `.home-mode-slot`: posición angular;
- `.home-mode-card`: superficie del modo;
- `.home-mode-art`: PNG protagonista;
- `.home-mode-dot`: selección directa;
- `#home-play-now`: recomendación diaria;
- `.home-resume`: partida guardada cuando existe;
- `.home-context`: récord o continuación;
- `.bottom-nav`: destinos globales.

Las cards miden 103–242 × 151–245 px según si están laterales o activas. La
activa tiene radio 23 px. El giro es continuo, por swipe, teclado, puntos o
click. Elegir una card no escribe `lastMode`; solo iniciar una partida lo hace.

Capturas: [Clásico](./screenshots/mobile-390x844/06-home-classic.png),
[Aventura](./screenshots/mobile-390x844/07-home-adventure.png),
[Contrarreloj](./screenshots/mobile-390x844/08-home-timed.png),
[Supervivencia](./screenshots/mobile-390x844/09-home-survival.png),
[Zen](./screenshots/mobile-390x844/10-home-zen.png) y
[Multijugador](./screenshots/mobile-390x844/11-home-multiplayer.png).

### 8.4 Lanzador de modo

`#modal-mode-launch` es un modal de página casi completa con:

- emblema, nombre, subtítulo y cierre;
- métricas de duración, guardado, objetivo y entrada;
- progreso;
- tarjeta de contexto con chevron;
- stats de la sesión;
- bloque “Cómo funciona” y panel de detalle;
- opciones específicas;
- CTA fijo inferior.

El modal usa tokens `--ml-accent*` distintos por modo. El cierre visible mide
34 × 39 px; cada info mide 24 × 24 px; la tarjeta de contexto, 344 × 91 px.

| Modo | Opciones del lanzador |
|---|---|
| Clásico | Mundo actual, nivel, estrellas y apertura del mapa |
| Aventura | Capítulo, bioma, mejor marca y continuación |
| Contrarreloj | 60 s iniciales, +3 s por convergencia, tope 90 s |
| Supervivencia | Fácil/Normal/Difícil, hasta 3 boosters, semana especial y ayuda expandible |
| Zen | Ritmo Sereno o Fluido, jardín y flores |

## 9. Pantallas y vistas

### 9.1 Pantallas de nivel superior

| ID | Entrada | Contenido y controles | Evidencia |
|---|---|---|---|
| `#screen-login` | Primera visita o perfil vacío | Nombre opcional, 6 radios de color, `¡Empezar!`, `Jugar como invitado` | [01](./screenshots/mobile-390x844/01-login.png) |
| `#screen-start` | Fin de onboarding, retorno o quit | Cabecera, carrusel, recomendación, hub router y bottom nav | [06–11](./SCREENSHOT_INDEX.md#inicio-y-selector-de-modos) |
| `#screen-worlds` | Clásico → Abrir mapa | Atrás, Ajustes, recompensas, mapa, rail y 5 tabs | [71–73](./SCREENSHOT_INDEX.md#lanzadores-mundos-y-partidas-por-modo) |
| `#screen-game` | Inicio de cualquier partida | Wallet, pausa, objetivo, HUD, tablero, peligro, boosters y pista | [74, 77, 80, 85, 88](./SCREENSHOT_INDEX.md#lanzadores-mundos-y-partidas-por-modo) |

### 9.2 Vistas del hub

| ID | Acceso normal | Contenido/acciones | Estado |
|---|---|---|---|
| `#view-events` | Bottom nav → Eventos | Recompensa diaria, misión, reto, cofre; Reclamar/Ver/Jugar/Abrir | Activa |
| `#view-missions` | Eventos → Ver | Misión diaria, progreso, recompensa, reroll y jugar | Activa |
| `#view-how` | Bottom nav → Guía | Tutorial visual, 4 modos, boosters, CTA de tutorial | Activa |
| `#view-settings` | Cabecera o Pausa → Ajustes | Sonido, música, vibración, FX, texto grande, ES/EN | Activa |
| `#view-daily` | Evento/recomendación diaria | Reglas, modificador, récord, Start y volver | Activa |
| `#view-resource-shop` | Bottom nav → Tienda | Gemas, monedas, XP, cofres y enlaces cruzados | Activa |
| `#view-shop` | Tienda → Personalización | Avatar, borde, tablero, pack de iconos y tema | Activa |
| `#view-chests` | Cabecera, Eventos o Tienda | Inventario, slots, catálogo, progreso, apertura y premios | Activa |
| `#view-medals` | Cabecera → Perfil | Perfil, estilo, stats, logros, rangos y edición de nombre | Activa |
| `#view-collections` | Bottom nav → Colecciones | 6 categorías y progreso agregado | Activa |
| `#view-collection-detail` | Categoría de colección | Filtros, orden, tiles, CTA contextual | Activa |
| `#view-multi` | Sin entrada productiva | “Próximamente” y Avísame | Latente |
| `#view-adventure` | Sustituida por launcher nuevo | Mapa anterior de Aventura | Legado/latente |

Las vistas latentes se capturaron mediante hooks de QA y no deben considerarse
rutas disponibles: [Multijugador](./screenshots/mobile-390x844/89-multiplayer-coming-soon.png)
y [mapa legado](./screenshots/mobile-390x844/90-adventure-legacy-map.png).

## 10. Modales y overlays

| ID | Tipo | Cuándo aparece | Controles | Evidencia |
|---|---|---|---|---|
| `#modal-mode-launch` | Modal de launcher | Click en modo activo | Cerrar, detalles, opciones, empezar | [69, 76, 79, 81–84, 86–87](./SCREENSHOT_INDEX.md#lanzadores-mundos-y-partidas-por-modo) |
| `#modal-pause` | Modal | Pausa | Ajustes, Reanudar, Reiniciar, Menú | [16](./screenshots/mobile-390x844/16-modal-pause.png), [75](./screenshots/mobile-390x844/75-modal-pause-classic.png) |
| `#modal-icon-pack` | Modal | Pack desde tienda/colección | Equipar/comprar, Volver | [39](./screenshots/mobile-390x844/39-modal-icon-pack.png) |
| `#modal-level` | Modal | Nivel superado | Siguiente nivel o mapa | [109–110](./SCREENSHOT_INDEX.md#resultados-hud-y-feedback) |
| `#modal-over` | Modal con body scroll | Fin, victoria o derrota | Reintentar, Compartir, Menú | [101–108](./SCREENSHOT_INDEX.md#resultados-hud-y-feedback) |
| `#modal-revive` | Modal | Última oportunidad en Supervivencia | Revivir o Rendirse | [99–100](./SCREENSHOT_INDEX.md#pre-nivel-jefes-pickers-y-revivir) |
| `#prelevel` | Overlay | Antes de un nivel compatible | Elegir boosters, Jugar, Omitir | [91–92](./SCREENSHOT_INDEX.md#pre-nivel-jefes-pickers-y-revivir) |
| `#pick-overlay` | Overlay | Ruta, reliquia o bendición | Cards de opción, Cancelar si procede | [78, 94, 98](./SCREENSHOT_INDEX.md#pre-nivel-jefes-pickers-y-revivir) |
| `#boss-coach` | Overlay dialog | Primera vez de mecánica de jefe | Entendido/Continuar | [93, 95–97](./SCREENSHOT_INDEX.md#pre-nivel-jefes-pickers-y-revivir) |

### 10.1 Diálogos que pertenecen al navegador

No forman parte del lenguaje visual controlado por CSS:

- `Editar nombre` abre `window.prompt`;
- `Compartir` usa la hoja nativa de Web Share cuando está disponible y cae a
  un fallback de copia;
- `Instalar` depende de `beforeinstallprompt`;
- las notificaciones de cofre dependen del permiso nativo de Notification.

Su geometría y color cambian por navegador/SO, por lo que no se incluyen como
capturas de la app. El botón que los dispara sí está auditado.

### 10.2 Resultado

`#modal-over` puede contener:

- título, motivo y récord;
- puntuación principal;
- modo, dificultad, capítulo/nivel;
- rendimiento: nivel, combo, eliminados, tiempo y récord;
- pico de puntuación;
- XP, monedas, subida de nivel y progreso;
- logros/feats;
- reto semanal;
- cofre conseguido;
- siguiente paso;
- acciones.

El header y footer permanecen fijos; `.modal-body` hace scroll. En la captura
de 390 × 844 el body de victoria mide 541 px visibles y 1.243 px de contenido.

## 11. Juego, tablero y HUD

### 11.1 Estructura

`#screen-game` es un grid de tres bandas:

```css
grid-template-rows: auto minmax(0, 1fr) auto;
```

1. chrome superior y HUD;
2. tablero centrado;
3. herramientas específicas del modo.

Controles persistentes:

- wallet de monedas y gemas;
- Pausa;
- Pista;
- celdas interactivas del tablero.

Controles condicionales:

- boosters de Supervivencia;
- picker de ruta/reliquia/bendición;
- acciones de coach;
- revive;
- acciones de nivel/resultado.

### 11.2 HUD

| Módulo | Contenido |
|---|---|
| Wallet | Monedas y gemas; pills de 67–94 × 29–30 px |
| Objetivo | Mundo/bioma/modo, texto de misión o estado diario |
| Score | Puntuación tabular, nivel/tiempo y multiplicador |
| Mult chip | Tiers, breakdown y delta; ver [111](./screenshots/mobile-390x844/111-hud-multiplier-breakdown.png) |
| Combo | Anillo, contador y rango |
| Survival bar | Vidas, oleada, tiempo, jefe, récord y frenesí |
| Peligro | Ocupación del tablero y umbral |
| Booster bar | Bomba, Hielo, Rayo, Barrido, Doble y Pista |
| Event dock | Toasts, warnings, recompensa y tutorial |

### 11.3 Tablero

`.board-wrap`:

- cuadrado definido por `--board-size`;
- padding 10 px base / 8 px móvil;
- radio 22 px base / 20 px móvil;
- `contain: layout paint`;
- patrón ambiental en pseudo-elemento;
- borde, trim, glow y fondo gobernados por tokens.

`.board`:

```css
grid-template-columns: repeat(var(--size,8), minmax(0,1fr));
grid-template-rows: repeat(var(--size,8), minmax(0,1fr));
gap: min(5px, 1.2vmin);
```

`.cell`:

- radio 11 px;
- `contain: layout style paint`;
- sin transición de background;
- touch y selección de texto desactivados;
- focus visible de 3 px cian;
- 41 × 41 px en la referencia 390 × 844.

Estados de celda documentados:

| Familia | Clases/atributos |
|---|---|
| Vacía/ocupada | `.empty`, `.has-icon` |
| Ayuda | `.hint` |
| Bonus | `.tile-bonus` |
| Portal | `.tile-portal` |
| Caja mágica | `.tile-magicbox` |
| Bomba | `.tile-bomb` |
| Ralentización | `.tile-slowdown` |
| Hielo | `.frozen`, `.ice-*` |
| Roca | `.tile-rock` |
| Bloqueo/cadenas | `.locked`, `.chains` |
| Telaraña | `.web` |
| Barrera | `.barrier` |
| Barro | `.mud` |
| Infección | `.infected` |
| Warning de jefe | `.boss-warn-*` |
| Efectos Survival | `.tide-fill`, `.lock-stamp`, `.surv-meteor` |

### 11.4 Skins de tablero

| ID | Nombre | Rareza | Coste |
|---|---|---|---:|
| `classic` | Tablero Clásico | common | 0 |
| `madera` | Tablero de Madera | common | 500 |
| `hielo` | Tablero de Hielo | rare | 800 |
| `lava` | Tablero de Lava | rare | 1.200 |
| `cristal` | Tablero de Cristal | epic | 1.500 |
| `magico` | Tablero Mágico | epic | 2.000 |
| `futurista` | Tablero Futurista | epic | 2.500 |
| `dorado` | Tablero Dorado | legendary | 3.000 |
| `bosque` | Tablero del Bosque | rare | 1.800 |
| `cosmico` | Tablero Cósmico | epic | 2.200 |
| `jardin` | Jardín Zen | legendary/exclusivo | 50 flores |

Cada skin cambia conjuntamente marco, patrón, animación ambiental, borde,
trim, glow, colores de celda y animación de limpieza.

## 12. Modos

| Modo | Multiplicador | Timer | Penaliza | Final/objetivo |
|---|---:|---|---|---|
| Tutorial | 0,5 | No | No | Junta dos iguales; una sesión |
| Clásico | 1,0 | No | Sí | Vacía el tablero y gana 1–3 estrellas |
| Aventura | 1,1 | No | Sí | Objetivos por nivel, biomas y mini-jefes |
| Contrarreloj | 1,2 | Sí | Sí | Máxima puntuación antes de 0 |
| Supervivencia | 1,5 | No | Sí | Oleadas infinitas, vidas, trampas y jefes |
| Zen | 0,8 | No | No | Sin derrota, sin Fever, ritmo elegido |

### 12.1 Supervivencia

Dificultades visibles: Fácil, Normal y Difícil. El launcher muestra el impacto
en vidas, carga/ritmo y monedas.

Boosters:

| ID | Nombre | Función |
|---|---|---|
| `bomb` | Bomba | Elimina una zona 3 × 3 |
| `freeze` | Congelación | Pausa la aparición |
| `clearLine` | Rayo | Elimina fila o columna |
| `wild` | Escoba | Limpia el grupo más repetido |
| `x2` | Comodín | Duplica puntos temporalmente |

Bendiciones:

| ID | Rareza | Efecto representado |
|---|---|---|
| `life` | common | Vida |
| `charge` | common | Carga |
| `slow` | common | Ralentización |
| `pack` | uncommon | Pack de bombas |
| `frenzy` | uncommon | Frenesí |
| `magnet` | rare | Imán |
| `score_boost` | rare | Boost de score |
| `golden_wave` | epic | Oleada dorada |

Jefes/encuentros definidos: `meteor`, `tide`, `frost`, `lockdown`, `quake`,
`crystalid`, `eco`, `puppeteer` y `void`.

Feats definidos: Impecable, Purista, Fénix, Coleccionista, Semana completa,
Frenético, Al límite, Ecónomo, Cazador, Ronda maestra y Domaecos.

## 13. Tienda, cosméticos y colecciones

### 13.1 Tienda de recursos

Ofertas monetarias visibles:

| Tipo | Cantidad | Precio | Nota |
|---|---:|---:|---|
| Gemas | 100 | 1,09 € | Base |
| Gemas | 330 | 3,39 € | Mejor valor; compara con 300 |
| Gemas | 1.200 | 11,99 € | Compara con 1.000 |
| Monedas | 1.000 | 1,09 € | Base |
| Monedas | 6.000 | 3,39 € | Mejor valor; compara con 5.000 |
| Monedas | 18.000 | 5,99 € | Compara con 15.000 |

XP ×4:

| Duración | Coste |
|---|---:|
| 6 h | 25 gemas |
| 3 días | 80 gemas |
| 7 días | 160 gemas |

El checkout actual es `mock-auto`; la UI representa el flujo, no una pasarela
real.

### 13.2 Temas

| ID | Nombre | Rareza | Coste | Tokens que sustituye |
|---|---|---|---:|---|
| `default` | Cosmos | common | 0 | Ninguno |
| `neon` | Neón | rare | 150 | fondos, paneles, acentos, score, nivel |
| `sunset` | Ocaso | rare | 200 | fondos, paneles, acentos, score, nivel |
| `forest` | Bosque | rare | 200 | fondos, paneles, acentos, score, nivel |
| `aurora` | Aurora | epic | 300 | fondos, paneles, acentos, score, nivel |
| `mono` | Eclipse | common | 250 | fondos, paneles, acentos, score, nivel |

### 13.3 Packs de iconos

| ID | Nombre | Rareza | Coste | Tipo |
|---|---|---|---:|---|
| `cosmos` | Cosmos | common | 0 | Vector/base |
| `basic-redesigned` | Básico Rediseñado | common | 350 | PNG |
| `gem-pattern` | Pack Gemas | rare | 500 | PNG |
| `nature-basic` | Naturaleza Básico | rare | 800 | PNG |
| `neon` | Pack Neón | epic | 1.200 | PNG |
| `marine` | Pack Marino | epic | 1.200 | PNG |
| `magic` | Pack Mágico | epic | 1.500 | PNG |
| `nature-advanced` | Naturaleza Avanzado | epic | 1.600 | PNG |
| `prismatic` | Joyas Prisma | legendary | 1.800 | PNG |
| `elemental` | Pack Elemental | legendary | 2.000 | PNG |

El catálogo contiene 9 familias raster con 104 fichas, más Cosmos como pack
vectorial/base; el modal de preview expone todas las piezas del pack.

### 13.4 Avatares y bordes

Avatares:

| ID | Nombre | Rareza | Coste |
|---|---|---|---:|
| `nova` | Nova | common | 0 |
| `comet` | Cometa | common | 260 |
| `prism` | Prisma | common | 320 |
| `sentinel` | Centinela | rare | 420 |
| `nebula` | Nébula | rare | 560 |
| `orbit` | Órbita | rare | 720 |
| `flare` | Llama | epic | 920 |
| `crystal` | Cristal | epic | 1.150 |
| `void` | Vacío | legendary | 1.450 |
| `pulse` | Pulso | legendary | 1.750 |

Bordes:

| ID | Nombre | Rareza | Coste |
|---|---|---|---:|
| `starlight` | Luz estelar | common | 0 |
| `plasma` | Plasma | common | 320 |
| `royal` | Real | common | 420 |
| `aurora` | Aurora | rare | 560 |
| `comet` | Cometa | rare | 700 |
| `crystal` | Cristal | rare | 920 |
| `eclipse` | Eclipse | epic | 1.150 |
| `circuit` | Circuito | epic | 1.380 |
| `bloom` | Bloom | epic | 1.580 |
| `mythic` | Mítico | legendary | 1.900 |

### 13.5 Colecciones

Categorías y cards de acceso:

- Tableros;
- Temas;
- Iconos;
- Avatares;
- Bordes;
- Logros.

Cada detalle ofrece:

- Volver;
- filtros Todos, Comunes, Raros, Épicos/Legendarios según contenido;
- orden “Más reciente”;
- grid de tiles;
- estado owned/locked/equipped;
- CTA contextual a tienda, eventos o partida.

## 14. Cofres

### 14.1 Catálogo

| ID | Rareza visual | Duración | Abrir ahora | Recompensa base |
|---|---|---:|---:|---|
| `wood` | basic/common | 3 h | 9 gemas | 60–199 monedas; 3–10 gemas; 1 ticket |
| `bronze` | common | 3 h | 9 gemas | 90–260 monedas; 4–12 gemas; 1 ticket |
| `silver` | rare | 8 h | 24 gemas | 140–360 monedas; 5–15 gemas; 1–2 tickets |
| `gold` | epic | 8 h | 24 gemas | 200–500 monedas; 7–18 gemas; 2–3 tickets |
| `event` | special | 8 h | 24 gemas | 180–520 monedas; 8–22 gemas; 2–4 tickets |
| `magic` | epic | 12 h | 36 gemas | 280–700 monedas; 10–24 gemas; 2–4 tickets |
| `royal` | legendary | 12 h | 36 gemas | 400–950 monedas; 14–30 gemas; 3–5 tickets |
| `supreme` | legendary | 24 h | 72 gemas | 550–1.250 monedas; 18–38 gemas; 4–6 tickets |
| `champion` | mythic | 24 h | 72 gemas | 750–1.600 monedas; 24–48 gemas; 5–8 tickets |
| `divine` | mythic | 36 h | 108 gemas | 1.000–2.400 monedas; 35–70 gemas; 7–10 tickets |

Ofertas directas en tienda: 30, 50, 90, 140, 210, 300, 450, 650 y 900
gemas para Wood → Divine; Event no se compra en ese listado.

### 14.2 Estados de UI

1. vacío;
2. inventario con reserva;
3. slot esperando;
4. slot abriendo;
5. slot listo;
6. slot seleccionado;
7. slot bloqueado y desbloqueo por gemas;
8. catálogo;
9. elección 1 de 3;
10. apertura;
11. premio garantizado;
12. revelado progresivo;
13. resultado y Seguir.

Capturas exhaustivas:
[vacío y catálogo](./SCREENSHOT_INDEX.md#cofres-vacíos-y-catálogo) y
[inventario/apertura/revelado](./SCREENSHOT_INDEX.md#cofres-activos-y-recompensa-diaria).

## 15. Perfil, progresión y logros

La vista de perfil contiene:

- avatar/borde y Editar nombre;
- nivel y barra de XP;
- economía y récords;
- estilo equipado;
- grids de avatares y bordes;
- estadísticas de partidas;
- logros;
- Supervivencia: rango, jefes y feats;
- progreso de modos.

Rangos de Supervivencia:

| Rango | Umbral |
|---|---:|
| Recluta | 0 |
| Explorador | 50 |
| Curtido | 150 |
| Veterano | 400 |
| Élite | 900 |
| Leyenda | 2.000 |

Logros:

| ID | Nombre | Condición | Rareza |
|---|---|---|---|
| `first` | Primer paso | Primera partida | common |
| `combo10` | En racha | Combo ×10 | common |
| `combo20` | Imparable | Combo ×20 | epic |
| `perfect` | Impecable | Tablero vacío | rare |
| `score3k` | Triple millar | 3.000 puntos | epic |
| `score8k` | Leyenda viva | 8.000 puntos | legendary |
| `level5` | Escalador | Nivel 5 | rare |
| `remove200` | Demoledor | 200 iconos totales | epic |
| `fever` | ¡Fiebre! | Entrar en Fever | legendary |
| `streak3` | Constante | 3 días seguidos | common |
| `variety5` | Explorador | Jugar los 5 modos principales | rare |

## 16. Flujos completos

### 16.1 Primera visita

```text
Acceso
  → nombre opcional + color
  → Empezar o Invitado
  → Tutorial paso 1
  → Tutorial paso 2
  → Tutorial paso 3
  → Tutorial completado
  → Inicio
```

### 16.2 Selección e inicio de modo

```text
Inicio
  → swipe/click/dot del carrusel
  → card activa
  → launcher
  → detalle/opciones
  → CTA
  → mapa, pre-nivel o partida
```

### 16.3 Clásico

```text
Inicio → Launcher Clásico → Mapa
  → mundo → nivel → Pre-nivel opcional → Partida
  → Pausa/Reanudar
  → Nivel completado
  → Siguiente nivel o Mapa
```

### 16.4 Aventura

```text
Inicio → Launcher Aventura → Continuar
  → Partida → objetivo/bioma
  → Selector de ruta / reliquia cuando corresponde
  → Nivel completado → siguiente nivel
  → Victoria/resultado al cerrar expedición
```

### 16.5 Contrarreloj

```text
Inicio → Launcher Contrarreloj → Empezar
  → 60 s, +3 s por convergencia, tope 90 s
  → reloj a cero
  → Resultado con récord/recompensas
  → Reintentar, Compartir o Menú
```

### 16.6 Supervivencia

```text
Inicio → Launcher Supervivencia
  → dificultad + hasta 3 boosters + ayuda
  → Partida por oleadas
  → peligros, boosters, Frenesí y jefes
  → tutoriales de jefe
  → bendición
  → Revivir o Rendirse
  → Resultado, feats, rango y cofre
```

### 16.7 Zen

```text
Inicio → Launcher Zen
  → Sereno o Fluido
  → Partida sin penalizaciones ni fin
  → flores/progreso de jardín
  → Pausa → continuar, reiniciar o menú
```

### 16.8 Reto diario

```text
Inicio recomendado o Eventos
  → Reto del día
  → reglas/modificador
  → Partida diaria
  → medalla por 750 / 1.500 / 2.500
  → Resultado
```

### 16.9 Compra y equipamiento

```text
Bottom nav Tienda
  → Recursos o Personalización
  → categoría
  → oferta / tile
  → comprar
  → feedback
  → equipar
  → cabecera, tablero o perfil reflejan el cambio
```

### 16.10 Cofre

```text
Cabecera / Eventos / Tienda
  → Cofres
  → elegir slot o premium
  → si es Choice Chest: elegir 1 de 3
  → apertura
  → revelar premios en orden
  → Seguir
  → inventario actualizado
```

### 16.11 Recompensa diaria

```text
Eventos → Reclamar
  → bloqueo inmediato
  → animación de explosión
  → saldo actualizado
  → estado “Reclamada hoy” deshabilitado
```

## 17. Animación y feedback

Se detectaron 166 `@keyframes`. Lista completa, agrupada:

- Shell/UI: `bootSpin`, `bootPulse`, `screen-in`, `heroSpin`, `ctaPulse`,
  `modal-in`, `hubViewIn`, `chipPop`, `bump`, `count-pop`.
- Home: `homePlayGlow`, `homePlayGlowPolished`, `homeModeArtFloat`,
  `homeSwipeSweep`, `homeSwipeRipple`, `homeModeGlowSettle`,
  `homeModeDepthSettle`, `dailyRewardBubblePop`, `dailyRewardBubbleRing`,
  `dailyRewardBubbleParticles`, `dailyRewardQuietFade`, `hubChestReady`.
- Worlds/progreso: `nodepulse`, `starpop`, `starShake`.
- Tablero ambiente: `board-drift`, `board-wood`, `board-ice`, `board-lava`,
  `board-prism`, `board-runes`, `board-scan`, `board-gold`, `board-leaf`,
  `board-stars`.
- Aparición/limpieza: `glyph-in`, `glyph-out`, `clear-ring`, `clear-wood`,
  `clear-ice`, `clear-lava`, `clear-crystal`, `clear-magic`, `clear-future`,
  `clear-gold`, `clear-leaf`, `clear-cosmic`, `clear-dust`, `clear-shards`,
  `clear-magma`, `clear-prism`, `clear-rune`, `clear-scan`,
  `clear-gold-spark`, `clear-leaf-burst`, `clear-star-burst`.
- Impacto/error: `miss`, `penalty-pop`, `board-shake`, `board-impact-soft`,
  `board-impact-mid`, `board-impact-heavy`, `time-pressure-board`,
  `ice-hit`, `ice-shatter`, `special-pulse`.
- Supervivencia: `tide-warn-pulse`, `boss-warn-pulse`, `boss-warn-board`,
  `slowdown-bob`, `surv-tide`, `surv-meteor-board`, `surv-lockdown`,
  `tide-fill-rise`, `lock-stamp`, `surv-damage`, `lives-hit`,
  `surv-wave-soon`, `fbk-boon`, `boss-reward`, `surv-quake`,
  `surv-penalty`, `surv-settle`, `surv-rain`, `surv-wave-up`,
  `frost-field`, `life-blast`, `board-clear-bonus`, `surv-meteor`,
  `special-clear`, `lastLife`, `boss-flag`, `pr-flame`,
  `surv-frenzy-pulse`.
- Boosters: `bomb-board`, `line-board`, `x2-board`, `wild-board`,
  `booster-fired`, `booster-grant-bar`, `booster-granted`, `armPulse`.
- Recompensas/score: `reward-chip-pop`, `reward-shine`, `reward-spark`,
  `reward-spark-2`, `reward-land`, `combo-pulse`, `combo-urgent`,
  `feverPulse`, `fever-burst`, `fever-out`, `rankPop`, `flashAnim`,
  `dangerBorder`, `hero-pulse`, `mbd-in`, `mult-drift`, `mult-rise`,
  `mult-spark`, `metallic-shake`.
- Toasts/pickers/tutorial: `toast-in`, `toast-out`, `toast-pop`,
  `toast-bar-shrink`, `pick-in`, `cascade-in`, `safe-delay-fill`,
  `epicGlow`, `epicSweep`, `coach-in`, `bossCoachVeilIn`,
  `bossCoachCardIn`, `bossCoachGlow`, `bossCoachFloat`.
- Cofres: `chestWobble`, `chestOpen`, `rewardPop`, `rewardPulse`,
  `chestHeroIdle`, `chestHeroRattle`, `chestHeroOpen`, `chestHeroFlash`,
  `chestSparkFly`, `rewardRays`, `rewardChestSettle`, `chestPrizeRise`,
  `chestOwnedPop`, `chestBuyPop`, `chestBuySpritePop`, `chestAtlasIdle`,
  `chestAtlasFrames`, `chestOpenMotion`, `chestOpenGlow`,
  `chestSlotReady`, `chestRevealNext`, `chestRareReveal`,
  `chestTierTarget`, `chestTierOutcome`.
- Tienda/launcher/guía: `modeLaunchIn`, `modeLaunchDetailIn`,
  `resourceTestPulse`, `resourceCheckout`, `resourcePurchased`,
  `guideTokenFloat`.

Las partículas repetibles usan pools fijos y caps. `prefers-reduced-motion` y
`body.reduced-fx` desactivan animación ambiental, partículas, vuelos, flashes,
drifts y pulsos sin ocultar la información persistente.

## 18. Iconografía y assets

Sistemas coexistentes:

1. `img/ui/*.png`: 55 iconos de UI legacy.
2. `img/icons-v2/`: 815 SVG aproximados en 12 categorías; se consumen como
   CSS mask y se tintan con `currentColor`.
3. `img/ui-generated/`: arte protagonista para Home, launcher, guía, tienda y
   cofres.
4. `img/icon-packs/`: fichas raster equipables.
5. `img/board-themes/v2/`: 11 familias visuales de tablero, 9 piezas cada una.
6. `img/player-icons/` y `img/player-borders/`: 10 assets por catálogo.

Convenciones:

- `.ic`: llena el contenedor;
- `.ic-inline`: `1em`, alineación de baseline;
- `.icv2`: mask SVG tintable;
- `.icv2-inline`: variante inline;
- los PNG protagonistas conservan alfa y no se usan como screenshots
  recortados.

## 19. Accesibilidad

- `#sr-status` anuncia cambios con `aria-live="polite"`.
- El tablero usa semántica `grid`/`gridcell` y labels de fila, columna y ficha.
- Los estados seleccionados usan `aria-checked`, `aria-pressed`,
  `aria-current` o `checked`.
- Los overlays importantes usan `role="dialog"` y `aria-modal`.
- Inputs, celdas y cards tienen `:focus-visible`.
- El texto grande se activa desde Ajustes.
- Sonido, música, vibración y FX pueden configurarse por separado.
- Idiomas visibles: ES y EN.
- `prefers-reduced-motion` reduce todas las duraciones y oculta estrellas
  decorativas.
- `body.reduced-fx` ofrece una reducción interna más granular.
- No hay implementación explícita de `prefers-contrast`.
- La auditoría de áreas táctiles pequeñas está en
  [`CONTROL_AUDIT.md`](./CONTROL_AUDIT.md#11-excepciones-de-área-táctil).

## 20. Hallazgos de QA visual

La documentación conserva también los defectos observados; una captura no se
ha retocado para ocultarlos:

- varias acciones tienen una caja inferior a 44 × 44 px; el inventario exacto
  está en
  [`CONTROL_AUDIT.md`](./CONTROL_AUDIT.md#11-excepciones-de-área-táctil);
- en el tramo inferior de `#modal-over`, una card de “Progreso cercano” puede
  comprimir el texto “Cofre de elección” verticalmente a 390 px; es visible en
  [la captura 108](./screenshots/mobile-390x844/108-modal-over-victory-bottom.png);
- el mapa de niveles muestra la scrollbar nativa del navegador en el borde
  derecho; es visible en
  [la captura 71](./screenshots/mobile-390x844/71-worlds-map.png);
- `#view-multi` y `#view-adventure` no tienen una entrada productiva actual;
  están documentadas como latente y legado, respectivamente;
- las vistas de Personalización, Perfil, Cofres y Resultado superan un
  viewport; por eso el índice usa varias capturas consecutivas y no una sola
  imagen recortada.

## 21. Mantenimiento del sistema

Al cambiar la interfaz:

1. actualizar el selector, tamaño, variante y ubicación en
   `CONTROL_AUDIT.md`;
2. actualizar la fila de pantalla/modal y el flujo afectado en este documento;
3. regenerar la captura con el mismo viewport y perfil QA aislado;
4. conservar nombres numéricos para mantener el orden del recorrido;
5. verificar enlaces, dimensiones y corrupción de PNG;
6. probar `prefers-reduced-motion`, `body.reduced-fx`, teclado y lector;
7. comprobar 360, 390, 720, 854 y 1.024 px, más landscape compacto;
8. no documentar una vista latente como disponible sin añadir antes una ruta
   productiva.

La evidencia visual completa está en
[`SCREENSHOT_INDEX.md`](./SCREENSHOT_INDEX.md).
