# Auditoría de controles — Convergence

> Anexo del [sistema de diseño](./DESIGN_SYSTEM.md). Las medidas proceden de
> `getBoundingClientRect()` y estilos computados sobre 65 estados renderizados
> a 390 × 844 px.

## 1. Método y alcance

- 1.781 instancias interactivas inspeccionadas.
- 122 firmas visuales agrupadas por tag, ID, clases, acción y rol.
- 82 controles declarados en `index.html`.
- 70 plantillas de botón adicionales generadas desde `game.js`.
- Incluye enabled/disabled, selected/unselected, owned/locked/equipped,
  ready/waiting/opening, modal y gameplay.
- El rango `A–B` indica que una misma firma cambia de tamaño por estado o
  posición 3D.
- Las celdas se documentan como familia; no se repiten las 64 instancias de
  cada tablero.

## 2. Acceso, controles globales y navegación

| Selector | Etiqueta/uso | Tamaño 390 × 844 | Radio |
|---|---|---:|---:|
| `#player-name` | Nombre opcional | 316 × 44 | 10 px |
| `.avatar-dot.sel` | Color de avatar seleccionado | 51,92 × 51,92 | 50% |
| `.avatar-dot` | Colores de avatar 2–6 | 44 × 44 | 50% |
| `#screen-login .btn-primary` | ¡Empezar! | 127,72 × 57 | 16 px |
| `#btn-guest` | Jugar como invitado | 193,03 × 48 | 16 px |
| `.btn` | Base de acción | mínimo 44 px de alto | 16 px |
| `.btn-primary` | Acción principal | 48–57 px de alto | 16 px |
| `.btn-ghost` | Acción secundaria | 44–48 px de alto | 16 px |
| `.icon-btn` | Acción solo icono | 42–44 × 42–44 | 12 px o 50% |
| `.bottom-nav .bnav` | Eventos | 71 × 91 | 0 |
| `.bottom-nav .bnav` | Tienda | 71 × 91 | 0 |
| `.bottom-nav .bnav-center` | Inicio | 71 × 91 | icono circular interno |
| `.bottom-nav .bnav` | Guía | 71 × 91 | 0 |
| `.bottom-nav .bnav` | Colecciones | 71 × 91 | 0 |
| `.hub-header-profile-button` | Abrir perfil | 252 × 70 | superficie sin radio propio |
| `.hub-header-chest` | Abrir Cofres/estado | 105 × 89 | 15,6 px |
| `.hub-header-settings` | Ajustes | 37 × 37 | 50% |
| `.hub-header-plus` | Conseguir monedas | 27 × 27 | 50% |
| `.hub-header-plus` | Conseguir gemas | 27 × 27 | 50% |
| `.hub-header-plus` | Conseguir energía | 27 × 27 | 50% |
| `.wallet-pill.wallet-coins` | Comprar monedas | 67–94 × 29–30 | 999 px |
| `.wallet-pill.wallet-gems` | Comprar gemas | 67–69 × 29–30 | 999 px |

## 3. Inicio, eventos, guía y ajustes

| Selector | Etiqueta/estado | Tamaño | Radio |
|---|---|---:|---:|
| `.home-mode-card-classic` | Seleccionar/Entrar en Clásico | 103–242 × 151–245 | 23 px |
| `.home-mode-card-adventure` | Seleccionar/Entrar en Aventura | 103–242 × 151–245 | 23 px |
| `.home-mode-card-timed` | Seleccionar/Entrar en Contrarreloj | 103–242 × 151–245 | 23 px |
| `.home-mode-card-survival` | Seleccionar/Entrar en Supervivencia | 103–242 × 151–245 | 23 px |
| `.home-mode-card-zen` | Seleccionar/Entrar en Zen | 103–242 × 151–245 | 23 px |
| `.home-mode-card-multi` | Multijugador · Próximamente | 103–242 × 151–245 | 23 px |
| `.home-mode-dot` | Punto no activo | 7 × 7 | 50% |
| `.home-mode-dot.is-selected` | Punto activo | 23 × 7 | 999 px |
| `#home-play-now` | Recomendado ahora | 359 × 50 | 13 px |
| `#events-reward-claim` | Reclamar | 78 × 31 | 999 px |
| `#events-reward-claim:disabled` | Reclamada hoy | 98 × 31 | 999 px |
| `.event-card-action` | Ver | 78 × 31 | 999 px |
| `.event-card-action` | Jugar | 78 × 31 | 999 px |
| `.event-card-action` | Abrir | 78 × 31 | 999 px |
| `.mission-reroll` | Cambiar misión · ticket | 342 × 48 | 16 px |
| `.guide-mode-classic` | Card Clásico | 166 × 207 | 17 px |
| `.guide-mode-timed` | Card Contrarreloj | 166 × 207 | 17 px |
| `.guide-mode-adventure` | Card Aventura | 166 × 207 | 17 px |
| `.guide-mode-survival` | Card Supervivencia | 166 × 207 | 17 px |
| `.how-back` | Volver | 41 × 41 | 50% |
| `#btn-tutorial` | Jugar tutorial | 368 × 52 | 15 px |
| `.set-close` | Cerrar Ajustes | 44 × 44 | 50% |
| `.switch` | Sonido, música, vibración, FX, texto | 62 × 34 | 999 px |
| `.lang-btn.on` | ES | 52 × 36 | 999 px |
| `.lang-btn` | EN | 54 × 36 | 999 px |

