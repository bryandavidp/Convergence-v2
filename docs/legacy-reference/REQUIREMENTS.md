# Requisitos — Convergence

> Documento de requisitos **reconstruido a partir del código existente** (ingeniería inversa), no un documento de diseño previo. Sirve como checklist de aceptación para cualquier reimplementación: si un requisito de aquí no está cubierto, la migración no es 100% fiel. Para el detalle técnico exacto (fórmulas, constantes, claves de datos) ver [`MIGRATION_SPEC.md`](./MIGRATION_SPEC.md).

## 1. Resumen del producto

Convergence es un juego de puzzle casual, mobile-first, instalable como PWA, jugable 100% offline tras la primera carga, sin cuentas de usuario ni backend. Todo el progreso vive en el dispositivo (`localStorage`). El jugador combina iconos idénticos tocando la casilla vacía entre ellos; el objetivo varía según el modo (vaciar el tablero, sobrevivir oleadas, acumular puntos a contrarreloj, progresar por un mapa infinito de biomas).

## 2. Requisitos funcionales

### 2.1 Mecánica core (todos los modos)
- RF-01: El tablero es una grilla NxN (por defecto 8×8) donde cada celda está vacía o contiene un icono.
- RF-02: Al tocar una celda vacía, el juego debe explorar las 4 direcciones cardinales y considerar, en cada una, únicamente el **icono no vacío más cercano** (las celdas sólidas bloquean la línea de visión).
- RF-03: Si el mismo icono aparece como "más cercano" en 2 o más direcciones, todas esas instancias convergen (se eliminan) y otorgan puntos.
- RF-04: Si no hay convergencia posible desde la celda tocada, se penaliza (feedback visual/sonoro/háptico de "fallo"; en modos con `penalties: true`, se agregan iconos extra al tablero).
- RF-05: El sistema debe generar (spawnear) iconos nuevos en celdas vacías de forma periódica, acelerando con el tiempo/nivel/errores, salvo cuando el modo lo bloquee explícitamente (congelación, etc.).
- RF-06: El juego debe terminar (o degradar según el modo) cuando no queden celdas vacías disponibles para un nuevo spawn.
- RF-07: Debe existir un sistema de combo con ventana temporal: toques exitosos consecutivos dentro de una ventana de tiempo incrementan un multiplicador de puntuación; expirar la ventana reinicia el combo.
- RF-08: Debe existir un modo "Fiebre" (Fever) que se activa a partir de cierto combo y multiplica temporalmente la puntuación.
- RF-09: Debe existir un sistema de pistas (hint) limitado por nivel/partida y con cooldown, que resalte una jugada válida.
- RF-10: El sistema de generación de iconos debe evitar ambigüedad visual: dentro de la variedad de iconos activa en un momento dado, no debe haber dos iconos "parecidos mas no idénticos" que puedan confundir al jugador (mismo shape, distinto color, o viceversa, dentro de la ventana activa).
- RF-11: Cuando quedan pocos iconos en el tablero, el sistema de spawn debe sesgar la generación para ayudar a emparejar los iconos sobrantes (asistencia anti-frustración), sin ser 100% determinista.

### 2.2 Modos de juego
- RF-20: **Tutorial** — secuencia guiada de 2 pasos con tableros fijos, resaltando la celda objetivo, que se completa una única vez por instalación.
- RF-21: **Clásico** — progresión de niveles organizados en mundos temáticos (5 mundos × 50 niveles), objetivo por defecto "vaciar el tablero", puntuación en estrellas (0-3) según errores cometidos, obstáculos específicos por mundo, desbloqueo secuencial de niveles y de mundos.
- RF-22: **Aventura** — progresión infinita por capítulos agrupados en biomas cíclicos (6 biomas), con objetivos variables por posición dentro del capítulo (vaciar / puntuación / supervivencia / jefe), dificultad creciente sin límite superior, siempre retomable desde el nivel más lejano alcanzado.
- RF-23: **Contrarreloj** — partida continua a puntuación, con reloj que empieza en un valor fijo, se repone con cada convergencia (con rendimientos decrecientes) y tiene un tope máximo; termina al agotarse el tiempo.
- RF-24: **Supervivencia** — modo infinito con vidas limitadas, oleadas que escalan en dificultad, eventos especiales periódicos (tipo jefe), preparación opcional de hasta 3 potenciadores por intento usando primero el arsenal persistente y después monedas, un anillo de suministro que convierte juego hábil en una pequeña recompensa de monedas, un medidor de "frenesí" independiente, revivir pagando moneda al perder la última vida, y 3 niveles de dificultad seleccionables antes de empezar. El arsenal persistente nunca debe estar disponible ni consumirse implícitamente durante la partida.
- RF-25: **Zen** — modo relajado sin penalizaciones ni derrota: si el tablero se llena, se despeja parcialmente en lugar de terminar la partida.
- RF-26: **Multijugador** — actualmente solo un placeholder ("Próximamente") con opción de "avisarme"; no implementado funcionalmente.