## 4. Lanzadores, mundos y juego

| Selector | Etiqueta/estado | Tamaño | Radio |
|---|---|---:|---:|
| `.mode-launch-close` | Cerrar launcher | 34 × 39 | pestaña irregular |
| `.mode-launch-info` | Ver detalles | 24 × 24 | 50% |
| `.mode-launch-context-card` | Mundo/bioma/reglas | 344 × 91 | 12 px |
| `#btn-mode-launch-detail-close` | Volver desde detalle | ≥44 px de área | circular |
| `#btn-mode-launch-start` | Abrir mapa/Empezar/Entrar | ancho interior completo | CTA redondeado |
| `#worlds-back` | Volver | 44 × 44 | 12 px |
| `#worlds-settings` | Ajustes | 44 × 44 | 12 px |
| `#world-rewards` | Ver recompensas | 351 × 44 | 16 px |
| `.lvl-node.current` | Nivel actual | 57 × 57 | 14 px |
| `.lvl-node.locked` | Nivel bloqueado | 57 × 57 | 14 px |
| `.lvl-reward` | Recompensa del mundo | 321 × 54 | 14 px |
| `.wr-item.sel` | Mundo seleccionado | 351 × 60 | 14 px |
| `.wr-item.locked` | Mundo bloqueado | 351 × 60 | 14 px |
| `#wt-shop` | Estilos | 70 × 59 | 12 px |
| `#wt-missions` | Misiones | 70 × 59 | 12 px |
| `#wt-play` | Jugar | 70 × 59 | 12 px |
| `#wt-chests` | Cofres | 70 × 59 | 12 px |
| `#wt-rank` | Clasificación | 70 × 59 | 12 px |
| `#btn-pause` | Pausa | 42 × 42 | 50% |
| `#btn-hint` | Pista | 34 × 34 | 12 px |
| `.cell.empty` | Celda vacía | 41 × 41 | 11 px |
| `.cell.has-icon` | Celda con ficha | 41 × 41 | 11 px |
| `.cell.tile-bomb` | Bomba | 41 × 41 | 11 px |
| `.cell.empty.hint` | Hint en composición compacta | 41 × 35 | 11 px |
| `.booster` | Bomba/Hielo/Rayo/Barrido/Doble | 5 columnas fluidas | arcade card |

## 5. Pausa, tutorial y resultado

| Selector | Etiqueta/estado | Tamaño | Radio |
|---|---|---:|---:|
| `#btn-pause-settings` | Ajustes | 48 × 67 | arte sin caja visible |
| `#btn-resume` | Reanudar | 313 × 54 | 12 px |
| `#btn-pause-restart` | Reiniciar | 313 × 54 | 12 px |
| `#btn-pause-quit` | Menú principal | 313 × 54 | 12 px |
| `#coach-play` | Jugar nivel 1 | 131 × 36 | 16 px |
| `#coach-skip` | Saltar tutorial | 111 × 36 | 16 px |
| `#coach-skip` | Ir al menú | 144 × 36 | 16 px |
| `#boss-coach-ok` | Entendido/Continuar | ancho del card | CTA |
| `#pl-play` | Jugar con selección | ancho del overlay | 16 px |
| `#pl-skip` | Omitir preparación | ancho del overlay | 16 px |
| `#pick-cancel` | Cancelar picker | ancho de panel | 16 px |
| `#btn-next-level` | Siguiente nivel | ancho modal | 16 px |
| `#btn-level-map` | Volver al mapa | ancho modal | 16 px |
| `#btn-revive` | Revivir | ancho modal | 16 px |
| `#btn-giveup` | Rendirse | ancho modal | 16 px |
| `#btn-retry` | Reintentar | ancho de columna | 16 px |
| `#btn-share` | Compartir | ancho de columna | 16 px |
| `#btn-over-quit` | Menú | ancho de columna | 16 px |

## 6. Tienda y personalización

| Selector | Etiqueta/estado | Tamaño | Radio |
|---|---|---:|---:|
| `.resource-buy` | Pack de gemas/monedas | 151 × 47 | 11 px |
| `.resource-buy-gems` | Activar XP ×4 | 151 × 47 | 11 px |
| `#resource-shop-close` | Volver | 184 × 44 | 16 px |
| `[data-act="open-style-shop"]` | Personalización | 184 × 44 | 16 px |
| `#shop-close` | Volver | 183 × 44 | 16 px |
| `[data-act="open-resource-shop"]` | Monedas, gemas y XP | 183 × 44 | 16 px |
| `.shop-sw` | Vista previa de tema | 46 × 46 | 12 px |
| `.iconpack-preview` | Ver iconos | 105 × 105 | 16 px |
| `#icon-pack-action` | Comprar/Equipar/Equipado | 312 × 48 | 16 px |
| `#icon-pack-close` | Volver | 312 × 48 | 16 px |
| `.btn-sm` de cosmético | Comprar/Equipar/Exclusivo | 73–148 × 34–44 | 16 px |

## 7. Colecciones y perfil

| Selector | Etiqueta/estado | Tamaño | Radio |
|---|---|---:|---:|
| `.col-card-boards` | Tableros | 342 × 74 | 16 px |
| `.col-card-themes` | Temas | 342 × 74 | 16 px |
| `.col-card-iconpacks` | Iconos | 342 × 74 | 16 px |
| `.col-card-avatars` | Avatares | 342 × 74 | 16 px |
| `.col-card-borders` | Bordes | 342 × 74 | 16 px |
| `.col-card-achievements` | Logros | 342 × 74 | 16 px |
| `.col-back` | Volver | 52 × 52 | 50% |
| `.col-filter.is-active` | Todos | 54 × 30 | 999 px |
| `.col-filter` | Comunes/Raros/etc. | 53–86 × 30 | 999 px |
| `.col-sort-btn` | Más reciente | 107 × 30 | 999 px |
| `.col-tile` | Tile common owned/locked | 74 × 106 | superficie interna |
| `.col-tile` | Tile rare/epic | 74 × 98 | superficie interna |
| `.col-tile` | Tile legendary | 74 × 89 | superficie interna |
| `.col-banner-cta` | Ir a tienda | 116 × 48 | 16 px |
| `.col-banner-cta` | Ir a eventos | 128 × 48 | 16 px |
| `.col-banner-cta` | Jugar | 78 × 48 | 16 px |
| `.profile-edit-name` | Editar nombre | 127 × 44 | 16 px |
| `.profile-cosmetic-tile.is-equipped` | Avatar/borde equipado | 149 × 138 | 18 px |
| `.profile-cosmetic-tile.is-locked` | Avatar/borde bloqueado | 149 × 138 | 18 px |

## 8. Cofres

| Selector | Etiqueta/estado | Tamaño | Radio |
|---|---|---:|---:|
| `.chests-close` | Volver | 44 × 44 | 50% |
| `.chest-shop-shortcut` | Tienda de cofres | 169 × 37 | 13 px |
| `#btn-chest-catalog` | Ver todos | 177 × 44 | 13 px |
| `#btn-chest-catalog-close` | Volver a mis cofres | 334 × 44 | 11 px |
| `.chest-empty-buy` | Comprar cofres | 153 × 48 | 14 px |
| `.chest-empty-play` | Jugar y ganar | 153 × 48 | 14 px |
| `.chest-slot-ready` | Cofre listo | 176 × 197 | 15 px |
| `.chest-slot-waiting` | Cofre en espera | 176 × 197 | 15 px |
| `.chest-slot-locked` | Desbloquear ranura | 176 × 176–197 | 15 px |
| `.chest-notice-action` | Notificaciones del navegador | 273 × 36 | 999 px |
| `.chest-survival-cta` | Jugar Supervivencia | 332 × 66 | 16 px |
| `#btn-open-premium` | Elegir/Abrir | 336 × 58 | 15 px |
| botón premium de gemas | Abrir cofre premium 25 | 332 × 44 | 11 px |
| `.cr-item` | Premio único/choice | 92–291 × 112 | 13 px |
| `.cr-item.is-revealed` | Premio revelado | 92 × 112 | 13 px |
| `Seguir` | Cerrar ceremonia | ancho de panel | CTA |

## 9. Matriz de ubicación de controles estáticos

Esta matriz evita que un control pequeño quede oculto dentro de una
descripción de componente.