### 2.3 Progresión y economía
- RF-30: Debe existir un perfil de jugador persistente con experiencia (XP) y nivel, con una curva de progresión definida, y con "rangos" narrativos que cambian cada cierto número de niveles.
- RF-31: Debe existir un sistema de misiones diarias (una por día, elegida determinísticamente para que sea la misma para todos los jugadores en la misma fecha, sin servidor) y un desafío semanal equivalente, cada uno con progreso, condición de éxito y recompensa automática en XP/monedas. Una misión diaria incompleta puede cambiarse gastando 1 ticket.
- RF-32: Debe existir un sistema de logros/medallas con condiciones variadas (partidas jugadas, combos, puntuación, iconos eliminados, racha de días jugados, etc.), cada uno desbloqueable una única vez con fecha de desbloqueo persistida.
- RF-33: Debe existir una recompensa diaria por inicio de sesión con racha (streak): la recompensa crece con los días consecutivos hasta un tope, y la racha se reinicia si se salta un día.
- RF-34: Debe existir al menos 3 monedas/recursos (moneda principal, gema, ticket) con distintas fuentes de obtención (fin de partida, niveles, oleadas, cofres, recompensa diaria).
- RF-35: Debe existir un sistema de cofres acumulables que, al abrirse, entregan una recompensa aleatoria de una tabla de probabilidades con al menos 3 tramos de rareza. La apertura debe visualizar primero la animación del cofre y después revelar el premio, respetando ambos modos de reducción de movimiento.
- RF-36: Debe existir un leaderboard local (mejor puntuación por modo + mejor puntuación global histórica).
- RF-37: Debe registrarse estadísticas agregadas de por vida (puntuación total, mejor combo, tiempo total jugado, partidas jugadas, iconos eliminados en total).
- RF-38: Debe existir un XP Booster temporal ×4 en packs de 6 horas, 3 días y 7 días comprables con gemas. Su vencimiento usa reloj de pared, las compras activas acumulan tiempo y cada partida captura el multiplicador al comenzar; ese snapshot debe sobrevivir a `RunSave` y mostrarse en HUD/resultados.
- RF-39: Monedas y gemas deben tener una tienda de recursos propia, separada de la personalización, con catálogo allowlist y checkout local automático de pruebas. La vista debe advertir de forma inequívoca que no existe cobro real.

### 2.4 Personalización (cosméticos)
- RF-40: Debe existir una tienda de personalización independiente con **skins de tablero** comprables con la moneda principal, puramente cosméticos (sin efecto en el gameplay), con un catálogo de al menos 8-10 opciones a precios crecientes, uno gratuito por defecto.
- RF-41: Debe existir una selección de **temas de color** de interfaz, comprables igual que los skins, aplicados vía variables CSS globales.
- RF-42: El estado de "comprado"/"equipado" de cosméticos debe persistir y aplicarse automáticamente al recargar la app.

### 2.5 Configuración de usuario
- RF-50: Ajustes persistentes: efectos de sonido (on/off), música (on/off), vibración/háptica (on/off, si el dispositivo lo soporta), modo de "reducir efectos" (independiente del ajuste de accesibilidad del SO), texto grande, idioma.
- RF-51: Cambiar el idioma debe re-renderizar inmediatamente toda la UI dinámica sin recargar la página.
- RF-52: Debe poder editarse el nombre de jugador y elegirse un color de avatar en el alta inicial.
- RF-53: Eventos, Misiones, Guía, Ajustes, Diario, Aventura, Tienda de recursos, Tienda de personalización, Cofres, Multijugador, Logros/Perfil y Colecciones deben navegar como vistas completas dentro de Inicio, conservando appbar y menú inferior. Los modales quedan reservados a interrupciones transitorias de la partida.

### 2.6 Internacionalización
- RF-60: Toda la interfaz debe soportar como mínimo español e inglés mediante un diccionario clave→texto, con selección de idioma por defecto basada en el idioma del navegador y overridable manualmente.
- RF-61: Los textos generados dinámicamente por JS (nombres/descripciones/objetivos de modo, menús) deben pasar también por el sistema de traducción, no solo el HTML estático.