| Contenedor | Controles declarados |
|---|---|
| `#screen-login` | `#player-name`; submit `¡Empezar!`; `#btn-guest` |
| `#screen-start` | `#btn-resume-run`; `#home-play-now`; `#btn-install`; nav Eventos, Tienda, Inicio, Guía, Colecciones |
| `#screen-worlds` | `#worlds-back`; `#worlds-settings`; `#world-rewards`; `#wt-shop`; `#wt-missions`; `#wt-play`; `#wt-chests`; `#wt-rank` |
| `#screen-game` | Comprar monedas; Comprar gemas; `#btn-pause`; `#btn-hint`; `#coach-play`; `#coach-skip`; `#btn-hint-tool` |
| `#boss-coach` | `#boss-coach-ok` |
| `#pick-overlay` | `#pick-cancel` más opciones dinámicas |
| `#prelevel` | `#pl-play`; `#pl-skip`; boosters dinámicos |
| `#modal-mode-launch` | cerrar; `#btn-mode-launch-detail-close`; `#btn-mode-launch-start`; cards/opciones dinámicas |
| `#view-events` | `#events-reward-claim`; Ver misión; Jugar diario; `#events-choice-open`; Abrir cofres |
| `#view-missions` | CTA Jugar; reroll dinámico |
| `#view-how` | Volver; 4 cards de modo; `#btn-tutorial` |
| `#modal-pause` | `#btn-pause-settings`; `#btn-resume`; `#btn-pause-restart`; `#btn-pause-quit` |
| `#modal-icon-pack` | `#icon-pack-action`; `#icon-pack-close` |
| `#modal-level` | `#btn-next-level`; `#btn-level-map` |
| `#modal-over` | `#btn-retry`; `#btn-share`; `#btn-over-quit` |
| `#view-settings` | cerrar; 5 switches; ES; EN |
| `#modal-revive` | `#btn-revive`; `#btn-giveup` |
| `#view-daily` | `#btn-daily-start`; Volver |
| `#view-adventure` | `#adventure-continue`; Volver |
| `#view-resource-shop` | Personalización; `#resource-shop-close`; ofertas dinámicas |
| `#view-shop` | Tienda de recursos; `#shop-close`; cosméticos dinámicos |
| `#view-chests` | Volver; Tienda; catálogo; premium; timer; empty CTAs; Survival CTA; cierre de catálogo |
| `#view-multi` | `#btn-multi-notify`; Volver |
| `#view-medals` | Editar nombre; Volver; tiles dinámicos |
| `#view-collections` | 6 cards de categoría dinámicas |
| `#view-collection-detail` | Volver; filtros; orden; tiles; CTA contextual |

## 10. Estados obligatorios por familia

| Familia | Estados que deben conservar diseño |
|---|---|
| Botón | default, hover con puntero, active, focus-visible, disabled |
| Card seleccionable | default, selected/current, disabled/locked |
| Switch | true, false, focus-visible |
| Wallet | saldo corto, saldo largo/compactado, compra |
| Cofre | empty, waiting, opening, ready, selected, locked, reward |
| Cosmético | locked, owned, equipped, exclusive |
| Colección | empty/progreso, owned, locked, filtered |
| Modal | body corto, body con scroll, CTA enabled/disabled |
| Partida | normal, peligro, Fever, boss warning, aiming booster, paused, ended |
| Toast | info, good, warn, bad, idle event |

## 11. Excepciones de área táctil

El mínimo declarado es `--tap:44px`. Las cajas que quedan por debajo son:

| Selector | Medida | Riesgo |
|---|---:|---|
| `.home-mode-dot` | 7 × 7 | Área real demasiado pequeña |
| `.home-mode-dot.is-selected` | 23 × 7 | Área real demasiado baja |
| `.mode-launch-info` | 24 × 24 | Difícil de activar con pulgar |
| `.hub-header-plus` | 27 × 27 | Acción económica frecuente |
| `.event-card-action` | 31 px de alto | Por debajo del mínimo |
| `#btn-hint` | 34 × 34 | Acción in-game frecuente |
| `.mode-launch-close` | 34 × 39 | Cierre bloqueante |
| `.hub-header-settings` | 37 × 37 | Acción global |
| `.how-back` | 41 × 41 | Ligeramente inferior |
| `#btn-pause` | 42 × 42 | Ligeramente inferior |

Recomendación de mantenimiento: conservar el círculo/pill visual, pero añadir
un wrapper o pseudo-hit-area de al menos 44 × 44 sin alterar el layout.

## 12. Evidencia

Cada control de este anexo puede localizarse en las capturas enlazadas desde
[`SCREENSHOT_INDEX.md`](./SCREENSHOT_INDEX.md). La fuente de verdad de color,
tipografía, radios, sombras y responsive está en
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).