### 2.7 Audio y feedback
- RF-70: Todos los efectos de sonido y la música deben poder generarse sin archivos de audio externos (síntesis en tiempo real), para minimizar peso de descarga.
- RF-71: Debe existir feedback háptico (vibración) en eventos clave (toque, combo, error, nivel, récord, etc.) en dispositivos compatibles.
- RF-72: El audio debe desbloquearse correctamente tras el primer gesto del usuario (requisito de autoplay policies, especialmente iOS) y debe reanudarse si el contexto de audio se suspende.

### 2.8 PWA / instalación / offline
- RF-80: La app debe ser instalable como PWA (manifest + Service Worker) y funcionar completamente offline tras la primera visita.
- RF-81: Debe informarse al usuario cuando haya una versión nueva disponible tras actualizar el Service Worker.
- RF-82: Debe ofrecerse un flujo de instalación manual con instrucciones específicas para plataformas sin `beforeinstallprompt` nativo (iOS/Safari).

### 2.9 Accesibilidad
- RF-90: Elementos interactivos deben cumplir un tamaño mínimo de toque (~44px, con variante ~52px para acciones primarias).
- RF-91: Debe existir una región `aria-live` para anunciar eventos relevantes a lectores de pantalla.
- RF-92: Debe respetarse `prefers-reduced-motion` del sistema operativo, además de ofrecer un ajuste propio de "reducir efectos" independiente y más granular.
- RF-93: Estados de foco visibles (`:focus-visible`) en todos los controles interactivos y navegación coherente por teclado (Escape regresa de una vista del hub, cierra un diálogo o pausa/reanuda según el contexto).

## 3. Requisitos no funcionales

- RNF-01 **Rendimiento**: el juego debe mantener una experiencia fluida en dispositivos móviles de gama media/baja; debe existir un gobernador adaptativo que reduzca la cantidad de partículas/efectos simultáneos si el frame time se degrada.
- RNF-02 **Offline-first**: ninguna funcionalidad del núcleo del juego debe depender de conectividad de red.
- RNF-03 **Sin backend**: toda la persistencia (progreso, economía, ajustes) vive en el cliente; no se requiere autenticación ni sincronización remota.
- RNF-04 **Responsive / mobile-first**: la UI debe adaptarse de forma fluida a distintos tamaños de viewport (teléfono a escritorio), orientación portrait como caso principal, respetando áreas seguras (notch/home-indicator).
- RNF-05 **Determinismo suficiente pero no estricto**: no se requiere replay bit-a-bit de partidas; el uso de aleatoriedad no seedeada es aceptable.
- RNF-06 **Tolerancia a esquemas de datos**: cualquier cambio en el modelo de datos persistente debe poder migrarse rellenando campos faltantes sin perder el progreso existente del usuario (esquema versionado).
- RNF-07 **Peso ligero**: preferencia explícita por generar contenido (iconos, sonidos, música) en tiempo de ejecución en vez de distribuir binarios pesados, cuando sea razonable.
- RNF-08 **Compatibilidad de navegador**: se asume soporte de navegadores evergreen modernos (el código usa `color-mix()`, `dvh`/`svh`, sin fallbacks para navegadores que no los soporten).
- RNF-09 **Cacheo agresivo con invalidación manual controlada**: el mecanismo de actualización de PWA debe permitir invalidar la caché completa en cada release sin depender de hashing automático de contenido.

## 4. Fuera de alcance / no implementado en el código actual

Estos puntos existen como intención en el código (UI, campos de datos, comentarios) pero **no tienen lógica funcional completa** — cualquier migración debe decidir explícitamente si los implementa desde cero o los mantiene como placeholder:

- Multijugador real (solo vista "Próximamente" + botón "Avísame").
- Pasarela de pago real, validación de recibos y concesión server-side: las compras de monedas/gemas usan exclusivamente el checkout ficticio `mock-auto`, sin cobro.
- Pack de assets `img/ui-system/` (sprites de botones/ventanas/checkboxes): referenciado por `sw.js` para precache pero **ausente físicamente del repo** y **no usado por `styles.css`** — parece un sistema de UI con sprites descartado en favor de componentes CSS puros.
- Tile `infected` (definido en `Tiles.DEFS` con descripción "se propaga si no la limpias") sin uso activo confirmado en las reglas leídas de Aventura/Clásico/Supervivencia.

## 5. Trazabilidad

Cada requisito funcional de este documento tiene su fórmula/constante/estructura de datos exacta documentada en [`MIGRATION_SPEC.md`](./MIGRATION_SPEC.md); use ese documento como fuente de verdad para valores numéricos exactos al implementar.
