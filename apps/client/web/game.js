/* =========================================================================
 * Convergencia — clon vanilla (sin frameworks, sin assets externos).
 *
 * Mecánica: toca una casilla VACÍA; se mira el icono más cercano en cada una
 * de las 4 direcciones; si 2 o más coinciden, convergen y se eliminan.
 *
 * Arquitectura modular (objetos independientes) pensada para poder dividir
 * cada bloque en su propio archivo o migrar a otro lenguaje:
 *   Config · Storage · Sound · State · Engine · Render · Toasts · Screens ·
 *   Loop · Game · Input · init
 *
 * Rendimiento (móvil): un único bucle rAF, celdas DOM reutilizadas (se
 * actualiza solo lo que cambia), animaciones por transform/opacity, pool de
 * popups, entrada por pointerdown (sin retardo de 300 ms).
 * ========================================================================= */
(() => {
  'use strict';

  const VERSION = '2.37.9';

  /* Núcleo de reglas compartido con el backend (`packages/game-core`). Llega
   * como script clásico cargado antes que game.js, porque el cliente es vanilla
   * y sin bundler. Si faltara, cada modo cae a su expresión histórica y el juego
   * sigue jugándose: la paridad entre ambos caminos la fija
   * `time-attack-parity.test.mjs`. */
  const GameCore = {
    get core() { return window.ConvergenceGameCore || null; },
    ready() { return !!window.ConvergenceGameCore; },
    timeAttack() { return State.mode === 'contrarreloj' && !!window.ConvergenceGameCore; },
  };
  const Platform = window.ConvergencePlatform || {
    runtime: 'web', isNative: false, hapticsAvailable: false,
    mirrorStorage() { }, removeStorage() { }, haptic() { return false; },
    async share() { return false; }, exitApp() { },
  };

  /* ===================== Telemetría de errores (local, sin red) =====================
   * Guarda los últimos errores en localStorage para diagnóstico, sin enviar nada.
   */
  const ErrLog = {
    KEY: 'cv_errlog', MAX: 20,
    push(kind, msg, extra) {
      try {
        const a = JSON.parse(localStorage.getItem(this.KEY) || '[]');
        a.push({ t: Date.now(), v: VERSION, kind, msg: String(msg).slice(0, 300), extra });
        while (a.length > this.MAX) a.shift();
        localStorage.setItem(this.KEY, JSON.stringify(a));
      } catch (_) { }
    },
  };
  window.addEventListener('error', (e) => { ErrLog.push('error', e.message, { src: e.filename, line: e.lineno }); showFatalError(); });
  window.addEventListener('unhandledrejection', (e) => { ErrLog.push('promise', (e.reason && e.reason.message) || e.reason); showFatalError(); });
  // Banner de recuperación: un fallo de JS no debe dejar una pantalla muerta. Se muestra
  // una sola vez (anti-bucle) con un botón para recargar. Texto en fallback si I18n aún
  // no existe (error muy temprano en el arranque).
  let _fatalShown = false;
  function showFatalError() {
    if (_fatalShown || !document.body) return;
    _fatalShown = true;
    const tt = (k, fb) => { try { return (typeof I18n !== 'undefined' && I18n.t(k)) || fb; } catch (_) { return fb; } };
    const box = document.createElement('div');
    box.className = 'fatal-error';
    box.setAttribute('role', 'alert');
    const msg = document.createElement('span');
    msg.textContent = tt('err_fatal', 'Algo ha fallado.');
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-sm';
    btn.textContent = tt('err_reload', 'Recargar');
    btn.addEventListener('click', () => location.reload());
    box.appendChild(msg); box.appendChild(btn);
    document.body.appendChild(box);
  }
  // Banner de navegador no soportado (sin color-mix): texto plano, sin depender de la
  // feature que falta. Detiene el arranque del juego.
  function showBrowserWarn() {
    if (!document.body) return;
    const box = document.createElement('div');
    box.className = 'browser-warn';
    box.setAttribute('role', 'alert');
    try { box.textContent = I18n.t('browser_old'); } catch (_) { box.textContent = 'Your browser is too old to play. Please update it.'; }
    document.body.appendChild(box);
  }
  // Aviso accionable de nueva versión del Service Worker: botón "Actualizar" que recarga
  // para servir los assets nuevos (RunSave conserva la partida en curso al recargar).
  let _updateShown = false;
  function showUpdateBanner(reg) {
    if (_updateShown || !document.body) return;
    _updateShown = true;
    const activate = () => {
      try { if (reg && reg.waiting) reg.waiting.postMessage('skipWaiting'); } catch (_) { }
      location.reload();
    };
    // Durante una partida también los avisos del sistema usan el único centro del
    // HUD: nada fijo en el borde inferior puede volver a tapar tablero o contexto.
    if (document.body.dataset.screen === 'game') {
      Toasts.show({
        key: 'app-update', kicker: 'HILO', title: I18n.t('update_ready'),
        detail: I18n.t('update_btn'), icon: 'info', kind: 'info', priority: 34,
        ms: 8000, onClick: activate,
      });
      return;
    }
    const box = document.createElement('div');
    box.className = 'update-banner'; box.setAttribute('role', 'status');
    document.body.classList.add('has-update-banner');
    const msg = document.createElement('span');
    msg.textContent = I18n.t('update_ready');
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-sm';
    btn.textContent = I18n.t('update_btn');
    btn.addEventListener('click', activate);
    box.appendChild(msg); box.appendChild(btn);
    document.body.appendChild(box);
  }

  /* ===================== Config ===================== */
  const Config = {
    SIZE: 8,
    // Los iconos ya no son emojis: se generan por SVG (ver el módulo Icons).
    COMBO_MULTIPLIERS: [[30, 10], [20, 8], [15, 5], [10, 3], [6, 2], [3, 1.5]], // [umbral, multiplicador], desc
    MILESTONES: { 10: 500, 20: 1000, 30: 2000 },
    EMPTY_BOARD_BONUS: 500,   // bonus por dejar el tablero vacío
    // Ayuda de vaciado: con el tablero casi vacío (<= threshold iconos), sesga el icono
    // que aparece hacia los que ya están (prioriza solitarios) para no alargar el vaciado.
    CLEAR_ASSIST: { threshold: 6, pMax: 0.9, decay: 0.1, pMin: 0.25 },
    // Refill tras limpiar modos que no terminan (Contrarreloj/Supervivencia/Zen).
    // La cantidad sube con la dificultad y con la cadena de tableros vaciados, pero
    // se siembra con pares jugables para evitar tableros imposibles tras el premio.
    EMPTY_BOARD_REFILL: { min: 10, baseFactor: 0.55, maxFactor: 1.1, hardCap: 26, maxPairs: 6, perClear: { facil: 2, normal: 3, dificil: 4 } },
    // Estrellas del nivel (Clásico): máximo de ERRORES permitidos para 3★ y 2★.
    // 0 errores -> 3★ · hasta 2 errores -> 2★ · más -> 1★.
    STAR_ERR: [0, 2],
    FEVER_COMBO: 10,          // combo para entrar en modo Fever
    FEVER_BOOST: 1.25,        // multiplicador extra de puntos en Fever
    // Contrarreloj (score attack): el reloj tiene TOPE -> el tiempo ganado no se
    // acumula sin límite (evita partidas infinitas a base de combos).
    TIMED_START: 60,          // s reloj inicial
    TIMED_CAP: 90,            // s máximo en el reloj (tope duro)
    TIMED_MISTAKE_S: 3,       // GM-11: el error en score-attack cuesta segundos, no iconos
    TIMED_GAIN: { base: 0.9, perIcon: 0.6, combo: 0.32, comboCap: 4, decaySec: 125, minDecay: 0.08 },
    SPRINT_WINDOW: 10,        // GM-10: sprint final — con <=10s en el reloj...
    SPRINT_MULT: 1.5,         // ...todos los puntos ×1.5 (riesgo-recompensa: cabalgar el borde)
    // GM-26: warm-up de apertura — el intervalo de spawn se multiplica ×0.55 los
    // primeros 10s del nivel (o hasta la 3ª convergencia) y sale con rampa de 2s.
    // Material temprano => primer combo antes (ataca el "arranque frío", D2 del plan).
    WARMUP: { ms: 10000, convs: 3, factor: 0.55, rampMs: 2000 },
    // GM-02: continuar con gemas al llenarse el tablero (Clásico/Aventura) — 1 oferta
    // por nivel, despeja el 40%. Primer sumidero de gemas de gameplay.
    CONTINUE_GEMS: 15,
    CONTINUE_CLEAR: 0.40,
    // Economía común de potenciadores. Clásico ofrece el subconjunto histórico;
    // Supervivencia permite preparar cualquiera de los cinco antes de confirmar
    // la partida. El stock persistente sustituye el coste, nunca se consume solo.
    BOOSTER_PRICES: { bomb: 80, freeze: 60, clearLine: 90, wild: 100, x2: 70 },
    // GM-03: potenciadores pre-nivel de Clásico (coste en monedas, máx. 2 por nivel,
    // desde el 2º mundo).
    PRELEVEL_BOOSTERS: { bomb: 80, freeze: 60, clearLine: 90 },
    PRELEVEL_MAX: 2,
    PRELEVEL_FROM_WORLD: 1,   // índice de mundo (0 = Bosque juega sin fricción)
    SURVIVAL_LOADOUT_MAX: 3,
    HINTS_PER_LEVEL: 3,
    HINT_COOLDOWN: 10000,     // ms
    HINT_DURATION: 2000,      // ms
    DIFFICULTY: {
      facil: { label: 'Fácil', initialIcons: 12, comboWindow: 5000, spawnStart: 6000, spawnMin: 2000, scoreMult: 0.8, penaltyBase: 1 },
      normal: { label: 'Normal', initialIcons: 18, comboWindow: 3500, spawnStart: 5000, spawnMin: 1400, scoreMult: 1.0, penaltyBase: 2 },
      dificil: { label: 'Difícil', initialIcons: 24, comboWindow: 2500, spawnStart: 3800, spawnMin: 900, scoreMult: 1.3, penaltyBase: 3 },
    },
    MODES: {
      tutorial: { name: 'Tutorial', emoji: '🎓', timed: false, penalties: false, mult: 0.5, single: true, fixedDiff: 'facil', accent: '#ffd23f', goal: 'Junta dos iguales', desc: 'Aprende la mecánica sin prisa ni penalizaciones.' },
      clasico: {
        name: 'Clásico', emoji: '🗺️', timed: false, penalties: true, mult: 1.0, accent: '#2f6bff', goal: 'Vacía el tablero', desc: 'Supera niveles con diferentes mapas y desafíos únicos.',
        onSetupLevel(ctx) { Classic.setup(ctx.level); },
        // GM-03: los potenciadores pre-nivel (congelar) también pausan el spawn aquí.
        blockSpawn() { return Survival.frozen() || Survival.locked(); }
      },
      aventura: {
        name: 'Aventura', emoji: '🚀', timed: false, penalties: true, mult: 1.1, accent: '#7a5cff', desc: 'Viaje infinito por biomas con reglas propias, objetivos y mini-jefes. ¿Hasta dónde llegarás?',
        onSetupLevel(ctx) { Adventure.setup(ctx.level); },
        onTick(dt) { Adventure.onTick(dt); },
        winCheck() { Adventure.refreshGoal(State.level); return Adventure.winCheck(); },
        // El objetivo MANDA: solo en niveles 'clear' se gana vaciando el tablero;
        // en score/survive/boss vaciar NO completa el nivel antes de tiempo.
        boardClearWins() { return Adventure.objective === 'clear'; },
        blockSpawn() { return Survival.frozen() || Survival.locked(); }
      },
      contrarreloj: {
        name: 'Contrarreloj', emoji: '⏱️', timed: true, scoreAttack: true, penalties: true, mult: 1.2, initialIcons: 22, accent: '#ff6cb0', goal: 'Suma puntos a contrarreloj', desc: 'Un solo tablero: cada convergencia suma algo de tiempo (con tope), pero la presión crece. ¡Puntúa todo lo posible antes de que el reloj llegue a cero!',
        spawnFactor() {
          if (State.elapsed * 1000 < Config.WARMUP.ms) return 1;
          const n = State.iconCount;
          if (n <= 10) return 0.65;
          if (n <= 16) return 0.85;
          if (n >= 30) return 1.1;
          return 1;
        }
      },
      supervivencia: {
        name: 'Supervivencia', emoji: '❤️', timed: false, penalties: true, mult: 1.5, fast: true, endless: true, accent: '#ff5b6e', desc: 'Aguanta oleadas crecientes con vidas, trampas, jefes y potenciadores. ¿Cuánto sobrevivirás?',
        onSetupLevel(ctx) { Survival.setup(ctx.level); },
        onTick(dt) { Survival.onTick(dt); },
        onConverge(ctx) { Survival.onConverge(ctx); },
        onOverflow() { Survival.onOverflow(); },
        blockSpawn() { return Survival.blockSpawn(); },
        spawnFactor() { return Survival.spawnFactor(); }
      },
      zen: {
        name: 'Zen', emoji: '☯️', timed: false, penalties: false, mult: 0.8, relaxed: true, endless: true, noFever: true, accent: '#9be15d', goal: 'Sin fallos ni prisa',
        // HUD-Z3: llenar el tablero en Zen NO es derrota. Transición calmada (mensaje
        // sereno + limpieza parcial), sin rojo ni alarma (el color de peligro se
        // suprime en Render.hud para Zen).
        onOverflow() { Toasts.show(I18n.t('zen_release'), 'info', 1400); Game.softClear(0.45); }, desc: 'Ritmo relajado, sin penalizaciones ni fin de partida. Juega y respira.'
      },
    },
    MODE_ORDER: ['tutorial', 'clasico', 'aventura', 'contrarreloj', 'supervivencia', 'zen'],
    DIFF_ORDER: ['facil', 'normal', 'dificil'],
  };

  /* ===================== Icons (SVG propios, sin emojis) =====================
   * Catálogo ordenado por DIFICULTAD DE DISTINCIÓN (forma+color muy distintos →
   * formas repetidas con colores parecidos). Cada nivel toma una "ventana" del
   * catálogo (ver Engine.poolForLevel) que nunca repite el nivel anterior.
   */
  const Icons = (() => {
    const COLORS = {
      red: '#ff5b6e', blue: '#4b8bff', green: '#3ad07f', yellow: '#ffd23f', purple: '#a06bff',
      cyan: '#2bd4e6', orange: '#ff9838', pink: '#ff79c6', lime: '#b6e64a', white: '#e8eefc',
      teal: '#27b6a0', indigo: '#6c7bff',
    };
    const CNAME = {
      red: 'rojo', blue: 'azul', green: 'verde', yellow: 'amarillo', purple: 'morado',
      cyan: 'cian', orange: 'naranja', pink: 'rosa', lime: 'lima', white: 'blanco', teal: 'turquesa', indigo: 'índigo'
    };
    const ST = 'stroke="rgba(0,0,0,.30)" stroke-width="3" stroke-linejoin="round"';
    const SHAPES = {
      circle: c => `<circle cx="50" cy="50" r="33" fill="${c}" ${ST}/>`,
      square: c => `<rect x="18" y="18" width="64" height="64" rx="12" fill="${c}" ${ST}/>`,
      triangle: c => `<path d="M50 16 L85 80 L15 80 Z" fill="${c}" ${ST}/>`,
      diamond: c => `<path d="M50 13 L87 50 L50 87 L13 50 Z" fill="${c}" ${ST}/>`,
      star: c => `<path d="M50 13 L61 39 L88 41 L67 59 L74 86 L50 71 L26 86 L33 59 L12 41 L39 39 Z" fill="${c}" ${ST}/>`,
      heart: c => `<path d="M50 84 C12 58 20 26 44 26 C50 26 50 33 50 36 C50 33 50 26 56 26 C80 26 88 58 50 84 Z" fill="${c}" ${ST}/>`,
      hexagon: c => `<path d="M50 14 L84 32 L84 68 L50 86 L16 68 L16 32 Z" fill="${c}" ${ST}/>`,
      plus: c => `<path d="M40 15 H60 V40 H85 V60 H60 V85 H40 V60 H15 V40 H40 Z" fill="${c}" ${ST}/>`,
      droplet: c => `<path d="M50 13 C50 13 77 49 77 65 A27 27 0 1 1 23 65 C23 49 50 13 50 13 Z" fill="${c}" ${ST}/>`,
      ring: c => `<circle cx="50" cy="50" r="30" fill="none" stroke="${c}" stroke-width="15"/>`,
      // Figuras desbloqueables (mockup): siluetas limpias, mismo estilo plano + contorno.
      pentagon: c => `<path d="M50 14 L84 39 L71 81 L29 81 L16 39 Z" fill="${c}" ${ST}/>`,
      moon: c => `<path d="M64 16 A36 36 0 1 0 64 84 A28 28 0 1 1 64 16 Z" fill="${c}" ${ST}/>`,
      sun: c => `<path d="M50 8 L58 28 L80 20 L72 42 L92 50 L72 58 L80 80 L58 72 L50 92 L42 72 L20 80 L28 58 L8 50 L28 42 L20 20 L42 28 Z" fill="${c}" ${ST}/>`,
      flower: c => `<g fill="${c}" ${ST}><circle cx="50" cy="28" r="15"/><circle cx="72" cy="44" r="15"/><circle cx="64" cy="70" r="15"/><circle cx="36" cy="70" r="15"/><circle cx="28" cy="44" r="15"/></g><circle cx="50" cy="52" r="12" fill="#ffe9a8" ${ST}/>`,
      clover: c => `<g fill="${c}" ${ST}><circle cx="50" cy="32" r="16"/><circle cx="34" cy="50" r="16"/><circle cx="66" cy="50" r="16"/></g><path d="M48 58 L52 58 L54 86 L46 86 Z" fill="${c}" ${ST}/>`,
      spiral: c => `<path d="M50 50 C50 43 59 43 59 50 C59 62 41 62 41 50 C41 34 67 34 67 50 C67 72 33 72 33 50 C33 25 75 25 75 50" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round"/>`,
    };
    const SNAME = {
      circle: 'círculo', square: 'cuadrado', triangle: 'triángulo', diamond: 'rombo',
      star: 'estrella', heart: 'corazón', hexagon: 'hexágono', plus: 'cruz', droplet: 'gota', ring: 'anillo',
      pentagon: 'pentágono', moon: 'luna', sun: 'sol', flower: 'flor', clover: 'trébol', spiral: 'espiral'
    };

    // Pares [forma, color]. ORDENADOS EN CICLOS de las 10 formas EN EL MISMO
    // ORDEN (3 ciclos = 30 iconos, múltiplo de 10). Cada forma aparece 3 veces
    // con colores distintos. Como cada nivel toma una "ventana" contigua de <=8
    // iconos (ver Engine.poolForLevel) y el periodo del ciclo es 10, CUALQUIER
    // ventana tiene SIEMPRE formas distintas: dos iconos sólo coinciden si son
    // idénticos (misma forma y color), eliminando convergencias "que parecen
    // válidas" por colores parecidos de una misma forma. La longitud múltiplo de
    // 10 conserva la propiedad incluso al dar la vuelta al catálogo.
    // Catálogo generado: ciclos de TODAS las formas en el MISMO orden (período = nº de
    // formas, 16 > 8). Cada forma aparece 3 veces con colores distintos. Como cada nivel
    // toma una ventana contigua de <=8 (Engine.poolForLevel), cualquier ventana tiene
    // siempre formas distintas → dos iconos solo coinciden si son idénticos (forma+color).
    const SHAPE_ORDER = ['circle', 'square', 'triangle', 'star', 'heart', 'diamond', 'hexagon', 'plus', 'droplet', 'ring', 'pentagon', 'moon', 'sun', 'flower', 'clover', 'spiral'];
    const COLOR_ORDER = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan', 'orange', 'pink', 'lime', 'white', 'teal', 'indigo'];
    const PAIRS = [];
    for (let cyc = 0; cyc < 3; cyc++) {
      for (let i = 0; i < SHAPE_ORDER.length; i++) {
        PAIRS.push([SHAPE_ORDER[i], COLOR_ORDER[(i + cyc * 7) % COLOR_ORDER.length]]);
      }
    }
    const CATALOG = [], DEFS = {}, cache = {};
    for (const [shape, color] of PAIRS) { const id = `${shape}_${color}`; CATALOG.push(id); DEFS[id] = { shape, color }; }

    return {
      CATALOG,
      svg(id) {
        if (cache[id]) return cache[id];
        const d = DEFS[id];
        return cache[id] = `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" focusable="false">${SHAPES[d.shape](COLORS[d.color])}</svg>`;
      },
      name(id) { const d = DEFS[id]; return `${SNAME[d.shape]} ${CNAME[d.color]}`; },
      colorOf(id) { const d = DEFS[id]; return d ? COLORS[d.color] : '#fff'; },
    };
  })();

  /* ===================== IconPacks (packs de iconos de tablero) =====================
   * Un pack cambia únicamente el render, el nombre accesible y el color de FX de
   * las fichas: los ids lógicos del tablero permanecen intactos. Los packs PNG se
   * asignan por posición del catálogo; como cada nivel muestra <=8 ids contiguos y
   * cada pack raster incluye al menos 8 diseños, nunca aparecen dos fichas distintas
   * con el mismo aspecto dentro de un nivel. Propiedad/equipado vive en
   * Meta.cosmetics.iconPack(s).
   */
  const IconPacks = {
    DEFAULT: 'cosmos',
    DEFS: {
      cosmos: { name: 'Cosmos', rarity: 'common', cost: 0, descKey: 'iconpack_cosmos_desc' },
      'basic-redesigned': { name: 'Básico Rediseñado', nameKey: 'iconpack_basic_redesigned_name', rarity: 'common', cost: 350, descKey: 'iconpack_basic_redesigned_desc', raster: true, dir: 'basic-redesigned', thumbnail: 'thumbnail.png' },
      'gem-pattern': { name: 'Pack Gemas', nameKey: 'iconpack_gem_pattern_name', rarity: 'rare', cost: 500, descKey: 'iconpack_gem_pattern_desc', raster: true, dir: 'gem-pattern', thumbnail: 'thumbnail.png' },
      'nature-basic': { name: 'Naturaleza Básico', nameKey: 'iconpack_nature_basic_name', rarity: 'rare', cost: 800, descKey: 'iconpack_nature_basic_desc', raster: true, dir: 'nature-basic', thumbnail: 'thumbnail.png' },
      'nature-advanced': { name: 'Naturaleza Avanzado', nameKey: 'iconpack_nature_advanced_name', rarity: 'epic', cost: 1600, descKey: 'iconpack_nature_advanced_desc', raster: true, dir: 'nature-advanced', thumbnail: 'thumbnail.png' },
      neon: { name: 'Pack Neón', nameKey: 'iconpack_neon_name', rarity: 'epic', cost: 1200, descKey: 'iconpack_neon_desc', raster: true, dir: 'neon', thumbnail: 'thumbnail.png' },
      marine: { name: 'Pack Marino', nameKey: 'iconpack_marine_name', rarity: 'epic', cost: 1200, descKey: 'iconpack_marine_desc', raster: true, dir: 'marine', thumbnail: 'thumbnail.png' },
      magic: { name: 'Pack Mágico', nameKey: 'iconpack_magic_name', rarity: 'epic', cost: 1500, descKey: 'iconpack_magic_desc', raster: true, dir: 'magic', thumbnail: 'thumbnail.png' },
      prismatic: { name: 'Joyas Prisma', nameKey: 'iconpack_prismatic_name', rarity: 'legendary', cost: 1800, descKey: 'iconpack_prismatic_desc', raster: true, dir: 'prismatic-jewels', thumbnail: 'thumbnail.png' },
      elemental: { name: 'Pack Elemental', nameKey: 'iconpack_elemental_name', rarity: 'legendary', cost: 2000, descKey: 'iconpack_elemental_desc', raster: true, dir: 'elemental', thumbnail: 'thumbnail.png' },
    },
    order: ['cosmos', 'basic-redesigned', 'gem-pattern', 'nature-basic', 'neon', 'marine', 'magic', 'nature-advanced', 'prismatic', 'elemental'],
    CATALOGS: {
      prismatic: [
        { file: 'violet-diamond.png', es: 'Diamante violeta', en: 'Violet diamond', color: '#c038ff' },
        { file: 'amber-hex.png', es: 'Gema ámbar', en: 'Amber gem', color: '#ff9a18' },
        { file: 'aqua-drop.png', es: 'Gota aguamarina', en: 'Aquamarine drop', color: '#16cfff' },
        { file: 'pink-heart.png', es: 'Corazón rosa', en: 'Pink heart', color: '#ff39a3' },
        { file: 'violet-spiral.png', es: 'Espiral violeta', en: 'Violet spiral', color: '#8a35ff' },
        { file: 'cyan-moon.png', es: 'Luna cian', en: 'Cyan moon', color: '#24dce8' },
        { file: 'golden-sun.png', es: 'Sol dorado', en: 'Golden sun', color: '#ffbd22' },
        { file: 'emerald-clover.png', es: 'Trébol esmeralda', en: 'Emerald clover', color: '#54d516' },
        { file: 'ruby-drop.png', es: 'Gota rubí', en: 'Ruby drop', color: '#f21f2d' },
        { file: 'golden-star.png', es: 'Estrella dorada', en: 'Golden star', color: '#ffc42c' },
      ],
      'gem-pattern': [
        { file: 'violet-diamond-1.png', es: '1 diamante violeta', en: '1 violet diamond', color: '#a84dff' },
        { file: 'violet-diamond-2.png', es: '2 diamantes violetas', en: '2 violet diamonds', color: '#a84dff' },
        { file: 'violet-diamond-3.png', es: '3 diamantes violetas', en: '3 violet diamonds', color: '#a84dff' },
        { file: 'violet-diamond-4.png', es: '4 diamantes violetas', en: '4 violet diamonds', color: '#a84dff' },
        { file: 'violet-diamond-5.png', es: '5 diamantes violetas', en: '5 violet diamonds', color: '#a84dff' },
        { file: 'orange-gem-1.png', es: '1 gema naranja', en: '1 orange gem', color: '#ff8017' },
        { file: 'orange-gem-2.png', es: '2 gemas naranjas', en: '2 orange gems', color: '#ff8017' },
        { file: 'orange-gem-3.png', es: '3 gemas naranjas', en: '3 orange gems', color: '#ff8017' },
        { file: 'orange-gem-4.png', es: '4 gemas naranjas', en: '4 orange gems', color: '#ff8017' },
        { file: 'orange-gem-5.png', es: '5 gemas naranjas', en: '5 orange gems', color: '#ff8017' },
        { file: 'blue-drop-1.png', es: '1 gota azul', en: '1 blue drop', color: '#13aaff' },
        { file: 'blue-drop-2.png', es: '2 gotas azules', en: '2 blue drops', color: '#13aaff' },
        { file: 'blue-drop-3.png', es: '3 gotas azules', en: '3 blue drops', color: '#13aaff' },
        { file: 'blue-drop-4.png', es: '4 gotas azules', en: '4 blue drops', color: '#13aaff' },
        { file: 'blue-drop-5.png', es: '5 gotas azules', en: '5 blue drops', color: '#13aaff' },
        { file: 'pink-heart-1.png', es: '1 corazón rosa', en: '1 pink heart', color: '#ff3d9b' },
        { file: 'pink-heart-2.png', es: '2 corazones rosas', en: '2 pink hearts', color: '#ff3d9b' },
        { file: 'pink-heart-3.png', es: '3 corazones rosas', en: '3 pink hearts', color: '#ff3d9b' },
        { file: 'pink-heart-4.png', es: '4 corazones rosas', en: '4 pink hearts', color: '#ff3d9b' },
        { file: 'pink-heart-5.png', es: '5 corazones rosas', en: '5 pink hearts', color: '#ff3d9b' },
      ],
      'basic-redesigned': [
        { file: 'red-circle.png', es: 'Círculo rojo', en: 'Red circle', color: '#ff4055' },
        { file: 'blue-square.png', es: 'Cuadrado azul', en: 'Blue square', color: '#2878f5' },
        { file: 'green-triangle.png', es: 'Triángulo verde', en: 'Green triangle', color: '#32d34b' },
        { file: 'yellow-star.png', es: 'Estrella amarilla', en: 'Yellow star', color: '#ffc928' },
        { file: 'purple-heart.png', es: 'Corazón violeta', en: 'Purple heart', color: '#9d48ed' },
        { file: 'cyan-diamond.png', es: 'Rombo cian', en: 'Cyan diamond', color: '#19cadb' },
        { file: 'orange-hexagon.png', es: 'Hexágono naranja', en: 'Orange hexagon', color: '#ff8a18' },
        { file: 'pink-plus.png', es: 'Cruz rosa', en: 'Pink plus', color: '#ef4b9b' },
        { file: 'lime-drop.png', es: 'Gota lima', en: 'Lime drop', color: '#a8df08' },
        { file: 'white-ring.png', es: 'Anillo blanco', en: 'White ring', color: '#eef3ff' },
        { file: 'teal-pentagon.png', es: 'Pentágono turquesa', en: 'Teal pentagon', color: '#16b8a5' },
        { file: 'purple-crescent.png', es: 'Luna violeta', en: 'Purple crescent', color: '#6749e8' },
        { file: 'red-sunburst.png', es: 'Destello rojo', en: 'Red sunburst', color: '#ff4055' },
        { file: 'blue-flower.png', es: 'Flor azul', en: 'Blue flower', color: '#3179f1' },
        { file: 'green-clover.png', es: 'Trébol verde', en: 'Green clover', color: '#32cf45' },
        { file: 'yellow-circle.png', es: 'Círculo dorado', en: 'Golden circle', color: '#ffd020' },
        { file: 'gold-square.png', es: 'Cuadrado dorado', en: 'Golden square', color: '#d9ab60' },
        { file: 'silver-square-outline.png', es: 'Marco cuadrado plateado', en: 'Silver square outline', color: '#dbe4f6' },
        { file: 'cyan-triangle-outline.png', es: 'Marco triangular cian', en: 'Cyan triangle outline', color: '#20d5de' },
        { file: 'yellow-hexagon-outline.png', es: 'Marco hexagonal dorado', en: 'Golden hexagon outline', color: '#ffc51d' },
      ],
      elemental: [
        { file: 'fire.png', es: 'Fuego', en: 'Fire', color: '#ff651d' },
        { file: 'water.png', es: 'Agua', en: 'Water', color: '#1dafff' },
        { file: 'earth.png', es: 'Tierra', en: 'Earth', color: '#a96a35' },
        { file: 'wind.png', es: 'Viento', en: 'Wind', color: '#54dbe5' },
        { file: 'lightning.png', es: 'Rayo', en: 'Lightning', color: '#ffcb28' },
        { file: 'ice.png', es: 'Hielo', en: 'Ice', color: '#42cfff' },
        { file: 'storm.png', es: 'Tormenta', en: 'Storm', color: '#35c77c' },
        { file: 'lava.png', es: 'Lava', en: 'Lava', color: '#ef4a1e' },
        { file: 'light.png', es: 'Luz', en: 'Light', color: '#ffc928' },
        { file: 'darkness.png', es: 'Oscuridad', en: 'Darkness', color: '#7b32d8' },
        { file: 'shield.png', es: 'Escudo elemental', en: 'Elemental shield', color: '#aa55db' },
        { file: 'meteor.png', es: 'Meteoro', en: 'Meteor', color: '#ff5d1d' },
      ],
      marine: [
        { file: 'starfish.png', es: 'Estrella de mar', en: 'Starfish', color: '#f06426' },
        { file: 'pink-shell.png', es: 'Concha rosa', en: 'Pink shell', color: '#f5a27d' },
        { file: 'yellow-fish.png', es: 'Pez amarillo', en: 'Yellow fish', color: '#2aaee7' },
        { file: 'seahorse.png', es: 'Caballito de mar', en: 'Seahorse', color: '#f3a526' },
        { file: 'red-coral.png', es: 'Coral rojo', en: 'Red coral', color: '#ef4b3f' },
        { file: 'purple-octopus.png', es: 'Pulpo morado', en: 'Purple octopus', color: '#9a51df' },
        { file: 'blue-jellyfish.png', es: 'Medusa azul', en: 'Blue jellyfish', color: '#29bfe8' },
        { file: 'pearl.png', es: 'Perla nacarada', en: 'Pearl', color: '#eadcf3' },
      ],
      magic: [
        { file: 'magic-crystal.png', es: 'Cristal mágico', en: 'Magic crystal', color: '#a53cf1' },
        { file: 'blue-potion.png', es: 'Poción azul', en: 'Blue potion', color: '#1aa9ee' },
        { file: 'enchanted-book.png', es: 'Libro encantado', en: 'Enchanted book', color: '#d89a62' },
        { file: 'star-wand.png', es: 'Varita estelar', en: 'Star wand', color: '#ffc42a' },
        { file: 'energy-orb.png', es: 'Orbe de energía', en: 'Energy orb', color: '#8245e5' },
        { file: 'sacred-rune.png', es: 'Runa sagrada', en: 'Sacred rune', color: '#27bde9' },
        { file: 'mystic-incense.png', es: 'Incienso místico', en: 'Mystic incense', color: '#9340d6' },
        { file: 'enchanted-amulet.png', es: 'Amuleto encantado', en: 'Enchanted amulet', color: '#9d42dd' },
      ],
      'nature-basic': [
        { file: 'green-leaf.png', es: 'Hoja verde', en: 'Green leaf', color: '#65d92f' },
        { file: 'water-drop.png', es: 'Gota de agua', en: 'Water drop', color: '#18bfff' },
        { file: 'pink-flower.png', es: 'Flor rosa', en: 'Pink flower', color: '#ff4a9e' },
        { file: 'clover.png', es: 'Trébol de cuatro hojas', en: 'Four-leaf clover', color: '#55d51f' },
        { file: 'acorn.png', es: 'Bellota', en: 'Acorn', color: '#c47524' },
        { file: 'sunflower.png', es: 'Girasol', en: 'Sunflower', color: '#ffc52d' },
        { file: 'red-mushroom.png', es: 'Seta roja', en: 'Red mushroom', color: '#f04432' },
        { file: 'mossy-rock.png', es: 'Roca musgosa', en: 'Mossy rock', color: '#8c8b72' },
      ],
      'nature-advanced': [
        { file: 'hibiscus.png', es: 'Hibisco', en: 'Hibiscus', color: '#ff3f8d' },
        { file: 'bamboo.png', es: 'Bambú', en: 'Bamboo', color: '#5bc52f' },
        { file: 'pine-cone.png', es: 'Piña de pino', en: 'Pine cone', color: '#ad632b' },
        { file: 'vine-spiral.png', es: 'Enredadera espiral', en: 'Curled vine', color: '#59d333' },
        { file: 'emerald-crystal.png', es: 'Cristal esmeralda', en: 'Emerald crystal', color: '#10d77e' },
        { file: 'tree-stump.png', es: 'Tocón de árbol', en: 'Tree stump', color: '#bd7b3b' },
        { file: 'blueberries.png', es: 'Arándanos', en: 'Blueberries', color: '#388cff' },
        { file: 'flowering-cactus.png', es: 'Cactus florecido', en: 'Flowering cactus', color: '#63c73e' },
        { file: 'maple-leaf.png', es: 'Hoja de arce', en: 'Maple leaf', color: '#ed641b' },
        { file: 'holly-leaf.png', es: 'Hoja de acebo', en: 'Holly leaf', color: '#79d524' },
      ],
      neon: [
        { file: 'neon-square.png', es: 'Cuadrado neón', en: 'Neon square', color: '#24a8ff' },
        { file: 'neon-triangle.png', es: 'Triángulo neón', en: 'Neon triangle', color: '#27ec59' },
        { file: 'neon-star.png', es: 'Estrella neón', en: 'Neon star', color: '#ffc326' },
        { file: 'neon-circle.png', es: 'Círculo neón', en: 'Neon circle', color: '#ff294c' },
        { file: 'neon-diamond.png', es: 'Rombo neón', en: 'Neon diamond', color: '#b83cff' },
        { file: 'neon-hexagon.png', es: 'Hexágono neón', en: 'Neon hexagon', color: '#ff7d1f' },
        { file: 'neon-heart.png', es: 'Corazón neón', en: 'Neon heart', color: '#ff3e9f' },
        { file: 'neon-drop.png', es: 'Gota neón', en: 'Neon drop', color: '#22dce8' },
      ],
    },
    get PRISMATIC_ASSETS() { return this.CATALOGS.prismatic; },
    _assets(id) { return this.CATALOGS[id] || null; },
    _assetPath(id, file) {
      const dir = this.DEFS[id]?.dir;
      return dir ? `img/icon-packs/${dir}/${file}` : '';
    },
    _index(iconId) {
      const i = Icons.CATALOG.indexOf(iconId);
      return i < 0 ? 0 : i;
    },
    packName(id) {
      const d = this.DEFS[id];
      return d ? (d.nameKey ? I18n.t(d.nameKey) : d.name) : '';
    },
    // Ids lógicos representativos: Cosmos muestra 16 formas; cada pack raster, su catálogo.
    iconsOf(id) {
      const assets = this._assets(id);
      return Icons.CATALOG.slice(0, assets ? assets.length : 16);
    },
    // Conserva el nombre histórico `svg`: los consumidores aceptan SVG o IMG.
    svg(id, iconId) {
      const assets = this._assets(id);
      if (!assets) return Icons.svg(iconId);
      const asset = assets[this._index(iconId) % assets.length];
      return `<img class="board-pack-icon" src="${this._assetPath(id, asset.file)}" alt="" aria-hidden="true" draggable="false">`;
    },
    iconName(id, iconId, lang = 'es') {
      const assets = this._assets(id);
      if (!assets) return Icons.name(iconId);
      const asset = assets[this._index(iconId) % assets.length];
      return asset[lang === 'en' ? 'en' : 'es'];
    },
    colorOf(id, iconId) {
      const assets = this._assets(id);
      if (!assets) return Icons.colorOf(iconId);
      return assets[this._index(iconId) % assets.length].color;
    },
    // Portada dedicada cuando existe; los packs sin miniatura mantienen el collage.
    previewHtml(id, n = 4) {
      const def = this.DEFS[id];
      if (def?.thumbnail) return `<img class="iconpack-thumbnail" src="${this._assetPath(id, def.thumbnail)}" alt="" aria-hidden="true" draggable="false">`;
      const ids = this.iconsOf(id).slice(0, n);
      return `<span class="iconpack-collage" data-count="${ids.length}" aria-hidden="true">${ids.map((ic) => `<span class="iconpack-collage-cell">${this.svg(id, ic)}</span>`).join('')}</span>`;
    },
    // A: precalienta (descarga + decode) los PNG de un pack raster para que el
    // tablero los tenga listos antes de la primera partida. Fire-and-forget e
    // idempotente. Cosmos (SVG inline) no tiene assets → no hace nada.
    _preloaded: new Set(),
    preload(id) {
      if (typeof Image === 'undefined') return; // entorno de tests (Node)
      if (this._preloaded.has(id)) return;
      const assets = this._assets(id);
      if (!assets) { this._preloaded.add(id); return; }
      this._preloaded.add(id);
      assets.forEach((a) => {
        const img = new Image();
        img.decoding = 'async';
        img.src = this._assetPath(id, a.file);
        if (img.decode) img.decode().catch(() => { });
      });
    },
  };

  /* ===================== Storage ===================== */
  const Storage = {
    get best() { return +(localStorage.getItem('cv_best') || 0); },
    set best(v) { localStorage.setItem('cv_best', String(v)); },
    get sound() { return localStorage.getItem('cv_sound') !== 'off'; },
    set sound(v) { localStorage.setItem('cv_sound', v ? 'on' : 'off'); },
    get user() { return localStorage.getItem('cv_user'); },
    set user(v) { v ? localStorage.setItem('cv_user', v) : localStorage.removeItem('cv_user'); },
    get profile() { try { return JSON.parse(localStorage.getItem('cv_profile') || 'null'); } catch (_) { return null; } },
    set profile(v) { try { localStorage.setItem('cv_profile', JSON.stringify(v)); } catch (_) { } },
    get tutorialDone() { return localStorage.getItem('cv_tut') === '1'; },
    set tutorialDone(v) { localStorage.setItem('cv_tut', v ? '1' : '0'); },
    get lastVersion() { return localStorage.getItem('cv_ver') || ''; },
    set lastVersion(v) { localStorage.setItem('cv_ver', v); },
    get survDiff() { return localStorage.getItem('cv_surv_diff') || 'normal'; },
    set survDiff(v) { localStorage.setItem('cv_surv_diff', v || 'normal'); },
    get zenDiff() { return localStorage.getItem('cv_zen_diff') || 'normal'; },
    set zenDiff(v) { localStorage.setItem('cv_zen_diff', v || 'normal'); },
    get preboostSeen() { return localStorage.getItem('cv_preboost') === '1'; },
    set preboostSeen(v) { localStorage.setItem('cv_preboost', v ? '1' : '0'); },
    // Alias público de la clasificación. Se pide explícitamente la primera vez
    // que el jugador publica: el nombre de la pantalla de bienvenida se dio como
    // privado y convertirlo en público sin avisar sería un cambio de uso a su
    // espalda.
    get rankAlias() { return localStorage.getItem('cv_rank_alias') || ''; },
    set rankAlias(v) { v ? localStorage.setItem('cv_rank_alias', v) : localStorage.removeItem('cv_rank_alias'); },
    get lastMode() { return localStorage.getItem('cv_last_mode') || ''; },
    set lastMode(v) { v ? localStorage.setItem('cv_last_mode', v) : localStorage.removeItem('cv_last_mode'); },
    get swipeHintSeen() { return localStorage.getItem('cv_swipe_hint') === '1'; },
    set swipeHintSeen(v) { localStorage.setItem('cv_swipe_hint', v ? '1' : '0'); },
  };

  /* ===================== Settings (persistentes) ===================== */
  const Settings = (() => {
    const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const lang0 = (typeof navigator !== 'undefined' && /^en/i.test(navigator.language || '')) ? 'en' : 'es';
    const def = { sfx: true, music: false, haptics: true, reducedFx: reduced, lang: lang0, largeText: false };
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem('cv_settings') || '{}') || {}; } catch (_) { raw = {}; }
    let reducedFxExplicit = Object.prototype.hasOwnProperty.call(raw, 'reducedFx');
    let s = Object.assign({}, def, raw);
    const save = () => { try { localStorage.setItem('cv_settings', JSON.stringify(s)); } catch (_) { } };
    return {
      get sfx() { return s.sfx; }, set sfx(v) { s.sfx = v; save(); },
      get music() { return s.music; }, set music(v) { s.music = v; save(); },
      get haptics() { return s.haptics; }, set haptics(v) { s.haptics = v; save(); },
      get reducedFx() { return s.reducedFx; }, set reducedFx(v) { s.reducedFx = v; reducedFxExplicit = true; save(); },
      get reducedFxExplicit() { return reducedFxExplicit; },
      get systemReducedMotion() { return reduced; },
      get lang() { return s.lang; }, set lang(v) { s.lang = v; save(); },
      get largeText() { return s.largeText; }, set largeText(v) { s.largeText = v; save(); },
    };
  })();

  /* ===================== I18n (ES / EN) =====================
   * Diccionario para la UI. apply() traduce el HTML estático por atributos
   * data-i18n (texto), data-i18n-ph (placeholder) y data-i18n-al (aria-label).
   * t(key) sirve para textos generados por JS (menús, resultados, ajustes…).
   */
  const I18n = (() => {
    const DICT = {
      es: {
        welcome_sub: 'Junta iconos iguales en el espacio', name_q: '¿Cómo te llamas?', optional: '(opcional)',
        begin: '¡Empezar!', guest: 'Jugar como invitado', start_sub: '¿List@ para conquistar el tablero?',
        play: 'Jugar', reward: 'Recompensa diaria', menu_profile: 'Logros', menu_shop: 'Tienda',
        menu_settings: 'Ajustes', how: '¿Cómo se juega?', install: 'Instalar app', sound: 'Sonido', best: 'Mejor puntuación:',
        tab_log: 'Logros', tab_events: 'Eventos', tab_shop: 'Tienda', tab_home: 'Inicio', tab_guide: 'Guía', tab_collections: 'Colecciones', tab_set: 'Ajustes', missions_title: '🎯 Misiones', missions_sub: 'Completa objetivos diarios y semanales para acelerar tu progreso.',
        // Clasificación (fase 6)
        ranks_title: 'Clasificación', ranks_sub: 'Contrarreloj. Solo se publican las partidas verificadas por el servidor.',
        ranks_scope_daily: 'Hoy', ranks_scope_weekly: 'Semana', ranks_scope_season: 'Temporada', ranks_scope_all: 'Histórico',
        ranks_loading: 'Cargando clasificación…', ranks_empty: 'Todavía no hay marcas en este periodo. ¡Sé el primero!',
        ranks_offline: 'Sin conexión con el servidor de rankings. Tu progreso local está a salvo.',
        ranks_error: 'No se pudo cargar la clasificación. Inténtalo de nuevo en un momento.',
        ranks_more: 'Ver más', ranks_you: 'Tú', ranks_your_rank: 'Tu posición: {n}', ranks_unranked: 'Aún no tienes marca en este periodo.',
        ranks_alias_title: 'Elige tu alias público', ranks_alias_sub: 'Aparecerá en la clasificación junto a tu puntuación. No uses tu nombre real.',
        ranks_alias_ph: 'Alias (máx. 24)', ranks_alias_save: 'Publicar', ranks_alias_cancel: 'Ahora no',
        ranks_alias_invalid: 'El alias debe tener entre 1 y 24 caracteres.',
        ranks_published: '¡Publicado! Puesto {n} en {b}.', ranks_not_improved: 'No has mejorado tu marca en este periodo.',
        ranks_rejected: 'El servidor no pudo verificar esta partida, así que no se ha publicado.',
        events_title: 'Eventos', events_sub: 'Tus retos, recompensas y actividades de hoy, reunidos en un solo lugar.',
        events_daily_label: 'Cada día', events_progress_label: 'Progreso diario', events_today_label: 'Solo hoy', events_rewards_label: 'Premios',
        events_view: 'Ver', events_play: 'Jugar', events_open: 'Abrir', events_reward_ready: 'Lista para reclamar', events_reward_claimed: 'Reclamada hoy',
        collections_title: 'Colecciones', collections_sub: 'Reúne tableros, temas y logros mientras juegas.',
        collections_boards: 'Tableros', collections_themes: 'Temas', collections_achievements: 'Logros', collections_unlocked: '{n} de {total}', collections_owned: 'Desbloqueado',
        collections_locked: 'Por descubrir', collections_explore_shop: 'Ver tableros y temas', collections_view_achievements: 'Ver logros',
        collections_hub_sub: 'Reúne tableros, temas, iconos, bordes y logros mientras juegas.',
        rarity_common: 'Común', rarity_rare: 'Raro', rarity_epic: 'Épico', rarity_legendary: 'Legendario',
        rarity_commons: 'Comunes', rarity_rares: 'Raros', rarity_epics: 'Épicos', rarity_legendaries: 'Legendarios',
        col_cat_boards: 'Tableros', col_cat_boards_desc: 'Desbloquea nuevos tableros con diseños únicos y efectos especiales.',
        col_cat_themes: 'Temas', col_cat_themes_desc: 'Colecciona temas completos para personalizar tu experiencia.',
        col_cat_icons: 'Iconos', col_cat_icons_desc: 'Colecciona packs de iconos para las fichas del tablero.',
        col_cat_avatars: 'Avatares', col_cat_avatars_desc: 'Desbloquea avatares exclusivos para tu perfil y destaca entre los demás.',
        col_cat_borders: 'Bordes', col_cat_borders_desc: 'Consigue bordes especiales para enmarcar tu avatar y presumir tu estilo.',
        col_cat_achievements: 'Logros', col_cat_achievements_desc: 'Completa desafíos y alcanza hitos para ganar recompensas.',
        col_icons_sub: 'Personaliza los iconos que aparecen en el tablero.',
        col_avatars_sub: 'Desbloquea avatares exclusivos y personaliza tu perfil.',
        col_borders_sub: 'Consigue bordes especiales para enmarcar tu avatar y presumir tu estilo.',
        col_boards_sub: 'Desbloquea tableros con diseños únicos y efectos especiales.',
        col_themes_sub: 'Colecciona temas completos para personalizar tu experiencia.',
        col_achievements_sub: 'Completa desafíos y alcanza hitos para ganar recompensas.',
        col_progress_icons: 'Progreso de iconos', col_progress_avatars: 'Progreso de avatares', col_progress_borders: 'Progreso de bordes', col_progress_boards: 'Progreso de tableros', col_progress_themes: 'Progreso de temas', col_progress_achievements: 'Progreso de logros',
        col_filter_all: 'Todos', col_sort_recent: 'Más reciente', col_sort_rarity: 'Rareza', col_sort_name: 'Nombre', col_sort_owned: 'Desbloqueados', col_sort_label: 'Ordenar por',
        col_locked_slot: 'Bloqueado · por descubrir', col_empty_rarity: 'Sin objetos de esta rareza todavía.',
        shop_iconpacks: 'Iconos de tablero', iconpack_view: 'Ver iconos', iconpack_contents: 'Iconos del pack', iconpack_cosmos_desc: 'El set clásico de figuras de Convergence.', iconpack_basic_redesigned_name: 'Básico Rediseñado', iconpack_basic_redesigned_desc: 'Veinte figuras clásicas renovadas con volumen, brillo y colores más definidos.', iconpack_gem_pattern_name: 'Pack Gemas', iconpack_gem_pattern_desc: 'Veinte patrones brillantes de una a cinco gemas que añaden un reto visual mayor.', iconpack_nature_basic_name: 'Naturaleza Básico', iconpack_nature_basic_desc: 'Ocho figuras esenciales inspiradas en hojas, flores, agua y bosque.', iconpack_nature_advanced_name: 'Naturaleza Avanzado', iconpack_nature_advanced_desc: 'Diez figuras naturales poderosas con plantas, frutos, madera y cristal.', iconpack_neon_name: 'Pack Neón', iconpack_neon_desc: 'Ocho figuras clásicas reinventadas con tubos de luz y colores neón intensos.', iconpack_marine_name: 'Pack Marino', iconpack_marine_desc: 'Ocho criaturas y tesoros que evocan las profundidades del océano.', iconpack_magic_name: 'Pack Mágico', iconpack_magic_desc: 'Ocho objetos encantados cargados de energía arcana.', iconpack_prismatic_name: 'Joyas Prisma', iconpack_prismatic_desc: 'Diez joyas facetadas con color intenso, reflejos de cristal y brillo neón.', iconpack_elemental_name: 'Pack Elemental', iconpack_elemental_desc: 'Doce fuerzas primordiales con materiales, luces y efectos espectaculares.', iconpack_equipped_note: 'Estos iconos aparecen ahora en tu tablero.',
        col_banner_icons_title: 'Más packs pronto', col_banner_icons_desc: 'Nuevos packs de iconos llegarán a la tienda. ¡Colecciónalos todos!', col_banner_icons_cta: 'Ir a tienda',
        col_banner_avatars_title: 'Avatar exclusivo', col_banner_avatars_desc: 'Participa en eventos especiales para conseguir avatares únicos por tiempo limitado.', col_banner_avatars_cta: 'Ir a eventos',
        col_banner_borders_title: 'Presume tu estilo', col_banner_borders_desc: 'Los bordes no dan ventaja en el juego. ¡Coléccionalos todos y destaca!', col_banner_borders_cta: 'Ir a tienda',
        col_banner_boards_title: 'Cambia tu tablero', col_banner_boards_desc: 'Los tableros son solo cambios visuales: no dan ventajas. ¡Colecciónalos todos!', col_banner_boards_cta: 'Ir a tienda',
        col_banner_themes_title: 'Colorea tu juego', col_banner_themes_desc: 'Los temas repintan toda la interfaz. Elige el que más te guste.', col_banner_themes_cta: 'Ir a tienda',
        col_banner_achievements_title: 'Gana recompensas', col_banner_achievements_desc: 'Completa retos en cualquier modo para desbloquear más logros.', col_banner_achievements_cta: 'Jugar',
        modes_title: 'Elige tu modo', modes_sub: 'Cada modo, una forma diferente de jugar', modes_more: 'Más modos',
        home_modes_label: 'Modos de juego', home_carousel_hint: 'Desliza horizontalmente · toca la tarjeta para entrar',
        home_swipe_coach: 'Desliza para explorar los modos',
        home_mode_prev: 'Modo anterior', home_mode_next: 'Modo siguiente', home_mode_pages: 'Seleccionar modo',
        home_mode_play: 'Entrar en {mode}', home_mode_select: 'Seleccionar {mode}', home_mode_position: '{mode}. {n} de {total}',
        home_quick_actions: 'Eventos y accesos rápidos',
        modes_profile_resources: 'Perfil y recursos', modes_resources: 'Recursos', modes_catalog: 'Catálogo de modos', econ_balance: 'Saldo: {n}',
        group_mode: 'Modo', group_diff: 'Dificultad',
        card_surv: 'Supervivencia', card_surv_badge: 'OLEADAS INFINITAS', card_surv_desc: 'Enfréntate a oleadas crecientes de enemigos. Cada vez son más fuertes. ¿Cuánto tiempo podrás sobrevivir?',
        card_classic: 'Clásico', card_classic_badge: 'POR NIVELES', card_classic_desc: 'Supera niveles con diferentes mapas y desafíos únicos. Nuevos obstáculos, mecánicas y objetos te esperan en cada uno.',
        group_prog: 'Progresión', group_score: 'Puntuación', group_relax: 'Relax',
        card_adv_badge: 'INFINITO', card_contra_badge: 'CONTRARRELOJ', card_zen_badge: 'RELAX', card_contra_daily: 'Incluye el Reto del día',
        card_multi: 'Multijugador', card_multi_badge: 'PRÓXIMAMENTE', card_multi_tag: 'COMPITE EN LÍNEA', card_multi_desc: 'Desafía a otros jugadores en línea cuando esté disponible.',
        card_feat_locks: 'Bloqueos', card_feat_objects: 'Objetos', card_feat_events: 'Eventos', card_feat_more: '¡Y mucho más!',
        card_feat_first: 'Termina primero el tablero', card_feat_best: 'Mejor puntuación', card_feat_online: 'Partidas en línea',
        card_feat_biomes: 'Biomas', card_feat_goals: 'Objetivos', card_feat_minibosses: 'Mini-jefes',
        card_feat_time: 'Gana tiempo', card_feat_pressure: 'Presión creciente',
        card_feat_no_penalties: 'Sin penalizaciones', card_feat_no_limit: 'Sin límite', card_feat_relaxed: 'Ritmo relajado',
        card_feat_lives: 'Vidas', card_feat_waves: 'Oleadas', card_feat_bosses: 'Jefes',
        how_card_desc: 'Repasa las reglas, consejos y todo lo que necesitas saber para dominar el juego.', how_card_cta: 'Ver información', multi_soon: 'Multijugador en línea: ¡muy pronto!',
        classic_title: 'Modo Clásico', world_news: 'Novedades de este mundo', worlds_label: 'Mundos', all_rewards: '🎁 Ver recompensas',
        to_map: 'Volver al mapa', classic_lvl_sub: 'Nivel {n} · {w}', classic_next: 'Siguiente nivel →',
        locked_level: '🔒 Completa el nivel anterior', locked_world: '🔒 Mundo bloqueado', reward_locked: 'Completa todos los niveles del mundo', reward_claimed: 'Recompensa ya reclamada', reward_got: '¡Recompensa del mundo! 🎁 +1 cofre · 💎 +20',
        stars_label: 'Estrellas del nivel', stars_help: '3★ sin errores · 2★ hasta 2 errores · 1★ más errores', star_lost: '−1 estrella · ¡evita los errores!',
        star_c3: 'Sin errores', star_c2: 'Hasta {n} errores', star_c1: 'Más errores', star_mine: 'Tus errores: {n}',
        coming_soon: 'Próximamente', tab_missions: 'Misiones', tab_play: 'Jugar', tab_chests: 'Cofres', tab_rank: 'Clasificación',
        powerup_empty: 'No te quedan de este power-up',
        equipped: 'Equipado', equip: 'Equipar', free: 'Gratis', no_coins: 'Monedas insuficientes',
        shop_boards: 'Tableros visuales', shop_themes: 'Temas de color', shop_hint2: 'Los tableros son solo cambios visuales: no dan ventajas ni desventajas. Equipa tu estilo favorito para jugar.', board_unlocked: '¡Tablero desbloqueado!',
        resource_shop_title: 'Tienda de recursos', style_shop_title: 'Personalización', resource_shop_short: 'Monedas, gemas y XP', style_shop_short: 'Personalización', style_shop_nav: 'Estilos', preview_theme: 'Vista previa de {name}',
        test_payment_title: 'Modo de pruebas', test_payment_note: 'Las compras de monedas y gemas se acreditan automáticamente. No se realiza ningún cobro.', mock_payment_badge: 'PAGO DE PRUEBA',
        resource_shop_premium: 'RECURSO PREMIUM', resource_shop_game_currency: 'DIVISA DEL JUEGO', resource_shop_progress: 'PROGRESIÓN', best_value: 'MEJOR VALOR',
        xp_booster_title: 'XP Booster', xp_booster_desc: 'Multiplica ×4 todo el XP ganado en las partidas que empieces mientras esté activo.', xp_boost_this_match: 'Esta partida',
        xp_boost_inactive: 'Sin booster activo', xp_boost_active: 'XP ×4 · {t}', xp_boost_extend: 'Extiende {t}', xp_boost_buy: 'Activar', xp_boost_no_gems: 'No tienes gemas suficientes para este booster.',
        xp_boost_added: 'XP ×4 activo · +{t}', xp_pack_6h: '6 h', xp_pack_3d: '3 días', xp_pack_7d: '7 días', xp_result_breakdown: '{base} XP base ×{mult} · +{bonus} por booster',
        mock_purchase_done: 'Compra de prueba completada · +{n} {r}', resource_purchase_failed: 'No se pudo completar la compra. Inténtalo de nuevo.', store_game_blocked: 'La tienda de recursos está disponible desde Inicio. Tu partida sigue activa.',
        resource_shop_chests: 'COFRES', chest_shop_title: 'Cofres', chest_shop_desc: 'Compra cofres al instante con gemas y ábrelos cuando quieras. El cofre de evento solo se gana jugando.', chest_shop_buy: 'Comprar cofre', chest_shop_add: 'Comprar', chest_shop_bought: '¡{c} añadido a tus cofres!', chest_shop_owned: 'Tienes {n}', chest_shop_owned_none: 'No tienes ninguno',
        home_chest_cta: 'Cofre', energy_label: 'Energía', energy_off: 'OFF', get_energy: 'Conseguir energía',
        chests_title: 'Cofres', chests_have: 'Tienes {n} cofre(s)', chests_hint: 'Cada cofre revela de 2 a 4 premios: monedas, recursos, boosters o un cosmético raro.', chests_none: 'No tienes cofres · cumple objetivos en cualquier modo para ganar el siguiente', chest_reward: '¡Recompensa! {r}', open_chest: 'Abrir cofre',
        chests_kicker: 'Recompensas', chests_subtitle: 'Juega, consigue cofres y descubre premios increíbles.', chests_progress_title: 'Tu progreso', chests_progress_rule: 'Cumple objetivos en cualquier modo: cada {t} cae el siguiente cofre del ciclo.',
        chests_play_survival: 'Jugar Supervivencia', chests_next_wave: 'Cofre extra en {n} oleadas', chests_open_now: 'O abrir ahora', chests_open_saved: 'Abrir cofre guardado', chests_available: 'Disponibles',
        chests_contents_note: 'Los cofres contienen monedas, gemas, tickets, potenciadores y cosméticos.', chest_opening: 'El cofre se está abriendo…', chest_opening_named: 'Abriendo {c}…', chest_opening_hint: 'Preparando tus recompensas',
        chest_reveal_title: 'Contenido del cofre', chest_cosmetic_title: '¡COSMÉTICO!', chest_rarity_common: 'Recompensa', chest_rarity_jackpot: 'Jackpot', chest_rarity_cosmetic: 'Especial', chest_continue: 'Seguir', chest_equip: 'Equipar',
        chest_reward_coins: '+{n} monedas', chest_reward_gems: '+{n} gemas', chest_reward_ticket: '+{n} ticket(s)', chest_reward_booster: '+{n} {b}', chest_reward_board: 'Tablero: {n}', chest_reward_theme: 'Tema: {n}', chest_reward_avatar_icon: 'Avatar: {n}', chest_reward_avatar_border: 'Borde: {n}',
        chest_view_all: 'Ver todos', chest_selected: 'Cofre seleccionado', chest_catalog_title: 'Tipos de cofres', chest_catalog_sub: 'Cuanto más raro sea el cofre, mejores serán sus recompensas.', chest_catalog_close: 'Volver a mis cofres',
        chest_contains: 'Qué puede contener', chest_type_panel: 'Tipo de cofre', chest_ceremony_title: 'Apertura del cofre', chest_contents_coins: 'Monedas', chest_contents_gems: 'Gemas', chest_contents_tickets: 'Tickets', chest_contents_cosmetics: 'Cosméticos y más',
        chest_slots_title: 'Ranuras de cofres', chest_possible_rewards: 'Posibles recompensas', chest_slot_opening: 'Abriendo', chest_slot_ready: '¡Listo!', chest_slot_blocked: 'Bloqueado', chest_slot_waiting: 'En espera', chest_slot_empty: 'Ranura vacía',
        chest_unlock_slot: 'Desbloquea otra ranura', chest_unlock_slot_cost: 'Toca otra vez para desbloquearla por {n} gemas', chest_slot_unlocked: '¡Nueva ranura desbloqueada!', chest_more_waiting: '+{n} cofre(s) en reserva',
        chest_start_unlock: 'Abrir', chest_open_now_action: 'Abrir ahora', chest_collect: 'Recoger', chest_unlocking_action: 'En progreso', chest_only_one: 'Solo puedes desbloquear un cofre a la vez.', chest_timer_started: '¡El cofre ha empezado a abrirse!',
        chest_premium_action: 'Abrir cofre premium', chest_premium_note: 'Premio instantáneo con mejores probabilidades', chest_duration: 'Duración', chest_size_label: 'Tamaño', chest_type_label: 'Tipo',
        chest_reward_boosters: 'Potenciadores', chest_reward_objects: 'Objetos', chest_reward_boards: 'Tableros', chest_reward_themes: 'Temas', chest_reward_avatars: 'Iconos y bordes', chest_reward_surprise: 'Y más…',
        chest_size_small: 'Pequeño', chest_size_medium: 'Mediano', chest_size_large: 'Grande', chest_size_xlarge: 'Muy grande', chest_size_huge: 'Enorme', chest_size_variable: 'Variable',
        chest_tier_basic: 'Básico', chest_tier_common: 'Común', chest_tier_rare: 'Raro', chest_tier_epic: 'Épico', chest_tier_legendary: 'Legendario', chest_tier_mythic: 'Mítico', chest_tier_special: 'Especial',
        chest_type_wood: 'Cofre de madera', chest_type_bronze: 'Cofre de bronce', chest_type_silver: 'Cofre de plata', chest_type_gold: 'Cofre de oro', chest_type_magic: 'Cofre mágico',
        chest_type_royal: 'Cofre real', chest_type_supreme: 'Cofre supremo', chest_type_champion: 'Cofre de campeones', chest_type_divine: 'Cofre divino', chest_type_event: 'Cofre de evento',
        chest_desc_wood: 'Recompensas comunes. Ideal para empezar.', chest_desc_bronze: 'Recursos comunes y alguna sorpresa poco rara.', chest_desc_silver: 'Mejores premios y más opciones de cosméticos.',
        chest_desc_gold: 'Recompensas épicas, más monedas y tickets.', chest_desc_magic: 'Contiene recompensas épicas garantizadas.', chest_desc_royal: 'Premios legendarios y alta probabilidad de cosméticos.',
        chest_desc_supreme: 'Recompensas de alto nivel y muchos recursos.', chest_desc_champion: 'Recompensas míticas y máximas probabilidades especiales.', chest_desc_divine: 'El cofre más poderoso, con recompensas máximas.', chest_desc_event: 'Recompensas únicas de eventos y temporadas.',
        chest_rarity_rare: 'Raro', chest_rarity_epic: 'Épico', chest_rarity_legendary: 'Legendario', chest_rarity_mythic: 'Mítico', chest_rarity_special: 'Especial',
        chest_odds_title: 'Probabilidades', chest_odds_cosmetic: 'Cosmético', home_chest_opening: 'Abriendo · {t}',
        chest_pipeline_won: '¡Cofre del ciclo! +1 {c}', chest_daily_won: '¡Choice Chest diario ganado · elige 1 de 3!', chest_daily_catchup_won: '¡Recuperación diaria! Tu Choice Chest sube a Plata', chest_weekly_won: 'Reto semanal · +1 cofre de evento',
        chest_next_in_cycle: 'Siguiente del ciclo: {c}', chest_pity: 'Mítico o mejor en ≤ {n} cofres',
        chest_auto_note: 'Al terminar un cofre, el siguiente más corto de ranuras y reserva empieza solo',
        chest_queue_title: 'Cola automática', chest_queue_next: 'Siguiente {n}',
        chest_notify_enable: 'Avisarme al estar listo', chest_notify_enabled: 'Avisos activados',
        chest_notify_denied: 'Las notificaciones están bloqueadas en el navegador', chest_notify_unsupported: 'Este navegador no admite avisos locales',
        chest_notification_title: '¡Cofre listo!', chest_notification_body_one: 'Tienes un cofre esperando para abrirse.', chest_notification_body_many: 'Tienes {n} cofres esperando para abrirse.',
        chest_tierup: '¡Ascenso sorpresa! Ahora es {c}', chest_tier_hold: 'Sin ascenso: sigue siendo {c}', chest_tier_max: 'Categoría máxima · no puede ascender más', chest_tier_roll: 'Ascenso sorpresa', chest_tier_success_detail: 'Tu {f} se convirtió en {t}. Recibirás las recompensas de {t}.', chest_tier_reward_note: 'Ascenso aplicado: {f} → {t}. Estos son los premios de {t}.', chest_tap_reveal: 'Toca para revelar', chest_upgrade_label: 'Posible ascenso al abrir', chest_upgrade_detail: '{p}% de convertirse en {c}. Si ocurre, recibirás {n} premios y las cantidades de ese cofre.', chest_open_now_cost: 'Abrir ahora: {n} gemas', chest_selected_announcement: '{c} seleccionado',
        chest_guaranteed_coins: 'Monedas garantizadas', chest_primary_roll: 'Premio principal', chest_bonus_rolls: '{n} premio(s) extra', chest_bonus_odds: 'Por extra: {c}% monedas {cmin}–{cmax} · {g}% gemas {gmin}–{gmax} · {t}% ticket x1 · {b}% booster x1', chest_level_scaled: 'Escala con tu nivel', booster_stock: 'Stock x{n}',
        booster_name_bomb: 'Bomba', booster_name_freeze: 'Congelación', booster_name_clearLine: 'Rayo', booster_name_wild: 'Escoba', booster_name_x2: 'Comodín',
        daily_choice_event_label: 'Primera victoria', daily_choice_title: 'Cofre de elección', daily_choice_open: 'Elegir', daily_choice_view: 'Ver cofre', daily_choice_ready: 'Elige 1 de 3 premios', daily_choice_waiting: 'En espera · ábrelo para elegir', daily_choice_opening: 'Abriendo · {t}', daily_choice_sub: 'Los tres premios están visibles. Solo recibirás el que elijas.', daily_choice_catchup_sub: 'Recuperación por el día perdido: este cofre subió a Plata. Elige un premio.', daily_choice_cancel: 'Ahora no', chest_choice_label: 'Elige 1 de 3', chest_event_featured: 'Evento {w} · booster destacado: {b}', chest_event_bonus: 'Booster de evento garantizado: {b}',
        soon_badge: 'Próximamente', notify_me: 'Avísame', notify_ok: '¡Te avisaremos cuando esté listo!',
        edit_name: 'Tu nombre', daily_banner_title: 'Recompensa diaria', daily_banner_sub: '¡Vuelve cada día y gana premios!', claim: 'Reclamar',
        home_classic: 'Partida clásica', home_classic_prefix: 'Partida', home_classic_name: 'Clásica', home_classic_sub: 'Juega en el tablero contra amigos o bots', home_surv_sub: 'Sobrevive a oleadas infinitas',
        home_play_recommended: 'Recomendado ahora', home_play_daily: 'Jugar el reto de hoy', home_play_daily_sub: '{mut} · mismo tablero para todos', home_play_mission: 'Avanzar tu misión', home_play_classic: 'Continuar Clásico', home_play_classic_sub: '{world} · nivel {n}',
        home_tournaments: 'Torneo diario', home_tournaments_sub: 'Compite por medallas cada día', home_multi_sub: 'Desafía a jugadores en línea',
        home_diary: 'Diario', home_league: 'Liga', home_friends: 'Amigos',
        home_multi_soon: 'Multijugador. Próximamente', home_league_soon: 'Liga. Próximamente', home_friends_soon: 'Amigos. Próximamente',
        home_saved_run: 'Partida guardada', continue_word: 'Continuar', home_status_pending: 'Pendiente', home_status_done: 'Completado',
        home_classic_title: 'Clásico', home_no_record: 'Sin récord', home_today: 'Hoy', home_daily_mission: 'Misión', home_weekly: 'Semanal',
        home_chests: 'Cofres', home_none_ready: 'Ninguno', home_chests_one: '1 cofre', home_chests_many: '{n} cofres', home_streak: 'Racha', home_play_hint: 'Elige entre 5 modos',
        home_reward_day: 'Día {n} · vuelve cada día y gana premios', home_reward_claimed: 'Día {n} reclamado',
        home_saved_classic: '{world} · Nivel {n}', home_saved_mode: '{mode} · Nivel {n}', home_classic_state: '{world} · Nivel {n}',
        home_classic_stars: '{n}/150 estrellas', home_surv_record: 'Mejor oleada {n}', home_surv_week: 'Semana: {n}',
        home_survmut_none: 'Sin mutador', home_survmut_ice: 'Hielo', home_survmut_chaos: 'Caos', home_survmut_frenzy: 'Furia',
        home_ready_one: '1 listo', home_ready_many: '{n} listos', home_days: '{n} días', home_day: '1 día', home_complete: 'Listo',
        world_bosque: 'Bosque Verde', world_desierto: 'Desierto Dorado', world_montana: 'Montaña Helada', world_cueva: 'Cueva Misteriosa', world_neon: 'Ciudad Neón',
        profile_action: 'Abrir perfil', edit_name_action: 'Editar nombre', get_coins: 'Conseguir monedas', get_gems: 'Conseguir gemas',
        q_missions: 'Misiones', q_daily: 'Diario', q_chests: 'Cofres', q_league: 'Liga', q_friends: 'Amigos', best_score: 'Mejor puntuación', play_word: 'Jugar',
        hud_record: 'Récord', hud_points: 'Puntos', hud_level: 'Nivel', hud_time: 'Tiempo', hud_speed: 'Velocidad', hud_occ: 'Ocupación',
        hud_danger: 'Peligro', hud_board_fill: 'Tablero',
        hud_event_boss: 'JEFE', hud_event_wave: 'NUEVA OLEADA', hud_event_next: 'A continuación',
        hud_next_boss: 'Siguiente jefe', hud_new_shapes: 'Nuevas figuras',
        hud_ctx_boss_rage: 'Jefe enfurecido', hud_phase_short: 'Fase {n}', hud_ctx_wave: 'Nueva oleada',
        hud_ctx_time: 'Tiempo restante', hud_ctx_zen: 'Flujo sereno',
        hud_ctx_double: 'Multiplicador ×2', hud_ctx_freeze: 'Tiempo congelado', hud_ctx_frenzy: 'Frenesí activo',
        hud_survival_title: 'SUPERVIVENCIA', hud_survival_ready: 'PREPÁRATE', hud_survival_go: '¡Empieza!',
        hud_narr_fever_title: 'FIEBRE', hud_narr_fever: '¡No pares!',
        hud_narr_meteor: 'El cielo se quiebra.', hud_narr_tide: 'La marea sube.', hud_narr_frost: 'El frío avanza.',
        hud_narr_lockdown: 'La jaula se cierra.', hud_narr_quake: 'El suelo recuerda.',
        hud_narr_crystalid: 'El cristal vuelve a crecer.', hud_narr_void: 'Tiene hambre.', hud_narr_puppeteer: 'Los hilos se tensan.',
        hud_remaining: 'restantes', hud_survive_sub: 'Sobrevive', hud_boss_sub: 'Jefe', rec_close: 'A {n} del récord', rec_new: '¡Nuevo récord!',
        mult_breakdown_combo: 'Combo', mult_breakdown_fever: 'Fiebre', mult_breakdown_frenzy: 'Frenesí', mult_breakdown_boon: 'Bendición', mult_breakdown_sprint: 'Sprint', mult_breakdown_total: 'Total',
        hud_lives_explain: 'Tus vidas. Si llegas a 0, se acaba.',
        hud_wave_explain: 'Ronda actual. Cada oleada es más dura.',
        hud_tier_explain: 'Dificultad: sube cada varias oleadas',
        hud_time_explain: 'Tiempo sobrevivido',
        hud_waveprog_explain: 'Cuenta atrás para la siguiente oleada',
        hud_danger_explain: 'Si esta barra se llena, pierdes una vida',
        how_title: '¿Cómo se juega?', how_sub: 'Aprende la mecánica, descubre los modos y domina tus potenciadores.', guide_kicker: 'Guía de juego',
        how1: 'Toca una <strong>casilla vacía</strong>.', how2: 'Se mira el icono más cercano en cada dirección.',
        how3: 'Si <strong>2 o más coinciden</strong>, ¡convergen y desaparecen!', how4: 'Encadena eliminaciones para subir el <strong>combo</strong> y multiplicar puntos.',
        how5: 'Los iconos aparecen solos: vacía el tablero antes de que se llene.',
        guide_rules_title: 'Reglas básicas', guide_modes_title: 'Modos de juego', guide_modes_sub: 'Toca un modo para conocer sus reglas y empezar una partida.',
        guide_mode_classic_desc: 'Supera niveles y gana hasta tres estrellas.', guide_mode_timed: 'Contrarreloj', guide_mode_timed_desc: 'Cada convergencia compra segundos y mantiene el ritmo.',
        guide_mode_adventure: 'Aventura', guide_mode_adventure_desc: 'Viaja por biomas con objetivos y mini-jefes.', guide_mode_survival_desc: 'Resiste oleadas, jefes y un tablero cada vez más rápido.',
        guide_powerups_title: 'Potenciadores', guide_powerups_sub: 'Úsalos en el momento justo para recuperar el control del tablero.',
        guide_power_bomb: 'Elimina una zona alrededor del objetivo.', guide_power_freeze: 'Detiene temporalmente el ritmo de aparición.',
        guide_power_ray: 'Limpia una línea completa del tablero.', guide_power_broom: 'Barre la fila o columna con más iconos.',
        guide_power_wild: 'Transforma un grupo repetido y salva la jugada.', guide_tutorial_cta: 'Jugar tutorial',
        tutorial_btn: 'Tutorial interactivo', understood: 'Entendido',
        pause: 'Pausa', resume: 'Reanudar', restart: 'Reiniciar', menu: 'Menú', main_menu: 'Menú principal', close: 'Cerrar', back: 'Volver', retry: 'Reintentar', share: 'Compartir',
        pause_subtitle: 'Tómate un respiro, ¡tú puedes!', pause_tag_endless: 'Oleadas infinitas', pause_tag_timed: 'Contra el reloj',
        settings_title: '⚙️ Ajustes', settings_word: 'Ajustes', shop_title: '🛍️ Tienda', shop_hint: 'Temas del tablero. Pulsa para previsualizar.',
        profile_title: '📊 Perfil', achievements_title: '🏆 Trofeos', profile_card_title: 'Tarjeta de jugador', profile_loadout_title: 'Tu estilo', profile_icons_title: 'Avatares', profile_borders_title: 'Bordes', profile_owned: '{n}/{total} desbloqueados', shop_player_hint: 'Personaliza tu tarjeta. También puedes conseguir avatares y bordes en los cofres.', shop_player_icons: 'Avatares', shop_player_borders: 'Bordes de avatar', pause_run_title: 'Partida en curso', pause_score_label: 'Puntos', pause_combo_label: 'Combo', trophies_progress: '{n} de {total} trofeos', best_by_mode: 'Mejores marcas por modo', achievements: 'Logros',
        adventure_title: '🚀 Aventura', adventure_sub: 'Viaje infinito por biomas. Cada capítulo cambia las reglas y termina con un mini-jefe.',
        revive_title: '💔 ¡Última oportunidad!', revive_sub: 'Te has quedado sin vidas. ¿Revivir y seguir sobreviviendo?', giveup: 'Rendirse',
        revive_gets: 'Recibes 1 vida y despeja el 60% del tablero', revive_count: 'Revivir {n}/{max}', revive_short: 'Te faltan {n} monedas',
        coach_skip: 'Saltar tutorial', coach_step: 'Paso {n} de {t}',
        coach1: '👆 Toca la casilla VACÍA que brilla, entre dos iconos iguales, para juntarlos.',
        coach2: '✨ ¡Eso es! Si coinciden en varias direcciones, eliminas más de golpe.',
        coach3: '⚡ Ahora encadena: junta las dos parejas rápido, antes de que se agote el círculo, para subir el combo.',
        coach_done: '¡Listo! Ya sabes jugar 🎉', coach_play1: 'Jugar nivel 1', coach_menu: 'Ir al menú',
        quit_confirm: '¿Salir? Toca de nuevo para confirmar', confirm_buy: '¿Confirmar?',
        resume_run: 'Continuar partida', run_resumed: 'Partida recuperada',
        premium_chest: 'Cofre premium', no_gems: 'Gemas insuficientes · gana gemas en Supervivencia, mundos y reto diario',
        reroll_mission: 'Cambiar misión · 1 ticket', mission_rerolled: '¡Misión nueva!', missions_intro: 'Los premios se acreditan automáticamente al completar el objetivo.', mission_daily_label: 'Misión diaria', mission_weekly_label: 'Reto semanal', mission_complete: 'Completada', mission_reward_label: 'Premio', mission_reward_daily: '+150 XP · +60 monedas', mission_reward_weekly: '+400 XP · +200 monedas · cofre de evento', mission_credited: 'Acreditado', mission_reroll_hint: 'Conservas el progreso global; solo cambia el objetivo de hoy.', mission_reroll_missing: 'Necesitas 1 ticket para cambiar la misión', mission_cta_mode: 'Jugar {mode}', mission_cta_modes: 'Elegir modo',
        mission_m_combo: 'Consigue un combo ×8', mission_m_remove: 'Elimina 80 iconos en una partida', mission_m_score: 'Haz 2.500 puntos en una partida', mission_m_perfect: 'Deja el tablero vacío una vez', mission_w_games: 'Juega 12 partidas esta semana', mission_w_remove: 'Elimina 800 iconos esta semana', mission_w_score: 'Suma 20.000 puntos esta semana', mission_w_combo: 'Consigue un combo ×15',
        daily_challenge: 'Reto del día', daily_play: 'Jugar', daily_best: 'Mejor de hoy: {n}',
        daily_pending: 'Tablero de hoy · ¡juégalo!', daily_home_pending: 'Hoy: ¡juégalo!', daily_home_done: '✅ {m} · {n}', daily_done_state: '✅ Hecho · Mejor: {n}',
        daily_done_medal: '{m} · Mejor: {n}', daily_medal_none: 'Sin medalla', daily_medal_bronze: 'Bronce', daily_medal_silver: 'Plata', daily_medal_gold: 'Oro',
        daily_medal_result: 'Medalla diaria: {m}', daily_next_medal: 'Siguiente medalla: supera {n}',
        daily_info_same: 'El mismo tablero para todos · cambia a medianoche', daily_info_mut: 'Mutador de hoy', daily_info_medals: 'Medallas', daily_info_best: 'Mejor de hoy', daily_info_no_best: 'Sin intentos todavía', daily_info_ghost: 'Tu fantasma: tu mejor intento de hoy', daily_info_streak: 'Racha con congelación ética', daily_info_first: '+5 💎 primer intento del día', daily_note_next: '🎯 Siguiente: {m} {n}', daily_medal_up: '¡Medalla de {m}! Siguiente: {n}', daily_medal_max: '¡Oro asegurado!',
        daily_learning_label: 'Hoy entrenas', daily_practice_in: 'Después, practica en {mode}', daily_practice_cta: 'Practicar en {mode}', daily_skill_pure: 'Cadenas limpias y lectura del tablero', daily_skill_ice: 'Liberar bloqueos sin perder el ritmo', daily_skill_window: 'Sostener combos rápidos', daily_skill_variety: 'Reconocer patrones con más iconos', daily_skill_rocks: 'Trazar rutas entre obstáculos', daily_skill_fast: 'Decidir bajo presión', daily_skill_crystal: 'Priorizar objetivos especiales', daily_skill_nohints: 'Leer el tablero sin asistencia',
        mode_note_clasico: 'Maestría: termina sin errores para 3★', mode_note_clasico_streak: 'Racha perfecta: ×{n}',
        mode_note_aventura: 'Descubre: {m}', mode_note_contrarreloj: 'Cada convergencia compra segundos', mode_note_daily: 'Reto diario: bronce, plata u oro', mode_note_zen: 'Sin castigo',
        mode_brief_clasico: 'Clásico · busca 3 estrellas', mode_brief_aventura: 'Aventura · lee el bioma y adapta la ruta',
        mode_brief_contrarreloj: 'Contrarreloj · prioriza combos para comprar tiempo', mode_brief_supervivencia: 'Supervivencia · prepara tu arsenal antes de la oleada', mode_brief_zen: 'Zen · calma, limpieza y colección',
        result_focus_clasico: 'Repite niveles sin errores para encadenar perfectos.', result_focus_aventura: 'El siguiente bioma cambia el objetivo: mira el banner antes de actuar.',
        result_focus_contrarreloj: 'El mejor ritmo nace de combos cortos y constantes.', result_focus_supervivencia: 'Guarda un booster para el tramo final de cada oleada.', result_focus_zen: 'Buen modo para practicar rutas largas sin presión.',
        classic_streak: 'Racha perfecta ×{n}', classic_best_streak: 'Mejor racha: ×{n}', classic_streak_lost: 'Racha perfecta reiniciada',
        time_pressure: '¡Últimos segundos!', surv_wave_soon: 'Oleada en camino',
        next_title: 'Siguiente paso', next_open_chest: 'Abrir cofre', next_open_chest_sub: 'Tienes recompensa guardada lista para abrir.',
        next_missions: 'Ver misiones', next_missions_sub: 'Hay progreso o recompensa cerca en misiones.',
        next_daily: 'Mejorar reto diario', next_daily_sub: 'Busca la siguiente medalla del día con el mismo tablero.',
        next_shop: 'Elegir cosmético', next_shop_sub: 'Ya puedes desbloquear o equipar algo visual.',
        next_classic: 'Volver al mapa', next_classic_sub: 'Sigue una ruta de 3★ y racha perfecta.',
        next_surv: 'Ir a Supervivencia', next_surv_sub: 'Gana cofres cada 10 oleadas y prueba boosters.',
        next_adventure: 'Continuar Aventura', next_adventure_sub: 'Descubre el siguiente bioma y su objetivo.',
        next_modes: 'Probar otro modo', next_modes_sub: 'Completa tu variedad de modos para desbloquear mastery.',
        progress_title: 'Progreso cercano', progress_daily: 'Misión diaria', progress_weekly: 'Reto semanal',
        progress_variety: 'Variedad de modos', progress_chests: 'Cofres listos', progress_cosmetic: 'Cosmético cercano',
        progress_ready: 'Listo', progress_left: 'faltan {n}', progress_modes_left: '{n} por probar',
        over_surv_sheet: 'Hoja de supervivencia', over_surv_sheet_sub: 'bendiciones, jefes y rango',
        over_performance: 'Rendimiento', over_performance_sub: 'lo esencial de la run',
        over_profile_general: 'perfil general', over_wave_reached: 'Oleada alcanzada',
        over_boons: 'Bendiciones elegidas', over_no_boons: 'Sin bendiciones',
        over_bosses: 'Jefes', over_bosses_cleared: 'Superados', over_service_rank: 'Rango de supervivencia',
        over_rank_up_short: 'Ascenso', over_this_run_waves: 'Oleadas esta run', over_toward_rank: 'Hacia {r}',
        over_wave_progress_unit: 'Oleada = progreso', over_rank_reason: 'Sube porque alcanzaste la oleada {w}: cada oleada completada suma servicio al rango de Supervivencia.',
        over_rank_reason_max: 'Rango máximo: cada oleada sigue sumando servicio vitalicio de Supervivencia.',
        over_peak_title: 'Mejor momento', over_peak_sub: 'Pico de la run', over_peak_points: 'Puntos', over_peak_combo: 'Combo',
        over_peak_chain: 'Cadena perfecta', over_peak_note_surv: 'Combo ×{c} en la oleada {w}: el tramo donde más puntos generaste de una sola cadena.',
        over_peak_note_level: 'Combo ×{c}: el tramo donde más puntos generaste de una sola cadena.',
        empty_chests_title: 'Aún no tienes cofres', empty_chests_sub: 'Cumple objetivos en cualquier modo · cada 3 cae un cofre del ciclo', empty_cta_surv: 'Jugar Supervivencia', chest_store_shortcut: 'Tienda de cofres', empty_chests_pitch: 'Abre premios hoy: compra un cofre al instante o juega para conseguir el siguiente gratis.', empty_chests_buy: 'Comprar cofres', empty_chests_play: 'Jugar y ganar',
        empty_medals_title: 'Tu primera medalla te espera', empty_medals_sub: 'Juega una partida para empezar a desbloquear logros',
        empty_lb_title: 'Sin marcas todavía', empty_lb_sub: 'Juega cualquier modo para registrar tu primera marca', empty_cta_play: 'Elegir modo',
        err_fatal: 'Algo ha fallado.', err_reload: 'Recargar', browser_old: 'Tu navegador es demasiado antiguo para jugar. Actualízalo, por favor.',
        update_ready: '✨ Nueva versión disponible', update_btn: 'Actualizar',
        sr_combo: 'Combo de {n}', sr_converge: '{n} iconos convergen', sr_wave: 'Oleada {n}', sr_life: 'Vida perdida, quedan {n}',
        sr_over: 'Fin de la partida, {n} puntos', sr_level: 'Nivel completado, {n} puntos', sr_stars: 'Nivel completado, {s} de 3 estrellas, {n} puntos',
        surv_sys_title: 'Cómo funciona', surv_sys_charge: 'Llena el anillo interior para convertir tus convergencias en monedas de suministro.', surv_sys_frenzy: 'Llena el anillo de frenesí para multiplicar tus puntos un rato.', surv_sys_lives: 'Pierdes una vida si el tablero se desborda; revivir cuesta monedas y sube de precio con cada uso.',
        surv_supply_reward: 'Suministro completo · +{n} monedas para tu próximo arsenal', surv_supply_short: '+25% suministro',
        pause_no_save: 'Este modo no guarda la partida al salir.',
        ci_tap: 'Toca para empezar', ci_no_mods: 'Sin modificadores especiales',
        daily_first_reward: '+5 💎 · primer intento del día', daily_new_best: '¡Nueva marca del día! {n}',
        no_moves_wait: 'Sin jugadas ahora mismo: espera al siguiente icono',
        challenge_start: 'Reto compartido: ¡mismo tablero!',
        diff_facil: 'Fácil', diff_normal: 'Normal', diff_dificil: 'Difícil',
        set_sfx: 'Efectos de sonido', set_music: 'Música', set_haptics: 'Vibración', set_reduced: 'Reducir efectos', set_large: 'Texto grande', set_lang: 'Idioma',
        perf_suggest: 'Toca aquí para activar el modo ligero y ganar fluidez', perf_light_on: 'Modo ligero activado · puedes revertirlo en Ajustes', rfx_system_notice: 'Efectos reducidos por el ajuste del sistema · cámbialo en Ajustes',
        st_points: 'Puntos', st_level: 'Nivel', st_combo: 'Combo máx.', st_removed: 'Eliminados', st_time: 'Tiempo', st_record: 'Récord', st_wave: 'Oleada', st_surv: 'Sobreviviste', st_best: 'Mejor',
        st_games: 'Partidas', st_bestcombo: 'Mejor combo', st_totaltime: 'Tiempo total',
        surv_new_icons: '¡Nuevos iconos! Sube la dificultad',
        surv_intro_goal: 'Sobrevive el mayor número de oleadas.',
        surv_intro_merge: 'Junta iconos iguales tocando la casilla vacía entre ellos.',
        surv_intro_lose: 'Si el tablero se llena, pierdes una vida.',
        surv_go: '¡YA!',
        aim_hint: 'Toca dónde aplicarlo', pu_freeze: 'Spawns congelados', pu_x2: '¡Puntos x2!', pu_bomb: '¡Boom!', pu_ray: '¡Rayo!', pu_icons: 'iconos', chain_boom: 'Cadena ×{n}',
        surv_meteor: '¡Lluvia de iconos!', surv_quake: '¡Terremoto!', surv_frost: 'Frente helado', surv_life_lost: 'Vida liberada · -1',
        surv_boss_soon: '⚠ Jefe', surv_boss_meteor_warn: '¡Lluvia de iconos inminente!', surv_boss_quake_warn: '¡Terremoto inminente!', surv_boss_frost_warn: '¡Frente helado inminente!',
        near_miss: '¡Te quedaste a {n} figuras de lograrlo!', peak_moment: 'Tu mejor momento: +{p} con combo ×{c}',
        sprint_on: '¡Sprint final! Puntos ×1.5', mistake_time: 'Error · −{n}s',
        boon_title: '¡Bendición!', boon_sub: 'Superaste al jefe: elige una mejora',
        boon_life: 'Vida extra', boon_life_d: '+1 corazón (puede superar el máximo)',
        boon_charge: 'Sobrecarga', boon_charge_d: '+50 de carga de suministro',
        boon_pack: 'Arsenal', boon_pack_d: '+1 bomba y +1 rayo',
        boon_slow: 'Calma', boon_slow_d: 'Figuras un 25% más lentas durante 3 oleadas',
        boon_frenzy: 'Furia', boon_frenzy_d: '¡Frenesí activado al instante!',
        boon_magnet: 'Imán', boon_magnet_d: 'Las próximas 5 uniones atraen +1 figura',
        boon_score_boost: 'Impulso de Puntos', boon_score_boost_d: '+0.25× permanente a la puntuación (máx. +0.5×)',
        boon_golden_wave: 'Oleada Dorada', boon_golden_wave_d: '¡Puntuación ×2 en esta oleada y la siguiente!',
        magnet_done: 'Imán agotado', new_record: '¡Nuevo récord!', fever_on: '¡FEVER!', revive_btn: 'Revivir',
        route_title: 'Elige tu ruta', route_dense: 'Ruta exigente', route_dense_d: 'Más obstáculos · puntos ×1.25 este capítulo',
        route_calm: 'Ruta serena', route_calm_d: 'Figuras más lentas · sin bonus',
        relic_title: 'Reliquia de jefe', relic_sub: 'Pasiva para el resto de la expedición (máx. 3)',
        relic_combo: 'Reloj de arena', relic_combo_d: 'Ventana de combo +0.4s',
        relic_crystal: 'Prisma', relic_crystal_d: 'Los cristales valen +30 extra',
        relic_hint: 'Brújula', relic_hint_d: '+1 pista en cada nivel',
        relic_shield: 'Escudo', relic_shield_d: 'La 1ª derrota del capítulo despeja el 30% en vez de terminar',
        relic_shield_fired: '¡El escudo te salvó! Tablero despejado',
        continue_title: 'Tablero lleno…', continue_sub: '¿Continuar por {n} gemas? Despeja el 40% del tablero (1 vez por nivel)',
        continue_yes: 'Continuar ({n}💎)', continue_yes_d: 'Despeja el 40% y sigue jugando',
        continue_no: 'Terminar partida', continue_done: '¡Continúas! Tablero despejado',
        classic_win_streak: 'Racha de victorias ×{n} · +{p}% monedas',
        zen_pace_title: 'Ritmo zen', zen_pace_slow: 'Sereno', zen_pace_slow_d: 'Figuras muy lentas, para respirar',
        zen_pace_normal: 'Fluido', zen_pace_normal_d: 'Ritmo tranquilo estándar', zen_release: 'Liberando espacio…',
        pl_sub: 'Lleva hasta 2 potenciadores (opcional)', pl_play: 'Jugar', pl_play_cost: 'Jugar · {c} monedas',
        pl_skip: 'Sin potenciadores', pl_first: 'Nuevo: puedes llevar potenciadores a los niveles. Se usan tocando su botón en partida.',
        pl_max: 'Máximo {n} potenciadores', pl_no_coins: 'Monedas insuficientes',
        surv_tide: '¡Marea de figuras!', surv_boss_tide_warn: '¡Marea inminente: despeja los bordes!',
        // Jefes nuevos y enfurecidos (SV-43)
        surv_lockdown: '¡Cierre! Candados en el tablero', surv_boss_lockdown_warn: '¡Cierre inminente: prepárate para romper candados!',
        surv_eco: '¡Ha vuelto: {b}!', surv_boss_eco_warn: '¡Un jefe vuelve a por ti!',
        surv_boss_enraged_warn: '⚠ ¡Jefe ENFURECIDO inminente!',
        surv_meteor_enraged: '¡Lluvia de iconos ENFURECIDA!', surv_tide_enraged: '¡Marea ENFURECIDA: marco completo!', surv_frost_enraged: 'Frente helado ENFURECIDO',
        bossname_meteor: 'Lluvia de iconos', bossname_tide: 'Marea', bossname_frost: 'Frente helado', bossname_lockdown: 'Cierre', bossname_quake: 'Terremoto',
        // Bestiario de encuentros (JF-β): nombre + epíteto por jefe, y nombre de ataque por fase.
        bossdex_meteor: 'Nubarrón', bossdex_meteor_e: 'el cielo a pedazos',
        bossdex_tide: 'La Corriente', bossdex_tide_e: 'señora de los bordes',
        bossdex_frost: 'Boreal', bossdex_frost_e: 'el aliento blanco',
        bossdex_lockdown: 'El Cerrajero', bossdex_lockdown_e: 'guardián de candados',
        bossdex_quake: 'Tectónico', bossdex_quake_e: 'el que baraja el mundo',
        bossatk_meteor_1: 'Lluvia', bossatk_meteor_2: 'Lluvia y roca',
        bossatk_tide_1: 'Marea', bossatk_tide_2: 'Marea completa',
        bossatk_frost_1: 'Escarcha', bossatk_frost_2: 'Clúster helado',
        bossatk_lockdown_1: 'Cierre', bossatk_lockdown_2: 'Jaula',
        bossatk_quake_1: 'Terremoto parcial', bossatk_quake_2: 'Terremoto total',
        surv_boss_cage_steal: '¡{b} enjaula tu {p}! Rompe la jaula para recuperarlo',
        surv_master_round: 'Ronda maestra ✦ +1 vida',
        surv_master_round_charge: 'Ronda maestra ✦ +50 de suministro',
        // Minijefes (JF-δ)
        minidex_magpie: 'La Urraca', minidex_magpie_e: 'la ladrona',
        minidex_firefly: 'Luciérnaga Dorada', minidex_firefly_e: 'la fugaz',
        minidex_sentinel: 'El Centinela', minidex_sentinel_e: 'el vigía',
        minidex_herald: 'El Heraldo', minidex_herald_e: 'el que anuncia',
        mini_steal: '¡{b} roba iconos! Cázala para recuperarlos',
        mini_return: '¡Botín recuperado! +{n} iconos',
        mini_firefly_gift: 'Toque dorado: +24 de frenesí',
        mini_sentinel_gift: 'Su territorio queda limpio',
        mini_herald_down: 'El Heraldo ha caído: el jefe llegará debilitado',
        mini_herald_up: '¡El Heraldo escapó! El jefe llega EMPODERADO',
        mini_gone: '{b} se marcha…',
        sr_mini_enter: 'Minijefe: {b}. Converge el icono sobre su ancla para cazarlo',
        sr_mini_down: '{b}, cazado',
        // Acto III: La Corte Profunda (JF-ε)
        bossdex_crystalid: 'Cristálido', bossdex_crystalid_e: 'el corazón que rebrota',
        bossdex_void: 'El Vacío', bossdex_void_e: 'la boca paciente',
        bossdex_puppeteer: 'El Titiritero', bossdex_puppeteer_e: 'amo de los hilos',
        bossatk_crystalid_1: 'Esquirlas', bossatk_crystalid_2: 'Esquirlas y rebrote',
        bossatk_void_1: 'Devorar', bossatk_void_2: 'Devorar y crecer',
        bossatk_puppeteer_1: 'Enhebrar', bossatk_puppeteer_2: 'Re-enhebrar',
        surv_boss_shards: '¡Esquirlas del Cristálido!',
        surv_boss_regrow: '¡{b} se regenera! Remátalo con tempo',
        surv_boss_devour: 'El Vacío devora {n} iconos…',
        surv_boss_grow: '¡El Vacío CRECE! No lo ignores',
        surv_boss_threads: '¡Hilos! Converger los tipos marcados LE CURA',
        surv_boss_heal: '¡{b} se cura con tus hilos!',
        surv_boss_crystalid_warn: '¡Cristálido inminente: remátalo antes de que rebrote!',
        surv_boss_void_warn: '¡El Vacío inminente: no dejes que crezca!',
        surv_boss_puppeteer_warn: '¡El Titiritero inminente: cuidado con los hilos!',
        // Jefes de bioma de Aventura (JF-ζ): identidad; la mecánica GM-08 no cambia.
        advdex_nebula: 'Corazón de Nebulosa', advdex_nebula_e: 'late entre el polvo',
        advdex_asteroid: 'El Magnetar', advdex_asteroid_e: 'pastor de rocas',
        advdex_ice: 'Aurora Hambrienta', advdex_ice_e: 'la luz que congela',
        advdex_core: 'El Fundidor', advdex_core_e: 'corazón del núcleo',
        advdex_void: 'La Nada', advdex_void_e: 'devora-pistas',
        advdex_crystal: 'Matriarca Cristal', advdex_crystal_e: 'madre del enjambre',
        feat_cazador: 'Cazador', feat_cazador_d: 'Derrota a los 5 Señores (Nubarrón, Corriente, Boreal, Cerrajero y Tectónico)',
        feat_ronda_maestra: 'Ronda maestra', feat_ronda_maestra_d: 'Logra 3 Rondas maestras (derrotas sin daño ni potenciadores)',
        feat_domaecos: 'Domaecos', feat_domaecos_d: 'Derrota a un eco de nivel III o superior',
        surv_boss_lvl: '{n}',
        surv_boss_leave: 'Huye {s}s',
        bosstut_boss_intro_title: '¡Aparición de Jefe!',
        bosstut_boss_intro_body: 'El jefe no usa una barra de vida normal: sus PV son las ANCLAS con brillo sobre el tablero. ¡Haz coincidir los iconos situados SOBRE las anclas para dañarlo!',
        bosstut_boss_intro_panel: '¿Cómo vencerlo?',
        bosstut_boss_intro_detail1_title: 'Ataca sus anclas',
        bosstut_boss_intro_detail1_body: 'Converge los iconos situados sobre las marcas luminosas.',
        bosstut_boss_intro_detail2_title: 'Rompe todas',
        bosstut_boss_intro_detail2_body: 'Cada ancla destruida reduce la vida real del jefe.',
        bosstut_boss_intro_tip_title: 'Consejo',
        bosstut_boss_intro_tip_body: 'Prioriza las anclas que ya tengan una convergencia preparada.',
        bosstut_boss_armored_title: 'Ancla Blindada con Escudo',
        bosstut_boss_armored_body: '🛡️ Esta ancla tiene un escudo de acero. No se puede converger directamente: realiza convergencias en casillas ADYACENTES (al lado) o usa una bomba 💣 para romper el escudo primero.',
        bosstut_boss_armored_panel: '¿Cómo romperla?',
        bosstut_boss_armored_detail1_title: 'Converge al lado',
        bosstut_boss_armored_detail1_body: 'Una unión adyacente agrieta el blindaje de acero.',
        bosstut_boss_armored_detail2_title: 'Usa una bomba',
        bosstut_boss_armored_detail2_body: 'La explosión elimina el escudo y deja el ancla expuesta.',
        bosstut_boss_armored_tip_title: 'Consejo',
        bosstut_boss_armored_tip_body: 'Rompe primero el escudo; después podrás dañar el ancla con normalidad.',
        bosstut_boss_phase2_title: '¡Cambio a Fase 2!',
        bosstut_boss_phase2_body: '⚠️ El jefe ha perdido la mitad de su vida. Ahora atacará con una variante más rápida y peligrosa.',
        bosstut_boss_phase2_panel: '¿Qué cambia?',
        bosstut_boss_phase2_detail1_title: 'Atacará más rápido',
        bosstut_boss_phase2_detail1_body: 'Sus ataques llegarán con mayor frecuencia.',
        bosstut_boss_phase2_detail2_title: 'Más peligro',
        bosstut_boss_phase2_detail2_body: 'El nuevo patrón ocupará más espacio del tablero.',
        bosstut_boss_phase2_tip_title: 'Consejo',
        bosstut_boss_phase2_tip_body: 'Prepárate y usa tus mejores movimientos para rematarlo.',
        bosstut_boss_boons_title: '✨ ¡Bendiciones de Victoria!',
        bosstut_boss_boons_body: 'Al derrotar a un jefe recibes una bendición. Elige 1 mejora entre 3 opciones aleatorias: corazones de vida, sobrecargas de suministro, ralentización de fichas, imán de convergencias o multiplicadores de puntuación permanentes.',
        bosstut_boss_boons_tip: 'Estas mejoras pueden marcar la diferencia en las oleadas más difíciles.',
        surv_armored_hint: '🛡️ ¡Protegido! Converge al lado o usa bomba para romper el escudo',
        surv_armored_broken: '🛡️ ¡Escudo roto! Ahora puedes converger el icono',
        surv_boss_hp_sr: 'Vida del jefe: {n} de {m} anclas',
        surv_boss_enter_sr: 'Jefe: {b}, nivel {n}, {k} anclas. Converge los iconos sobre las anclas para dañarlo.',
        surv_boss_prep: '{b} prepara: {a}',
        surv_boss_phase2: '¡Fase 2! {b} cambia de patrón',
        surv_boss_defeated: '¡{b} DERROTADO!',
        surv_boss_retreat: '{b} se retira…',
        survmut_ice: 'Semana del hielo: trampas heladas · monedas ×1.15', survmut_chaos: 'Semana del caos: el terremoto ha vuelto', survmut_frenzy: 'Semana de la furia: frenesí +30%',
        dmut_pure: 'Reto de hoy: tablero puro', dmut_ice: 'Reto de hoy: tablero helado', dmut_window: 'Reto de hoy: combos más exigentes', dmut_variety: 'Reto de hoy: más variedad de figuras', dmut_rocks: 'Reto de hoy: campo de rocas', dmut_fast: 'Reto de hoy: ritmo veloz', dmut_crystal: 'Reto de hoy: cristales dobles', dmut_nohints: 'Reto de hoy: sin pistas',
        dmut_pure_n: 'Puro', dmut_ice_n: 'Hielo', dmut_window_n: 'Combos exigentes', dmut_variety_n: 'Variedad', dmut_rocks_n: 'Rocas', dmut_fast_n: 'Veloz', dmut_crystal_n: 'Cristales', dmut_nohints_n: 'Sin pistas',
        daily_streak_chest: '¡{n} días de medalla seguidos! +1 cofre', daily_cal_al: 'Calendario de medallas de los últimos 14 días',
        timecap_hint: 'Cápsula de tiempo: detónala por adyacencia (+5s)',
        advboss_warn: 'El jefe carga su ataque…',
        advboss_nebula: '¡Andanada del jefe!', advboss_asteroid: '¡El jefe lanza rocas!', advboss_ice: '¡El jefe congela!', advboss_core: '¡El jefe acelera el núcleo!', advboss_void: '¡El vacío devora una pista!', advboss_crystal: '¡El jefe se regenera!',
        exped_title: 'Tu expedición',
        garden_10: '¡10 flores en tu jardín! +1 cofre', garden_50: '¡50 flores! Skin «Jardín Zen» desbloqueado',
        board_excl: 'Exclusivo',
        pick_back: 'Volver',
        pu_row: '¡Fila despejada!', pu_col: '¡Columna despejada!', pu_no_target: 'Sin objetivo', pu_wild_emergency: 'Comodín · despeje de emergencia', pu_wild_icons: 'Comodín · {n} iconos',
        surv_diff_title: 'Supervivencia', surv_diff_sub: 'Elige el ritmo de la partida', surv_start: 'Empezar supervivencia',
        surv_week_label: 'Esta semana', survmut_none: 'Semana clásica · sin modificador',
        surv_diff_facil_d: '4 vidas · ritmo suave · monedas ×0.85', surv_diff_normal_d: '3 vidas · estándar · monedas ×1', surv_diff_dificil_d: '3 vidas · ritmo alto · monedas ×1.3',
        surv_launch_record: 'Récord: oleada {w}', surv_launch_norecord: 'Récord: —',
        mode_launch_close: 'Cerrar', mode_launch_back: 'Volver', mode_launch_details: 'Ver detalles', mode_launch_progress: 'Tu progreso', mode_launch_how: 'Cómo funciona', mode_launch_record: 'Récord', mode_launch_no_record: '—', mode_launch_plays: 'Partidas', mode_launch_level: 'Nivel', mode_launch_chapter: 'Capítulo', mode_launch_best: 'Mejor marca', mode_launch_worlds: 'Mundos', mode_launch_stars: 'Estrellas', mode_launch_next_boss: 'Próximo jefe', mode_launch_start_time: 'Tiempo inicial', mode_launch_time_cap: 'Tope de reloj', mode_launch_each_match: 'Cada convergencia', mode_launch_flowers: 'Flores', mode_launch_goal: 'Objetivo', mode_launch_pace: 'Ritmo',
        session_title: 'Ficha de la sesión', session_duration: 'Duración', session_save: 'Guardado', session_goal: 'Objetivo', session_entry: 'Entrada', session_save_yes: 'Se puede retomar', session_save_no: 'Una sesión',
        session_classic_duration: '3–6 min/nivel', session_classic_goal: 'Vacía el tablero', session_classic_entry: 'Gratis · boosters opcionales',
        session_adventure_duration: '4–7 min/nivel', session_adventure_goal: 'Cumple el objetivo', session_adventure_entry: 'Gratis · monedas y XP',
        session_timed_duration: '1–4 min', session_timed_goal: 'Máxima puntuación', session_timed_entry: 'Gratis · monedas y XP',
        session_survival_duration: 'Sin límite', session_survival_goal: 'Aguanta oleadas', session_survival_entry: 'Gratis',
        session_zen_duration: 'Sin límite', session_zen_goal: 'Juega a tu ritmo', session_zen_entry: 'Gratis · flores y colección',
        ml_surv_tag: 'Oleadas infinitas ∞', ml_surv_weekly: 'Progreso semanal', ml_surv_special: 'Semana especial', ml_surv_choose: 'Dificultad', ml_surv_feats: 'Esta semana', ml_surv_how3: 'Pierdes una vida si el tablero se desborda.', ml_surv_week_none_title: 'Semana clásica', ml_surv_week_none_sub: 'Sin modificador', ml_surv_week_ice_title: 'Semana del hielo', ml_surv_week_ice_sub: 'Trampas heladas · monedas ×1.15', ml_surv_week_chaos_title: 'Semana del caos', ml_surv_week_chaos_sub: 'El terremoto ha vuelto', ml_surv_week_frenzy_title: 'Semana de la furia', ml_surv_week_frenzy_sub: 'Frenesí +30%',
        surv_loadout_title: 'Prepara tu arsenal', surv_loadout_sub: 'Elige hasta {n}. Usamos tu stock antes de cobrar monedas.', surv_loadout_count: '{n}/{max} equipados', surv_loadout_price: '{n} monedas', surv_loadout_none: 'Sin boosters: puedes jugar gratis y financiar la próxima preparación.', surv_loadout_uses_stock: '{n} del stock', surv_loadout_cost: '{n} monedas', surv_loadout_max: 'Máximo {n} boosters por partida', surv_start_empty: 'Empezar sin boosters', surv_start_stock: 'Empezar · usar {n} del stock', surv_start_cost: 'Empezar · {n} monedas',
        ml_classic_tag: 'Por niveles', ml_classic_world: 'Mundo actual', ml_classic_route: 'Tu partida', ml_classic_cta: 'Abrir mapa clásico', ml_classic_how1: 'Supera niveles y desbloquea mundos nuevos.', ml_classic_how2: 'Gana hasta 3 estrellas según tus errores.', ml_classic_how3: 'Cada mundo añade obstáculos y reglas propias.',
        ml_adv_tag: 'Viaje infinito', ml_adv_biome: 'Bioma actual', ml_adv_route: 'Tu expedición', ml_adv_cta: 'Continuar aventura', ml_adv_how1: 'Avanza por capítulos de cinco niveles.', ml_adv_how2: 'Cada bioma cambia objetivos y obstáculos.', ml_adv_how3: 'El último nivel de cada capítulo tiene mini-jefe.',
        ml_timed_tag: 'Contrarreloj', ml_timed_score: 'Tu marca', ml_timed_rules: 'Reglas de la partida', ml_timed_cta: 'Empezar contrarreloj', ml_timed_how1: 'Empiezas con 60 segundos en un único tablero.', ml_timed_how2: 'Cada convergencia recupera tiempo, con un tope de 90.', ml_timed_how3: 'Los combos mantienen el reloj y multiplican puntos.',
        ml_zen_tag: 'Relax', ml_zen_garden: 'Tu jardín', ml_zen_space: 'Jardín zen', ml_zen_choose: 'Elige ritmo', ml_zen_cta: 'Entrar en zen', ml_zen_how1: 'No hay penalizaciones ni final de partida.', ml_zen_how2: 'Si el tablero se llena, se despeja parcialmente.', ml_zen_how3: 'Cada tablero limpio hace crecer una flor.',
        surv_boss_cleared: '¡JEFE SUPERADO!', surv_boss_cleared_clean: '¡Jefe superado sin potenciadores! ✦',
        surv_frenzy_max: '¡FURIA MÁXIMA!', surv_wave_record_live: 'Récord: oleada {w} ¡y subiendo!',
        surv_over_wave_new: '🏆 ¡Nuevo récord de oleada!', surv_over_wave_near: 'A {k} de tu récord (oleada {best})', surv_over_record: 'Tu récord: oleada {best}',
        surv_run_bosses: '{n} jefes superados',
        // Hoja de Servicio (SV-30/31/32)
        srank_recluta: 'Recluta', srank_explorador: 'Explorador', srank_curtido: 'Curtido', srank_veterano: 'Veterano', srank_elite: 'Élite', srank_leyenda: 'Leyenda',
        surv_rank_label: 'Rango', surv_rank_progress: '{c}/{n} oleadas → {next}', surv_rank_max: '¡Rango máximo!', surv_rank_up: '¡Ascenso de rango: {r}!',
        surv_week_best: 'Esta semana: oleada {w}', surv_week_best_none: 'Esta semana: aún sin marca',
        feat_unlocked: '¡Hazaña!', surv_feats_label: 'Hazañas',
        feat_impecable: 'Impecable', feat_impecable_d: 'Supera un jefe sin perder ninguna vida',
        feat_purista: 'Purista', feat_purista_d: 'Llega a la oleada 10 sin usar potenciadores',
        feat_fenix: 'Fénix', feat_fenix_d: 'Bate tu récord en una run donde reviviste',
        feat_coleccionista: 'Coleccionista', feat_coleccionista_d: 'Elige las 8 bendiciones distintas',
        feat_semana_completa: 'Trotamundos', feat_semana_completa_d: 'Marca récord semanal en 3 mutadores distintos',
        feat_frenetico: 'Frenético', feat_frenetico_d: 'Activa 3 frenesíes máximos en una run',
        feat_al_limite: 'Al límite', feat_al_limite_d: 'Supera 2 oleadas seguidas con 1 sola vida',
        feat_economo: 'Económico', feat_economo_d: 'Llega a la oleada 15 sin revivir',
        surv_frenzy: 'Frenesí', surv_frenzy_ready: '¡Frenesí activado!', surv_wave_reward: 'Oleada {w} · +{c} monedas',
        surv_milestone: 'Hito de oleada {w}', surv_wave_record: '¡Récord! Oleada {w}', surv_best_wave: 'Mejor oleada',
        surv_rewards: 'Recompensas', surv_reward_line: '+{c} monedas · +{g} gemas · +{ch} cofres', surv_time_record: '¡Récord de supervivencia!',
        coins: 'monedas', gems: 'gemas', daily_done: '¡Misión diaria completada!', weekly_done: '¡Reto semanal completado!', lvl: 'Nivel',
        next: 'Próximo', new_icons: 'Nuevos iconos', chapter: 'Capítulo', next_to: 'Ir al nivel {n} →', lets_play: '¡A jugar!',
        obj_clear: 'Vacía el tablero', obj_score: 'Consigue {n} pts', obj_score_live: 'Puntos: {p}/{n}', obj_survive: 'Sobrevive {n}s', obj_boss: 'JEFE · rompe los 💎', obj_boss_live: 'JEFE · rompe los 💎 ({n})',
        objlabel_clear: 'Limpiar', objlabel_score: 'Puntuar', objlabel_survive: 'Sobrevivir', objlabel_boss: 'Jefe',
        biomemod_nebula: '', biomemod_asteroid: '🪨 Aparecen rocas que estorban', biomemod_ice: '🧊 Casillas heladas: tócalas para romperlas', biomemod_core: '🔥 Los iconos aparecen más rápido', biomemod_void: '🕳️ Menos pistas disponibles', biomemod_crystal: '💎 Cristales con puntos extra',
        sum_level: 'Nivel alcanzado {n}', sum_time: 'Tiempo {t}', sum_wave: 'Oleada {w} · {s}s sobrevividos', sum_chapter: 'Capítulo {c} · Nivel {n}',
        level_done: '¡Nivel completado!', perfect_done: '¡Tablero perfecto!', level_sub: 'Nivel {n} superado', perfect_sub: 'Tablero limpio · bonus +{b}', level_reason_score: 'Objetivo cumplido: {n} pts', level_reason_clear: 'Tablero vaciado', level_reason_boss: 'Cristales del jefe destruidos', level_reason_survive: 'Has resistido {n}s', boss_next: '¡Jefe a la vista!',
        over_victory: '🏆 ¡Victoria!', over_surv: '🛡️ Fin de la supervivencia', over_fail: '¡Misión fallida!', over_time: 'Contrarreloj terminado',
        reason_time: '¡Se acabó el tiempo!', reason_nomoves: 'Sin movimientos posibles · {n}% del tablero ocupado.', reason_full: 'El tablero se ha llenado.', reason_end: 'Fin de la partida.', reason_surv: 'Sobreviviste {s}s', ach_unlocked: '🏅 Logro: {n}',
        legacy_import_title: 'Sincronizar progreso', legacy_import_sub: 'Se ha detectado una partida local previa. Revisa los datos proyectados antes de vincular tu cuenta.',
        legacy_import_confirm: 'Confirmar e importar', legacy_import_cancel: 'Mantener solo local',
        legacy_import_warning_text: 'Monedas y cofres locales no verificados se guardan en cuarentena y se verificarán por servidor.',
        legacy_import_done: 'Importación enviada', legacy_import_kept_local: 'Tu progreso sigue solo en este dispositivo', legacy_import_unavailable: 'La sincronización no está disponible ahora mismo',
        adventure_level: 'Aventura', xp: 'XP',
        sync_action_review: 'Revisar sincronización',
        sync_status_local_only: 'Solo local', sync_status_queued: 'En cola', sync_status_syncing: 'Sincronizando…',
        sync_status_awaiting: 'Requiere confirmación', sync_status_synced: 'Sincronizado', sync_status_offline: 'Sin conexión',
        sync_status_conflict: 'Conflicto', sync_status_identity_mismatch: 'Otra cuenta', sync_status_invalid_local: 'Datos locales no válidos', sync_status_error: 'Error de sincronización',
      },
      en: {
        welcome_sub: 'Match equal icons across space', name_q: "What's your name?", optional: '(optional)',
        begin: 'Start!', guest: 'Play as guest', start_sub: 'Ready to conquer the board?',
        play: 'Play', reward: 'Daily reward', menu_profile: 'Profile', menu_shop: 'Shop',
        menu_settings: 'Settings', how: 'How to play?', install: 'Install app', sound: 'Sound', best: 'Best score:',
        tab_log: 'Trophies', tab_events: 'Events', tab_shop: 'Shop', tab_home: 'Home', tab_guide: 'Guide', tab_collections: 'Collections', tab_set: 'Settings', missions_title: '🎯 Missions', missions_sub: 'Complete daily and weekly objectives to speed up your progress.',
        // Leaderboards (phase 6)
        ranks_title: 'Leaderboard', ranks_sub: 'Time Attack. Only runs verified by the server are published.',
        ranks_scope_daily: 'Today', ranks_scope_weekly: 'Week', ranks_scope_season: 'Season', ranks_scope_all: 'All time',
        ranks_loading: 'Loading leaderboard…', ranks_empty: 'No scores in this period yet. Be the first!',
        ranks_offline: 'No connection to the leaderboard server. Your local progress is safe.',
        ranks_error: 'Could not load the leaderboard. Try again in a moment.',
        ranks_more: 'Show more', ranks_you: 'You', ranks_your_rank: 'Your rank: {n}', ranks_unranked: 'You have no score in this period yet.',
        ranks_alias_title: 'Choose your public alias', ranks_alias_sub: 'It shows on the leaderboard next to your score. Do not use your real name.',
        ranks_alias_ph: 'Alias (max 24)', ranks_alias_save: 'Publish', ranks_alias_cancel: 'Not now',
        ranks_alias_invalid: 'The alias must be between 1 and 24 characters.',
        ranks_published: 'Published! Rank {n} on {b}.', ranks_not_improved: 'You did not beat your score in this period.',
        ranks_rejected: 'The server could not verify this run, so it was not published.',
        events_title: 'Events', events_sub: "Today's challenges, rewards and activities, all in one place.",
        events_daily_label: 'Every day', events_progress_label: 'Daily progress', events_today_label: 'Today only', events_rewards_label: 'Rewards',
        events_view: 'View', events_play: 'Play', events_open: 'Open', events_reward_ready: 'Ready to claim', events_reward_claimed: 'Claimed today',
        collections_title: 'Collections', collections_sub: 'Collect boards, themes and achievements as you play.',
        collections_boards: 'Boards', collections_themes: 'Themes', collections_achievements: 'Achievements', collections_unlocked: '{n} of {total}', collections_owned: 'Unlocked',
        collections_locked: 'Undiscovered', collections_explore_shop: 'View boards & themes', collections_view_achievements: 'View achievements',
        collections_hub_sub: 'Collect boards, themes, icons, borders and achievements as you play.',
        rarity_common: 'Common', rarity_rare: 'Rare', rarity_epic: 'Epic', rarity_legendary: 'Legendary',
        rarity_commons: 'Common', rarity_rares: 'Rare', rarity_epics: 'Epic', rarity_legendaries: 'Legendary',
        col_cat_boards: 'Boards', col_cat_boards_desc: 'Unlock new boards with unique designs and special effects.',
        col_cat_themes: 'Themes', col_cat_themes_desc: 'Collect complete themes to personalize your experience.',
        col_cat_icons: 'Icons', col_cat_icons_desc: 'Collect icon packs for the board tiles.',
        col_cat_avatars: 'Avatars', col_cat_avatars_desc: 'Unlock exclusive avatars for your profile and stand out.',
        col_cat_borders: 'Borders', col_cat_borders_desc: 'Get special borders to frame your avatar and show off your style.',
        col_cat_achievements: 'Achievements', col_cat_achievements_desc: 'Complete challenges and reach milestones to earn rewards.',
        col_icons_sub: 'Customize the icons that appear on the board.',
        col_avatars_sub: 'Unlock exclusive avatars and personalize your profile.',
        col_borders_sub: 'Get special borders to frame your avatar and show off your style.',
        col_boards_sub: 'Unlock boards with unique designs and special effects.',
        col_themes_sub: 'Collect complete themes to personalize your experience.',
        col_achievements_sub: 'Complete challenges and reach milestones to earn rewards.',
        col_progress_icons: 'Icon progress', col_progress_avatars: 'Avatar progress', col_progress_borders: 'Border progress', col_progress_boards: 'Board progress', col_progress_themes: 'Theme progress', col_progress_achievements: 'Achievement progress',
        col_filter_all: 'All', col_sort_recent: 'Most recent', col_sort_rarity: 'Rarity', col_sort_name: 'Name', col_sort_owned: 'Unlocked', col_sort_label: 'Sort by',
        col_locked_slot: 'Locked · to discover', col_empty_rarity: 'No items of this rarity yet.',
        shop_iconpacks: 'Board icons', iconpack_view: 'View icons', iconpack_contents: 'Pack icons', iconpack_cosmos_desc: 'The classic Convergence figure set.', iconpack_basic_redesigned_name: 'Redesigned Basic', iconpack_basic_redesigned_desc: 'Twenty classic figures refreshed with volume, shine and more defined colors.', iconpack_gem_pattern_name: 'Gem Pattern Pack', iconpack_gem_pattern_desc: 'Twenty bright patterns from one to five gems that add a greater visual challenge.', iconpack_nature_basic_name: 'Nature Basic', iconpack_nature_basic_desc: 'Eight essential figures inspired by leaves, flowers, water and woodland.', iconpack_nature_advanced_name: 'Nature Advanced', iconpack_nature_advanced_desc: 'Ten powerful nature figures featuring plants, fruit, wood and crystal.', iconpack_neon_name: 'Neon Pack', iconpack_neon_desc: 'Eight classic figures reinvented with luminous tubes and vivid neon colors.', iconpack_marine_name: 'Marine Pack', iconpack_marine_desc: 'Eight creatures and treasures evoking the depths of the ocean.', iconpack_magic_name: 'Magic Pack', iconpack_magic_desc: 'Eight enchanted objects charged with arcane energy.', iconpack_prismatic_name: 'Prismatic Jewels', iconpack_prismatic_desc: 'Ten richly colored faceted jewels with crystal highlights and a neon glow.', iconpack_elemental_name: 'Elemental Pack', iconpack_elemental_desc: 'Twelve primal forces with spectacular materials, lights and effects.', iconpack_equipped_note: 'These icons now appear on your board.',
        col_banner_icons_title: 'More packs soon', col_banner_icons_desc: 'New icon packs are coming to the shop. Collect them all!', col_banner_icons_cta: 'Go to shop',
        col_banner_avatars_title: 'Exclusive avatar', col_banner_avatars_desc: 'Join special events to get unique avatars for a limited time.', col_banner_avatars_cta: 'Go to events',
        col_banner_borders_title: 'Show off your style', col_banner_borders_desc: 'Borders give no gameplay advantage. Collect them all and stand out!', col_banner_borders_cta: 'Go to shop',
        col_banner_boards_title: 'Change your board', col_banner_boards_desc: 'Boards are visual only: no advantages. Collect them all!', col_banner_boards_cta: 'Go to shop',
        col_banner_themes_title: 'Color your game', col_banner_themes_desc: 'Themes repaint the whole interface. Pick your favorite.', col_banner_themes_cta: 'Go to shop',
        col_banner_achievements_title: 'Earn rewards', col_banner_achievements_desc: 'Complete challenges in any mode to unlock more achievements.', col_banner_achievements_cta: 'Play',
        modes_title: 'Choose your mode', modes_sub: 'Each mode, a different way to play', modes_more: 'More modes',
        home_modes_label: 'Game modes', home_carousel_hint: 'Swipe horizontally · tap the card to enter',
        home_swipe_coach: 'Swipe to explore the modes',
        home_mode_prev: 'Previous mode', home_mode_next: 'Next mode', home_mode_pages: 'Choose a mode',
        home_mode_play: 'Enter {mode}', home_mode_select: 'Select {mode}', home_mode_position: '{mode}. {n} of {total}',
        home_quick_actions: 'Events and shortcuts',
        modes_profile_resources: 'Profile and resources', modes_resources: 'Resources', modes_catalog: 'Mode catalog', econ_balance: 'Balance: {n}',
        group_mode: 'Mode', group_diff: 'Difficulty',
        card_surv: 'Survival', card_surv_badge: 'ENDLESS WAVES', card_surv_desc: 'Face growing waves of enemies. They get stronger every time. How long can you survive?',
        card_classic: 'Classic', card_classic_badge: 'BY LEVELS', card_classic_desc: 'Clear levels across different maps and unique challenges. New obstacles, mechanics and objects await in each one.',
        group_prog: 'Progression', group_score: 'Score', group_relax: 'Relax',
        card_adv_badge: 'ENDLESS', card_contra_badge: 'TIME ATTACK', card_zen_badge: 'RELAX', card_contra_daily: 'Includes the Daily challenge',
        card_multi: 'Multiplayer', card_multi_badge: 'COMING SOON', card_multi_tag: 'COMPETE ONLINE', card_multi_desc: 'Challenge other players online when it is available.',
        card_feat_locks: 'Locks', card_feat_objects: 'Objects', card_feat_events: 'Events', card_feat_more: 'And much more!',
        card_feat_first: 'Finish the board first', card_feat_best: 'Best score', card_feat_online: 'Online matches',
        card_feat_biomes: 'Biomes', card_feat_goals: 'Goals', card_feat_minibosses: 'Mini-bosses',
        card_feat_time: 'Gain time', card_feat_pressure: 'Rising pressure',
        card_feat_no_penalties: 'No penalties', card_feat_no_limit: 'No limit', card_feat_relaxed: 'Relaxed pace',
        card_feat_lives: 'Lives', card_feat_waves: 'Waves', card_feat_bosses: 'Bosses',
        how_card_desc: 'Review the rules, tips and everything you need to master the game.', how_card_cta: 'See info', multi_soon: 'Online multiplayer: coming soon!',
        classic_title: 'Classic Mode', world_news: "This world's news", worlds_label: 'Worlds', all_rewards: '🎁 See rewards',
        to_map: 'Back to map', classic_lvl_sub: 'Level {n} · {w}', classic_next: 'Next level →',
        locked_level: '🔒 Complete the previous level', locked_world: '🔒 World locked', reward_locked: 'Complete all levels in the world', reward_claimed: 'Reward already claimed', reward_got: 'World reward! 🎁 +1 chest · 💎 +20',
        stars_label: 'Level stars', stars_help: '3★ no mistakes · 2★ up to 2 mistakes · 1★ more mistakes', star_lost: '−1 star · avoid mistakes!',
        star_c3: 'No mistakes', star_c2: 'Up to {n} mistakes', star_c1: 'More mistakes', star_mine: 'Your mistakes: {n}',
        coming_soon: 'Coming soon', tab_missions: 'Missions', tab_play: 'Play', tab_chests: 'Chests', tab_rank: 'Leaderboard',
        powerup_empty: 'No more of this power-up',
        equipped: 'Equipped', equip: 'Equip', free: 'Free', no_coins: 'Not enough coins',
        shop_boards: 'Visual boards', shop_themes: 'Color themes', shop_hint2: 'Boards are visual-only cosmetics: no advantages or disadvantages. Equip your favorite style before playing.', board_unlocked: 'Board unlocked!',
        resource_shop_title: 'Resource shop', style_shop_title: 'Customization', resource_shop_short: 'Coins, gems & XP', style_shop_short: 'Customization', style_shop_nav: 'Styles', preview_theme: 'Preview {name}',
        test_payment_title: 'Test mode', test_payment_note: 'Coin and gem purchases are credited automatically. No payment is charged.', mock_payment_badge: 'TEST PAYMENT',
        resource_shop_premium: 'PREMIUM RESOURCE', resource_shop_game_currency: 'GAME CURRENCY', resource_shop_progress: 'PROGRESSION', best_value: 'BEST VALUE',
        xp_booster_title: 'XP Booster', xp_booster_desc: 'Multiplies by ×4 all XP earned in matches you start while it is active.', xp_boost_this_match: 'This match',
        xp_boost_inactive: 'No active booster', xp_boost_active: 'XP ×4 · {t}', xp_boost_extend: 'Adds {t}', xp_boost_buy: 'Activate', xp_boost_no_gems: 'You do not have enough gems for this booster.',
        xp_boost_added: 'XP ×4 active · +{t}', xp_pack_6h: '6 h', xp_pack_3d: '3 days', xp_pack_7d: '7 days', xp_result_breakdown: '{base} base XP ×{mult} · +{bonus} from booster',
        mock_purchase_done: 'Test purchase completed · +{n} {r}', resource_purchase_failed: 'The purchase could not be completed. Please try again.', store_game_blocked: 'The resource shop is available from Home. Your match is still active.',
        resource_shop_chests: 'CHESTS', chest_shop_title: 'Chests', chest_shop_desc: 'Buy chests instantly with gems and open them whenever you like. The event chest is only earned by playing.', chest_shop_buy: 'Buy chest', chest_shop_add: 'Buy', chest_shop_bought: '{c} added to your chests!', chest_shop_owned: 'You have {n}', chest_shop_owned_none: 'You have none',
        home_chest_cta: 'Chest', energy_label: 'Energy', energy_off: 'OFF', get_energy: 'Get energy',
        chests_title: 'Chests', chests_have: 'You have {n} chest(s)', chests_hint: 'Each chest reveals 2 to 4 rewards: coins, resources, boosters or a rare cosmetic.', chests_none: 'No chests · complete goals in any mode to earn the next one', chest_reward: 'Reward! {r}', open_chest: 'Open chest',
        chests_kicker: 'Rewards', chests_subtitle: 'Play, earn chests and discover incredible prizes.', chests_progress_title: 'Your progress', chests_progress_rule: 'Complete goals in any mode: every {t}, the next cycle chest drops.',
        chests_play_survival: 'Play Survival', chests_next_wave: 'Bonus chest in {n} waves', chests_open_now: 'Or open now', chests_open_saved: 'Open saved chest', chests_available: 'Available',
        chests_contents_note: 'Chests contain coins, gems, tickets, boosters and cosmetics.', chest_opening: 'The chest is opening…', chest_opening_named: 'Opening {c}…', chest_opening_hint: 'Preparing your rewards',
        chest_reveal_title: 'Chest contents', chest_cosmetic_title: 'COSMETIC!', chest_rarity_common: 'Reward', chest_rarity_jackpot: 'Jackpot', chest_rarity_cosmetic: 'Special', chest_continue: 'Continue', chest_equip: 'Equip',
        chest_reward_coins: '+{n} coins', chest_reward_gems: '+{n} gems', chest_reward_ticket: '+{n} ticket(s)', chest_reward_booster: '+{n} {b}', chest_reward_board: 'Board: {n}', chest_reward_theme: 'Theme: {n}', chest_reward_avatar_icon: 'Avatar: {n}', chest_reward_avatar_border: 'Frame: {n}',
        chest_view_all: 'View all', chest_selected: 'Selected chest', chest_catalog_title: 'Chest types', chest_catalog_sub: 'The rarer the chest, the better its rewards.', chest_catalog_close: 'Back to my chests',
        chest_contains: 'What it can contain', chest_type_panel: 'Chest type', chest_ceremony_title: 'Chest opening', chest_contents_coins: 'Coins', chest_contents_gems: 'Gems', chest_contents_tickets: 'Tickets', chest_contents_cosmetics: 'Cosmetics and more',
        chest_slots_title: 'Chest slots', chest_possible_rewards: 'Possible rewards', chest_slot_opening: 'Opening', chest_slot_ready: 'Ready!', chest_slot_blocked: 'Locked', chest_slot_waiting: 'Waiting', chest_slot_empty: 'Empty slot',
        chest_unlock_slot: 'Unlock another slot', chest_unlock_slot_cost: 'Tap again to unlock it for {n} gems', chest_slot_unlocked: 'New slot unlocked!', chest_more_waiting: '+{n} chest(s) in reserve',
        chest_start_unlock: 'Open', chest_open_now_action: 'Open now', chest_collect: 'Collect', chest_unlocking_action: 'In progress', chest_only_one: 'You can only unlock one chest at a time.', chest_timer_started: 'The chest has started opening!',
        chest_premium_action: 'Open premium chest', chest_premium_note: 'Instant reward with better odds', chest_duration: 'Duration', chest_size_label: 'Size', chest_type_label: 'Type',
        chest_reward_boosters: 'Boosters', chest_reward_objects: 'Items', chest_reward_boards: 'Boards', chest_reward_themes: 'Themes', chest_reward_avatars: 'Icons & frames', chest_reward_surprise: 'And more…',
        chest_size_small: 'Small', chest_size_medium: 'Medium', chest_size_large: 'Large', chest_size_xlarge: 'Very large', chest_size_huge: 'Huge', chest_size_variable: 'Variable',
        chest_tier_basic: 'Basic', chest_tier_common: 'Common', chest_tier_rare: 'Rare', chest_tier_epic: 'Epic', chest_tier_legendary: 'Legendary', chest_tier_mythic: 'Mythic', chest_tier_special: 'Special',
        chest_type_wood: 'Wood chest', chest_type_bronze: 'Bronze chest', chest_type_silver: 'Silver chest', chest_type_gold: 'Gold chest', chest_type_magic: 'Magic chest',
        chest_type_royal: 'Royal chest', chest_type_supreme: 'Supreme chest', chest_type_champion: 'Champions chest', chest_type_divine: 'Divine chest', chest_type_event: 'Event chest',
        chest_desc_wood: 'Common rewards. Ideal for getting started.', chest_desc_bronze: 'Common resources with a few uncommon surprises.', chest_desc_silver: 'Better prizes and more chances for cosmetics.',
        chest_desc_gold: 'Epic rewards, more coins and tickets.', chest_desc_magic: 'Contains guaranteed epic rewards.', chest_desc_royal: 'Legendary prizes and a high cosmetic chance.',
        chest_desc_supreme: 'High-level rewards and plenty of resources.', chest_desc_champion: 'Mythic rewards with the best special odds.', chest_desc_divine: 'The most powerful chest, with maximum rewards.', chest_desc_event: 'Unique event and seasonal rewards.',
        chest_rarity_rare: 'Rare', chest_rarity_epic: 'Epic', chest_rarity_legendary: 'Legendary', chest_rarity_mythic: 'Mythic', chest_rarity_special: 'Special',
        chest_odds_title: 'Odds', chest_odds_cosmetic: 'Cosmetic', home_chest_opening: 'Opening · {t}',
        chest_pipeline_won: 'Cycle chest! +1 {c}', chest_daily_won: 'Daily Choice Chest earned · pick 1 of 3!', chest_daily_catchup_won: 'Daily catch-up! Your Choice Chest upgrades to Silver', chest_weekly_won: 'Weekly challenge · +1 event chest',
        chest_next_in_cycle: 'Next in cycle: {c}', chest_pity: 'Mythic or better in ≤ {n} chests',
        chest_auto_note: 'When a chest finishes, the next shortest in slots or reserve starts on its own',
        chest_queue_title: 'Automatic queue', chest_queue_next: 'Next {n}',
        chest_notify_enable: 'Notify me when ready', chest_notify_enabled: 'Notifications enabled',
        chest_notify_denied: 'Notifications are blocked in your browser', chest_notify_unsupported: 'This browser does not support local notifications',
        chest_notification_title: 'Chest ready!', chest_notification_body_one: 'One chest is waiting to be opened.', chest_notification_body_many: '{n} chests are waiting to be opened.',
        chest_tierup: 'Surprise upgrade! It is now a {c}', chest_tier_hold: 'No upgrade: it stays a {c}', chest_tier_max: 'Maximum category · it cannot upgrade further', chest_tier_roll: 'Surprise upgrade', chest_tier_success_detail: 'Your {f} became a {t}. You will receive the {t} rewards.', chest_tier_reward_note: 'Upgrade applied: {f} → {t}. These are the {t} rewards.', chest_tap_reveal: 'Tap to reveal', chest_upgrade_label: 'Chance to upgrade when opened', chest_upgrade_detail: '{p}% chance to become a {c}. If it does, you will receive its {n} rewards and amounts.', chest_open_now_cost: 'Open now: {n} gems', chest_selected_announcement: '{c} selected',
        chest_guaranteed_coins: 'Guaranteed coins', chest_primary_roll: 'Main reward', chest_bonus_rolls: '{n} extra reward(s)', chest_bonus_odds: 'Per extra: {c}% coins {cmin}–{cmax} · {g}% gems {gmin}–{gmax} · {t}% ticket x1 · {b}% booster x1', chest_level_scaled: 'Scales with your level', booster_stock: 'Stock x{n}',
        booster_name_bomb: 'Bomb', booster_name_freeze: 'Freeze', booster_name_clearLine: 'Ray', booster_name_wild: 'Broom', booster_name_x2: 'Wildcard',
        daily_choice_event_label: 'First win', daily_choice_title: 'Choice Chest', daily_choice_open: 'Choose', daily_choice_view: 'View chest', daily_choice_ready: 'Pick 1 of 3 rewards', daily_choice_waiting: 'Waiting · open it to choose', daily_choice_opening: 'Opening · {t}', daily_choice_sub: 'All three rewards are visible. You only receive the one you choose.', daily_choice_catchup_sub: 'Catch-up for the missed day: this chest upgraded to Silver. Choose one reward.', daily_choice_cancel: 'Not now', chest_choice_label: 'Pick 1 of 3', chest_event_featured: 'Event {w} · featured booster: {b}', chest_event_bonus: 'Guaranteed event booster: {b}',
        soon_badge: 'Coming soon', notify_me: 'Notify me', notify_ok: "We'll let you know when it's ready!",
        edit_name: 'Your name', daily_banner_title: 'Daily reward', daily_banner_sub: 'Come back every day and win prizes!', claim: 'Claim',
        home_classic: 'Classic game', home_classic_prefix: 'Classic', home_classic_name: 'Game', home_classic_sub: 'Play on the board against friends or bots', home_surv_sub: 'Survive endless waves',
        home_play_recommended: 'Recommended now', home_play_daily: "Play today's challenge", home_play_daily_sub: '{mut} · same board for everyone', home_play_mission: 'Advance your mission', home_play_classic: 'Continue Classic', home_play_classic_sub: '{world} · level {n}',
        home_tournaments: 'Daily tournament', home_tournaments_sub: 'Compete for medals every day', home_multi_sub: 'Challenge players online',
        home_diary: 'Daily', home_league: 'League', home_friends: 'Friends',
        home_multi_soon: 'Multiplayer. Coming soon', home_league_soon: 'League. Coming soon', home_friends_soon: 'Friends. Coming soon',
        home_saved_run: 'Saved game', continue_word: 'Continue', home_status_pending: 'Pending', home_status_done: 'Complete',
        home_classic_title: 'Classic', home_no_record: 'No record', home_today: 'Today', home_daily_mission: 'Mission', home_weekly: 'Weekly',
        home_chests: 'Chests', home_none_ready: 'None', home_chests_one: '1 chest', home_chests_many: '{n} chests', home_streak: 'Streak', home_play_hint: 'Choose from 5 modes',
        home_reward_day: 'Day {n} · come back daily for prizes', home_reward_claimed: 'Day {n} claimed',
        home_saved_classic: '{world} · Level {n}', home_saved_mode: '{mode} · Level {n}', home_classic_state: '{world} · Level {n}',
        home_classic_stars: '{n}/150 stars', home_surv_record: 'Best wave {n}', home_surv_week: 'Week: {n}',
        home_survmut_none: 'No modifier', home_survmut_ice: 'Ice', home_survmut_chaos: 'Chaos', home_survmut_frenzy: 'Fury',
        home_ready_one: '1 ready', home_ready_many: '{n} ready', home_days: '{n} days', home_day: '1 day', home_complete: 'Ready',
        world_bosque: 'Green Forest', world_desierto: 'Golden Desert', world_montana: 'Frozen Mountain', world_cueva: 'Mysterious Cave', world_neon: 'Neon City',
        profile_action: 'Open profile', edit_name_action: 'Edit name', get_coins: 'Get coins', get_gems: 'Get gems',
        q_missions: 'Missions', q_daily: 'Daily', q_chests: 'Chests', q_league: 'League', q_friends: 'Friends', best_score: 'Best score', play_word: 'Play',
        hud_record: 'Best', hud_points: 'Score', hud_level: 'Level', hud_time: 'Time', hud_speed: 'Speed', hud_occ: 'Fill',
        hud_danger: 'Danger', hud_board_fill: 'Board',
        hud_event_boss: 'BOSS', hud_event_wave: 'NEW WAVE', hud_event_next: 'Coming up',
        hud_next_boss: 'Next boss', hud_new_shapes: 'New shapes',
        hud_ctx_boss_rage: 'Boss enraged', hud_phase_short: 'Phase {n}', hud_ctx_wave: 'New wave',
        hud_ctx_time: 'Time left', hud_ctx_zen: 'Calm flow',
        hud_ctx_double: '×2 multiplier', hud_ctx_freeze: 'Time frozen', hud_ctx_frenzy: 'Frenzy active',
        hud_survival_title: 'SURVIVAL', hud_survival_ready: 'GET READY', hud_survival_go: 'Go!',
        hud_narr_fever_title: 'FEVER', hud_narr_fever: 'Keep it going!',
        hud_narr_meteor: 'The sky breaks open.', hud_narr_tide: 'The tide rises.', hud_narr_frost: 'The cold advances.',
        hud_narr_lockdown: 'The cage closes.', hud_narr_quake: 'The ground remembers.',
        hud_narr_crystalid: 'The crystal grows again.', hud_narr_void: 'It is hungry.', hud_narr_puppeteer: 'The strings tighten.',
        hud_remaining: 'left', hud_survive_sub: 'Survive', hud_boss_sub: 'Boss', rec_close: '{n} to record', rec_new: 'New record!',
        mult_breakdown_combo: 'Combo', mult_breakdown_fever: 'Fever', mult_breakdown_frenzy: 'Frenzy', mult_breakdown_boon: 'Boon', mult_breakdown_sprint: 'Sprint', mult_breakdown_total: 'Total',
        hud_lives_explain: 'Your lives. Reach 0 and it is game over.',
        hud_wave_explain: 'Current round. Each wave gets harder.',
        hud_tier_explain: 'Difficulty: goes up every few waves',
        hud_time_explain: 'Time survived',
        hud_waveprog_explain: 'Countdown to the next wave',
        hud_danger_explain: 'If this bar fills up, you lose a life',
        how_title: 'How to play?', how_sub: 'Learn the mechanic, discover every mode and master your boosters.', guide_kicker: 'Game guide',
        how1: 'Tap an <strong>empty cell</strong>.', how2: 'It checks the nearest icon in every direction.',
        how3: 'If <strong>2 or more match</strong>, they converge and vanish!', how4: 'Chain clears to raise the <strong>combo</strong> and multiply points.',
        how5: 'Icons spawn on their own: clear the board before it fills up.',
        guide_rules_title: 'Core rules', guide_modes_title: 'Game modes', guide_modes_sub: 'Tap a mode to review its rules and start a run.',
        guide_mode_classic_desc: 'Clear levels and earn up to three stars.', guide_mode_timed: 'Time Attack', guide_mode_timed_desc: 'Every convergence buys seconds and keeps your rhythm.',
        guide_mode_adventure: 'Adventure', guide_mode_adventure_desc: 'Travel through biomes with goals and mini-bosses.', guide_mode_survival_desc: 'Endure waves, bosses and an ever-faster board.',
        guide_powerups_title: 'Boosters', guide_powerups_sub: 'Use them at the right moment to take back control of the board.',
        guide_power_bomb: 'Removes an area around the target.', guide_power_freeze: 'Temporarily stops the spawn pace.',
        guide_power_ray: 'Clears a complete line from the board.', guide_power_broom: 'Sweeps the row or column with the most icons.',
        guide_power_wild: 'Transforms a repeated group and saves the move.', guide_tutorial_cta: 'Play tutorial',
        tutorial_btn: 'Interactive tutorial', understood: 'Got it',
        pause: 'Paused', resume: 'Resume', restart: 'Restart', menu: 'Menu', main_menu: 'Main menu', close: 'Close', back: 'Back', retry: 'Retry', share: 'Share',
        pause_subtitle: "Take a breather, you've got this!", pause_tag_endless: 'Endless waves', pause_tag_timed: 'Beat the clock',
        settings_title: '⚙️ Settings', settings_word: 'Settings', shop_title: '🛍️ Shop', shop_hint: 'Board themes. Tap to preview.',
        profile_title: '📊 Profile', achievements_title: '🏆 Trophies', profile_card_title: 'Player card', profile_loadout_title: 'Your style', profile_icons_title: 'Avatars', profile_borders_title: 'Frames', profile_owned: '{n}/{total} unlocked', shop_player_hint: 'Customize your player card. Avatars and frames can also drop from chests.', shop_player_icons: 'Avatars', shop_player_borders: 'Avatar frames', pause_run_title: 'Current run', pause_score_label: 'Score', pause_combo_label: 'Combo', trophies_progress: '{n} of {total} trophies', best_by_mode: 'Best by mode', achievements: 'Achievements',
        adventure_title: '🚀 Adventure', adventure_sub: 'Endless journey across biomes. Each chapter changes the rules and ends with a mini-boss.',
        revive_title: '💔 Last chance!', revive_sub: 'You ran out of lives. Revive and keep surviving?', giveup: 'Give up',
        revive_gets: 'Get 1 life and clear 60% of the board', revive_count: 'Revive {n}/{max}', revive_short: 'You need {n} more coins',
        coach_skip: 'Skip tutorial', coach_step: 'Step {n} of {t}',
        coach1: '👆 Tap the glowing EMPTY cell between two matching icons to merge them.',
        coach2: "✨ That's it! If they match in several directions, you clear more at once.",
        coach3: '⚡ Now chain them: clear both pairs quickly, before the ring runs out, to build your combo.',
        coach_done: 'Done! You know how to play 🎉', coach_play1: 'Play level 1', coach_menu: 'Go to menu',
        quit_confirm: 'Leave the game? Tap again to confirm', confirm_buy: 'Confirm?',
        resume_run: 'Resume game', run_resumed: 'Game restored',
        premium_chest: 'Premium chest', no_gems: 'Not enough gems · earn gems in Survival, worlds and the daily run',
        reroll_mission: 'Swap mission · 1 ticket', mission_rerolled: 'New mission!', missions_intro: 'Rewards are credited automatically when you complete the goal.', mission_daily_label: 'Daily mission', mission_weekly_label: 'Weekly challenge', mission_complete: 'Complete', mission_reward_label: 'Reward', mission_reward_daily: '+150 XP · +60 coins', mission_reward_weekly: '+400 XP · +200 coins · event chest', mission_credited: 'Credited', mission_reroll_hint: 'Your global progress stays; only today’s goal changes.', mission_reroll_missing: 'You need 1 ticket to swap the mission', mission_cta_mode: 'Play {mode}', mission_cta_modes: 'Choose mode',
        mission_m_combo: 'Reach an ×8 combo', mission_m_remove: 'Remove 80 icons in one run', mission_m_score: 'Score 2,500 points in one run', mission_m_perfect: 'Clear the board once', mission_w_games: 'Play 12 games this week', mission_w_remove: 'Remove 800 icons this week', mission_w_score: 'Score 20,000 points this week', mission_w_combo: 'Reach an ×15 combo',
        daily_challenge: 'Daily challenge', daily_play: 'Play', daily_best: "Today's best: {n}",
        daily_pending: "Today's board · play it!", daily_home_pending: 'Today: play it!', daily_home_done: '✅ {m} · {n}', daily_done_state: '✅ Done · Best: {n}',
        daily_done_medal: '{m} · Best: {n}', daily_medal_none: 'No medal', daily_medal_bronze: 'Bronze', daily_medal_silver: 'Silver', daily_medal_gold: 'Gold',
        daily_medal_result: 'Daily medal: {m}', daily_next_medal: 'Next medal: beat {n}',
        daily_info_same: 'Same board for everyone · changes at midnight', daily_info_mut: "Today's twist", daily_info_medals: 'Medals', daily_info_best: "Today's best", daily_info_no_best: 'No attempts yet', daily_info_ghost: 'Your ghost: your best try today', daily_info_streak: 'Ethical freeze streak', daily_info_first: '+5 💎 first try of the day', daily_note_next: '🎯 Next: {m} {n}', daily_medal_up: '{m} medal! Next: {n}', daily_medal_max: 'Gold secured!',
        daily_learning_label: 'Today you train', daily_practice_in: 'Then practise in {mode}', daily_practice_cta: 'Practise in {mode}', daily_skill_pure: 'Clean chains and board reading', daily_skill_ice: 'Break blockers without losing rhythm', daily_skill_window: 'Sustain fast combos', daily_skill_variety: 'Recognise patterns with more icons', daily_skill_rocks: 'Route around obstacles', daily_skill_fast: 'Decide under pressure', daily_skill_crystal: 'Prioritise special goals', daily_skill_nohints: 'Read the board without assistance',
        mode_note_clasico: 'Mastery: finish with no mistakes for 3★', mode_note_clasico_streak: 'Perfect streak: ×{n}',
        mode_note_aventura: 'Discover: {m}', mode_note_contrarreloj: 'Every convergence buys seconds', mode_note_daily: 'Daily run: bronze, silver or gold', mode_note_zen: 'Breathe: no punishment',
        mode_brief_clasico: 'Classic · chase 3 stars', mode_brief_aventura: 'Adventure · read the biome and adapt',
        mode_brief_contrarreloj: 'Time Attack · use combos to buy time', mode_brief_supervivencia: 'Survival · prepare your loadout before the wave', mode_brief_zen: 'Zen · calm, clearing and collection',
        result_focus_clasico: 'Replay levels with no mistakes to chain perfect clears.', result_focus_aventura: 'The next biome changes the goal: read the banner before acting.',
        result_focus_contrarreloj: 'The best pace comes from short, steady combos.', result_focus_supervivencia: 'Keep one booster for the final stretch of each wave.', result_focus_zen: 'A good mode for practicing long routes without pressure.',
        classic_streak: 'Perfect streak ×{n}', classic_best_streak: 'Best streak: ×{n}', classic_streak_lost: 'Perfect streak reset',
        time_pressure: 'Last seconds!', surv_wave_soon: 'Wave incoming',
        next_title: 'Next step', next_open_chest: 'Open chest', next_open_chest_sub: 'You have a saved reward ready to open.',
        next_missions: 'View missions', next_missions_sub: 'Mission progress or a reward is close.',
        next_daily: 'Improve daily run', next_daily_sub: 'Chase the next daily medal on the same board.',
        next_shop: 'Choose cosmetic', next_shop_sub: 'You can unlock or equip something visual.',
        next_classic: 'Back to map', next_classic_sub: 'Keep building 3★ clears and perfect streaks.',
        next_surv: 'Play Survival', next_surv_sub: 'Earn chests every 10 waves and try boosters.',
        next_adventure: 'Continue Adventure', next_adventure_sub: 'Discover the next biome and its goal.',
        next_modes: 'Try another mode', next_modes_sub: 'Complete mode variety to unlock mastery.',
        progress_title: 'Nearby progress', progress_daily: 'Daily mission', progress_weekly: 'Weekly challenge',
        progress_variety: 'Mode variety', progress_chests: 'Ready chests', progress_cosmetic: 'Nearby cosmetic',
        progress_ready: 'Ready', progress_left: '{n} left', progress_modes_left: '{n} to try',
        over_surv_sheet: 'Survival sheet', over_surv_sheet_sub: 'boons, bosses and rank',
        over_performance: 'Performance', over_performance_sub: 'the run essentials',
        over_profile_general: 'profile progress', over_wave_reached: 'Wave reached',
        over_boons: 'Chosen boons', over_no_boons: 'No boons',
        over_bosses: 'Bosses', over_bosses_cleared: 'Cleared', over_service_rank: 'Survival rank',
        over_rank_up_short: 'Rank up', over_this_run_waves: 'Waves this run', over_toward_rank: 'Toward {r}',
        over_wave_progress_unit: 'Wave = progress', over_rank_reason: 'It rises because you reached wave {w}: every cleared wave adds service to your Survival rank.',
        over_rank_reason_max: 'Max rank: every wave still adds lifetime Survival service.',
        over_peak_title: 'Best moment', over_peak_sub: 'Run peak', over_peak_points: 'Points', over_peak_combo: 'Combo',
        over_peak_chain: 'Perfect chain', over_peak_note_surv: '×{c} combo on wave {w}: the stretch where one chain generated your most points.',
        over_peak_note_level: '×{c} combo: the stretch where one chain generated your most points.',
        empty_chests_title: 'No chests yet', empty_chests_sub: 'Complete goals in any mode · every 3, a cycle chest drops', empty_cta_surv: 'Play Survival', chest_store_shortcut: 'Chest shop', empty_chests_pitch: 'Open rewards today: buy a chest instantly or play to earn the next one for free.', empty_chests_buy: 'Buy chests', empty_chests_play: 'Play and earn',
        empty_medals_title: 'Your first medal awaits', empty_medals_sub: 'Play a game to start unlocking achievements',
        empty_lb_title: 'No scores yet', empty_lb_sub: 'Play any mode to set your first score', empty_cta_play: 'Choose a mode',
        err_fatal: 'Something went wrong.', err_reload: 'Reload', browser_old: 'Your browser is too old to play. Please update it.',
        update_ready: '✨ New version available', update_btn: 'Update',
        sr_combo: 'Combo of {n}', sr_converge: '{n} icons converge', sr_wave: 'Wave {n}', sr_life: 'Life lost, {n} remaining',
        sr_over: 'Game over, {n} points', sr_level: 'Level complete, {n} points', sr_stars: 'Level complete, {s} of 3 stars, {n} points',
        surv_sys_title: 'How it works', surv_sys_charge: 'Fill the inner ring to turn your convergences into supply coins.', surv_sys_frenzy: 'Fill the frenzy ring to multiply your points for a while.', surv_sys_lives: 'You lose a life if the board overflows; reviving costs coins and gets pricier each use.',
        surv_supply_reward: 'Supply complete · +{n} coins for your next loadout', surv_supply_short: '+25% supply',
        pause_no_save: 'This mode does not save your game when you leave.',
        ci_tap: 'Tap to start', ci_no_mods: 'No special modifiers',
        daily_first_reward: '+5 💎 · first try of the day', daily_new_best: 'New daily best! {n}',
        no_moves_wait: 'No moves right now: wait for the next icon',
        challenge_start: 'Shared challenge: same board!',
        diff_facil: 'Easy', diff_normal: 'Normal', diff_dificil: 'Hard',
        set_sfx: 'Sound effects', set_music: 'Music', set_haptics: 'Vibration', set_reduced: 'Reduce effects', set_large: 'Large text', set_lang: 'Language',
        perf_suggest: 'Tap here to turn on light mode for smoother play', perf_light_on: 'Light mode on · you can revert it in Settings', rfx_system_notice: 'Effects reduced by your system setting · change it in Settings',
        st_points: 'Score', st_level: 'Level', st_combo: 'Max combo', st_removed: 'Cleared', st_time: 'Time', st_record: 'Best', st_wave: 'Wave', st_surv: 'Survived', st_best: 'Best',
        st_games: 'Games', st_bestcombo: 'Best combo', st_totaltime: 'Total time',
        surv_new_icons: 'New icons! Difficulty up',
        surv_intro_goal: 'Survive as many waves as you can.',
        surv_intro_merge: 'Merge matching icons by tapping the empty cell between them.',
        surv_intro_lose: 'If the board fills up, you lose a life.',
        surv_go: 'GO!',
        aim_hint: 'Tap where to use it', pu_freeze: 'Spawns frozen', pu_x2: 'Double points!', pu_bomb: 'Boom!', pu_ray: 'Ray!', pu_icons: 'icons', chain_boom: 'Chain ×{n}',
        surv_meteor: 'Icon rain!', surv_quake: 'Quake!', surv_frost: 'Frozen front', surv_life_lost: 'Life blast · -1',
        surv_boss_soon: '⚠ Boss', surv_boss_meteor_warn: 'Icon rain incoming!', surv_boss_quake_warn: 'Quake incoming!', surv_boss_frost_warn: 'Frozen front incoming!',
        near_miss: 'You were just {n} icons away!', peak_moment: 'Your best moment: +{p} with a ×{c} combo',
        sprint_on: 'Final sprint! Points ×1.5', mistake_time: 'Miss · −{n}s',
        boon_title: 'Blessing!', boon_sub: 'You beat the boss: pick an upgrade',
        boon_life: 'Extra life', boon_life_d: '+1 heart (can exceed the max)',
        boon_charge: 'Overcharge', boon_charge_d: '+50 supply charge',
        boon_pack: 'Arsenal', boon_pack_d: '+1 bomb and +1 ray',
        boon_slow: 'Calm', boon_slow_d: 'Icons are 25% slower for 3 waves',
        boon_frenzy: 'Fury', boon_frenzy_d: 'Frenzy activated instantly!',
        boon_magnet: 'Magnet', boon_magnet_d: 'Next 5 matches attract +1 icon',
        boon_score_boost: 'Score Boost', boon_score_boost_d: 'Permanent +0.25× score (max +0.5×)',
        boon_golden_wave: 'Golden Wave', boon_golden_wave_d: '×2 score for this wave and the next!',
        magnet_done: 'Magnet depleted', new_record: 'New record!', fever_on: 'FEVER!', revive_btn: 'Revive',
        route_title: 'Choose your route', route_dense: 'Demanding route', route_dense_d: 'More obstacles · points ×1.25 this chapter',
        route_calm: 'Serene route', route_calm_d: 'Slower icons · no bonus',
        relic_title: 'Boss relic', relic_sub: 'Passive for the rest of the expedition (max 3)',
        relic_combo: 'Hourglass', relic_combo_d: 'Combo window +0.4s',
        relic_crystal: 'Prism', relic_crystal_d: 'Crystals are worth +30 extra',
        relic_hint: 'Compass', relic_hint_d: '+1 hint every level',
        relic_shield: 'Shield', relic_shield_d: 'First defeat of the chapter clears 30% instead of ending',
        relic_shield_fired: 'The shield saved you! Board cleared',
        continue_title: 'Board full…', continue_sub: 'Continue for {n} gems? Clears 40% of the board (once per level)',
        continue_yes: 'Continue ({n}💎)', continue_yes_d: 'Clear 40% and keep playing',
        continue_no: 'End game', continue_done: 'You continue! Board cleared',
        classic_win_streak: 'Win streak ×{n} · +{p}% coins',
        zen_pace_title: 'Zen pace', zen_pace_slow: 'Serene', zen_pace_slow_d: 'Very slow icons, room to breathe',
        zen_pace_normal: 'Flowing', zen_pace_normal_d: 'Standard calm pace', zen_release: 'Freeing space…',
        pl_sub: 'Bring up to 2 power-ups (optional)', pl_play: 'Play', pl_play_cost: 'Play · {c} coins',
        pl_skip: 'No power-ups', pl_first: 'New: you can bring power-ups into levels. Tap their button in-game to use them.',
        pl_max: 'Max {n} power-ups', pl_no_coins: 'Not enough coins',
        surv_tide: 'Icon tide!', surv_boss_tide_warn: 'Tide incoming: clear the edges!',
        // New and enraged bosses (SV-43)
        surv_lockdown: 'Lockdown! Locks on the board', surv_boss_lockdown_warn: 'Lockdown incoming: get ready to break locks!',
        surv_eco: "It's back: {b}!", surv_boss_eco_warn: 'A boss returns for you!',
        surv_boss_enraged_warn: '⚠ ENRAGED boss incoming!',
        surv_meteor_enraged: 'ENRAGED icon rain!', surv_tide_enraged: 'ENRAGED tide: full frame!', surv_frost_enraged: 'ENRAGED frozen front',
        bossname_meteor: 'Icon rain', bossname_tide: 'Tide', bossname_frost: 'Frozen front', bossname_lockdown: 'Lockdown', bossname_quake: 'Quake',
        // Encounter bestiary (JF-β): boss name + epithet, and per-phase attack names.
        bossdex_meteor: 'Stormfront', bossdex_meteor_e: 'the sky in pieces',
        bossdex_tide: 'The Current', bossdex_tide_e: 'lady of the edges',
        bossdex_frost: 'Boreal', bossdex_frost_e: 'the white breath',
        bossdex_lockdown: 'The Locksmith', bossdex_lockdown_e: 'warden of locks',
        bossdex_quake: 'Tectonic', bossdex_quake_e: 'the world-shuffler',
        bossatk_meteor_1: 'Rain', bossatk_meteor_2: 'Rain and rock',
        bossatk_tide_1: 'Tide', bossatk_tide_2: 'Full tide',
        bossatk_frost_1: 'Frost', bossatk_frost_2: 'Frozen cluster',
        bossatk_lockdown_1: 'Lockdown', bossatk_lockdown_2: 'Cage',
        bossatk_quake_1: 'Partial quake', bossatk_quake_2: 'Total quake',
        surv_boss_cage_steal: '{b} cages your {p}! Break the cage to get it back',
        surv_master_round: 'Master round ✦ +1 life',
        surv_master_round_charge: 'Master round ✦ +50 supply',
        // Minibosses (JF-δ)
        minidex_magpie: 'The Magpie', minidex_magpie_e: 'the thief',
        minidex_firefly: 'Golden Firefly', minidex_firefly_e: 'the fleeting',
        minidex_sentinel: 'The Sentinel', minidex_sentinel_e: 'the watcher',
        minidex_herald: 'The Herald', minidex_herald_e: 'the announcer',
        mini_steal: '{b} is stealing icons! Hunt it down to get them back',
        mini_return: 'Loot recovered! +{n} icons',
        mini_firefly_gift: 'Golden touch: +24 frenzy',
        mini_sentinel_gift: 'Its territory is cleared',
        mini_herald_down: 'The Herald has fallen: the boss will arrive weakened',
        mini_herald_up: 'The Herald escaped! The boss arrives EMPOWERED',
        mini_gone: '{b} slips away…',
        sr_mini_enter: 'Miniboss: {b}. Converge the icon on its anchor to hunt it',
        sr_mini_down: '{b}, hunted down',
        // Act III: The Deep Court (JF-ε)
        bossdex_crystalid: 'Crystalid', bossdex_crystalid_e: 'the regrowing heart',
        bossdex_void: 'The Void', bossdex_void_e: 'the patient maw',
        bossdex_puppeteer: 'The Puppeteer', bossdex_puppeteer_e: 'master of threads',
        bossatk_crystalid_1: 'Shards', bossatk_crystalid_2: 'Shards and regrowth',
        bossatk_void_1: 'Devour', bossatk_void_2: 'Devour and grow',
        bossatk_puppeteer_1: 'Threading', bossatk_puppeteer_2: 'Re-threading',
        surv_boss_shards: 'Crystalid shards!',
        surv_boss_regrow: '{b} regenerates! Finish it with tempo',
        surv_boss_devour: 'The Void devours {n} icons…',
        surv_boss_grow: 'The Void GROWS! Do not ignore it',
        surv_boss_threads: 'Threads! Converging marked types HEALS it',
        surv_boss_heal: '{b} heals from your threads!',
        surv_boss_crystalid_warn: 'Crystalid incoming: finish it before it regrows!',
        surv_boss_void_warn: 'The Void incoming: do not let it grow!',
        surv_boss_puppeteer_warn: 'The Puppeteer incoming: beware the threads!',
        // Adventure biome bosses (JF-ζ): identity only; GM-08 mechanics unchanged.
        advdex_nebula: 'Nebula Heart', advdex_nebula_e: 'beating in the dust',
        advdex_asteroid: 'The Magnetar', advdex_asteroid_e: 'shepherd of rocks',
        advdex_ice: 'Hungry Aurora', advdex_ice_e: 'the freezing light',
        advdex_core: 'The Smelter', advdex_core_e: 'heart of the core',
        advdex_void: 'The Nothing', advdex_void_e: 'hint-devourer',
        advdex_crystal: 'Crystal Matriarch', advdex_crystal_e: 'mother of the swarm',
        feat_cazador: 'Hunter', feat_cazador_d: 'Defeat the 5 Lords (Stormfront, Current, Boreal, Locksmith and Tectonic)',
        feat_ronda_maestra: 'Master round', feat_ronda_maestra_d: 'Earn 3 Master rounds (defeats with no damage and no power-ups)',
        feat_domaecos: 'Echo tamer', feat_domaecos_d: 'Defeat an echo of level III or higher',
        surv_boss_lvl: '{n}',
        surv_boss_leave: 'Flees {s}s',
        bosstut_boss_intro_title: 'Boss Arrival!',
        bosstut_boss_intro_body: 'The boss does not use a normal health bar: its HP are the glowing ANCHORS on the board. Match the icons ON the anchors to damage it!',
        bosstut_boss_intro_panel: 'How do you beat it?',
        bosstut_boss_intro_detail1_title: 'Attack its anchors',
        bosstut_boss_intro_detail1_body: 'Match the icons sitting on the glowing marks.',
        bosstut_boss_intro_detail2_title: 'Break them all',
        bosstut_boss_intro_detail2_body: 'Every destroyed anchor reduces the boss’s real health.',
        bosstut_boss_intro_tip_title: 'Tip',
        bosstut_boss_intro_tip_body: 'Prioritize anchors that already have a match prepared.',
        bosstut_boss_armored_title: 'Armored Anchor with Shield',
        bosstut_boss_armored_body: '🛡️ This anchor has a steel shield. It cannot be merged directly: make matches in ADJACENT cells (next to it) or use a bomb 💣 to break the shield first.',
        bosstut_boss_armored_panel: 'How do you break it?',
        bosstut_boss_armored_detail1_title: 'Match beside it',
        bosstut_boss_armored_detail1_body: 'An adjacent match cracks the steel armor.',
        bosstut_boss_armored_detail2_title: 'Use a bomb',
        bosstut_boss_armored_detail2_body: 'The blast removes the shield and exposes the anchor.',
        bosstut_boss_armored_tip_title: 'Tip',
        bosstut_boss_armored_tip_body: 'Break the shield first; then you can damage the anchor normally.',
        bosstut_boss_phase2_title: 'Shift to Phase 2!',
        bosstut_boss_phase2_body: '⚠️ The boss has lost half of its health. It will now attack with a faster, more dangerous pattern.',
        bosstut_boss_phase2_panel: 'What changes?',
        bosstut_boss_phase2_detail1_title: 'Faster attacks',
        bosstut_boss_phase2_detail1_body: 'Its attacks will arrive more frequently.',
        bosstut_boss_phase2_detail2_title: 'More danger',
        bosstut_boss_phase2_detail2_body: 'The new pattern will occupy more of the board.',
        bosstut_boss_phase2_tip_title: 'Tip',
        bosstut_boss_phase2_tip_body: 'Get ready and use your best moves to finish it off.',
        bosstut_boss_boons_title: '✨ Victory Blessings!',
        bosstut_boss_boons_body: 'Defeating a boss grants you a blessing. Choose 1 upgrade out of 3 random choices: extra hearts, supply overcharges, icon slowdowns, magnet merges, or permanent score multipliers.',
        bosstut_boss_boons_tip: 'These upgrades can make the difference in the toughest waves.',
        surv_armored_hint: '🛡️ Protected! Match next to it or use a bomb to break the shield',
        surv_armored_broken: '🛡️ Shield broken! You can now merge the icon',
        surv_boss_hp_sr: "Boss health: {n} of {m} anchors",
        surv_boss_enter_sr: 'Boss: {b}, level {n}, {k} anchors. Converge the icons on the anchors to damage it.',
        surv_boss_prep: '{b} is preparing: {a}',
        surv_boss_phase2: 'Phase 2! {b} shifts its pattern',
        surv_boss_defeated: '{b} DEFEATED!',
        surv_boss_retreat: '{b} retreats…',
        survmut_ice: 'Ice week: frozen traps · coins ×1.15', survmut_chaos: 'Chaos week: the quake is back', survmut_frenzy: 'Fury week: frenzy +30%',
        dmut_pure: "Today's twist: pure board", dmut_ice: "Today's twist: frozen board", dmut_window: "Today's twist: tighter combos", dmut_variety: "Today's twist: more icon variety", dmut_rocks: "Today's twist: rock field", dmut_fast: "Today's twist: fast pace", dmut_crystal: "Today's twist: double crystals", dmut_nohints: "Today's twist: no hints",
        dmut_pure_n: 'Pure', dmut_ice_n: 'Ice', dmut_window_n: 'Tight combos', dmut_variety_n: 'Variety', dmut_rocks_n: 'Rocks', dmut_fast_n: 'Fast', dmut_crystal_n: 'Crystals', dmut_nohints_n: 'No hints',
        daily_streak_chest: '{n} medal days in a row! +1 chest', daily_cal_al: 'Medal calendar for the last 14 days',
        timecap_hint: 'Time capsule: detonate it by adjacency (+5s)',
        advboss_warn: 'The boss is charging its attack…',
        advboss_nebula: 'Boss volley!', advboss_asteroid: 'The boss hurls rocks!', advboss_ice: 'The boss freezes!', advboss_core: 'The boss speeds up the core!', advboss_void: 'The void devours a hint!', advboss_crystal: 'The boss regenerates!',
        exped_title: 'Your expedition',
        garden_10: '10 flowers in your garden! +1 chest', garden_50: '50 flowers! "Zen Garden" skin unlocked',
        board_excl: 'Exclusive',
        pick_back: 'Back',
        pu_row: 'Row cleared!', pu_col: 'Column cleared!', pu_no_target: 'No target', pu_wild_emergency: 'Wildcard · emergency clear', pu_wild_icons: 'Wildcard · {n} icons',
        surv_diff_title: 'Survival', surv_diff_sub: 'Choose the run pace', surv_start: 'Start survival',
        surv_week_label: 'This week', survmut_none: 'Classic week · no modifier',
        surv_diff_facil_d: '4 lives · gentle pace · coins ×0.85', surv_diff_normal_d: '3 lives · standard · coins ×1', surv_diff_dificil_d: '3 lives · fast pace · coins ×1.3',
        surv_launch_record: 'Record: wave {w}', surv_launch_norecord: 'Record: —',
        mode_launch_close: 'Close', mode_launch_back: 'Back', mode_launch_details: 'View details', mode_launch_progress: 'Your progress', mode_launch_how: 'How it works', mode_launch_record: 'Record', mode_launch_no_record: '—', mode_launch_plays: 'Runs', mode_launch_level: 'Level', mode_launch_chapter: 'Chapter', mode_launch_best: 'Best score', mode_launch_worlds: 'Worlds', mode_launch_stars: 'Stars', mode_launch_next_boss: 'Next boss', mode_launch_start_time: 'Starting time', mode_launch_time_cap: 'Clock cap', mode_launch_each_match: 'Each convergence', mode_launch_flowers: 'Flowers', mode_launch_goal: 'Goal', mode_launch_pace: 'Pace',
        session_title: 'Session brief', session_duration: 'Duration', session_save: 'Save', session_goal: 'Goal', session_entry: 'Entry', session_save_yes: 'Can be resumed', session_save_no: 'One session',
        session_classic_duration: '3–6 min/level', session_classic_goal: 'Clear the board', session_classic_entry: 'Free · optional boosters',
        session_adventure_duration: '4–7 min/level', session_adventure_goal: 'Complete the goal', session_adventure_entry: 'Free · coins and XP',
        session_timed_duration: '1–4 min', session_timed_goal: 'Highest score', session_timed_entry: 'Free · coins and XP',
        session_survival_duration: 'No limit', session_survival_goal: 'Survive waves', session_survival_entry: 'Free',
        session_zen_duration: 'Unlimited', session_zen_goal: 'Play at your pace', session_zen_entry: 'Free · flowers and collection',
        ml_surv_tag: 'Infinite waves ∞', ml_surv_weekly: 'Weekly progress', ml_surv_special: 'Special week', ml_surv_choose: 'Difficulty', ml_surv_feats: 'This week', ml_surv_how3: 'You lose one life if the board overflows.', ml_surv_week_none_title: 'Classic week', ml_surv_week_none_sub: 'No modifier', ml_surv_week_ice_title: 'Ice week', ml_surv_week_ice_sub: 'Frozen traps · coins ×1.15', ml_surv_week_chaos_title: 'Chaos week', ml_surv_week_chaos_sub: 'The quake is back', ml_surv_week_frenzy_title: 'Fury week', ml_surv_week_frenzy_sub: 'Frenzy +30%',
        surv_loadout_title: 'Prepare your loadout', surv_loadout_sub: 'Pick up to {n}. Stock is used before coins are charged.', surv_loadout_count: '{n}/{max} equipped', surv_loadout_price: '{n} coins', surv_loadout_none: 'No boosters: play for free and fund your next loadout.', surv_loadout_uses_stock: '{n} from stock', surv_loadout_cost: '{n} coins', surv_loadout_max: 'Maximum {n} boosters per run', surv_start_empty: 'Start without boosters', surv_start_stock: 'Start · use {n} from stock', surv_start_cost: 'Start · {n} coins',
        ml_classic_tag: 'Level based', ml_classic_world: 'Current world', ml_classic_route: 'Your game', ml_classic_cta: 'Open classic map', ml_classic_how1: 'Clear levels and unlock new worlds.', ml_classic_how2: 'Earn up to 3 stars based on your mistakes.', ml_classic_how3: 'Each world adds its own obstacles and rules.',
        ml_adv_tag: 'Endless journey', ml_adv_biome: 'Current biome', ml_adv_route: 'Your expedition', ml_adv_cta: 'Continue adventure', ml_adv_how1: 'Advance through five-level chapters.', ml_adv_how2: 'Each biome changes goals and obstacles.', ml_adv_how3: 'Every chapter ends with a mini-boss.',
        ml_timed_tag: 'Time attack', ml_timed_score: 'Your score', ml_timed_rules: 'Run rules', ml_timed_cta: 'Start time attack', ml_timed_how1: 'Start with 60 seconds on one board.', ml_timed_how2: 'Each convergence restores time, capped at 90.', ml_timed_how3: 'Combos sustain the clock and multiply points.',
        ml_zen_tag: 'Relax', ml_zen_garden: 'Your garden', ml_zen_space: 'Zen garden', ml_zen_choose: 'Choose pace', ml_zen_cta: 'Enter zen', ml_zen_how1: 'There are no penalties or game over.', ml_zen_how2: 'A full board is partially cleared.', ml_zen_how3: 'Every cleared board grows one flower.',
        surv_boss_cleared: 'BOSS CLEARED!', surv_boss_cleared_clean: 'Boss cleared with no power-ups! ✦',
        surv_frenzy_max: 'MAX FURY!', surv_wave_record_live: 'Record: wave {w} and climbing!',
        surv_over_wave_new: '🏆 New wave record!', surv_over_wave_near: '{k} short of your record (wave {best})', surv_over_record: 'Your record: wave {best}',
        surv_run_bosses: '{n} bosses cleared',
        // Service Record (SV-30/31/32)
        srank_recluta: 'Recruit', srank_explorador: 'Explorer', srank_curtido: 'Hardened', srank_veterano: 'Veteran', srank_elite: 'Elite', srank_leyenda: 'Legend',
        surv_rank_label: 'Rank', surv_rank_progress: '{c}/{n} waves → {next}', surv_rank_max: 'Max rank!', surv_rank_up: 'Rank up: {r}!',
        surv_week_best: 'This week: wave {w}', surv_week_best_none: 'This week: no mark yet',
        feat_unlocked: 'Feat!', surv_feats_label: 'Feats',
        feat_impecable: 'Flawless', feat_impecable_d: 'Beat a boss without losing a life',
        feat_purista: 'Purist', feat_purista_d: 'Reach wave 10 without using power-ups',
        feat_fenix: 'Phoenix', feat_fenix_d: 'Beat your record in a run where you revived',
        feat_coleccionista: 'Collector', feat_coleccionista_d: 'Pick all 8 distinct blessings',
        feat_semana_completa: 'Globetrotter', feat_semana_completa_d: 'Set a weekly record in 3 distinct mutators',
        feat_frenetico: 'Frantic', feat_frenetico_d: 'Trigger 3 max frenzies in one run',
        feat_al_limite: 'On the edge', feat_al_limite_d: 'Clear 2 waves in a row with a single life',
        feat_economo: 'Thrifty', feat_economo_d: 'Reach wave 15 without reviving',
        surv_frenzy: 'Frenzy', surv_frenzy_ready: 'Frenzy active!', surv_wave_reward: 'Wave {w} · +{c} coins',
        surv_milestone: 'Wave {w} milestone', surv_wave_record: 'Record! Wave {w}', surv_best_wave: 'Best wave',
        surv_rewards: 'Rewards', surv_reward_line: '+{c} coins · +{g} gems · +{ch} chests', surv_time_record: 'Survival record!',
        coins: 'coins', gems: 'gems', daily_done: 'Daily mission complete!', weekly_done: 'Weekly challenge complete!', lvl: 'Level',
        next: 'Next', new_icons: 'New icons', chapter: 'Chapter', next_to: 'Go to level {n} →', lets_play: "Let's play!",
        obj_clear: 'Clear the board', obj_score: 'Reach {n} pts', obj_score_live: 'Points: {p}/{n}', obj_survive: 'Survive {n}s', obj_boss: 'BOSS · break the 💎', obj_boss_live: 'BOSS · break the 💎 ({n})',
        objlabel_clear: 'Clear', objlabel_score: 'Score', objlabel_survive: 'Survive', objlabel_boss: 'Boss',
        biome_nebula: 'Nebula', biome_asteroid: 'Asteroid Belt', biome_ice: 'Ice Field', biome_core: 'Burning Core', biome_void: 'The Void', biome_crystal: 'Crystalia',
        biomemod_nebula: '', biomemod_asteroid: '🪨 Rocks block the board', biomemod_ice: '🧊 Frozen cells: tap to break', biomemod_core: '🔥 Icons spawn faster', biomemod_void: '🕳️ Fewer hints available', biomemod_crystal: '💎 Crystals worth extra points',
        sum_level: 'Reached level {n}', sum_time: 'Time {t}', sum_wave: 'Wave {w} · {s}s survived', sum_chapter: 'Chapter {c} · Level {n}',
        level_done: 'Level complete!', perfect_done: 'Perfect board!', level_sub: 'Level {n} cleared', perfect_sub: 'Clean board · bonus +{b}', level_reason_score: 'Goal reached: {n} pts', level_reason_clear: 'Board cleared', level_reason_boss: 'Boss crystals destroyed', level_reason_survive: 'You survived {n}s', boss_next: 'Boss ahead!',
        over_victory: '🏆 Victory!', over_surv: '🛡️ Survival over', over_fail: 'Mission failed!', over_time: 'Time trial over',
        reason_time: "Time's up!", reason_nomoves: 'No moves left · {n}% of the board filled.', reason_full: 'The board filled up.', reason_end: 'Game over.', reason_surv: 'Survived {s}s', ach_unlocked: '🏅 Achievement: {n}',
        m_tutorial_n: 'Tutorial', m_tutorial_d: 'Learn the mechanic, no rush or penalties.', m_tutorial_g: 'Match two equal',
        m_clasico_n: 'Classic', m_clasico_d: 'Clear the board to pass the level. Careful: mistakes add icons.', m_clasico_g: 'Clear the board',
        m_aventura_n: 'Adventure', m_aventura_d: 'Endless journey across biomes with their own rules, goals and mini-bosses. How far will you go?',
        m_contrarreloj_n: 'Time Attack', m_contrarreloj_d: 'Each convergence adds time; combos add even more. Do not let the clock hit zero!', m_contrarreloj_g: 'Combos = more time',
        m_supervivencia_n: 'Survival', m_supervivencia_d: 'Endure rising waves with lives, traps, bosses and boosters. How long will you last?',
        m_zen_n: 'Zen', m_zen_d: 'Relaxed pace, no penalties or game over. Play and breathe.', m_zen_g: 'No mistakes, no rush',
        legacy_import_title: 'Sync your progress', legacy_import_sub: 'We found a previous local game. Review the projected data before linking your account.',
        legacy_import_confirm: 'Confirm and import', legacy_import_cancel: 'Keep local only',
        legacy_import_warning_text: 'Unverified local coins and chests are quarantined and will be checked by the server.',
        legacy_import_done: 'Import submitted', legacy_import_kept_local: 'Your progress stays on this device only', legacy_import_unavailable: 'Sync is not available right now',
        adventure_level: 'Adventure', xp: 'XP',
        sync_action_review: 'Review sync',
        sync_status_local_only: 'Local only', sync_status_queued: 'Queued', sync_status_syncing: 'Syncing…',
        sync_status_awaiting: 'Needs confirmation', sync_status_synced: 'Synced', sync_status_offline: 'Offline',
        sync_status_conflict: 'Conflict', sync_status_identity_mismatch: 'Different account', sync_status_invalid_local: 'Invalid local data', sync_status_error: 'Sync error',
      },
    };
    const FIELD = { name: 'n', desc: 'd', goal: 'g' };
    return {
      DICT, // expuesto para QA/tests (paridad de claves ES/EN)
      get lang() { return Settings.lang === 'en' ? 'en' : 'es'; },
      t(key) { const d = DICT[this.lang] || DICT.es; return d[key] != null ? d[key] : (DICT.es[key] != null ? DICT.es[key] : key); },
      modeT(id, field) {
        const m = Config.MODES[id] || {};
        if (this.lang === 'es') return m[field] || '';
        const k = 'm_' + id + '_' + (FIELD[field] || field);
        return DICT.en[k] != null ? DICT.en[k] : (m[field] || '');
      },
      apply(root) {
        const r = root || document;
        r.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.t(el.getAttribute('data-i18n')); });
        r.querySelectorAll('.m-head h2[data-i18n]').forEach((el) => { el.textContent = el.textContent.replace(/^[^A-Za-z0-9¿¡]+/, '').trim(); });
        r.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = this.t(el.getAttribute('data-i18n-html')); });
        r.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', this.t(el.getAttribute('data-i18n-ph'))); });
        r.querySelectorAll('[data-i18n-al]').forEach((el) => { el.setAttribute('aria-label', this.t(el.getAttribute('data-i18n-al'))); });
        document.documentElement.setAttribute('lang', this.lang);
      },
    };
  })();

  /* ===================== RunLog (bitácora de partida) =====================
   * Registra lo que el backend necesita para REEJECUTAR la partida y verificar
   * la puntuación (`submitRunClaim`). El servidor nunca acepta el score como
   * dato: lo recalcula con el mismo núcleo y solo publica si coincide.
   *
   * Por eso hay que registrar TODA fuente de puntos, no solo las convergencias:
   * una casilla bonus o una bomba sin anotar dejarían el recálculo por debajo y
   * la marca legítima se rechazaría en silencio.
   *
   * Es deliberadamente pasivo: no altera estado de juego, no decide nada y
   * cualquier fallo suyo se traga sin tocar la partida. Grabar la bitácora nunca
   * puede ser la causa de que alguien pierda una partida.
   */
  const RunLog = {
    MAX: 4000,          // el tope que impone el contrato del claim
    events: [],
    startedAt: 0,
    active: false,
    overflow: false,    // se superó el tope: la partida deja de ser publicable

    start() {
      this.events = []; this.startedAt = Date.now();
      this.active = true; this.overflow = false;
    },
    stop() { this.active = false; },

    // El reloj de la bitácora es el de partida, y solo avanza: el servidor
    // rechaza una run cuyo elapsed retroceda.
    _at() {
      const seconds = Math.max(0, Math.round(State.elapsed || 0));
      const previous = this.events.length ? this.events[this.events.length - 1].elapsedSeconds : 0;
      return Math.max(seconds, previous);
    },
    _push(event) {
      if (!this.active) return;
      if (this.events.length >= this.MAX) { this.overflow = true; return; }
      event.elapsedSeconds = this._at();
      this.events.push(event);
    },

    convergence(data) {
      this._push({
        kind: 'convergence',
        removed: data.removed,
        combo: data.combo,
        fever: !!data.fever,
        level: data.level,
        crystals: data.crystals || 0,
        capsules: data.capsules || 0,
        emptyBoardChain: data.emptyBoardChain || 0,
        perfectLevel: !!data.perfectLevel,
        wave: data.wave || 1,
      });
    },
    mistake() { this._push({ kind: 'mistake' }); },
    bonusTile() { this._push({ kind: 'bonusTile' }); },

    /* La cápsula de tiempo y el bono de tablero vacío se resuelven DESPUÉS de la
     * convergencia que los provocó, pero el servidor los reejecuta como campos
     * de esa misma convergencia. Se adjuntan a la última anotada, que es
     * exactamente la jugada a la que pertenecen. */
    _lastConvergence() {
      for (let i = this.events.length - 1; i >= 0; i--) {
        if (this.events[i].kind === 'convergence') return this.events[i];
      }
      return null;
    },
    attachCapsule() {
      const event = this._lastConvergence();
      if (event) event.capsules += 1;
    },
    attachEmptyBoardChain(chain) {
      const event = this._lastConvergence();
      if (event) event.emptyBoardChain = chain;
    },
    areaClear(cells, level) {
      this._push({ kind: 'areaClear', cells, level: level || 1, wave: 1 });
    },

    /** ¿Puede esta partida optar a tabla? Una bitácora desbordada, no. */
    publishable() { return !this.overflow && this.events.length > 0; },
  };

  /* ===================== Haptics (vibración móvil) =====================
   * Cada patrón declara dos cosas: su forma en milisegundos al estilo
   * `navigator.vibrate` (pulso/pausa alternados) y la primitiva háptica nativa
   * equivalente, que es lo que se usa dentro del APK.
   *
   * Los valores originales (8 para `tap`, 12-14 para los pulsos de combo) venían
   * de la época web y no se sienten: un pulso por debajo de ~20 ms no llega a
   * mover un motor LRA moderno, así que el tablero vibraba "sin vibrar". Los
   * mínimos de aquí son perceptibles conservando la forma de cada patrón.
   */
  const Haptics = {
    get webOk() { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; },
    // El ajuste de vibración se muestra si CUALQUIERA de las dos vías existe: en
    // el WebView nativo `navigator.vibrate` puede faltar y el ajuste desaparecía.
    get ok() { return this.webOk || !!Platform.hapticsAvailable; },
    // Duración total de un patrón, para el plugin nativo cuando solo expone
    // `vibrate({duration})` y no las formas de onda con amplitud.
    _ms(p) {
      if (typeof p === 'number') return p;
      if (!Array.isArray(p)) return 0;
      let total = 0;
      for (let i = 0; i < p.length; i += 2) total += p[i] || 0;
      return total;
    },
    fire(p, kind) {
      if (!Settings.haptics) return;
      // El puente devuelve false si el plugin no está o ya falló; en ese caso
      // todavía queda la API del WebView y no debe darse por perdida.
      if (Platform.isNative && Platform.haptic(kind || 'medium', this._ms(p))) return;
      if (this.webOk) { try { navigator.vibrate(p); } catch (_) { } }
    },
    tap() { this.fire(22, 'light'); },
    combo() { this.fire(32, 'medium'); },
    milestone() { this.fire([24, 30, 28], 'success'); },
    error() { this.fire(60, 'error'); },
    level() { this.fire([28, 40, 28, 40], 'success'); },
    record() { this.fire([24, 28, 24, 28, 48], 'success'); },
    fever() { this.fire([30, 30, 30], 'warning'); },
    ice() { this.fire([20, 18, 22], 'light'); },
    quake() { this.fire([40, 28, 46, 28, 58], 'heavy'); },
    life() { this.fire([28, 36, 28, 32], 'success'); },
    roll() { this.fire([22, 20, 28, 26, 34], 'medium'); },    // marea (creciente)
    impacts() { this.fire([40, 22, 40, 22, 52], 'heavy'); },  // meteoro (staccato)
    clank() { this.fire([52, 26, 52], 'heavy'); },            // cierre (metálico)
    reward() { this.fire([24, 24, 24, 30], 'success'); },     // ventaja concedida
  };

  /* ===================== Sound (WebAudio, sin archivos) ===================== */
  const Sound = {
    ctx: null, sfxGain: null, musicGain: null, _unlocked: false,
    // AP-8 (docs/ANIMATION_PERF_PLAN.md): tope de osciladores concurrentes. En cadenas de
    // convergencias muy rápidas se creaban ráfagas de nodos WebAudio (cada `tone` es uno, y
    // los acordes de combo 3-4 a la vez) que congestionaban el scheduler en el hilo principal.
    // Por encima del tope se descarta el tono extra (inaudible en la ráfaga), nunca se corta uno vivo.
    _osc: 0, MAX_OSC: 32,
    get enabled() { return Settings.sfx; },
    // ¿Hay ALGO que quiera reproducirse? Si sonido y música están ambos en OFF, la app no debe
    // tocar la sesión de audio del dispositivo: nada de audioSession='playback' ni de mantener el
    // contexto "running", porque iOS trataría la app como si emitiera sonido e interrumpiría el
    // audio de fondo de otras apps (música, podcast...). Ese era el bug reportado.
    wanted() { return !!(Settings.sfx || Settings.music); },
    // Libera la sesión de audio suspendiendo el contexto (iOS deja de considerar la app como
    // "reproduciendo" y el audio de fondo se reanuda). Idempotente y seguro fuera de gesto.
    suspend() {
      this._osc = 0;
      if (this.ctx && this.ctx.state === 'running' && this.ctx.suspend) {
        const r = this.ctx.suspend(); if (r && r.catch) r.catch(() => { });
      }
    },
    // Reconcilia el estado del audio tras cambiar Settings.sfx/music o el foco de la pestaña.
    // Debe correr dentro de un gesto para poder (re)activar el contexto en iOS; suspender es libre.
    applyEnabled() { if (this.wanted()) this.ensure(); else this.suspend(); },
    // Debe llamarse DENTRO de un gesto de usuario (iOS lo exige).
    ensure() {
      // Con sonido Y música desactivados NO agarramos la sesión de audio del dispositivo: ni
      // fijamos audioSession='playback' ni creamos/reanudamos el contexto. Si ya existía, lo
      // suspendemos para devolver la sesión al sistema (no interferir con el audio de fondo).
      if (!this.wanted()) { this.suspend(); return; }
      const ua = navigator.userActivation;
      const activeGesture = !ua || ua.isActive;
      if (!this.ctx && !activeGesture) return;
      if (!this.ctx) {
        try {
          // iOS 16.4+: enrutar al canal "playback" para que el audio suene aunque el interruptor
          // físico de silencio esté activado (la causa más común de "no hay sonido en iPhone").
          // Solo se hace cuando el usuario SÍ quiere audio (guard de wanted() arriba).
          try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { }
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.ctx.destination);
          this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.0; this.musicGain.connect(this.ctx.destination);
        } catch (_) { }
      }
      // iOS usa también el estado 'interrupted' (tras Siri/llamada), no solo 'suspended'.
      if (this.ctx && this.ctx.state !== 'running') {
        if (!activeGesture) return;
        const r = this.ctx.resume(); if (r && r.catch) r.catch(() => { });
      }
      // Desbloqueo iOS: reproducir un búfer silencioso una vez dentro del gesto.
      if (this.ctx && !this._unlocked) {
        try {
          const buf = this.ctx.createBuffer(1, 1, 22050), src = this.ctx.createBufferSource();
          src.buffer = buf; src.connect(this.ctx.destination); src.start(0); this._unlocked = true;
        } catch (_) { }
      }
    },
    tone(freq, dur, type = 'sine', vol = 0.2, when = 0) {
      // Guard de estado 'running': programar sobre un contexto suspendido/interrumpido no suena,
      // fuga el contador de osciladores (onended no dispara) y puede glitchear al reanudar.
      if (!Settings.sfx || !this.ctx || this.ctx.state !== 'running') return;
      if (this._osc >= this.MAX_OSC) return; // ráfaga saturada: descarta este tono extra
      const t = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.sfxGain || this.ctx.destination);
      this._osc++;
      // Desconectar el subgrafo al terminar: sin esto los nodos se acumulan durante la partida
      // (osc+gain por cada tono) y sobrecargan el hilo de audio -> fallos/crackle en partidas largas.
      osc.onended = () => { this._osc = Math.max(0, this._osc - 1); try { osc.disconnect(); g.disconnect(); } catch (_) { } };
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    chord(freqs, dur, type = 'sine', vol = 0.12, stagger = 0) { freqs.forEach((f, i) => this.tone(f, dur, type, vol, i * stagger)); },
    tap() { this.tone(420, 0.05, 'triangle', 0.10); },
    ui() { this.tone(380, 0.05, 'sine', 0.08); },
    success() { this.tone(660, 0.09, 'sine', 0.15); this.tone(990, 0.09, 'sine', 0.09, 0.03); },
    // Pitch sube con el combo (eliminaciones encadenadas). Throttle anti-acumulación.
    eliminate(n) { const t = performance.now(); if (t - (this._lastElim || 0) < 30) return; this._lastElim = t; const base = 520 + Math.min(n, 24) * 16; this.tone(base, 0.07, 'triangle', 0.12); this.tone(base * 1.5, 0.08, 'sine', 0.07, 0.03); },
    match(removed, combo, mult) {
      this.eliminate(combo);
      const tier = removed >= 4 ? 4 : removed >= 3 ? 3 : mult >= 2 ? 2 : combo >= 3 ? 1 : 0;
      if (tier >= 2) this.combo(Math.min(4, tier - 1));
      if (removed >= 4) this.tone(1760, 0.07, 'sine', 0.055, 0.11);
    },
    combo(l) { const roots = [523, 587, 659, 784, 988]; const r = roots[clamp(l, 0, 4)]; this.chord([r, r * 1.26, r * 1.5], 0.14, 'sine', 0.10, 0.02); },
    rank() { this.chord([784, 1047, 1319], 0.2, 'sine', 0.12, 0.05); },
    fever() { this.chord([330, 415, 554, 659], 0.3, 'sawtooth', 0.06, 0.04); },
    milestone() { this.chord([659, 988, 1319], 0.25, 'square', 0.07, 0.06); },
    record() { this.chord([784, 988, 1175, 1568], 0.3, 'sine', 0.12, 0.07); },
    bossDefeat() { this.tone(176, 0.16, 'sawtooth', 0.09); this.chord([523, 784, 1047, 1568], 0.32, 'sine', 0.10, 0.045); this.tone(2093, 0.12, 'triangle', 0.055, 0.30); },
    bossReward() { this.chord([659, 880, 1175, 1568], 0.18, 'triangle', 0.085, 0.055); this.tone(1976, 0.12, 'sine', 0.055, 0.30); },
    boardClear() { this.tone(196, 0.12, 'triangle', 0.08);[523, 784, 1047, 1568, 2093].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.105, i * 0.045)); },
    miss() { this.tone(160, 0.12, 'sawtooth', 0.09); },
    danger() { this.tone(120, 0.09, 'sine', 0.08); },
    level() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.13, i * 0.08)); },
    over() { [392, 311, 247, 196].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.15, i * 0.12)); },
    iceCrack(stage = 1) {
      const base = 820 + clamp(stage, 0, 3) * 80;
      this.tone(base, 0.045, 'square', 0.055);
      this.tone(260, 0.06, 'triangle', 0.045, 0.025);
    },
    iceBreak() { this.chord([740, 980, 1320], 0.12, 'triangle', 0.08, 0.018); this.tone(1700, 0.05, 'sine', 0.05, 0.06); },
    quake() { [72, 58, 82, 64, 94].forEach((f, i) => this.tone(f, 0.16, 'sawtooth', 0.07, i * 0.08)); },
    rain() { [988, 784, 659, 523, 392].forEach((f, i) => this.tone(f, 0.08, 'triangle', 0.07, i * 0.045)); },
    lifeBlast() { this.tone(92, 0.18, 'sawtooth', 0.08); this.chord([392, 587, 784, 1175], 0.24, 'sine', 0.09, 0.035); },
    booster(id) {
      if (id === 'freeze') { this.chord([880, 1175, 1568], 0.16, 'triangle', 0.07, 0.025); return; }
      if (id === 'bomb') { this.tone(96, 0.16, 'sawtooth', 0.10); this.tone(520, 0.08, 'square', 0.06, 0.04); return; }
      if (id === 'x2') { this.chord([659, 988, 1319], 0.14, 'square', 0.055, 0.018); return; }
      if (id === 'clearLine') { [660, 760, 860, 960].forEach((f, i) => this.tone(f, 0.055, 'triangle', 0.055, i * 0.035)); return; }
      if (id === 'wild') { this.chord([523, 784, 1047, 1568], 0.18, 'sine', 0.08, 0.03); return; }
      this.rank();
    },
    // Firmas de audio ÚNICAS por evento de Supervivencia (FBK-05): antes marea≈meteoro
    // (rain) y escarcha≈cierre (booster freeze) sonaban igual. Ahora cada evento tiene
    // su motivo para reconocerlo sin mirar el texto.
    tide() { [392, 523, 659, 784, 988].forEach((f, i) => this.tone(f, 0.09, 'triangle', 0.06, i * 0.05)); this.tone(180, 0.22, 'sine', 0.05, 0.02); },       // whoosh que SUBE + gorgoteo grave
    meteor() { this.tone(1250, 0.14, 'sine', 0.05); this.tone(720, 0.12, 'sine', 0.05, 0.07); this.tone(88, 0.16, 'sawtooth', 0.10, 0.18); this.tone(120, 0.10, 'square', 0.06, 0.28); }, // silbido que CAE + impactos
    frost() { this.chord([880, 1175, 1568], 0.16, 'triangle', 0.07, 0.025); this.tone(2100, 0.05, 'sine', 0.04, 0.08); },   // cristalino (familia hielo)
    lockdown() { this.tone(300, 0.05, 'square', 0.08); this.tone(170, 0.13, 'sawtooth', 0.08, 0.05); this.tone(120, 0.14, 'square', 0.06, 0.12); }, // clank metálico + cerrojo
    waveUp() { this.tone(523, 0.10, 'triangle', 0.09); this.tone(784, 0.13, 'sine', 0.08, 0.06); },  // progreso (distinto de danger)
    bossWarn() { [196, 220, 247, 277].forEach((f, i) => this.tone(f, 0.15, 'sawtooth', 0.06, i * 0.09)); }, // tensión que sube
    grant() { this.chord([784, 1047, 1319, 1568], 0.16, 'sine', 0.08, 0.05); },  // campana alegre ascendente
    echo() { [1319, 988, 784, 659, 523].forEach((f, i) => this.tone(f, 0.10, 'sine', 0.05, i * 0.05)); },  // shimmer descendente
  };

  /* ===================== Helpers ===================== */
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Accesibilidad (FBK-08): respeta la preferencia del SO de "reducir movimiento",
  // además del ajuste in-app `Settings.reducedFx`. Se combinan en las animaciones nuevas.
  const prefersReduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionOff = () => Settings.reducedFx || prefersReduceMotion();
  /* PRNG seedeable (mulberry32). El GAMEPLAY (spawns, trampas, bonus) tira de
   * RNG.random() para que un mismo seed reproduzca el mismo tablero (reto diario,
   * replays, validación anti-trampas futura). Los efectos visuales (FX) y la
   * economía meta (cofres) siguen usando Math.random a propósito: no son reglas
   * de partida y un cofre seedeable sería explotable. */
  const RNG = {
    _s: (Math.random() * 0xffffffff) >>> 0,
    seed(v) {
      if (typeof v === 'string') { let h = 0; for (let i = 0; i < v.length; i++) h = (Math.imul(h, 31) + v.charCodeAt(i)) | 0; v = h; }
      this._s = v >>> 0;
    },
    random() {
      let t = (this._s += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
  const rand = (n) => (RNG.random() * n) | 0;
  // Hash polinomial de 32 bits (mismo algoritmo que el hashStr interno de Meta):
  // elección determinista de mutadores diarios/semanales sin servidor (GM-15/22).
  const hash32 = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const fmtNum = (n) => {
    const v = Math.floor(+n || 0);
    const sign = v < 0 ? '-' : '';
    return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };
  const fmtCompact = (n) => {
    const v = Math.floor(+n || 0), sign = v < 0 ? '-' : '', abs = Math.abs(v);
    if (abs < 10000) return sign + String(abs);
    const unit = abs >= 999500 ? 'M' : 'K';
    const scaled = unit === 'M' ? abs / 1000000 : abs / 1000;
    const digits = scaled < 10 ? 1 : 0;
    return sign + scaled.toFixed(digits).replace(/\.0$/, '') + unit;
  };
  const fmtSigned = (n) => (n > 0 ? '+' : '') + fmtNum(n);
  // Escapado HTML único para TODO texto interpolado en template strings que acaben en
  // innerHTML. Cualquier dato de usuario o texto variable debe pasar por aquí.
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const DIRS = [-1, 0, 1, 0, 0, 1, 0, -1]; // pares (dr,dc): arriba, derecha, abajo, izquierda

  /* ===================== State ===================== */
  const State = {
    board: [], size: Config.SIZE,
    score: 0, level: 1, iconCount: 0,
    combo: 0, comboMult: 1, comboAt: 0, comboWindow: 3500,
    spawnRate: 2600, elapsed: 0, timeLeft: 0,
    status: 'idle', // idle|playing|paused|over|levelComplete
    mode: 'clasico', diff: 'normal',
    hintsLeft: 3, hintReadyAt: 0,
    maxCombo: 0, removedTotal: 0, mistakes: 0, // estadísticas de la partida
    displayScore: 0,        // marcador animado (count-up)
    fever: false, feverEver: false, perfectEver: false,
    recordHit: false,       // récord superado en vivo (una vez por partida)
    recordNear: false,      // aviso "a X del récord" mostrado (una vez por partida, HUD-TA4)
    minIcons: 99,           // mínimo de iconos alcanzado en el nivel (near-miss, GM-01)
    bestPlay: null,         // jugada pico de la partida {points, combo, removed, wave, level} (GM-28)
    spawnHoldUntil: 0,      // pausa breve de spawns (entrada en Fiebre, GM-27)
    warmupUntil: 0, warmupConvs: 0, warmupEndAt: 0, warmupDone: true, // warm-up de apertura (GM-26)
    sprintToastAt: 0,       // throttle del aviso de sprint final (GM-10)
    emptyBonusClaimed: false, emptyBoards: 0, lastActionCell: null,
    lastDangerAt: 0,        // throttle del aviso de peligro
    timePressure: 0,        // 0 normal, 1 presion, 2 critico (Contrarreloj)
    pool: [], // iconos disponibles este nivel
    tiles: [],              // capa de casillas especiales (paralela a board): null=normal
    coinsRun: 0,            // monedas ganadas en la partida en curso
    xpMultiplier: 1,        // snapshot del XP booster al comenzar la partida
    dailyMut: null,         // mutador capturado al iniciar Daily (estable si cruza medianoche)
  };

  /* ===================== Engine (lógica pura del tablero) ===================== */
  const Engine = {
    idx: (r, c) => r * State.size + c,
    inside: (r, c) => r >= 0 && c >= 0 && r < State.size && c < State.size,

    // Nº de iconos distintos del nivel (variedad creciente => más difícil)
    // Sube 1 icono cada 3 niveles (antes cada 2) para un ritmo más suave.
    varietyFor(level) {
      return clamp(4 + Math.floor((level - 1) / 3), 4, Math.min(8, Icons.CATALOG.length));
    },
    _window(off, n) {
      const L = Icons.CATALOG.length, a = [];
      for (let i = 0; i < n; i++) a.push(Icons.CATALOG[(off + i) % L]);
      return a;
    },
    // Ventana deslizante aditiva: avanza 1 posición por nivel, por lo que comparte
    // (n-1) iconos con el nivel anterior → introducción GRADUAL (entra 1 nuevo,
    // sale 1 viejo). Mantiene formas distintas dentro de la ventana (período 16 > 8).
    poolForLevel(level) {
      const n = this.varietyFor(level);
      const off = (level - 1) % Icons.CATALOG.length;
      return this._window(off, n);
    },

    occupation() {
      let n = 0;
      for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null) n++;
      return n / State.board.length * 100;
    },

    spawnRateForLevel(level) {
      const d = Config.DIFFICULTY[State.diff];
      let base = d.spawnStart * Math.pow(0.95, level - 1);
      return Math.round(clamp(base, d.spawnMin, 6000));
    },

    emptyCells() {
      const out = [];
      // Una casilla sólida (roca/bloqueada/helada) NO es colocable: nunca debe recibir
      // un icono nuevo (spawnOne/placeInitial/addPenalty).
      for (let i = 0; i < State.board.length; i++) {
        if (State.board[i] === null && !State.tiles[i]) out.push(i);
      }
      return out;
    },

    // Celdas "calientes": vaciadas por el jugador (o punto de convergencia) hace un
    // instante. Un SPAWN ORGÁNICO inmediato ahí (sin retardo visual) se lee como "el
    // icono eliminado no desapareció" o "reapareció el mismo icono en su casilla"
    // (bug reportado): mientras exista alternativa, spawnOne las evita una ventana
    // corta; si no hay alternativa se usan igual (overflow y conteo no cambian). El
    // relleno post-tablero-limpio NO las evita: su entrada en cascada retardada
    // (Render.refillAnim) ya hace legible cualquier celda, y evitar celdas ahí
    // distorsionaba la geometría de los patrones (−12% de score del bot estándar,
    // medido con balance-sim 31 runs — inaceptable para el guardarraíl de medallas).
    HOT_MS: 650,
    _hotCells: Object.create(null),
    noteHot(cells) {
      const now = performance.now();
      for (const i of cells) this._hotCells[i] = now;
    },
    resetHot() { this._hotCells = Object.create(null); },
    _isHot(i, win) {
      const t = this._hotCells[i];
      if (t === undefined) return false;
      const dt = performance.now() - t;
      return dt >= 0 && dt < (win || this.HOT_MS);
    },
    _preferCold(list, win) {
      const cold = list.filter((i) => !this._isHot(i, win));
      return cold.length ? cold : list;
    },

    /* Iconos que convergen al tocar la casilla vacía `i`.
       Devuelve los índices a eliminar (grupos con 2+ del mismo tipo). */
    converging(i) {
      // Una casilla sólida (roca/bloqueada/helada) no se puede activar.
      const ti = State.tiles[i];
      if (State.board[i] !== null || (ti && (ti.solid || ti.trigger))) return [];
      const r = (i / State.size) | 0, c = i % State.size;
      const groups = Object.create(null);
      for (let d = 0; d < 8; d += 2) {
        let rr = r + DIRS[d], cc = c + DIRS[d + 1];
        while (this.inside(rr, cc)) {
          const j = this.idx(rr, cc);
          // Casilla sólida: corta la línea de visión (no se ve ni converge tras ella).
          const t = State.tiles[j];
          if (t && t.solid) break;
          const v = State.board[j];
          if (v !== null) { (groups[v] || (groups[v] = [])).push(j); break; }
          rr += DIRS[d]; cc += DIRS[d + 1];
        }
      }
      const out = [];
      for (const k in groups) if (groups[k].length >= 2) out.push(...groups[k]);
      return out;
    },

    /* ¿Queda algún movimiento posible? (alguna casilla vacía que converja) */
    hasMoves() {
      for (let i = 0; i < State.board.length; i++) {
        if (State.board[i] === null && this.converging(i).length >= 2) return true;
      }
      return false;
    },

    placeInitial(n) {
      this.resetHot(); // tablero nuevo: ninguna celda arrastra "calor" de la partida anterior
      const empties = this.emptyCells();
      for (let k = 0; k < n && empties.length; k++) {
        const j = rand(empties.length);
        const idx = empties.splice(j, 1)[0];
        State.board[idx] = State.pool[rand(State.pool.length)];
        State.iconCount++;
      }
    },

    // Elige el id del próximo icono a aparecer. Con el tablero casi vacío sesga hacia
    // un icono igual a los presentes (prioriza el de menor count = solitarios) para
    // facilitar la convergencia; en el resto de casos, aleatorio del pool del nivel.
    _pickSpawnId() {
      const pool = State.pool;
      const randomId = () => pool[rand(pool.length)];
      const cfg = Config.CLEAR_ASSIST;
      if (State.iconCount <= 0 || State.iconCount > cfg.threshold) return randomId();
      // Cuenta los iconos presentes (ignora celdas con tile sólido por seguridad).
      const counts = Object.create(null);
      for (let i = 0; i < State.board.length; i++) {
        const v = State.board[i];
        if (v !== null && !(State.tiles[i] && State.tiles[i].solid)) counts[v] = (counts[v] || 0) + 1;
      }
      const ids = Object.keys(counts);
      if (!ids.length) return randomId();
      const p = clamp(cfg.pMax - (State.iconCount - 1) * cfg.decay, cfg.pMin, cfg.pMax);
      if (RNG.random() >= p) return randomId();
      // Elige entre los id presentes con el MENOR count (empates al azar): empareja
      // primero los solitarios, que son los que bloquean el vaciado.
      let min = Infinity;
      for (const id of ids) if (counts[id] < min) min = counts[id];
      const candidates = ids.filter((id) => counts[id] === min);
      return candidates[rand(candidates.length)];
    },

    spawnOne() {
      let empties = this.emptyCells();
      if (!empties.length) return -1;
      // Evitar la celda que el jugador acaba de vaciar (ventana corta): un spawn
      // instantáneo ahí — a veces del MISMO icono por el sesgo de clear-assist —
      // se lee como "mi icono no se eliminó".
      empties = this._preferCold(empties, 450);
      const idx = empties[rand(empties.length)];
      State.board[idx] = this._pickSpawnId();
      State.iconCount++;
      return idx;
    },

    // Coloca n iconos de penalización en celdas vacías; devuelve sus índices.
    addPenalty(n) {
      const empties = this.emptyCells();
      const placed = [];
      const k = Math.min(n, empties.length);
      for (let x = 0; x < k; x++) {
        const j = rand(empties.length);
        const idx = empties.splice(j, 1)[0];
        State.board[idx] = State.pool[rand(State.pool.length)];
        State.iconCount++;
        placed.push(idx);
      }
      return placed;
    },

    _shuffle(list) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = rand(i + 1);
        const t = list[i]; list[i] = list[j]; list[j] = t;
      }
      return list;
    },

    _balancedIconBag(n) {
      const pool = State.pool && State.pool.length ? State.pool : this.poolForLevel(State.level || 1);
      const bag = [];
      while (bag.length < n) {
        const cycle = this._shuffle(pool.slice());
        for (const id of cycle) {
          bag.push(id);
          if (bag.length >= n) break;
        }
      }
      return bag;
    },

    emptyRefillTarget(chain = 1) {
      const cfg = Config.EMPTY_BOARD_REFILL;
      const d = Config.DIFFICULTY[State.diff] || Config.DIFFICULTY.normal;
      const m = Config.MODES[State.mode] || {};
      const room = this.emptyCells().length;
      if (room <= 0) return 0;
      const source = Math.max(d.initialIcons || 0, m.initialIcons || 0, cfg.min);
      const base = Math.max(cfg.min, Math.round(source * cfg.baseFactor));
      const step = (cfg.perClear && cfg.perClear[State.diff]) || cfg.perClear.normal;
      const cap = Math.min(cfg.hardCap, Math.max(base, Math.round(source * cfg.maxFactor)));
      const target = base + Math.max(0, (chain || 1) - 1) * step;
      const low = Math.min(cfg.min, room);
      const high = Math.min(cap, room);
      return Math.min(room, clamp(target, low, high));
    },

    _rayRefillSlot(center, dr, dc, reservedCenters, reservedIcons) {
      let r = (center / State.size | 0) + dr;
      let c = center % State.size + dc;
      while (this.inside(r, c)) {
        const j = this.idx(r, c);
        const t = State.tiles[j];
        if (t && t.solid) return -1;
        if (State.board[j] !== null || reservedIcons.has(j)) return -1;
        if (!t && !reservedCenters.has(j)) return j;
        r += dr; c += dc;
      }
      return -1;
    },

    _findRefillPattern(reservedCenters, reservedIcons, maxArms) {
      const centers = this._shuffle(this.emptyCells().filter((i) => !reservedCenters.has(i)));
      for (const center of centers) {
        const dirs = this._shuffle([
          [0, -1],
          [-1, 0],
          [0, 1],
          [1, 0],
        ]);
        const cells = [];
        for (const [dr, dc] of dirs) {
          const idx = this._rayRefillSlot(center, dr, dc, reservedCenters, reservedIcons);
          if (idx >= 0) cells.push(idx);
        }
        if (cells.length >= 2) return { center, cells: cells.slice(0, Math.min(maxArms, cells.length)) };
      }
      return null;
    },

    refillAfterEmpty(chain = 1) {
      const target = this.emptyRefillTarget(chain);
      const placed = [];
      if (target <= 0) return placed;

      const reservedCenters = new Set();
      const reservedIcons = new Set();
      const patternCount = Math.min(Config.EMPTY_BOARD_REFILL.maxPairs, Math.max(2, Math.floor(target / 4)));
      const patternIds = this._balancedIconBag(patternCount);
      for (let p = 0; p < patternCount && placed.length + 2 <= target; p++) {
        const room = target - placed.length;
        const arms = Math.min(room, State.diff === 'facil' && chain <= 1 ? 2 : (chain >= 3 || State.diff === 'dificil' ? 4 : 3));
        const pattern = this._findRefillPattern(reservedCenters, reservedIcons, arms);
        if (!pattern) break;
        const id = patternIds[p];
        reservedCenters.add(pattern.center);
        pattern.cells.forEach((idx) => {
          reservedIcons.add(idx);
          State.board[idx] = id;
          State.iconCount++;
          placed.push(idx);
        });
      }

      const fillable = this._shuffle(this.emptyCells().filter((i) => !reservedCenters.has(i)));
      const bag = this._balancedIconBag(Math.min(target - placed.length, fillable.length));
      for (let k = 0; k < bag.length; k++) {
        const idx = fillable[k];
        State.board[idx] = bag[k];
        State.iconCount++;
        placed.push(idx);
      }
      return placed;
    },
  };

  /* ===================== Render (DOM) ===================== */
  const Render = {
    boardEl: null, cells: [], glyphs: [],
    popupsEl: null, popupPool: [], popupNext: 0, convergeLayer: null,
    scoreFeedbackEl: null, scoreFeedbackPool: [], scoreFeedbackNext: 0,

    buildBoard() {
      this.boardEl = $('#board');
      this.popupsEl = $('#popups');
      this.boardEl.style.setProperty('--size', State.size);
      this.boardEl.innerHTML = '';
      this.cells = []; this.glyphs = []; this._cellId = []; this._cellPack = []; this._cellTile = []; this._cellAria = [];
      const frag = document.createDocumentFragment();
      for (let i = 0; i < State.size * State.size; i++) {
        const b = document.createElement('button');
        b.className = 'cell empty';
        b.dataset.i = i;
        b.setAttribute('role', 'gridcell');
        b.tabIndex = i === 0 ? 0 : -1;
        const g = document.createElement('span');
        g.className = 'glyph'; g.setAttribute('aria-hidden', 'true');
        b.appendChild(g);
        frag.appendChild(b);
        this.cells.push(b); this.glyphs.push(g);
      }
      this.boardEl.appendChild(frag);
      // El host del tablero queda reservado a la coreografía espacial de las fichas.
      // El texto de puntuación vive junto al marcador (initScoreFeedback), nunca aquí.
      this.popupsEl.innerHTML = '';
      this.convergeLayer = document.createElement('div');
      this.convergeLayer.className = 'converge-layer';
      this.convergeLayer.setAttribute('aria-hidden', 'true');
      this.popupsEl.appendChild(this.convergeLayer);
      this.popupPool = [];
      this.initScoreFeedback();
      // buildBoard normalmente precede a FX.init; esta rama mantiene el pool unido
      // si en el futuro el tablero se reconstruye durante la misma sesión.
      if (FX.layer) FX._attachConvergeLayer(this.convergeLayer);
    },

    cellLabel(i) {
      const r = (i / State.size | 0) + 1, c = (i % State.size) + 1;
      const v = State.board[i];
      const packId = Meta.equippedIconPack();
      return `Fila ${r}, columna ${c}: ${v ? IconPacks.iconName(packId, v, Settings.lang) : 'vacía'}`;
    },

    // Pinta el icono solo cuando cambia el id lógico o el pack equipado.
    setGlyph(i, id) {
      const packId = Meta.equippedIconPack(), packKey = id ? packId : null;
      if (!this._cellPack) this._cellPack = [];
      if (this._cellId[i] === id && this._cellPack[i] === packKey) return;
      this._cellId[i] = id;
      this._cellPack[i] = packKey;
      const g = this.glyphs[i];
      g.innerHTML = id ? IconPacks.svg(packId, id) : '';
      // Salvaguarda A: los packs raster pintan un <img>; si el PNG aún no está
      // disponible (caché fría, primer arranque, offline), no dejar la celda
      // vacía —el tablero se rompía—: caer al SVG inline de Cosmos del MISMO id
      // lógico. Solo se reemplaza si la ficha no cambió entretanto.
      if (id) {
        const im = g.firstChild;
        if (im && im.tagName === 'IMG') {
          im.addEventListener('error', () => {
            if (this._cellId[i] === id) g.innerHTML = Icons.svg(id);
          }, { once: true });
        }
      }
    },

    // Overlay de casilla especial (roca/helada/cristal/cadenas/portal…) por clase, con caché.
    setTile(i) {
      const t = State.tiles[i], type = t ? t.type : '', def = t ? Tiles.DEFS[type] : null;
      const key = t ? type + ':' + (t.taps != null ? t.taps : '') + ':' + (t.hits != null ? t.hits : '') : '';
      if (this._cellTile[i] === key) return;
      this._cellTile[i] = key;
      const el = this.cells[i];
      const cls = def ? def.cls : '';
      Tiles.CLASSES.forEach((c) => el.classList.toggle(c, c === cls));
      el.classList.remove('ice-1', 'ice-2', 'ice-3', 'lock-1', 'lock-2', 'lock-cracked');
      if (type === 'frozen') el.classList.add('ice-' + clamp(t.taps || 1, 1, 3));
      if (type === 'locked') {
        const hits = clamp(t.hits || 1, 1, 2);
        el.classList.add('lock-' + hits);
        el.classList.toggle('lock-cracked', hits <= 1);
      }
      if (type === 'rock') el.classList.toggle('rock-cracked', t.hits != null && (t.hits || 1) <= 1);
      else el.classList.remove('rock-cracked');
      // Ancla de jefe (JF-02): blindada mientras conserva hits (el icono queda atrapado).
      el.classList.toggle('boss-armored', type === 'boss' && (t.hits || 0) > 0);
      // Glifo de objetos especiales/obstáculos con etiqueta propia (p. ej. "+30").
      el.dataset.tileGlyph = (def && def.trigger) ? def.glyph : '';
    },

    syncCell(i) {
      const el = this.cells[i], v = State.board[i];
      this.setGlyph(i, v);
      this.setTile(i);
      el.classList.toggle('empty', v === null && !State.tiles[i]);
      el.classList.toggle('has-icon', v !== null);
      // Hilos del Titiritero (JF-ε): los tipos enhebrados se marcan en toda celda.
      el.classList.toggle('threaded', v !== null && Bosses.isThreaded(v));
      // Grupo A · A3 (docs/RENDER_STABILITY_PLAN.md RS-12): aria-label memoizado. El texto
      // solo depende de (icono, pack equipado, idioma); recomputar cellLabel (llama a
      // IconPacks.iconName) y reescribir el atributo en CADA celda por barrido invalidaba el
      // árbol de accesibilidad 64 veces por syncAll. Con muchos eventos de jefe encadenados
      // (varios syncAll seguidos) ese coste se acumula en el hilo principal. Se salta cuando
      // no cambia; el atributo queda exactamente igual, solo se evita el trabajo redundante.
      if (!this._cellAria) this._cellAria = [];
      const ariaKey = (v == null ? '∅' : v) + '|' + Meta.equippedIconPack() + '|' + Settings.lang;
      if (this._cellAria[i] !== ariaKey) {
        this._cellAria[i] = ariaKey;
        el.setAttribute('aria-label', this.cellLabel(i));
      }
    },

    syncAll() { for (let i = 0; i < State.board.length; i++) this.syncCell(i); },
    // Grupo A · A3: sincroniza SOLO las celdas afectadas por un evento. Los eventos de jefe
    // (meteoro/escarcha/cierre) tocan un puñado de celdas pero llamaban a syncAll (barrido de
    // las 64). Un barrido dirigido evita 64 iteraciones por evento sin cambiar el resultado.
    syncCells(list) { for (let k = 0; k < list.length; k++) this.syncCell(list[k]); },

    spawnAnim(i) {
      const el = this.cells[i], g = this.glyphs[i];
      // Limpia un posible estado de "clear" en curso: si un icono aparece en una
      // casilla que se acaba de vaciar (carrera spawn↔convergencia a alta velocidad),
      // el icono nuevo NO debe heredar la animación glyph-out ni quedar invisible.
      el.classList.remove('spawn', 'clear');
      if (!g) return;
      // RS-10 (docs/RENDER_STABILITY_PLAN.md): WAAPI en vez de reiniciar la animación CSS con
      // `void offsetWidth`. Ese reflujo SÍNCRONO se ejecutaba POR CELDA; en un refill masivo
      // (decenas de iconos tras vaciar el tablero) eran decenas de reflujos forzados en un solo
      // frame = layout thrashing y pérdida de frames, especialmente en Safari/iOS. WAAPI arranca
      // sin reflujo, corre en el compositor (transform/opacity) y no depende de FX.cap.
      const anims = g.getAnimations ? g.getAnimations() : null;
      if (anims) anims.forEach((a) => { try { a.cancel(); } catch (_) { } });
      if (typeof g.animate !== 'function') return;
      try {
        g.animate(
          [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: 280, easing: 'cubic-bezier(.2,.9,.3,1.3)' },
        );
      } catch (_) { }
    },
    clearAnim(indices, target) {
      // En una convergencia, FX ya ha clonado la casilla completa (cuerpo + icono).
      // Se retira el contenido real en el mismo tick para que el vuelo se lea como
      // una continuación limpia, sin duplicarlo con glyph-out ni pseudo-bursts.
      // Las limpiezas especiales (sin target) conservan su salida temática propia.
      if (target != null) {
        indices.forEach(i => {
          const el = this.cells[i];
          el.classList.remove('spawn', 'clear');
          el.style.removeProperty('--clear-snap');
          if (State.board[i] === null) {
            el.classList.remove('has-icon');
            el.classList.toggle('empty', !State.tiles[i]);
            this.setGlyph(i, null);
          }
        });
        return;
      }

      const combo = Math.max(1, State.combo || 1);
      const t = clamp((combo - 1) / 19, 0, 1);        // 0..1 ramp sobre combo 1..20
      const snap = (0.45 - t * 0.38).toFixed(2);      // colapso del pop 0.45 → 0.07 (más seco a más combo)
      indices.forEach(i => {
        const el = this.cells[i];
        el.style.setProperty('--clear-snap', snap);
        // El fondo se vacía YA, a la vez que el icono inicia su pop (sin delay): la
        // casilla pasa a 'empty' al instante; el glyph (icono) sigue presente y se
        // borra al terminar la animación de salida. Race-safe: si entre medias
        // aparece un icono nuevo, su syncCell vuelve a poner has-icon.
        if (State.board[i] === null) { el.classList.remove('has-icon'); el.classList.toggle('empty', !State.tiles[i]); }
        el.classList.add('clear');
        let done = false;
        const fin = () => {
          if (done) return; done = true;
          el.classList.remove('clear');
          // Borra el glyph al acabar el pop. Race-safe: si entre medias apareció un
          // icono nuevo (spawn/penalización), board[i]!==null y NO se toca.
          if (State.board[i] === null) this.setGlyph(i, null);
        };
        el.addEventListener('animationend', fin, { once: true });
        // Cinturón: si animationend nunca llega (animación cancelada por cambio de
        // clase, pestaña oculta, animation:none…), la celda NO puede quedarse con un
        // icono fantasma pintado sobre board[i]===null (bug "no desaparece del todo").
        setTimeout(fin, 480);
      });
    },

    // Entrada del relleno post-tablero-limpio: cascada con retardo por celda y gesto
    // propio (brota desde abajo), distinguible del spawn normal (pop) y de la marea
    // de Supervivencia (tide-fill). Solo transform/opacity; `fill:'backwards'`
    // mantiene la ficha invisible durante su delay aunque syncAll ya la haya pintado,
    // de modo que el tablero se VE vacío mientras aterriza el vuelo de convergencia
    // y el relleno se lee como consecuencia del bonus, no como spawns misteriosos.
    refillAnim(i, delay = 0) {
      const el = this.cells[i], g = this.glyphs[i];
      el.classList.remove('spawn', 'clear');
      if (!g) return;
      const anims = g.getAnimations ? g.getAnimations() : null;
      if (anims) anims.forEach((a) => { try { a.cancel(); } catch (_) { } });
      if (typeof g.animate !== 'function') return;
      try {
        g.animate(
          [
            { transform: 'translateY(38%) scale(.35)', opacity: 0 },
            { transform: 'translateY(-6%) scale(1.08)', opacity: 1, offset: 0.72 },
            { transform: 'translateY(0) scale(1)', opacity: 1 },
          ],
          { duration: 430, delay, fill: 'backwards', easing: 'cubic-bezier(.2,.85,.3,1.1)' },
        );
      } catch (_) { }
    },

    miss(i) { const el = this.cells[i]; el.classList.remove('miss'); void el.offsetWidth; el.classList.add('miss'); },

    // RS-10 (docs/RENDER_STABILITY_PLAN.md): iceHit se llama en BUCLE en oleadas de escarcha/
    // meteoro (placed.forEach). El `void offsetWidth` (reflujo síncrono) solo hace falta para
    // RE-disparar la animación sobre una celda que YA la tiene; una celda nueva arranca con
    // solo añadir la clase. Condicionarlo quita el layout thrashing del camino de bucle.
    iceHit(i) {
      const el = this.cells[i];
      if (el.classList.contains('ice-hit')) { el.classList.remove('ice-hit'); void el.offsetWidth; }
      el.classList.add('ice-hit');
      setTimeout(() => el.classList.remove('ice-hit'), 360);
    },
    iceBreak(i) {
      const el = this.cells[i];
      el.classList.remove('ice-hit');
      if (el.classList.contains('ice-shatter')) { el.classList.remove('ice-shatter'); void el.offsetWidth; }
      el.classList.add('ice-shatter');
      setTimeout(() => el.classList.remove('ice-shatter'), 520);
    },
    // RS-4 (docs/RENDER_STABILITY_PLAN.md): tope de pulsos DECORATIVOS de celda simultáneos.
    // En una cascada grande esto se llamaba decenas de veces (cleared.forEach): cada celda
    // que anima promueve a una capa del compositor -> pico de memoria de GPU que en Android
    // hi-dpi (Mi Pad 7) desaloja backing stores y las fichas parpadean a negro. El tope escala
    // con el nivel del gobernador; pasado el tope se omite SOLO el adorno (el estado de la celda
    // ya lo pinta syncCell/syncAll), invisible en cascadas enormes. Además el reflujo síncrono
    // (`void offsetWidth`) solo se fuerza al RE-disparar sobre una celda que ya pulsa: en el
    // camino común de cascada (celda nueva) se evita la tormenta de layout.
    _pulseActive: 0,
    _pulseCap() { const lvl = (Perf && typeof Perf.level === 'number') ? Perf.level : 0; return lvl >= 2 ? 10 : lvl >= 1 ? 18 : 28; },
    cellPulse(i, cls, ms = 700) {
      const el = this.cells[i]; if (!el) return;
      const already = el.classList.contains(cls);
      if (!already && this._pulseActive >= this._pulseCap()) return; // shed decoration under load
      if (already) { el.classList.remove(cls); void el.offsetWidth; }
      else this._pulseActive++;
      el.classList.add(cls);
      setTimeout(() => {
        el.classList.remove(cls);
        if (!already) this._pulseActive = Math.max(0, this._pulseActive - 1);
      }, ms);
    },
    boardEvent(cls, ms = 900) {
      const w = document.querySelector('.board-wrap'); if (!w) return;
      w.classList.remove(cls); void w.offsetWidth; w.classList.add(cls);
      setTimeout(() => w.classList.remove(cls), ms);
    },
    // Terremoto (FBK-04): en vez de teletransportar los iconos (que se leía como
    // "barajado aleatorio"), cada icono SE DESLIZA desde su casilla vieja a la nueva
    // (técnica FLIP, solo transform → compositor). Así se entiende que el temblor
    // ha SACUDIDO el tablero. `srcOf` mapea celda-destino → celda-origen.
    quakeSlide(srcOf) {
      const rects = this.cells.map((c) => c.getBoundingClientRect());
      for (const dest in srcOf) {
        const d = +dest, s = srcOf[dest]; if (s === d) continue;
        const g = this.glyphs[d]; if (!g || !this._cellId[d]) continue;
        const dx = rects[s].left - rects[d].left, dy = rects[s].top - rects[d].top;
        g.getAnimations().forEach((a) => a.cancel());
        g.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 460, easing: 'cubic-bezier(.2,.7,.3,1)' });
      }
    },
    // Ventaja concedida (FBK-09): el icono del booster APARECE en el centro del
    // tablero (donde están los ojos) con chispa dorada y luego "cae" hacia la barra
    // de boosters — deja claro qué has ganado y a dónde ha ido. Antes: invisible (H4).
    _rewardSourcePoint() {
      const anchor = $('.gscore') || $('.score-row') || $('#hud-score');
      if (!anchor) return null;
      const r = anchor.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      const x = Math.min(window.innerWidth - 64, r.right + 36);
      return { x, y: r.top + r.height / 2 };
    },
    _boardCenterPoint() {
      const b = $('#board');
      const r = b && b.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    bossRewardSourcePoint() {
      const anchors = Array.from(document.querySelectorAll('.cell.tile-boss'));
      const pts = anchors.map((el) => {
        const r = el.getBoundingClientRect();
        return r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      }).filter(Boolean);
      if (!pts.length) return this._boardCenterPoint();
      return {
        x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
        y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
      };
    },
    rewardFlyout({ iconMarkup, targetEl, label, amount = '+1', tone = 'gold', sourcePoint = null }) {
      if (motionOff() || !iconMarkup || !targetEl) return;
      const src = sourcePoint || this._rewardSourcePoint();
      const tr = targetEl.getBoundingClientRect();
      if (!src || !tr.width) return;
      const sx = src.x, sy = src.y;
      const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
      const dx = tx - sx, dy = ty - sy;
      const distance = Math.hypot(dx, dy);
      const holdMs = 230;
      const flightMs = Math.round(clamp(520 + distance * 0.30, 640, 860));
      const duration = holdMs + flightMs;
      const launchAt = holdMs / duration;
      const flyAt = (p) => launchAt + (1 - launchAt) * p;
      const lift = clamp(distance * 0.16, 36, 112);
      const swerve = clamp(Math.abs(dx) * 0.07, 12, 34) * (dx < 0 ? -1 : 1);
      const stageTransform = `translate(calc(-50% + ${swerve * -0.25}px), calc(-50% - 16px))`;
      const flyer = document.createElement('span');
      flyer.className = 'grant-flyer reward-flyer-' + tone;
      flyer.setAttribute('aria-hidden', 'true');
      flyer.style.left = sx + 'px';
      flyer.style.top = sy + 'px';
      flyer.innerHTML = `<span class="grant-flyer-card"><span class="grant-flyer-ic">${iconMarkup}</span><span class="grant-flyer-tx"><b>${esc(amount)}</b><small>${esc(label || 'Recompensa')}</small></span></span>`;
      document.body.appendChild(flyer);
      const anim = flyer.animate([
        { transform: 'translate(-50%, -50%) scale(.48) rotate(-10deg)', opacity: 0 },
        { transform: `${stageTransform} scale(1.2) rotate(${dx < 0 ? -8 : 8}deg)`, opacity: 1, offset: Math.min(.14, launchAt * .58) },
        { transform: `${stageTransform} scale(1.08) rotate(${dx < 0 ? -4 : 4}deg)`, opacity: 1, offset: launchAt },
        { transform: `translate(calc(-50% + ${dx * .22 + swerve}px), calc(-50% + ${dy * .12 - lift}px)) scale(1.04) rotate(${dx < 0 ? -12 : 12}deg)`, opacity: 1, offset: flyAt(.26) },
        { transform: `translate(calc(-50% + ${dx * .76}px), calc(-50% + ${dy * .70 - lift * .28}px)) scale(.76) rotate(${dx < 0 ? -5 : 5}deg)`, opacity: 1, offset: flyAt(.76) },
        { transform: `translate(calc(-50% + ${dx * .98}px), calc(-50% + ${dy * .98 - 3}px)) scale(.42) rotate(0deg)`, opacity: .95, offset: flyAt(.94) },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.24) rotate(0deg)`, opacity: 0 },
      ], { duration, easing: 'cubic-bezier(.16,.86,.18,1)' });
      const landTimer = setTimeout(() => {
        if (!targetEl.isConnected) return;
        targetEl.classList.remove('reward-land');
        void targetEl.offsetWidth;
        targetEl.classList.add('reward-land');
        setTimeout(() => targetEl.classList.remove('reward-land'), 460);
      }, Math.max(120, duration - 120));
      anim.finished.catch(() => { }).then(() => { clearTimeout(landTimer); flyer.remove(); });
      return duration;
    },
    grantPop(token, targetId, label) {
      const target = document.querySelector(`.booster[data-b="${targetId}"]`);
      const targetIcon = target && (target.querySelector('.b-ic') || target);
      if (!targetIcon) return;
      return this.rewardFlyout({
        iconMarkup: targetIcon.innerHTML || iconAnyInline(token),
        targetEl: targetIcon,
        label: label || 'Poder',
        amount: '+1',
        tone: 'power',
      });
    },
    coinsReward(amount, label, _sourcePoint) {
      amount = Math.max(0, amount | 0);
      if (!amount) return;
      const coinNum = $('#hud-coins');
      const target = (coinNum && coinNum.parentElement) || coinNum;
      if (!target) return;
      this.scoreFeedback('+' + fmtNum(amount) + ' ' + (label || I18n.t('coins')), 'var(--gold)', 'coins');
      this.bump(target);
      return 0;
    },
    // Pérdida de vida (FBK-10): los corazones del HUD reaccionan como DAÑO (sacudida
    // + destello rojo), reforzando que ha sido malo (no lo celebra el marco dorado).
    livesHit() {
      const el = $('#surv-lives'); if (!el) return;
      el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
      setTimeout(() => el.classList.remove('hit'), 640);
    },
    impact(tier = 1) {
      if (Settings.reducedFx) return;
      const cls = tier >= 3 ? 'impact-heavy' : tier >= 2 ? 'impact-mid' : 'impact-soft';
      this.boardEvent(cls, tier >= 3 ? 360 : 260);
    },
    lifeClear(indices, frame = 'life-blast') {
      if (frame) this.boardEvent(frame, 900);   // frame=null → el llamador ya puso su marco (p. ej. daño rojo)
      indices.forEach(i => this.cellPulse(i, 'life-cleared', 820));
    },
    meteor(indices) { indices.forEach(i => this.cellPulse(i, 'surv-meteor', 820)); },
    boosterPulse(id) {
      this.boardEvent('boost-' + id, id === 'freeze' || id === 'x2' ? 1100 : 780);
      const b = document.querySelector(`.booster[data-b="${id}"]`);
      if (b) { b.classList.remove('fired'); void b.offsetWidth; b.classList.add('fired'); setTimeout(() => b.classList.remove('fired'), 520); }
    },
    boosterReady(id, token, label) {
      const b = document.querySelector(`.booster[data-b="${id}"]`);
      if (b) {
        b.classList.remove('just-granted', 'grant-incoming');
        clearTimeout(b._grantTimer);
        const oldTag = b.querySelector('.earned-tag');
        if (oldTag) oldTag.remove();
        const count = b.querySelector('.b-count');
        if (count) count.classList.remove('count-pop');
        let flyMs = 0;
        const hudOnly = State.status === 'playing' || State.status === 'paused';
        if (!motionOff() && token && !hudOnly) {
          b.classList.add('grant-incoming');
          flyMs = this.grantPop(token, id, label) || 0;
        }
        const land = () => {
          b.classList.remove('grant-incoming');
          b.classList.add('just-granted');
          let tag = b.querySelector('.earned-tag');
          if (!tag) { tag = document.createElement('span'); tag.className = 'earned-tag'; b.appendChild(tag); }
          tag.textContent = '+1';
          if (count) { count.classList.remove('count-pop'); void count.offsetWidth; count.classList.add('count-pop'); }
        };
        if (motionOff() || hudOnly) land(); else setTimeout(land, Math.max(360, flyMs - 80));
        b._grantTimer = setTimeout(() => {
          b.classList.remove('just-granted', 'grant-incoming');
          if (count) count.classList.remove('count-pop');
          const tag = b.querySelector('.earned-tag');
          if (tag && tag.parentNode === b) tag.remove();
        }, motionOff() ? 900 : Math.max(1250, flyMs + 760));
      }
    },

    hint(indices, on) { indices.forEach(i => this.cells[i].classList.toggle('hint', on)); },

    initScoreFeedback() {
      const host = $('#score-feedback');
      if (!host) return;
      this.scoreFeedbackEl = host;
      if (this.scoreFeedbackPool.length) return;
      host.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const p = document.createElement('span');
        p.className = 'score-fx';
        host.appendChild(p);
        this.scoreFeedbackPool.push(p);
      }
    },
    scoreFeedback(text, color, tone = 'points') {
      if (!text) return;
      if (!this.scoreFeedbackPool.length) this.initScoreFeedback();
      if (!this.scoreFeedbackPool.length) return;
      const p = this.scoreFeedbackPool[this.scoreFeedbackNext = (this.scoreFeedbackNext + 1) % this.scoreFeedbackPool.length];
      p.textContent = text;
      p.dataset.tone = tone;
      p.style.color = color || '#fff';
      clearTimeout(p._t);
      p.getAnimations().forEach((a) => a.cancel());
      const rank = tone === 'rank';
      if (Settings.reducedFx) {
        p.style.opacity = '1';
        p.style.transform = 'translate(-50%, -12px)';
        p._t = setTimeout(() => { p.style.opacity = '0'; }, rank ? 900 : 760);
        return;
      }
      const anim = p.animate(rank ? [
        { opacity: 0, transform: 'translate(-50%, 6px) scale(.72)' },
        { opacity: 1, transform: 'translate(-50%, -10px) scale(1.08)', offset: .24 },
        { opacity: 0, transform: 'translate(-50%, -34px) scale(.98)' },
      ] : [
        { opacity: 0, transform: 'translate(-50%, 2px) scale(.82)' },
        { opacity: 1, transform: 'translate(-50%, -8px) scale(1)', offset: .18 },
        { opacity: 0, transform: 'translate(-50%, -28px) scale(.96)' },
      ], { duration: rank ? 900 : 760, easing: 'ease-out', fill: 'forwards' });
      if (anim && anim.finished) anim.finished.then(() => { p.style.opacity = '0'; anim.cancel(); }).catch(() => { });
    },
    // Compatibilidad con los productores existentes: el índice ya no posiciona
    // texto sobre una celda; todo se agrega alrededor de la puntuación.
    popup(_i, text, color) {
      this.scoreFeedback(text, color, 'points');
    },

    bump(el) { el.getAnimations().forEach(a => a.cancel()); el.animate([{}, { transform: 'scale(1.18)', color: '#ffd84d', offset: .5 }, {}], { duration: 300, easing: 'ease' }); },

    // Un único marcador sirve a todos los modos. En Supervivencia se monta dentro
    // del pie de estado; al cambiar de modo vuelve a su slot normal. appendChild
    // mueve el nodo real, por lo que conserva IDs, listeners y el pool de feedback.
    mountScoreRow(inSurvival) {
      const row = $('#hud-score-row');
      const normalSlot = $('#hud-score-slot');
      const survivalFooter = $('#surv-footer');
      const target = inSurvival ? survivalFooter : normalSlot;
      if (!row || !normalSlot || !survivalFooter || !target) return;
      if (row.parentNode !== target) target.appendChild(row);
      normalSlot.hidden = !!inSurvival;
    },

    hud() {
      $('#hud-score').textContent = fmtNum(State.displayScore);
      $('#hud-level').textContent = State.level;
      $('#hud-best').textContent = fmtNum(Storage.best);
      const runCoins = $('#hud-run-coins');
      const runWrap = $('#hud-run-coins-wrap');
      if (runCoins) runCoins.textContent = fmtSigned(State.coinsRun || (State.mode === 'supervivencia' ? Survival.runCoins : 0));
      if (runWrap) runWrap.hidden = State.mode === 'supervivencia' || !(State.coinsRun > 0);
      refreshXpBoostIndicators();

      const isZen = State.mode === 'zen';
      const bestWrap = $('#hud-best-wrap');
      const zenWrap = $('#hud-zen-wrap');
      if (bestWrap) bestWrap.hidden = isZen || State.mode === 'supervivencia';
      if (zenWrap) {
        zenWrap.hidden = !isZen;
        if (isZen) {
          const fl = Meta.zenFlowers();
          let text = fl;
          if (fl < 10) text = `${fl}/10 🎁`;
          else if (fl < 50) text = `${fl}/50 🖼️`;
          $('#hud-zen-flowers').textContent = text;
        }
      }

      $('#hud-speed').textContent = (State.spawnRate / 1000).toFixed(1) + 's';
      const timeEl = $('#hud-time');
      const timed = Config.MODES[State.mode].timed;
      timeEl.textContent = timed ? fmtTime(State.timeLeft) : fmtTime(State.elapsed);
      const pressure = timed && State.status === 'playing' ? (State.timeLeft <= 10 ? 2 : State.timeLeft <= 20 ? 1 : 0) : 0;
      if (pressure !== State.timePressure) {
        State.timePressure = pressure;
        document.body.classList.toggle('time-pressure', pressure > 0);
        document.body.classList.toggle('time-critical', pressure === 2);
        if (pressure === 2) {
          this.boardEvent('time-pressure', 520); Sound.danger();
          // Sprint final (GM-10): anunciar el ×1.5 al entrar en zona crítica. Con
          // throttle: cabalgar el borde hace oscilar la presión y no debe spamear.
          const now = performance.now();
          if (Config.MODES[State.mode].scoreAttack && now - State.sprintToastAt > 6000) {
            State.sprintToastAt = now;
            Toasts.show(I18n.t('sprint_on'), 'warn', 1700, 'fire');
          }
        }
      }
      if (timeEl.parentElement) timeEl.parentElement.classList.toggle('urgent', pressure === 2);
      // Ghost personal (GM-12): ¿vas por delante o por detrás de tu mejor intento?
      {
        const gEl = $('#hud-ghost');
        if (gEl) {
          let show = false;
          if (Config.MODES[State.mode].scoreAttack && State.status === 'playing' && State.elapsed >= 10) {
            const ref = State.isDaily ? Meta.dailyGhost() : Meta.modeGhost(State.mode);
            if (ref && ref.length) {
              const gi = Math.min(ref.length - 1, Math.max(0, Math.floor(State.elapsed / 10) - 1));
              const diff = State.score - ref[gi];
              gEl.textContent = (diff >= 0 ? '▲ +' : '▼ −') + Math.abs(diff);
              gEl.classList.toggle('up', diff >= 0);
              show = true;
            }
          }
          gEl.hidden = !show;
        }
      }
      // Barra de ocupación = medidor de peligro (cuanto más llena, peor)
      const occ = Engine.occupation();
      // HUD-Z3: en Zen el tablero lleno se despeja solo (sin derrota), así que no hay
      // "peligro": el medidor se mantiene neutro (nada de ámbar/rojo ni sonido de alarma).
      const dl = State.mode === 'zen' ? 0 : (occ >= 85 ? 2 : occ >= 65 ? 1 : 0);
      this.contextBar(occ, dl);

      this.danger(dl);
      if (dl === 2 && State.status === 'playing') {
        const t = performance.now();
        if (t - State.lastDangerAt > 900) { State.lastDangerAt = t; Sound.danger(); Haptics.fire(24, 'light'); }
      }
      // Pistas
      ['hint-badge', 'hint-badge-tool'].forEach((id) => { const el = $('#' + id); if (el) el.textContent = fmtNum(State.hintsLeft); });
      const hintDisabled = State.hintsLeft <= 0 || performance.now() < State.hintReadyAt;
      const hintUnavailable = State.isDaily && State.dailyMut === 'nohints';
      ['btn-hint', 'btn-hint-tool'].forEach((id) => {
        const el = $('#' + id); if (!el) return;
        el.disabled = hintDisabled;
        el.hidden = hintUnavailable;
      });
      this.multChip();
      this.hero();
    },
    // Héroe del marcador (HUD-X3): resuelve la ÚNICA métrica dominante del modo y la
    // pinta grande en el centro, degradando la puntuación a línea secundaria. Si el
    // modo no tiene objetivo-héroe (Supervivencia, Zen), devuelve null y manda el score.
    hero() {
      const wrap = $('#hud-hero');
      const gscore = document.querySelector('.gscore');
      if (!wrap || !gscore) return;
      const info = this._heroInfo();
      const on = !!info;
      gscore.classList.toggle('hero-on', on);
      wrap.hidden = !on;
      if (!on) { wrap.classList.remove('urgent'); return; }
      const valEl = $('#hud-hero-val');
      if (valEl && valEl.textContent !== String(info.val)) valEl.textContent = info.val;
      const subEl = $('#hud-hero-sub');
      if (subEl) { subEl.hidden = !info.sub; if (info.sub) subEl.textContent = info.sub; }
      const barEl = $('#hud-hero-bar');
      if (barEl) {
        const hasBar = info.frac != null;
        barEl.hidden = !hasBar;
        if (hasBar) { const f = $('#hud-hero-bar-fill'); if (f) f.style.width = (clamp(info.frac, 0, 1) * 100).toFixed(1) + '%'; }
      }
      wrap.classList.toggle('urgent', !!info.urgent);
      // Acento del héroe: el color del objetivo cambia con el modo (--mode-accent).
    },
    // Resuelve {val, sub?, frac?, urgent?} o null. val es texto/numero ya formateado.
    _heroInfo() {
      const mode = State.mode;
      if (mode === 'clasico') {
        const n = State.iconCount;
        return { val: n, sub: I18n.t('hud_remaining'), urgent: n > 0 && n <= 5 };
      }
      if (mode === 'aventura') return Adventure.heroInfo ? Adventure.heroInfo() : null;
      if (Config.MODES[mode] && Config.MODES[mode].timed) {
        const t = fmtTime(State.timeLeft);
        const urgent = State.timePressure === 2;
        if (State.isDaily) {
          const next = ModeSignals.dailyNextMedalInfo(State.score);
          if (next) {
            const meds = Meta.DAILY_MEDALS, idx = meds.indexOf(next.threshold);
            const prev = idx > 0 ? meds[idx - 1] : 0;
            const frac = (State.score - prev) / (next.threshold - prev);
            return { val: t, sub: next.icon + ' ' + fmtNum(State.score) + ' / ' + fmtNum(next.threshold), frac, urgent };
          }
          return { val: t, sub: ModeSignals.dailyMedalIcon('gold') + ' ' + I18n.t('daily_medal_max'), urgent };
        }
        return { val: t, urgent };
      }
      return null; // Supervivencia y Zen: manda la puntuación (score-main)
    },
    // Desglose del multiplicador (HUD-S4): responde "¿de dónde sale mi ×3,4?".
    // Información de CONSULTA (no de combate): se muestra al tocar el marcador.
    _multFmt(f) { return '×' + (f % 1 === 0 ? f : +f.toFixed(2)); },
    multBreakdown() {
      const parts = [];
      const add = (key, f) => { if (f > 1.001) parts.push(I18n.t('mult_breakdown_' + key) + ' ' + this._multFmt(f)); };
      add('combo', State.comboMult);
      add('fever', Game.feverBoost());
      add('frenzy', State.tempMult || 1);
      add('sprint', Game.sprintMult());
      if (State.mode === 'supervivencia') add('boon', Survival.scoreMult());
      const total = State.comboMult * Game.feverBoost() * (State.tempMult || 1) * Game.sprintMult()
        * (State.mode === 'supervivencia' ? Survival.scoreMult() : 1);
      return { parts, total };
    },
    _mbdT: 0,
    toggleMultBreakdown() {
      const el = $('#mult-bd'); if (!el) return;
      if (State.mode === 'zen' || State.mode === 'tutorial') return; // HUD minimalista
      if (!el.hidden) { el.hidden = true; return; }
      const { parts, total } = this.multBreakdown();
      if (total <= 1.001 || !parts.length) return; // nada relevante que desglosar
      el.innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join('')
        + `<span class="mbd-total">${esc(I18n.t('mult_breakdown_total') + ' ' + this._multFmt(total))}</span>`;
      el.hidden = false;
      clearTimeout(this._mbdT);
      this._mbdT = setTimeout(() => { if (el) el.hidden = true; }, 4200);
    },
    // Chip del multiplicador TOTAL (combo × fiebre × temporal): un único número
    // legible junto al score que responde "¿por cuánto vale ahora cada jugada?" (GM-16).
    _lastMult: 1,
    _multRiseTimer: 0,
    multChip() {
      const el = $('#hud-mult'); if (!el) return;
      if (el.hidden) el.hidden = false;
      el.removeAttribute('hidden');
      el.style.removeProperty('display');
      // Incluye el multiplicador de bendiciones de Supervivencia (Survival.scoreMult):
      // el chip debe mostrar EXACTAMENTE lo que multiplica cada jugada.
      const v = State.comboMult * Game.feverBoost() * (State.tempMult || 1) * Game.sprintMult()
        * (State.mode === 'supervivencia' ? Survival.scoreMult() : 1);
      const txt = '×' + (v % 1 === 0 ? v : +v.toFixed(1));
      const on = v > 1.001 && State.status === 'playing';
      const tier = !on ? 0 : v >= 8 ? 5 : v >= 6 ? 4 : v >= 4 ? 3 : v >= 2 ? 2 : 1;
      if (el.textContent !== txt) {
        el.textContent = txt;
        if (on && v > this._lastMult && !Settings.reducedFx) {
          el.classList.remove('rising');
          void el.offsetWidth;
          el.classList.add('rising');
          clearTimeout(this._multRiseTimer);
          this._multRiseTimer = setTimeout(() => el.classList.remove('rising'), 460);
        }
      }
      el.classList.toggle('on', on);
      for (let i = 1; i <= 5; i++) el.classList.toggle('tier-' + i, tier === i);
      el.classList.toggle('hot', on && v >= 6);
      if (!on) {
        clearTimeout(this._multRiseTimer);
        el.classList.remove('rising');
      }
      this._lastMult = v;
    },
    // Coalescer: marca el HUD como "sucio"; el bucle lo refresca UNA vez por frame.
    // Evita rehacer occupation()+~10 escrituras del DOM en cada tap durante combos
    // rápidos (lo que saturaba el hilo principal en iOS).
    _hudDirty: false,
    hudSoon() { this._hudDirty = true; },

    penalty(indices) {
      indices.forEach(i => {
        this.syncCell(i); this.spawnAnim(i);
        const el = this.cells[i];
        el.classList.add('penalty');
        setTimeout(() => el.classList.remove('penalty'), 1400);
      });
    },
    boardShake() {
      const w = document.querySelector('.board-wrap');
      w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');
      setTimeout(() => w.classList.remove('shake'), 320);
    },

    combo() {
      this.multChip();
      const el = $('#hud-mult');
      if (el && State.combo < 3) el.classList.remove('expiring');
    },
    comboRing(frac) {
      const el = $('#hud-mult');
      if (el) el.classList.toggle('expiring', State.combo >= 3 && frac < 0.24);
    },

    // La presentación del jefe usa el mismo centro de eventos que el resto del HUD.
    bossCard(title, sub, icon, ariaLabel) {
      Toasts.event({
        key: 'boss-enter', kicker: I18n.t('hud_event_boss'), title, detail: sub,
        icon: icon || 'skull', kind: 'bad', priority: 100, ms: 2400, ariaLabel,
      });
    },
    // El rango se celebra alrededor de la puntuación, sin tapar la jugada.
    rankFlash(text, color) {
      this.scoreFeedback(text, color || '#fff', 'rank');
    },
    // Activar/desactivar el aura de Fever
    fever(on) {
      const f = $('#fever'); if (f) f.classList.toggle('on', on);
      // Clase en el propio tablero (no en <body>): evita invalidar el árbol entero.
      const w = document.querySelector('.board-wrap'); if (w) w.classList.toggle('fever-on', on);
      // El aro de combo "arde" mientras dura la Fiebre (GM-27).
      const c = $('#combo'); if (c && c.classList) c.classList.toggle('fever', on);
    },
    // Entrada en Fiebre (GM-27): zoom + barrido de acento del tablero, una sola vez.
    feverBurst() {
      if (Settings.reducedFx) return;
      const w = document.querySelector('.board-wrap'); if (!w) return;
      w.classList.remove('fever-burst'); void w.offsetWidth; w.classList.add('fever-burst');
      setTimeout(() => w.classList.remove('fever-burst'), 640);
    },
    // Salida de Fiebre (GM-27): "exhalación" breve (desaturación de vuelta a la calma).
    feverOut() {
      if (Settings.reducedFx) return;
      const w = document.querySelector('.board-wrap'); if (!w) return;
      w.classList.remove('fever-out'); void w.offsetWidth; w.classList.add('fever-out');
      setTimeout(() => w.classList.remove('fever-out'), 360);
    },
    // Destello breve de pantalla (récord / perfecto)
    flash() {
      if (Settings.reducedFx) return;
      const el = $('#flash'); if (!el) return;
      el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    },
    _contextSig: '',
    contextBar(occ, dangerLevel) {
      const bar = $('#hud-context-bar'), fill = $('#hud-progress-fill');
      const labelEl = $('#occ-label'), textEl = $('#occ-text'), iconEl = $('#occ-icon'), valueEl = $('#occ-percent');
      if (!bar || !fill || !labelEl || !textEl || !iconEl || !valueEl) return;
      const now = performance.now();
      const dangerChannel = State.mode === 'supervivencia' || dangerLevel > 0;
      let type = dangerChannel ? 'danger' : 'board';
      let label = I18n.t(dangerChannel ? 'hud_danger' : 'hud_board_fill');
      let value = Math.round(occ) + '%';
      let frac = clamp(occ / 100, 0, 1);
      let icon = dangerChannel ? '8-ui/exclamation' : '8-ui/grid';

      if (State.mode === 'zen') {
        type = 'zen'; label = I18n.t('hud_ctx_zen'); value = Math.round(occ) + '%';
        frac = clamp(occ / 100, 0, 1); icon = '4-nature/flower';
      } else if (Config.MODES[State.mode] && Config.MODES[State.mode].timed
        && dangerLevel === 0 && State.timePressure > 0) {
        type = 'time'; label = I18n.t('hud_ctx_time'); value = fmtTime(State.timeLeft);
        frac = clamp(State.timeLeft / 20, 0, 1); icon = '9-media/clock';
      } else if (State.mode === 'supervivencia') {
        const enc = Bosses.enc;
        if (enc && enc.kind === 'boss' && !enc.resolved) {
          if (enc.phase > 1 && dangerLevel === 0 && now < (enc.phaseContextUntil || 0)) {
            type = 'boss'; label = I18n.t('hud_ctx_boss_rage'); value = I18n.t('hud_phase_short').replace('{n}', enc.phase);
            frac = clamp(enc.anchorsLeft / Math.max(1, enc.anchorsMax), 0, 1); icon = '1-game/skull';
          }
        }
        if (type !== 'boss' && dangerLevel > 0) {
          type = 'danger'; label = I18n.t('hud_danger'); value = Math.round(occ) + '%';
          frac = clamp(occ / 100, 0, 1); icon = '8-ui/exclamation';
        } else if (type !== 'boss' && dangerLevel === 0
          && !(Toasts._evActive && /^wave-/.test(Toasts._evActive.key))
          && Survival.waveAcc / Math.max(1, Survival.WAVE_MS) >= .78) {
          const remaining = Math.max(0, Survival.WAVE_MS - Survival.waveAcc);
          type = 'wave'; label = I18n.t('hud_ctx_wave'); value = Math.ceil(remaining / 1000) + 's';
          frac = clamp(remaining / (Survival.WAVE_MS * .22), 0, 1); icon = '9-media/clock';
        } else if (type !== 'boss' && dangerLevel === 0 && Survival.x2Until > now) {
          const remaining = Survival.x2Until - now;
          type = 'boost'; label = I18n.t('hud_ctx_double'); value = Math.ceil(remaining / 1000) + 's';
          frac = clamp(remaining / 11000, 0, 1); icon = '4-nature/lightning';
        } else if (type !== 'boss' && dangerLevel === 0 && Survival.freezeUntil > now) {
          const remaining = Survival.freezeUntil - now;
          type = 'cold'; label = I18n.t('hud_ctx_freeze'); value = Math.ceil(remaining / 1000) + 's';
          frac = clamp(remaining / 7000, 0, 1); icon = '4-nature/snowflake';
        } else if (type !== 'boss' && dangerLevel === 0 && Survival.frenzyActive()) {
          const remaining = Math.max(0, Survival.frenzyUntil - now);
          type = 'frenzy'; label = I18n.t('hud_ctx_frenzy'); value = Math.ceil(remaining / 1000) + 's';
          frac = clamp(remaining / 10000, 0, 1); icon = '4-nature/fire';
        }
      }

      const sig = [type, label, value, Math.round(frac * 100)].join('|');
      if (sig === this._contextSig) return;
      this._contextSig = sig;
      bar.dataset.context = type;
      bar.setAttribute('aria-label', label + ' ' + value);
      textEl.removeAttribute('data-i18n');
      textEl.textContent = label;
      valueEl.textContent = value;
      iconEl.style.setProperty('--icv2-url', "url('img/icons-v2/" + icon + ".svg')");
      labelEl.classList.toggle('warn', type === 'wave' || (type === 'danger' && dangerLevel === 1));
      labelEl.classList.toggle('danger', type === 'boss' || (type === 'danger' && dangerLevel === 2));
      ['warn', 'danger', 'context-board', 'context-boss', 'context-wave', 'context-boost', 'context-cold', 'context-frenzy', 'context-time', 'context-zen'].forEach((c) => fill.classList.remove(c));
      if (type === 'danger' && dangerLevel > 0) fill.classList.add(dangerLevel === 2 ? 'danger' : 'warn');
      else if (type !== 'danger') fill.classList.add('context-' + type);
      fill.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
    },
    // Pulso de peligro del tablero según ocupación
    danger(level) { // 0 ninguno, 1 warn, 2 danger
      const w = document.querySelector('.board-wrap'); if (!w) return;
      w.classList.toggle('warn', level === 1);
      w.classList.toggle('danger', level === 2);
    },
  };

  /* ===================== Toasts y lector de pantalla ===================== */
  const announce = (msg) => { $('#sr-status').textContent = msg; };
  // Variante con throttle para eventos de juego frecuentes (convergencias): evita saturar
  // al lector de pantalla en cadenas rápidas. Los hitos importantes usan announce() directo.
  let _srLast = 0;
  const announceGame = (msg, ms = 1400) => { const t = Date.now(); if (t - _srLast < ms) return; _srLast = t; announce(msg); };
  const Toasts = {
    ICON: { info: 'info', good: 'check', warn: 'warning', bad: 'close' },
    MAX_QUEUE: 6,
    _evQ: [], _evActive: null, _seq: 0, _timer: 0, _transitionTimer: 0,
    _idleTimer: 0, _idleIndex: 0, _finishing: false, _paused: false, _pausedAt: 0,
    _narratedEncounters: new WeakSet(),
    _later(fn, ms) {
      const timer = setTimeout(fn, ms);
      if (timer && typeof timer.unref === 'function') timer.unref();
      return timer;
    },
    _priority(kind, isEvent) {
      const base = { info: 40, good: 50, warn: 60, bad: 80 }[kind] || 40;
      return isEvent ? Math.max(70, base) : base;
    },
    _normalize(msg, kind, ms, iconArg, onClick, isEvent) {
      const data = msg && typeof msg === 'object' ? msg : {};
      let title = data.title != null ? String(data.title) : String(msg == null ? '' : msg);
      let icon = data.icon != null ? data.icon : iconArg;
      kind = data.kind || kind || 'info';
      ms = Math.max(500, data.ms || ms || (isEvent ? 2200 : 2800));
      if (icon == null && title) {
        const match = title.match(/^(\p{Extended_Pictographic}️?)\s+/u);
        if (match) { icon = match[1]; title = title.slice(match[0].length); }
      }
      icon = icon != null ? icon : (this.ICON[kind] || '');
      const detail = data.detail != null ? String(data.detail) : '';
      const kicker = data.kicker != null ? String(data.kicker) : '';
      const action = data.onClick || onClick;
      const liveExpiry = State.status === 'playing' && !action
        ? Date.now() + Math.max(isEvent ? 5000 : 2600, ms * (isEvent ? 2.4 : 1.6))
        : 0;
      return {
        key: data.key || [kicker, title, detail].join('|'), title, detail, kicker,
        kind, ms, icon, onClick: action, event: data.event != null ? !!data.event : !!isEvent,
        idle: !!data.idle, priority: data.priority != null ? +data.priority : this._priority(kind, isEvent),
        expiresAt: data.expiresAt === false ? 0 : (data.expiresAt || liveExpiry), count: Math.max(1, data.count || 1), seq: ++this._seq,
        ariaLabel: data.ariaLabel ? String(data.ariaLabel) : '', onStart: data.onStart, onFinish: data.onFinish,
        remaining: ms, startedAt: 0,
      };
    },
    show(msg, kind = 'info', ms = 2800, iconArg, onClick) {
      return this._enqueue(this._normalize(msg, kind, ms, iconArg, onClick, false));
    },
    event(msg, kind = 'info', ms = 2200, iconArg) {
      return this._enqueue(this._normalize(msg, kind, ms, iconArg, null, true));
    },
    _enqueue(item) {
      if (!item.title || (item.expiresAt && item.expiresAt <= Date.now())) return false;
      clearTimeout(this._idleTimer); this._idleTimer = 0;
      if (this._evActive && this._evActive.key === item.key) {
        // Un productor puede seguir notificando mientras su estado permanece activo
        // (jefe, aviso de oleada, modificador...). La misma clave representa el mismo
        // evento semántico: no se vuelve a anunciar ni se reinicia su temporizador.
        return false;
      }
      const queued = this._evQ.find((it) => it.key === item.key);
      if (queued) return false;
      this._evQ.push(item);
      this._sortQueue();
      while (this._evQ.length > this.MAX_QUEUE) this._evQ.pop();
      if (this._evActive && item.priority > this._evActive.priority) this._finishActive(true);
      else this._pumpEv();
      return true;
    },
    _sortQueue() { this._evQ.sort((a, b) => b.priority - a.priority || a.seq - b.seq); },
    _render(item) {
      const card = $('#hud-event-center'); if (!card) return;
      const iconEl = $('#hud-event-icon'), kickerEl = $('#hud-event-kicker');
      const titleEl = $('#hud-event-title'), detailEl = $('#hud-event-detail');
      const countEl = $('#hud-event-count'), progressEl = $('#hud-event-progress');
      card.hidden = false;
      document.body.classList.add('hud-event-active');
      card.classList.remove('info', 'good', 'warn', 'bad', 'event', 'idle', 'out', 'pop', 'actionable');
      card.classList.add(item.kind);
      if (item.event) card.classList.add('event');
      if (item.idle) card.classList.add('idle');
      card.dataset.msg = item.title; card.dataset.priority = String(item.priority);
      card.setAttribute('aria-label', item.ariaLabel || [item.kicker, item.title, item.detail].filter(Boolean).join('. '));
      if (iconEl) {
        iconEl.hidden = !item.icon; iconEl.innerHTML = ''; iconEl.textContent = '';
        if (item.icon) {
          const token = EMOJI_IMG[item.icon] || (/^(v2:)?[a-z][a-z0-9-]*$/.test(item.icon) ? item.icon : null);
          if (token) iconEl.innerHTML = iconAny(token); else iconEl.textContent = item.icon;
        }
      }
      if (kickerEl) { kickerEl.hidden = !item.kicker; kickerEl.textContent = item.kicker; }
      if (titleEl) titleEl.textContent = item.title;
      if (detailEl) { detailEl.hidden = !item.detail; detailEl.textContent = item.detail; }
      if (countEl) { countEl.hidden = item.count <= 1; countEl.textContent = '×' + item.count; }
      if (progressEl) {
        progressEl.hidden = Settings.reducedFx || !item.event;
        progressEl.style.animation = 'none'; void progressEl.offsetWidth;
        progressEl.style.animationDuration = item.remaining + 'ms';
        progressEl.style.removeProperty('animation');
        progressEl.style.animationPlayState = this._paused ? 'paused' : 'running';
      }
      card.onclick = null;
      if (typeof item.onClick === 'function') {
        card.classList.add('actionable');
        card.onclick = () => { const fn = item.onClick; this._finishActive(true); fn(); };
      }
    },
    _startTimer(item) {
      clearTimeout(this._timer); this._timer = 0;
      if (this._paused || item !== this._evActive) return;
      item.startedAt = Date.now();
      this._timer = this._later(() => this._finishActive(false), Math.max(1, item.remaining));
    },
    _pumpEv() {
      if (this._paused || this._finishing || this._evActive) return;
      let item = this._evQ.shift();
      while (item && item.expiresAt && item.expiresAt <= Date.now()) item = this._evQ.shift();
      if (!item) { this._scheduleIdle(); return; }
      this._evActive = item;
      this._render(item);
      if (typeof item.onStart === 'function') {
        try { item.onStart(); } catch (err) { console.error('HUD event start failed', err); }
      }
      this._startTimer(item);
    },
    _finishActive(interrupted) {
      if (!this._evActive || this._finishing) return;
      clearTimeout(this._timer); this._timer = 0;
      const finished = this._evActive;
      this._evActive = null; this._finishing = true;
      const card = $('#hud-event-center');
      if (card && !Settings.reducedFx && !interrupted) card.classList.add('out');
      const delay = card && !Settings.reducedFx && !interrupted ? 180 : 0;
      clearTimeout(this._transitionTimer);
      this._transitionTimer = this._later(() => {
        if (card) { card.hidden = true; card.classList.remove('out', 'pop'); card.onclick = null; }
        document.body.classList.remove('hud-event-active');
        this._finishing = false;
        if (!interrupted && typeof finished.onFinish === 'function') {
          try { finished.onFinish(); } catch (err) { console.error('HUD event finish failed', err); }
        }
        this._pumpEv();
      }, delay);
    },
    pause() {
      if (this._paused) return;
      this._paused = true; this._pausedAt = Date.now();
      if (this._evActive && this._timer) {
        this._evActive.remaining = Math.max(1, this._evActive.remaining - (Date.now() - this._evActive.startedAt));
        clearTimeout(this._timer); this._timer = 0;
      }
      const progress = $('#hud-event-progress'); if (progress) progress.style.animationPlayState = 'paused';
    },
    resume() {
      if (!this._paused) return;
      const pausedFor = this._pausedAt ? Math.max(0, Date.now() - this._pausedAt) : 0;
      this._paused = false; this._pausedAt = 0;
      if (pausedFor) this._evQ.forEach((item) => { if (item.expiresAt) item.expiresAt += pausedFor; });
      const progress = $('#hud-event-progress'); if (progress) progress.style.animationPlayState = 'running';
      if (this._evActive) this._startTimer(this._evActive); else this._pumpEv();
    },
    reset() {
      clearTimeout(this._timer); clearTimeout(this._transitionTimer); clearTimeout(this._idleTimer);
      this._timer = this._transitionTimer = this._idleTimer = 0;
      this._evQ = []; this._evActive = null; this._finishing = false; this._paused = false; this._pausedAt = 0;
      this._narratedEncounters = new WeakSet();
      const card = $('#hud-event-center');
      if (card) { card.hidden = true; card.classList.remove('out', 'pop', 'actionable'); card.onclick = null; }
      document.body.classList.remove('hud-event-active');
    },
    _idleItem() {
      if (State.mode !== 'supervivencia' || State.status !== 'playing') return null;
      const activeBoss = Bosses.enc && Bosses.enc.kind === 'boss' && !Bosses.enc.resolved ? Bosses.enc : null;
      if (activeBoss) {
        if (this._narratedEncounters.has(activeBoss)) return null;
        this._narratedEncounters.add(activeBoss);
        const def = Bosses.DEX[activeBoss.id] || {};
        return this._normalize({
          key: 'idle-boss-narrator-' + activeBoss.id,
          kicker: Bosses.name(activeBoss.id),
          title: I18n.t('hud_narr_' + activeBoss.id),
          icon: def.icon || 'skull', kind: 'bad', priority: 24, ms: 1900, idle: true,
        }, 'bad', 1900, def.icon, null, false);
      }
      return null;
    },
    _scheduleIdle() {
      clearTimeout(this._idleTimer); this._idleTimer = 0;
      if (State.mode !== 'supervivencia' || State.status !== 'playing') return;
      this._idleTimer = this._later(() => {
        this._idleTimer = 0;
        if (this._evActive || this._evQ.length || this._paused) return;
        const item = this._idleItem(); if (item) this._enqueue(item);
      }, 1500);
    },
    // Compatibilidad con consumidores antiguos: el nuevo host siempre contiene uno.
    _trim() { },
    _out() { this._finishActive(false); },
  };

  /* ===================== Feedback (despachador de eventos, FBK-01) =============
   * Fuente ÚNICA de verdad de cómo se comunica cada evento de partida: color de
   * valencia + icono + sonido + vibración + toast (en cola serial) + destello de
   * marco opcional. Antes cada evento cableaba a mano Toasts.show + Sound + Haptics
   * (con colisiones y omisiones); ahora todos pasan por Feedback.event(id, opts),
   * lo que GARANTIZA que cada evento es distinto en varias dimensiones.
   * Los "verbos de movimiento" del tablero (cómo se mueven los iconos) se añaden por
   * evento en las fases siguientes; este módulo cubre el canal audio/toast/marco.
   */
  const Feedback = {
    // valence: threat(rojo) · warn(ámbar) · cold(azul) · boon(oro/verde) — vía `kind`.
    SIG: {
      quake: { kind: 'warn', ms: 2000, priority: 88, icon: 'teleporter', snd: 'quake', hap: 'quake', toast: 'surv_quake' },
      tide: { kind: 'warn', ms: 2000, priority: 88, icon: '🌊', snd: 'tide', hap: 'roll', toastEn: ['surv_tide', 'surv_tide_enraged'] },
      meteor: { kind: 'bad', ms: 2000, priority: 90, icon: 'v2:meteor', snd: 'meteor', hap: 'impacts', toastEn: ['surv_meteor', 'surv_meteor_enraged'] },
      frost: { kind: 'info', ms: 1900, priority: 86, icon: 'v2:snowflake', snd: 'frost', hap: 'ice', toastEn: ['surv_frost', 'surv_frost_enraged'] },
      lockdown: { kind: 'bad', ms: 2000, priority: 90, icon: '🔒', snd: 'lockdown', hap: 'clank', toast: 'surv_lockdown' },
      echo: { kind: 'bad', ms: 1900, priority: 96, icon: '🔁', snd: 'echo', hap: 'quake' },
      lifeLost: { kind: 'bad', ms: 1900, priority: 100, icon: 'heart', snd: 'lifeBlast', hap: 'life', toast: 'surv_life_lost' },
      grant: { kind: 'good', ms: 1700, priority: 60, icon: '✨', snd: 'grant', hap: 'reward', frame: 'fbk-boon' },
      waveUp: { kind: 'warn', ms: 1600, priority: 80, icon: 'fire', snd: 'waveUp', hap: 'combo' },
      waveSoon: { kind: 'warn', ms: 1500, priority: 72, icon: 'fire', snd: 'danger', hap: null, toast: 'surv_wave_soon' },
      // `hap` nombra un PATRÓN de Haptics, no su método de bajo nivel: 'fire'
      // llamaba a Haptics.fire() sin argumentos, que en web equivale a
      // navigator.vibrate(0) — cancelaba la vibración en vez de emitirla.
      bossWarn: { kind: 'bad', ms: 2400, priority: 98, icon: null, snd: 'bossWarn', hap: 'quake' },
      bossPhase: { kind: 'warn', ms: 1600, priority: 95, icon: '⚠️', snd: 'danger', hap: 'combo' },
    },
    event(id, opts) {
      opts = opts || {};
      const s = this.SIG[id]; if (!s) return;
      let msg = opts.msg;
      if (msg == null) {
        const key = opts.toastKey || (s.toastEn ? s.toastEn[opts.enraged ? 1 : 0] : s.toast);
        if (key) msg = I18n.t(key);
      }
      const icon = opts.icon != null ? opts.icon : s.icon;
      const title = opts.title != null ? opts.title : msg;
      let accepted = true;
      if (title != null) {
        accepted = Toasts.event({
          key: opts.key || id,
          kicker: opts.kicker || '',
          title,
          detail: opts.detail || '',
          kind: opts.kind || s.kind,
          priority: opts.priority != null ? opts.priority : s.priority,
          ms: opts.ms || s.ms,
          icon,
          expiresAt: opts.expiresAt === false ? false
            : (opts.expiresAt || Date.now() + Math.max(3000, (opts.ms || s.ms) * 2)),
        });
      }
      // La deduplicación cubre todos los canales: si este mismo evento ya está
      // visible o en cola, tampoco repetimos sonido, vibración ni marco.
      if (!accepted) return false;
      const frame = Object.prototype.hasOwnProperty.call(opts, 'frame') ? opts.frame : s.frame;
      if (frame) Render.boardEvent(frame, 800);
      const snd = opts.snd || s.snd; if (snd && Sound[snd]) Sound[snd]();
      const hap = opts.hap != null ? opts.hap : s.hap; if (hap && typeof Haptics[hap] === 'function') Haptics[hap]();
      // El propio centro de eventos es una región aria-live; anunciarlo de nuevo en
      // #sr-status haría que los lectores de pantalla oyeran cada aviso dos veces.
      return true;
    },
  };

  // Cuenta ascendente de un número en un elemento (recompensa visual barata).
  function countUp(el, to, ms, prefix, suffix) {
    if (!el) return; to = +to || 0; prefix = prefix || ''; suffix = suffix || '';
    if (Settings.reducedFx || to <= 0) { el.textContent = prefix + fmtNum(to) + suffix; return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      el.textContent = prefix + fmtNum(Math.round(to * (1 - Math.pow(1 - k, 3)))) + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Construye una fila de estadísticas: items = [ [valor, etiqueta, color?], ... ]
  function statRow(items) {
    return items.map(([v, k, c]) =>
      `<div class="stat"><span class="v"${c ? ` style="color:${c}"` : ''}>${v}</span><span class="k">${k}</span></div>`
    ).join('');
  }

  /* ===================== Screens ===================== */
  const Screens = {
    show(name) {
      document.body.dataset.screen = name;
      document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'screen-' + name; });
    },
  };

  /* ===================== Hub views =====================
   * Las secciones de metajuego comparten la pantalla de Inicio, su appbar y su
   * navegación inferior. Solo las decisiones transitorias de una partida
   * siguen usando Modal (pausa, reanimación y resultados). */
  /* ===================== Ranks (clasificación en nube) =====================
   * Lee las tablas por callable y publica la partida terminada.
   *
   * Regla de degradación: la nube es OPCIONAL. Sin sesión, sin App Check o sin
   * red, la vista muestra su estado y el juego sigue igual. Nada de aquí puede
   * impedir jugar ni bloquear el fin de partida.
   */
  const Ranks = {
    MODE: 'contrarreloj',
    SCOPES: [
      { id: 'daily', key: 'ranks_scope_daily' },
      { id: 'weekly', key: 'ranks_scope_weekly' },
      { id: 'season', key: 'ranks_scope_season' },
      { id: 'all-time', key: 'ranks_scope_all' },
    ],
    scope: 'daily',
    entries: [],
    cursor: null,
    viewerRank: null,
    loading: false,

    /** El transporte lo publica el bundle modular tras iniciar sesión. */
    transport() { return window.ConvergenceLeaderboards || null; },
    available() { return !!this.transport(); },

    open() {
      this.scope = 'daily'; this.entries = []; this.cursor = null; this.viewerRank = null;
      this.buildScopes(); this.render();
      HubViews.open('ranks');
      void this.load({ reset: true });
    },

    buildScopes() {
      const host = $('#ranks-scopes'); if (!host) return;
      host.innerHTML = this.SCOPES.map((scope) => (
        `<button class="ranks-scope${scope.id === this.scope ? ' on' : ''}" role="tab" type="button"`
        + ` aria-selected="${scope.id === this.scope}" data-scope="${scope.id}">${I18n.t(scope.key)}</button>`
      )).join('');
      host.querySelectorAll('[data-scope]').forEach((button) => button.addEventListener('click', () => {
        if (this.loading || button.dataset.scope === this.scope) return;
        this.scope = button.dataset.scope;
        this.entries = []; this.cursor = null; this.viewerRank = null;
        Sound.ui(); this.buildScopes(); this.render();
        void this.load({ reset: true });
      }));
    },

    status(messageKey) {
      const el = $('#ranks-status'); if (!el) return;
      el.textContent = messageKey ? I18n.t(messageKey) : '';
      el.hidden = !messageKey;
    },

    async load({ reset = false } = {}) {
      const transport = this.transport();
      if (!transport) { this.status('ranks_offline'); this.render(); return; }
      if (this.loading) return;
      this.loading = true;
      this.status('ranks_loading');
      try {
        const page = await transport.page({
          mode: this.MODE,
          scope: this.scope,
          limit: 20,
          ...(reset || !this.cursor ? {} : { cursor: this.cursor }),
        });
        this.entries = reset ? page.entries : this.entries.concat(page.entries);
        this.cursor = page.nextCursor;
        this.viewerRank = page.viewerRank;
        this.status(this.entries.length ? null : 'ranks_empty');
      } catch (error) {
        ErrLog.push('ranks', error && error.message);
        this.status('ranks_error');
      } finally {
        this.loading = false;
        this.render();
      }
    },

    render() {
      const list = $('#ranks-list'); if (!list) return;
      // La fila propia se marca por alias: el uid en nube no se guarda en local
      // y no hace falta para resaltar una fila.
      const alias = Storage.rankAlias;
      list.innerHTML = this.entries.map((entry, index) => {
        const mine = alias && entry.displayName === alias;
        return `<li class="ranks-row${mine ? ' is-me' : ''}">`
          + `<span class="ranks-pos">${index + 1}</span>`
          + `<span class="ranks-name">${esc(entry.displayName)}</span>`
          + `<span class="ranks-score">${fmtNum(entry.score)}</span></li>`;
      }).join('');

      const viewer = $('#ranks-viewer');
      if (viewer) {
        viewer.hidden = !this.entries.length;
        viewer.textContent = this.viewerRank
          ? I18n.t('ranks_your_rank').replace('{n}', String(this.viewerRank))
          : I18n.t('ranks_unranked');
      }
      const more = $('#ranks-more');
      if (more) {
        more.hidden = !this.cursor;
        more.disabled = this.loading;
      }
    },

    initEvents() {
      const more = $('#ranks-more');
      if (more) more.addEventListener('click', () => { Sound.ui(); void this.load(); });

      // El transporte lo publica el bundle modular DESPUÉS de iniciar sesión, que
      // es una ida y vuelta de red. Sin esto, abrir la clasificación antes de que
      // terminara mostraba "sin conexión" para siempre: el estado no se
      // reintentaba nunca. Ahora, en cuanto el carril de nube está listo, si el
      // jugador sigue mirando la tabla se recarga sola.
      window.addEventListener('convergence:leaderboards-ready', () => {
        if (HubViews.current === 'ranks') void this.load({ reset: true });
      });
    },

    /* ---------- Publicación ---------- */

    /** Pide alias la primera vez; devuelve null si el jugador declina. */
    async ensureAlias() {
      const stored = Storage.rankAlias;
      if (stored) return stored;
      // `window.prompt` no existe o se ignora en algunos WebView (Capacitor entre
      // ellos, según versión). Si no se puede preguntar NO se cae al nombre del
      // jugador: se asigna un alias neutro y editable. Publicar bajo el nombre
      // que dio como privado sería justo lo que se quiso evitar.
      let raw = null;
      try {
        if (typeof window.prompt === 'function') {
          raw = window.prompt(`${I18n.t('ranks_alias_title')}\n${I18n.t('ranks_alias_sub')}`, '');
          if (raw === null) return null;   // el jugador declinó: no se publica
        }
      } catch (_) { raw = null; }

      const alias = String(raw == null ? '' : raw).trim().slice(0, 24)
        || `Jugador#${String(1000 + Math.floor(Math.random() * 9000))}`;
      Storage.rankAlias = alias;
      return alias;
    },

    /**
     * Publica la partida recién terminada. Silencioso por diseño: si no hay
     * nube, si la bitácora desbordó o si el modo no puntúa, no se dice nada —
     * no es un error del jugador y no debe interrumpir el fin de partida.
     */
    async publishRun() {
      const transport = this.transport();
      if (!transport) return;
      if (State.mode !== this.MODE) return;
      if (!RunLog.publishable()) return;
      if (!(await this.ensureAlias())) return;

      try {
        const result = await transport.submit({
          protocolVersion: 1,
          idempotencyKey: `${RunLog.startedAt}-${State.score}-${RunLog.events.length}`,
          mode: State.mode,
          difficulty: State.diff,
          claimedScore: State.score,
          seed: State.seed == null ? 0 : State.seed,
          startedAt: RunLog.startedAt,
          finishedAt: Date.now(),
          gameVersion: VERSION,
          finalStateHash: `${State.score}:${State.removedTotal}:${State.maxCombo}`,
          events: RunLog.events,
        });
        if (result.verification === 'rejected') {
          Toasts.show(I18n.t('ranks_rejected'), 'bad', 2600);
          return;
        }
        if (!result.improvedBoards || !result.improvedBoards.length) {
          Toasts.show(I18n.t('ranks_not_improved'), 'info', 2200);
          return;
        }
        Toasts.show(
          I18n.t('ranks_published')
            .replace('{n}', '')
            .replace('{b}', String(result.improvedBoards.length)),
          'good', 2600, 'trophy',
        );
      } catch (error) {
        // Publicar es un extra: un fallo aquí no puede ensuciar el fin de partida.
        ErrLog.push('ranks-publish', error && error.message);
      }
    },
  };

  const HubViews = {
    current: 'home',
    host: null,
    homeMain: null,
    _last: null,
    _history: [],
    _activeNav: 'nav-home',
    init() {
      this.host = $('#hub-views');
      this.homeMain = document.querySelector('#screen-start .home-main');
      if (!this.host || !this.homeMain) return;
      document.querySelectorAll('[data-hub-view]').forEach((view) => {
        view.hidden = true;
        this.host.appendChild(view);
      });
      this.host.hidden = true;
      document.body.dataset.homeView = 'home';
      this._updateNav('nav-home');
    },
    _view(name) {
      return this.host && this.host.querySelector(`[data-hub-view="${name}"]`);
    },
    _updateNav(action) {
      this._activeNav = action || null;
      document.querySelectorAll('#screen-start .bottom-nav .bnav').forEach((button) => {
        if (action && button.dataset.act === action) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    },
    _captureRoute() {
      const screen = document.body.dataset.screen;
      if (screen === 'worlds') return { kind: 'worlds', focusId: document.activeElement && document.activeElement.id };
      if (screen !== 'start') return null;
      if (this.current && this.current !== 'home') return { kind: 'hub', name: this.current, nav: this._activeNav };
      return { kind: 'home' };
    },
    _pushRoute(route) {
      if (!route) return;
      const last = this._history[this._history.length - 1];
      const same = last && last.kind === route.kind && last.name === route.name;
      if (!same) this._history.push(route);
      if (this._history.length > 12) this._history.shift();
    },
    open(name, options = {}) {
      const view = this._view(name); if (!view) return false;
      // Navegar a otra vista (no-Ajustes) desde la pausa cancela el retorno.
      if (pauseSettingsReturn && name !== 'settings') pauseSettingsReturn = false;
      const route = this._captureRoute();
      if (this.current === 'shop' && name !== 'shop') Cosmetics.apply();
      if (this.current === 'chests' && name !== 'chests') {
        resetChestCeremony(); setChestButtonsBusy(false);
        chestCeremonyReturnFocus = null; chestCatalogReturnFocus = null;
      }
      const openingFromHome = document.body.dataset.screen === 'start' && this.current === 'home';
      if (openingFromHome) this._last = document.activeElement;
      if (options.history !== false && !(route && route.kind === 'hub' && route.name === name)) this._pushRoute(route);

      // Un siguiente paso del resumen puede llevar directamente a Tienda,
      // Misiones o Cofres. Al abandonar ese resumen la run queda cerrada.
      if (document.body.dataset.screen === 'game' && State.status === 'over') {
        Loop.stop(); Music.stop(); State.status = 'idle'; ModeSignals.clear();
        if (typeof Survival !== 'undefined') Survival.cleanup();
      }

      Screens.show('start');
      if (this.homeMain) this.homeMain.hidden = true;
      if (this.host) this.host.hidden = false;
      this.host.querySelectorAll('[data-hub-view]').forEach((item) => { item.hidden = item !== view; });
      const scroll = view.querySelector('.view-body'); if (scroll) scroll.scrollTop = 0;
      this.current = name;
      document.body.dataset.homeView = name;
      document.body.classList.add('hub-view-open');
      this._updateNav(options.nav || null);
      updateTopBars(); Econ.refresh();

      const heading = view.querySelector('h1, h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        requestAnimationFrame(() => {
          try { heading.focus({ preventScroll: true }); } catch (_) { heading.focus(); }
        });
        announce(heading.textContent || name);
      }
      return true;
    },
    back() {
      // Ajustes abierto desde la pausa: "Volver" reabre el modal de pausa.
      if (pauseSettingsReturn && this.current === 'settings') { returnFromPauseSettings(); return; }
      const route = this._history.pop();
      if (!route || route.kind === 'home') { this.home({ clearHistory: false }); return; }
      if (route.kind === 'hub') {
        this.open(route.name, { nav: route.nav, history: false });
        return;
      }
      if (route.kind === 'worlds') {
        this.home({ focus: false, clearHistory: false });
        Worlds.open();
        if (route.focusId) requestAnimationFrame(() => {
          const target = $('#' + route.focusId);
          if (target && target.focus) target.focus({ preventScroll: true });
        });
        return;
      }
      this.home({ clearHistory: false });
    },
    home(options = {}) {
      if (!this.host || !this.homeMain) return;
      if (options.focus !== false) pauseSettingsReturn = false;
      if (this.current === 'shop') Cosmetics.apply();
      if (this.current === 'chests') {
        resetChestCeremony(); setChestButtonsBusy(false);
        chestCeremonyReturnFocus = null; chestCatalogReturnFocus = null;
      }
      const shouldFocus = options.focus !== false;
      this.host.querySelectorAll('[data-hub-view]').forEach((view) => { view.hidden = true; });
      this.host.hidden = true;
      this.homeMain.hidden = false;
      this.current = 'home';
      document.body.dataset.homeView = 'home';
      document.body.classList.remove('hub-view-open');
      this._updateNav('nav-home');
      if (options.clearHistory !== false) this._history = [];
      updateTopBars();
      if (shouldFocus) {
        const target = this._last && this._last.isConnected ? this._last : document.querySelector('[data-act="nav-home"]');
        if (target && target.focus) requestAnimationFrame(() => {
          try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
        });
      }
      this._last = null;
    },
  };

  const Modal = {
    _last: null,
    _id: null,
    open(id) {
      this._id = id;
      this._last = document.activeElement;
      document.body.classList.add('modal-open');
      $('#overlay').hidden = false;
      document.querySelectorAll('.modal').forEach(m => m.hidden = m.id !== id);
      const m = $('#' + id);
      const body = m.querySelector('.modal-body');
      if (body) body.scrollTop = 0;
      const focusable = m.querySelector('.modal-actions button:not([disabled])') || m.querySelector('button:not([disabled]), [href], input');
      if (focusable) focusable.focus({ preventScroll: true });
    },
    close() {
      const closedId = this._id;
      this._id = null;
      const exitEndedGame = closedId && closedId !== 'modal-over' &&
        State.status === 'over' && document.body.dataset.screen === 'game';
      document.body.classList.remove('modal-open', 'mode-launch-open');
      $('#overlay').hidden = true; document.querySelectorAll('.modal').forEach(m => m.hidden = true);
      // Accesibilidad: devolver el foco al elemento que abrió el modal.
      if (this._last && this._last.focus) { try { this._last.focus(); } catch (_) { } }
      this._last = null;
      // Si un modal secundario se cierra tras el resumen de game over, ya no
      // hay un modal util al que volver: salimos igual que con "Menu".
      if (exitEndedGame) Game.quit();
    },
  };

  /* ===================== FX (partículas DOM, animadas por el compositor) =======
   * Capa <div> a pantalla completa con un pool fijo de <span> reutilizables.
   * Cada partícula se anima con la Web Animations API (transform/opacity), que
   * corre en el hilo del compositor (off-main-thread) -> coste de CPU casi nulo
   * por frame y SIN canvas (evita el fallo de compositing de WebKit que dejaba
   * la pantalla en blanco con secuencias largas de combos). La trayectoria con
   * "gravedad" se precalcula como keyframes parabólicos.
   */
  const FX = {
    layer: null, pool: [], idx: 0, active: 0, cap: 40, w: 0, h: 0, boardRect: null, supported: true,
    wave: null, convergeHost: null, convergeGroups: [], convergeGroupIdx: 0,
    // Grupo C · C1 (docs/RENDER_STABILITY_PLAN.md RS-14/RS-8): backend de partículas en UN canvas
    // (1 capa del compositor en vez de ~140 spans). EXPERIMENTAL y detrás de bandera: OFF por
    // defecto (el pool DOM sigue siendo el camino de producción). Se activa con `?canvasfx` en la
    // URL o `localStorage.cv_canvas_fx='1'`, para MEDIR con tools/perf-probe.js --android antes de
    // considerar promoverlo (RS-8 exige medición, "NO cambio a ciegas"). Solo cubre las partículas
    // de _emit (burst/confeti/chispas de boardClear); la coreografía de convergencia sigue en DOM.
    useCanvas: false, canvas: null, cctx: null, cps: [], cdpr: 1,
    POOL: 140,                // backstop absoluto para celebraciones y recompensas
    ABS_MAX: 140,
    CONVERGE_GROUPS: 3,       // tres coreografías completas pueden convivir sin reciclar nodos
    MAX_CONVERGE_ICONS: 5,    // cuatro direcciones + una casilla extra de Imán
    BURST_PARTICLES: 12,
    CONVERGE_TRAVEL_MS: 165,
    CONVERGE_TRAIL_FADE_MS: 140,
    CONVERGE_IMPACT_DELAY: 165, // siempre igual al viaje: burst/onda nacen en el impacto
    CONVERGE_WAVE_MS: 260,
    BURST_THRESHOLDS: [3, 6, 10, 15, 20, 30],
    BURST_ACCENTS: ['#ffffff', '#34e29b', '#00d0ff', '#b46cff', '#ff5cf0', '#ffd84d', '#ff9838'],
    // Estrella REDONDEADA (5 puntas con esquinas suaves) como máscara SVG: escala
    // a cualquier tamaño (mask-size 100%) y el fondo/gradiente se ve a través.
    STAR_MASK: "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Cpath%20fill='%23fff'%20d='M12%202.5c.5%200%20.9.3%201.1.7l2.4%205%205.4.8c1%20.1%201.4%201.3.7%202l-3.9%203.8.9%205.4c.2%201-.9%201.8-1.8%201.3L12%2018.9l-4.8%202.5c-.9.5-2-.3-1.8-1.3l.9-5.4L3.4%2011c-.7-.7-.3-1.9.7-2l5.4-.8%202.4-5c.2-.4.6-.7%201.1-.7z'/%3E%3C/svg%3E\")",
    // Aplica (on) o quita (off) la forma de estrella sobre un elemento del pool.
    _setStar(el, on) {
      const m = on ? this.STAR_MASK : 'none';
      el.style.webkitMaskImage = m; el.style.maskImage = m;
      if (on) {
        el.style.webkitMaskSize = el.style.maskSize = '100% 100%';
        el.style.webkitMaskRepeat = el.style.maskRepeat = 'no-repeat';
        el.style.webkitMaskPosition = el.style.maskPosition = 'center';
      }
      el.style.clipPath = 'none';
    },
    init() {
      this.layer = $('#fx'); if (!this.layer) return;
      this.supported = typeof Element !== 'undefined' && !!Element.prototype.animate;
      this.useCanvas = this._wantCanvas();   // C1: bandera experimental (OFF salvo ?canvasfx / flag)
      const frag = document.createDocumentFragment();
      for (let i = 0; i < this.POOL; i++) {
        const s = document.createElement('span');
        s.className = 'fxp';
        this.pool.push({ el: s, anim: null, busy: false });
        frag.appendChild(s);
      }
      // #fx-wave queda reservado a boardClear. La convergencia usa ondas locales
      // para no perder su impacto cuando ambas celebraciones coinciden.
      this.wave = document.createElement('span'); this.wave.id = 'fx-wave';
      frag.appendChild(this.wave);
      this.layer.appendChild(frag);
      this._attachConvergeLayer(Render.convergeLayer);
      this.resize();
      if (this.useCanvas) this._initCanvas();   // C1: capa única de partículas (experimental)
      window.addEventListener('resize', () => this.resize(), { passive: true });
      window.addEventListener('scroll', () => this.syncBoardRect(), { passive: true });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize(), { passive: true });
    },
    _attachConvergeLayer(host) {
      if (!host) return;
      this._cancelConvergeAnimations();
      host.innerHTML = '';
      this.convergeHost = host;
      this.convergeGroups = [];
      this.convergeGroupIdx = 0;
      const frag = document.createDocumentFragment();
      for (let g = 0; g < this.CONVERGE_GROUPS; g++) {
        const group = { tiles: [], trails: [], particles: [], wave: null };
        for (let i = 0; i < this.MAX_CONVERGE_ICONS; i++) {
          const trail = document.createElement('span');
          trail.className = 'converge-trail';
          group.trails.push({ el: trail, anim: null });
          frag.appendChild(trail);
        }
        for (let i = 0; i < this.MAX_CONVERGE_ICONS; i++) {
          const tile = document.createElement('span');
          tile.className = 'cell has-icon converge-tile';
          tile.setAttribute('aria-hidden', 'true');
          const glyph = document.createElement('span'); glyph.className = 'glyph';
          tile.appendChild(glyph);
          group.tiles.push({ el: tile, glyph, anim: null });
          frag.appendChild(tile);
        }
        for (let i = 0; i < this.BURST_PARTICLES; i++) {
          const particle = document.createElement('span');
          particle.className = 'converge-particle';
          group.particles.push({ el: particle, anim: null });
          frag.appendChild(particle);
        }
        group.wave = document.createElement('span');
        group.wave.className = 'converge-wave';
        frag.appendChild(group.wave);
        this.convergeGroups.push(group);
      }
      host.appendChild(frag);
    },
    _cancelConvergeGroup(group) {
      if (!group) return;
      [...(group.tiles || []), ...(group.trails || []), ...(group.particles || [])].forEach((slot) => {
        const anim = slot.anim;
        if (anim) {
          try { anim.onfinish = null; anim.oncancel = null; anim.cancel(); } catch (_) { }
        }
        slot.anim = null;
        slot.el.style.opacity = '0';
      });
      if (group.wave && group.wave.getAnimations) group.wave.getAnimations().forEach((a) => { try { a.cancel(); } catch (_) { } });
      if (group.wave) group.wave.style.opacity = '0';
    },
    _cancelConvergeAnimations() { this.convergeGroups.forEach((group) => this._cancelConvergeGroup(group)); },
    _nextConvergeGroup() {
      if (!this.convergeGroups.length) this._attachConvergeLayer(Render.convergeLayer);
      if (!this.convergeGroups.length) return null;
      const group = this.convergeGroups[this.convergeGroupIdx];
      this.convergeGroupIdx = (this.convergeGroupIdx + 1) % this.convergeGroups.length;
      this._cancelConvergeGroup(group);
      return group;
    },
    resize() {
      this._cancelConvergeAnimations();
      this.w = window.innerWidth; this.h = window.innerHeight; this.syncBoardRect();
      if (this.canvas) this._sizeCanvas();   // C1: mantener la resolución del canvas al viewport×dpr
    },
    syncBoardRect() { const el = $('#board'); this.boardRect = el ? el.getBoundingClientRect() : null; },
    // Coordenadas (viewport) del centro de la celda i
    cellXY(i) {
      const s = State.size, r = this.boardRect;
      if (!r || !r.width) return { x: this.w / 2, y: this.h / 2 };
      return { x: r.left + ((i % s) + 0.5) / s * r.width, y: r.top + ((i / s | 0) + 0.5) / s * r.height };
    },
    // Métrica local exacta: tablero y clones comparten .board-wrap, por lo que siguen
    // juntos durante impact(), resize y skins. Se descuenta el gap real una sola vez.
    _gridMetrics() {
      const el = $('#board'), host = this.convergeHost, r = this.boardRect, s = State.size;
      if (!el || !host || !r || !r.width) return null;
      const hr = host.getBoundingClientRect();
      const sx = hr.width && host.clientWidth ? hr.width / host.clientWidth : 1;
      const sy = hr.height && host.clientHeight ? hr.height / host.clientHeight : 1;
      const left = hr.width ? (r.left - hr.left) / sx : 0;
      const top = hr.height ? (r.top - hr.top) / sy : 0;
      const width = r.width / sx, height = r.height / sy;
      let gapX = 0, gapY = 0;
      if (typeof window.getComputedStyle === 'function') {
        const cs = window.getComputedStyle(el);
        gapX = parseFloat(cs.columnGap) || 0;
        gapY = parseFloat(cs.rowGap) || 0;
      }
      const cellW = (width - gapX * (s - 1)) / s;
      const cellH = (height - gapY * (s - 1)) / s;
      return {
        cellW, cellH, cellPx: Math.min(cellW, cellH),
        xy: (i) => {
          const row = (i / s) | 0, col = i % s;
          return { x: left + col * (cellW + gapX) + cellW / 2, y: top + row * (cellH + gapY) + cellH / 2 };
        },
      };
    },
    // Busca una ranura LIBRE (sin cancelar las activas: cero churn de capas).
    _slot() {
      const N = this.pool.length;
      for (let k = 0; k < N; k++) {
        const p = this.pool[this.idx]; this.idx = (this.idx + 1) % N;
        if (!p.busy) return p;
      }
      return null; // todas ocupadas -> se descarta la partícula (mejor que blanquear)
    },
    // Lanza una partícula con velocidad (vx,vy) px/s y gravedad g px/s^2 durante life s.
    // Si se alcanza el tope de concurrencia, se DESCARTA (nunca se cancela una activa),
    // así el nº de capas del compositor queda acotado y no hay parpadeo blanco.
    _emit(x, y, vx, vy, g, life, size, color, shape, spin, delay, force) {
      // C1 (RS-14): con la bandera de canvas activa, la partícula se dibuja en la capa única en
      // vez de tomar un span del pool DOM. Mismo contrato de tope (se descarta al saturar).
      if (this.useCanvas && this.cctx) return this._emitCanvas(x, y, vx, vy, g, life, size, color, shape, spin, delay, force);
      if (!this.supported || this.active >= (force ? this.ABS_MAX : this.cap)) return;
      const p = this._slot(); if (!p) return;
      const el = p.el;
      el.style.width = size + 'px';
      el.style.height = (shape === 1 ? size * 0.6 : size) + 'px';
      el.style.background = color;
      el.style.borderRadius = shape === 1 ? '1px' : '50%';
      // Partículas redondas/cuadradas: sin estrella ni glow. Se resetea SIEMPRE
      // para no contaminar ranuras reutilizadas por las estrellas (burst, confeti…).
      this._setStar(el, false); el.style.filter = 'none'; el.style.transformOrigin = '50% 50%';
      // Muestreo parabólico de la trayectoria -> keyframes (el compositor interpola).
      const N = 5, frames = [];
      for (let k = 0; k <= N; k++) {
        const t = life * k / N;
        const px = x + vx * t, py = y + vy * t + 0.5 * g * t * t;
        const rot = spin ? ' rotate(' + (spin * t) + 'deg)' : '';
        frames.push({ transform: 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)' + rot, opacity: k >= N - 1 ? 0 : 1, offset: k / N });
      }
      p.busy = true; this.active++;
      let anim;
      try { anim = el.animate(frames, { duration: life * 1000, delay: delay || 0, easing: 'linear', fill: delay ? 'both' : 'forwards' }); }
      catch (_) { p.busy = false; this.active--; return; }
      p.anim = anim;
      const done = () => {
        if (p.busy) { p.busy = false; this.active = Math.max(0, this.active - 1); }
        el.style.opacity = '0';
        if (p.anim === anim) p.anim = null;
        try { anim.onfinish = null; anim.oncancel = null; anim.cancel(); } catch (_) { }
      };
      anim.onfinish = done; anim.oncancel = done;
    },
    /* ===== C1 (RS-14): backend de partículas en canvas único (experimental, detrás de bandera) =====
       Colapsa las ~140 capas del pool DOM en 1 sola. OFF por defecto: solo se usa para MEDIR el
       ahorro de presupuesto de capas (perf-probe --android) antes de decidir promoverlo (RS-8). */
    _wantCanvas() {
      try { if ((location.search || '').indexOf('canvasfx') !== -1) return true; } catch (_) { }
      try { return localStorage.getItem('cv_canvas_fx') === '1'; } catch (_) { }
      return false;
    },
    _initCanvas() {
      if (this.canvas || !this.layer) return;
      const c = document.createElement('canvas');
      c.id = 'fx-canvas'; c.setAttribute('aria-hidden', 'true');
      c.style.position = 'absolute'; c.style.inset = '0';
      c.style.width = '100%'; c.style.height = '100%'; c.style.pointerEvents = 'none';
      this.canvas = c;
      this.cctx = typeof c.getContext === 'function' ? c.getContext('2d') : null;
      this.layer.appendChild(c);
      this._sizeCanvas();
    },
    _sizeCanvas() {
      if (!this.canvas) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);   // acota el tamaño de la textura (RS-6)
      this.cdpr = dpr;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
    },
    // Permite conmutar el backend en caliente (perf-probe/medición). No toca producción (OFF).
    enableCanvas(on) {
      this.useCanvas = !!on;
      if (on) this._initCanvas();
      else if (this.cctx && this.canvas) { this.cps.length = 0; this.cctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    },
    _emitCanvas(x, y, vx, vy, g, life, size, color, shape, spin, delay, force) {
      const capN = force ? this.ABS_MAX : this.cap;
      if (this.cps.length >= capN) return;   // mismo contrato que el pool: se descarta al saturar
      this.cps.push({ x, y, vx, vy, g, life, size, color, shape, spin: spin || 0, age: -((delay || 0) / 1000) });
      if (typeof Loop !== 'undefined' && Loop.kick) Loop.kick();   // el loop debe estar vivo para dibujar
    },
    // Integrador PURO (testeable en Node): posición/rotación/alfa de la partícula a la edad t (s).
    // Reproduce EXACTAMENTE la parábola y el desvanecimiento de los keyframes de _emit
    // (opacidad 1 hasta el 60% de la vida, fundido lineal 60%→80%, 0 después).
    _particleAt(p, t) {
      if (t < 0) return { x: p.x, y: p.y, rot: 0, alpha: 0, dead: false };
      if (t >= p.life) return { x: 0, y: 0, rot: 0, alpha: 0, dead: true };
      const frac = t / p.life;
      const alpha = frac < 0.6 ? 1 : frac >= 0.8 ? 0 : 1 - (frac - 0.6) / 0.2;
      return { x: p.x + p.vx * t, y: p.y + p.vy * t + 0.5 * p.g * t * t, rot: p.spin * t, alpha, dead: false };
    },
    // Un paso por frame (lo llama Loop.tick): avanza edades, descarta muertas y redibuja la capa.
    stepCanvas(dt) {
      if (!this.useCanvas || !this.cctx || !this.canvas) return;
      const ctx = this.cctx, dpr = this.cdpr, list = this.cps;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!list.length) return;
      const ds = dt / 1000; let w = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i]; p.age += ds;
        const s = this._particleAt(p, p.age);
        if (s.dead) continue;              // fuera del array (no se copia -> se recolecta)
        list[w++] = p;                     // compacta in-place las vivas
        if (s.alpha <= 0) continue;
        this._drawParticle(ctx, p, s, dpr);
      }
      list.length = w;
    },
    _drawParticle(ctx, p, s, dpr) {
      ctx.globalAlpha = s.alpha; ctx.fillStyle = p.color;
      const cx = s.x * dpr, cy = s.y * dpr, sz = p.size * dpr;
      if (p.shape === 1) {                 // confeti: rectángulo (mismo aspecto que el span DOM)
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(s.rot * Math.PI / 180);
        ctx.fillRect(-sz / 2, -sz * 0.3, sz, sz * 0.6); ctx.restore();
      } else {                             // burst/chispa: círculo
        ctx.beginPath(); ctx.arc(cx, cy, sz / 2, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    // Estallido en la celda eliminada (sale del centro hacia fuera).
    // OJO: usa el rect del tablero CACHEADO (no se llama a getBoundingClientRect
    // aquí: leerlo por cada eliminación, intercalado con las escrituras del DOM,
    // provoca "layout thrashing" y bloquea el hilo principal en iOS).
    burst(i, color, n) {
      if (Settings.reducedFx || !this.supported) return;
      const { x, y } = this.cellXY(i); n = Math.min(n, 5);
      for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, sp = 70 + Math.random() * 170; this._emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 70, 780, 0.42 + Math.random() * 0.28, 5 + Math.random() * 4, color, 0, 0); }
    },
    // Celebración de récord: brota de la última eliminación, sube/se abre y cae al fondo
    celebrate(i) {
      if (Settings.reducedFx || !this.supported) return;
      const { x, y } = this.cellXY(i), C = ['#ffd23f', '#ff5b6e', '#4b8bff', '#3ad07f', '#a06bff', '#2bd4e6', '#ff9838'];
      const n = Math.min(36, this.cap);
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 260 + Math.random() * 320;
        // vida suficiente para que la parábola alcance el fondo de la pantalla
        this._emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 900, 1.7 + Math.random() * 1.1, 6 + Math.random() * 4, C[k % C.length], 1, (Math.random() - 0.5) * 720);
      }
    },
    // Confeti que cae desde arriba (nivel/victoria)
    confetti(n) {
      if (Settings.reducedFx || !this.supported) return;
      n = Math.min(n, this.cap);
      const C = ['#ff5b6e', '#4b8bff', '#3ad07f', '#ffd23f', '#a06bff', '#2bd4e6', '#ff9838'];
      for (let k = 0; k < n; k++) this._emit(Math.random() * this.w, -14, (Math.random() - 0.5) * 110, 150 + Math.random() * 170, 360, 1.8 + Math.random() * 1.1, 6 + Math.random() * 4, C[k % C.length], 1, (Math.random() - 0.5) * 540);
    },
    // Bonus de tablero limpio en modos de tablero continuo: explosión radial
    // desde el tablero, no lluvia desde arriba, para comunicar "lo vaciaste aquí".
    boardClear(centerIdx, color) {
      if (Settings.reducedFx || !this.supported) return;
      this.syncBoardRect();
      const r = this.boardRect;
      if (!r || !r.width) return;
      const C = ['#ffd84d', '#34e29b', '#00d0ff', '#ff5cf0', '#ffb24d', '#eaf0ff'];
      const origin = centerIdx != null ? this.cellXY(centerIdx) : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const radius = Math.max(r.width, r.height) * 0.72;
      if (this.wave) {
        const w = Math.round(r.width * 1.1);
        this.wave.style.width = w + 'px'; this.wave.style.height = w + 'px';
        this.wave.style.borderColor = color || '#ffd84d';
        this.wave.style.boxShadow = '0 0 18px ' + (color || '#ffd84d') + ', inset 0 0 18px ' + (color || '#ffd84d');
        const wt = (sc) => 'translate3d(' + (cx - w / 2).toFixed(1) + 'px,' + (cy - w / 2).toFixed(1) + 'px,0) scale(' + sc + ')';
        try {
          this.wave.animate([
            { transform: wt(0.1), opacity: 0, offset: 0, easing: 'ease-out' },
            { transform: wt(0.34), opacity: 0.9, offset: 0.18, easing: 'cubic-bezier(.15,.6,.3,1)' },
            { transform: wt(1.18), opacity: 0, offset: 1 },
          ], { duration: 760, fill: 'forwards' });
        } catch (_) { }
      }
      const n = Math.min(34, this.cap);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.283 + (Math.random() - 0.5) * 0.22;
        const dist = radius * (0.62 + Math.random() * 0.48);
        const tx = cx + Math.cos(a) * dist, ty = cy + Math.sin(a) * dist;
        const col = C[k % C.length];
        if (k % 3 === 0) this._flyStar(origin.x, origin.y, tx, ty, 8 + Math.random() * 5, col, Math.random() * 70, 720 + Math.random() * 180);
        else this._emit(origin.x, origin.y, Math.cos(a) * (260 + Math.random() * 280), Math.sin(a) * (260 + Math.random() * 280) - 80, 520, 0.82 + Math.random() * 0.32, 6 + Math.random() * 5, col, 1, (Math.random() - 0.5) * 720);
      }
    },
    // Mini-estrella que sale volando de (x0,y0) hacia (x1,y1): pop + viaje hacia
    // afuera con desaceleración elegante y desvanecido. Reutiliza el pool.
    _flyStar(x0, y0, x1, y1, size, color, delay, dur, force) {
      if (!this.supported || this.active >= (force ? this.ABS_MAX : this.cap)) return;
      const p = this._slot(); if (!p) return;
      const el = p.el;
      el.style.width = size + 'px'; el.style.height = size + 'px';
      el.style.background = color;
      this._setStar(el, true); el.style.filter = 'drop-shadow(0 0 3px ' + color + ')'; el.style.transformOrigin = '50% 50%';
      const tr = (x, y, sc, rot) => 'translate3d(' + (x - size / 2).toFixed(1) + 'px,' + (y - size / 2).toFixed(1) + 'px,0) scale(' + sc + ') rotate(' + rot + 'deg)';
      const mx = x0 + (x1 - x0) * 0.62, my = y0 + (y1 - y0) * 0.62;
      const frames = [
        { transform: tr(x0, y0, 0.2, 0), opacity: 0, offset: 0, easing: 'ease-out' },
        { transform: tr(mx, my, 1, 18), opacity: 1, offset: 0.4, easing: 'ease-out' },
        { transform: tr(x1, y1, 0.4, 40), opacity: 0, offset: 1 },
      ];
      p.busy = true; this.active++;
      let anim;
      try { anim = el.animate(frames, { duration: dur, delay: delay || 0, fill: 'both' }); }
      catch (_) { p.busy = false; this.active--; return; }
      p.anim = anim;
      const done = () => {
        if (p.busy) { p.busy = false; this.active = Math.max(0, this.active - 1); }
        el.style.opacity = '0';
        if (p.anim === anim) p.anim = null;
        try { anim.onfinish = null; anim.oncancel = null; anim.cancel(); } catch (_) { }
      };
      anim.onfinish = done; anim.oncancel = done;
    },
    // Dibuja el recorrido como una descarga que crece DETRÁS de la ficha y permanece
    // un instante tras el impacto. Solo anima transform/opacity y usa nodos del grupo:
    // el feedback es visible incluso con el pool global saturado y no crea DOM por tap.
    _tracePath(slot, from, to, cellPx, color) {
      if (!slot || !slot.el) return false;
      const el = slot.el;
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 1) return false;
      const height = clamp(cellPx * 0.105, 3, 7);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const duration = this.CONVERGE_TRAVEL_MS + this.CONVERGE_TRAIL_FADE_MS;
      const impact = this.CONVERGE_TRAVEL_MS / duration;
      const atTravel = (offset) => +(impact * offset).toFixed(4);
      const afterImpact = impact + (1 - impact) * 0.38;
      const tr = (scaleX) => 'translate3d(' + from.x.toFixed(1) + 'px,' + (from.y - height / 2).toFixed(1) + 'px,0) rotate(' + angle.toFixed(2) + 'deg) scaleX(' + scaleX + ')';
      el.style.width = distance.toFixed(1) + 'px';
      el.style.height = height.toFixed(1) + 'px';
      el.style.color = color || '#ffffff';
      let anim;
      try {
        anim = el.animate([
          { transform: tr(0.015), opacity: 0, offset: 0 },
          { transform: tr(0.02), opacity: 0.34, offset: atTravel(0.10) },
          { transform: tr(0.22), opacity: 0.76, offset: atTravel(0.32) },
          { transform: tr(0.65), opacity: 0.90, offset: atTravel(0.62) },
          { transform: tr(0.92), opacity: 1, offset: atTravel(0.84) },
          { transform: tr(1), opacity: 0.94, offset: impact },
          { transform: tr(1), opacity: 0.58, offset: afterImpact },
          { transform: tr(1), opacity: 0, offset: 1 },
        ], { duration, easing: 'linear', fill: 'both' });
      } catch (_) { el.style.opacity = '0'; return false; }
      slot.anim = anim;
      const done = () => {
        if (slot.anim !== anim) return;
        slot.anim = null; el.style.opacity = '0';
        try { anim.onfinish = null; anim.oncancel = null; anim.cancel(); } catch (_) { }
      };
      anim.onfinish = done; anim.oncancel = done;
      return true;
    },
    // Copia la ficha COMPLETA: cuerpo cuadrado, borde, estados de tile y glifo. Hay
    // una breve anticipación hacia atrás y después un tirón cada vez más rápido; el
    // estiramiento longitudinal remarca la velocidad sin desacoplar icono y casilla.
    _flyTile(slot, id, source, from, to, cellW, cellH) {
      if (!slot || !id) return false;
      const el = slot.el, glyph = slot.glyph;
      let classes = [];
      if (source && source.classList) {
        try { classes = Array.from(source.classList); } catch (_) { }
        if (!classes.length && source.classList._set) classes = Array.from(source.classList._set);
      }
      const transient = new Set(['empty', 'spawn', 'clear', 'hint', 'miss', 'penalty', 'aim-target', 'ice-hit', 'ice-shatter']);
      classes = classes.filter((c) => !transient.has(c));
      classes.push('cell', 'has-icon', 'converge-tile');
      el.className = Array.from(new Set(classes)).join(' ');
      el.dataset.tileGlyph = (source && source.dataset && source.dataset.tileGlyph) || '';
      glyph.innerHTML = IconPacks.svg(Meta.equippedIconPack(), id);
      el.style.width = cellW.toFixed(1) + 'px'; el.style.height = cellH.toFixed(1) + 'px';
      const dx = to.x - from.x, dy = to.y - from.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const spin = (dx > 0 || (dx === 0 && dy > 0)) ? 1 : -1;
      const tr = (x, y, scale, stretch = 1, rotation = 0) => {
        const squash = Math.max(0.9, 1 - (stretch - 1) * 0.18);
        const sx = scale * (horizontal ? stretch : squash);
        const sy = scale * (horizontal ? squash : stretch);
        return 'translate3d(' + (x - cellW / 2).toFixed(1) + 'px,' + (y - cellH / 2).toFixed(1) + 'px,0) rotate(' + rotation + 'deg) scale3d(' + sx.toFixed(3) + ',' + sy.toFixed(3) + ',1)';
      };
      const at = (t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      const recoil = at(-0.012), p1 = at(0.22), p2 = at(0.65), p3 = at(0.92);
      let anim;
      try {
        anim = el.animate([
          { transform: tr(from.x, from.y, 1), opacity: 1, offset: 0 },
          { transform: tr(recoil.x, recoil.y, 1.05, 1, -spin), opacity: 1, offset: 0.10 },
          { transform: tr(p1.x, p1.y, 1.02, 1.12, spin), opacity: 1, offset: 0.32 },
          { transform: tr(p2.x, p2.y, 0.75, 1.28, 2 * spin), opacity: 1, offset: 0.62 },
          { transform: tr(p3.x, p3.y, 0.34, 1.50, 4 * spin), opacity: 0.94, offset: 0.84 },
          { transform: tr(to.x, to.y, 0.03, 1.70, 6 * spin), opacity: 0, offset: 1 },
        ], { duration: this.CONVERGE_TRAVEL_MS, easing: 'linear', fill: 'both' });
      } catch (_) { glyph.innerHTML = ''; return false; }
      slot.anim = anim;
      const done = () => {
        if (slot.anim !== anim) return;
        slot.anim = null; el.style.opacity = '0'; glyph.innerHTML = '';
        try { anim.onfinish = null; anim.oncancel = null; anim.cancel(); } catch (_) { }
      };
      anim.onfinish = done; anim.oncancel = done;
      return true;
    },
    _burstProfile(iconColors, comboColor, combo = State.combo || 1) {
      combo = Math.max(1, Number(combo) || 1);
      const tier = this.BURST_THRESHOLDS.reduce((n, threshold) => n + (combo >= threshold ? 1 : 0), 0);
      const power = clamp((combo - 1) / 29, 0, 1);
      const palette = [];
      [...(Array.isArray(iconColors) ? iconColors : [iconColors]), comboColor, ...this.BURST_ACCENTS].forEach((c) => {
        if (c && !palette.includes(c)) palette.push(c);
      });
      const baseColors = new Set(Array.isArray(iconColors) ? iconColors.filter(Boolean) : [iconColors].filter(Boolean)).size;
      return {
        colors: palette.slice(0, Math.min(palette.length, Math.max(baseColors, 1 + tier))),
        distanceScale: 1 + power * 0.22,
        sizeScale: 1 + power * 0.12,
      };
    },
    _burstParticle(slot, center, tx, ty, duration, size, color) {
      if (!slot) return false;
      const el = slot.el;
      el.style.width = size.toFixed(1) + 'px'; el.style.height = size.toFixed(1) + 'px';
      el.style.background = color; el.style.borderRadius = '50%';
      const ox = center.x - size / 2, oy = center.y - size / 2;
      const tr = (dx, dy, scale) => 'translate3d(' + (ox + dx).toFixed(1) + 'px,' + (oy + dy).toFixed(1) + 'px,0) scale(' + scale + ')';
      let anim;
      try {
        anim = el.animate([
          { transform: tr(0, 0, 0.25), opacity: 0, offset: 0 },
          { transform: tr(0, 0, 1), opacity: 1, offset: 0.025 },
          { transform: tr(tx, ty, 0), opacity: 0, offset: 1 },
        ], { duration: duration * 1000, delay: this.CONVERGE_IMPACT_DELAY, easing: 'ease-out', fill: 'both' });
      } catch (_) { return false; }
      slot.anim = anim;
      const done = () => {
        if (slot.anim !== anim) return;
        slot.anim = null; el.style.opacity = '0';
        try { anim.onfinish = null; anim.oncancel = null; anim.cancel(); } catch (_) { }
      };
      anim.onfinish = done; anim.oncancel = done;
      return true;
    },
    _iconBurst(slots, center, iconColors, comboColor, cellPx) {
      const profile = this._burstProfile(iconColors, comboColor);
      const size = cellPx * 0.13 * profile.sizeScale;
      let emitted = 0;
      for (let k = 0; k < this.BURST_PARTICLES; k++) {
        const angle = (k / this.BURST_PARTICLES) * 360 + (Math.random() * 20 - 10);
        const dist = cellPx * (0.75 + Math.random() * 0.50) * profile.distanceScale;
        const rad = angle * Math.PI / 180;
        if (this._burstParticle(slots[k], center, Math.cos(rad) * dist, Math.sin(rad) * dist,
          0.5 + Math.random() * 0.4, size, profile.colors[k % profile.colors.length])) emitted++;
      }
      return emitted;
    },
    _convergeWave(el, center, cellPx, color) {
      if (!el) return null;
      if (el.getAnimations) el.getAnimations().forEach((a) => a.cancel());
      const comboPower = clamp(((State.combo || 1) - 1) / 29, 0, 1);
      const size = cellPx * 1.12;
      const finalScale = 1.28 + comboPower * 0.14;
      const glow = cellPx * (0.11 + comboPower * 0.04);
      el.style.width = size.toFixed(1) + 'px'; el.style.height = size.toFixed(1) + 'px';
      el.style.borderWidth = clamp(cellPx * 0.045, 2, 4).toFixed(1) + 'px';
      el.style.borderColor = color || '#fff';
      el.style.boxShadow = '0 0 ' + glow.toFixed(1) + 'px ' + (color || '#fff') + ', inset 0 0 ' + glow.toFixed(1) + 'px ' + (color || '#fff');
      const tr = (scale) => 'translate3d(' + (center.x - size / 2).toFixed(1) + 'px,' + (center.y - size / 2).toFixed(1) + 'px,0) scale(' + scale + ')';
      try {
        return el.animate([
          { transform: tr(0.16), opacity: 0, offset: 0 },
          { transform: tr(0.32), opacity: 0.94, offset: 0.12, easing: 'cubic-bezier(.15,.65,.25,1)' },
          { transform: tr(finalScale), opacity: 0, offset: 1 },
        ], { duration: this.CONVERGE_WAVE_MS, delay: this.CONVERGE_IMPACT_DELAY, easing: 'ease-out', fill: 'both' });
      } catch (_) { return null; }
    },
    scoreToHud(centerIdx, color, tier) {
      if (motionOff() || !this.supported) return;
      this.syncBoardRect();
      const hud = $('#hud-score');
      if (!hud) return;
      const hr = hud.getBoundingClientRect();
      if (!hr.width) return;
      const from = this.cellXY(centerIdx);
      const tx = hr.left + hr.width / 2, ty = hr.top + hr.height / 2;
      const n = Math.min(4, 2 + Math.max(0, tier || 0));
      for (let k = 0; k < n; k++) {
        this._flyStar(
          from.x + (Math.random() - 0.5) * 10,
          from.y + (Math.random() - 0.5) * 10,
          tx + (Math.random() - 0.5) * 20,
          ty + (Math.random() - 0.5) * 14,
          5 + Math.random() * 4,
          color || '#ffd84d',
          this.CONVERGE_IMPACT_DELAY + 80 + k * 36,
          460 + Math.random() * 120,
          true
        );
      }
    },
    // Convergencia magnética: viaja la ficha cuadrada COMPLETA, todos los bloques
    // colapsan a la vez y allí se reproduce el burst radial anterior + una onda corta.
    // Cada grupo tiene 5 fichas, 12 partículas y 1 onda precreadas: cero churn DOM.
    converge(centerIdx, cells, color) {
      if (motionOff() || !this.supported) return;
      this.syncBoardRect();
      const r = this.boardRect;
      if (!r || !r.width) return;
      const grid = this._gridMetrics(); if (!grid) return;
      const group = this._nextConvergeGroup(); if (!group) return;
      const center = grid.xy(centerIdx);
      const activeCells = cells.slice(0, this.MAX_CONVERGE_ICONS);
      const iconColors = [];
      let flights = 0, trails = 0;
      activeCells.forEach((idx, k) => {
        const id = (Render._cellId && Render._cellId[idx]) || State.board[idx];
        const iconColor = IconPacks.colorOf(Meta.equippedIconPack(), id);
        const from = grid.xy(idx);
        iconColors.push(iconColor);
        if (this._tracePath(group.trails[k], from, center, grid.cellPx, iconColor || color)) trails++;
        if (this._flyTile(group.tiles[k], id, Render.cells[idx], from, center, grid.cellW, grid.cellH)) flights++;
      });
      const particles = this._iconBurst(group.particles, center, iconColors, color, grid.cellPx);
      const wave = this._convergeWave(group.wave, center, grid.cellPx, color);
      return { flights, trails, particles, wave: !!wave };
    },
    // Conservado por compatibilidad con el bucle; las partículas son autónomas (WAAPI).
    step() { return false; },
  };

  /* ===================== Music (procedural, sin archivos; off por defecto) ===================== */
  const Music = {
    timer: 0, next: 0, step: 0, intensity: 0,
    scale: [220, 247, 294, 330, 392, 440, 494, 587],
    start() {
      if (!Settings.music) return;
      Sound.ensure(); if (!Sound.ctx) return;
      const t = Sound.ctx.currentTime;
      Sound.musicGain.gain.cancelScheduledValues(t);
      Sound.musicGain.gain.setValueAtTime(0.0001, t);
      Sound.musicGain.gain.linearRampToValueAtTime(0.14, t + 0.8);
      this.next = t + 0.1; this.step = 0;
      if (!this.timer) this.timer = setInterval(() => this._sched(), 60);
    },
    stop(fast) {
      if (Sound.ctx && Sound.musicGain) { const t = Sound.ctx.currentTime; Sound.musicGain.gain.cancelScheduledValues(t); Sound.musicGain.gain.linearRampToValueAtTime(0.0001, t + (fast ? 0.05 : 0.4)); }
      if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    },
    setIntensity(v) { this.intensity = clamp(v, 0, 1); if (this.timer && Sound.ctx) Sound.musicGain.gain.linearRampToValueAtTime(0.12 + 0.14 * this.intensity, Sound.ctx.currentTime + 0.3); },
    _note(f, dur, t, vol, type) { const o = Sound.ctx.createOscillator(), g = Sound.ctx.createGain(); o.type = type || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(Sound.musicGain); o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (_) { } }; o.start(t); o.stop(t + dur + 0.02); },
    _sched() {
      if (!Sound.ctx) return;
      const tempo = 0.30 - 0.12 * this.intensity, ahead = Sound.ctx.currentTime + 0.2;
      while (this.next < ahead) {
        const s = this.step;
        if (s % 4 === 0) this._note(this.scale[0] / 2, tempo * 3.6, this.next, 0.5, 'sine');
        const idx = (s * 3) % this.scale.length;
        this._note(this.scale[idx], tempo * 0.9, this.next, 0.32 + 0.3 * this.intensity, 'triangle');
        if (this.intensity > 0.5 && s % 2 === 0) this._note(this.scale[(idx + 4) % this.scale.length] * 2, tempo * 0.5, this.next, 0.16, 'sine');
        this.next += tempo; this.step++;
      }
    },
  };

  /* ===================== Cofres (catálogo + economía tipada) ===================== */
  const CHEST_TYPE_ORDER = ['wood', 'bronze', 'silver', 'gold', 'magic', 'royal', 'supreme', 'champion', 'divine', 'event'];
  const CHEST_TYPES = Object.freeze({
    wood: {
      id: 'wood', nameKey: 'chest_type_wood', sizeKey: 'chest_size_small', rarityKey: 'chest_tier_basic', descKey: 'chest_desc_wood',
      asset: 'img/ui-generated/chests/atlas/wood.png', accent: '#8fd6ff', durationMs: 3 * 60 * 60 * 1000, instantCost: 9,
      reward: { coins: [60, 199], gems: [3, 10], tickets: [1, 1], coinCut: .60, gemCut: .90, ticketCut: .98, rarity: 'common' },
    },
    bronze: {
      id: 'bronze', nameKey: 'chest_type_bronze', sizeKey: 'chest_size_small', rarityKey: 'chest_tier_common', descKey: 'chest_desc_bronze',
      asset: 'img/ui-generated/chests/atlas/bronze.png', accent: '#ff9a52', durationMs: 3 * 60 * 60 * 1000, instantCost: 9,
      reward: { coins: [90, 260], gems: [4, 12], tickets: [1, 1], coinCut: .56, gemCut: .86, ticketCut: .96, rarity: 'common' },
    },
    silver: {
      id: 'silver', nameKey: 'chest_type_silver', sizeKey: 'chest_size_medium', rarityKey: 'chest_tier_rare', descKey: 'chest_desc_silver',
      asset: 'img/ui-generated/chests/atlas/silver.png', accent: '#75c9ff', durationMs: 8 * 60 * 60 * 1000, instantCost: 24,
      reward: { coins: [140, 360], gems: [5, 15], tickets: [1, 2], coinCut: .50, gemCut: .78, ticketCut: .92, rarity: 'rare' },
    },
    gold: {
      id: 'gold', nameKey: 'chest_type_gold', sizeKey: 'chest_size_medium', rarityKey: 'chest_tier_epic', descKey: 'chest_desc_gold',
      asset: 'img/ui-generated/chests/atlas/gold.png', accent: '#ffc52f', durationMs: 8 * 60 * 60 * 1000, instantCost: 24,
      reward: { coins: [200, 500], gems: [7, 18], tickets: [2, 3], coinCut: .46, gemCut: .72, ticketCut: .87, rarity: 'epic' },
    },
    magic: {
      id: 'magic', nameKey: 'chest_type_magic', sizeKey: 'chest_size_large', rarityKey: 'chest_tier_epic', descKey: 'chest_desc_magic',
      asset: 'img/ui-generated/chests/atlas/magic.png', accent: '#d45cff', durationMs: 12 * 60 * 60 * 1000, instantCost: 36,
      reward: { coins: [280, 700], gems: [10, 24], tickets: [2, 4], coinCut: .40, gemCut: .64, ticketCut: .78, rarity: 'epic' },
    },
    royal: {
      id: 'royal', nameKey: 'chest_type_royal', sizeKey: 'chest_size_large', rarityKey: 'chest_tier_legendary', descKey: 'chest_desc_royal',
      asset: 'img/ui-generated/chests/atlas/royal.png', accent: '#4fa2ff', durationMs: 12 * 60 * 60 * 1000, instantCost: 36,
      reward: { coins: [400, 950], gems: [14, 30], tickets: [3, 5], coinCut: .36, gemCut: .55, ticketCut: .68, rarity: 'legendary' },
    },
    supreme: {
      id: 'supreme', nameKey: 'chest_type_supreme', sizeKey: 'chest_size_xlarge', rarityKey: 'chest_tier_legendary', descKey: 'chest_desc_supreme',
      asset: 'img/ui-generated/chests/atlas/supreme.png', accent: '#ff4f9a', durationMs: 24 * 60 * 60 * 1000, instantCost: 72,
      reward: { coins: [550, 1250], gems: [18, 38], tickets: [4, 6], coinCut: .30, gemCut: .46, ticketCut: .58, rarity: 'legendary' },
    },
    champion: {
      id: 'champion', nameKey: 'chest_type_champion', sizeKey: 'chest_size_xlarge', rarityKey: 'chest_tier_mythic', descKey: 'chest_desc_champion',
      asset: 'img/ui-generated/chests/atlas/champion.png', accent: '#9c6cff', durationMs: 24 * 60 * 60 * 1000, instantCost: 72,
      reward: { coins: [750, 1600], gems: [24, 48], tickets: [5, 8], coinCut: .25, gemCut: .40, ticketCut: .50, rarity: 'mythic' },
    },
    divine: {
      id: 'divine', nameKey: 'chest_type_divine', sizeKey: 'chest_size_huge', rarityKey: 'chest_tier_mythic', descKey: 'chest_desc_divine',
      asset: 'img/ui-generated/chests/atlas/divine.png', accent: '#77edff', durationMs: 36 * 60 * 60 * 1000, instantCost: 108,
      reward: { coins: [1000, 2400], gems: [35, 70], tickets: [7, 10], coinCut: .20, gemCut: .32, ticketCut: .40, rarity: 'mythic' },
    },
    event: {
      id: 'event', nameKey: 'chest_type_event', sizeKey: 'chest_size_variable', rarityKey: 'chest_tier_special', descKey: 'chest_desc_event',
      asset: 'img/ui-generated/chests/atlas/event.png', accent: '#5ee07a', durationMs: 8 * 60 * 60 * 1000, instantCost: 24,
      reward: { coins: [180, 520], gems: [8, 22], tickets: [2, 4], coinCut: .38, gemCut: .63, ticketCut: .78, rarity: 'special' },
    },
  });

  const CHEST_HOUR_MS = 60 * 60 * 1000;
  const CHEST_SKIP_GEMS_PER_HOUR = 3;
  // Duraciones vigentes antes de CH-3. Solo se usan para migrar cofres que ya
  // estaban en el inventario y todavía no tenían una duración propia guardada.
  const LEGACY_CHEST_DURATIONS = Object.freeze({
    wood: 3 * CHEST_HOUR_MS, bronze: 4 * CHEST_HOUR_MS,
    silver: 6 * CHEST_HOUR_MS, gold: 8 * CHEST_HOUR_MS,
    magic: 12 * CHEST_HOUR_MS, royal: 16 * CHEST_HOUR_MS,
    supreme: 20 * CHEST_HOUR_MS, champion: 24 * CHEST_HOUR_MS,
    divine: 36 * CHEST_HOUR_MS, event: 6 * CHEST_HOUR_MS,
  });
  function storedChestDuration(chest) {
    const saved = Number(chest && chest.durationMs);
    if (Number.isFinite(saved) && saved > 0) return saved;
    const type = chest && CHEST_TYPES[chest.type] ? chest.type : 'wood';
    return CHEST_TYPES[type].durationMs;
  }

  /* CH-4: la apertura es una ceremonia multi-tirada — el TAMAÑO del cofre pasa de
   * ser cosmético a significar nº de premios por apertura. */
  const CHEST_ROLL_COUNTS = {
    chest_size_small: 2, chest_size_medium: 3, chest_size_large: 3,
    chest_size_xlarge: 4, chest_size_huge: 4, chest_size_variable: 3,
  };
  function chestRollCount(type) {
    const defn = CHEST_TYPES[type] || CHEST_TYPES.wood;
    return CHEST_ROLL_COUNTS[defn.sizeKey] || 2;
  }
  /* CH-4: ruleta de mejora al abrir (publicada en el catálogo): un tier arriba con
   * 10% de probabilidad; el cofre de evento asciende a real. */
  const CHEST_UPGRADE_CHANCE = 0.10;
  const CHEST_UPGRADE_PATH = {
    wood: 'bronze', bronze: 'silver', silver: 'gold', gold: 'magic', magic: 'royal',
    royal: 'supreme', supreme: 'champion', champion: 'divine', event: 'royal',
  };
  const CHEST_GUARANTEED_COIN_SHARE = 0.25;
  const CHEST_BONUS_ODDS = Object.freeze({ coins: .52, gems: .23, tickets: .13, booster: .12 });
  const CHEST_BOOSTER_IDS = Object.freeze(['bomb', 'freeze', 'clearLine', 'wild', 'x2']);
  const XP_BOOST_MULTIPLIER = 4;
  /* CH-4 (F7): monedas y gemas escalan con el nivel meta (como el escalado
   * por arena de CR) — +5%/nivel con tope ×2.5. Los tickets no escalan. */
  function chestLevelScale(level) { return Math.min(2.5, 1 + 0.05 * (Math.max(1, level | 0) - 1)); }

  /* Rangos y probabilidades REALES de un tipo de cofre, para mostrarlos tal cual
   * en la UI (CH-1: transparencia; ver docs/CHEST_SYSTEM_MASTER_PLAN.md §4-U2/E3).
   * El redondeo por categoría puede no sumar 100 exacto y es aceptable.
   * `level` (opcional) aplica el escalado real de monedas para que lo mostrado
   * coincida con lo que caerá de verdad. */
  function chestOdds(type, level) {
    const validType = CHEST_TYPES[type] ? type : 'wood';
    const r = CHEST_TYPES[validType].reward;
    const pct = (v) => Math.round(v * 100);
    const s = level ? chestLevelScale(level) : 1;
    const upgradeTo = CHEST_UPGRADE_PATH[validType] || null;
    const bonusCoinSpan = Math.max(10, Math.round(r.coins[1] * 0.12));
    const bonusGemSpan = Math.max(2, Math.round(r.gems[1] * 0.2));
    return {
      coins: { min: Math.round(r.coins[0] * s), max: Math.round(r.coins[1] * s), pct: pct(r.coinCut) },
      gems: { min: Math.round(r.gems[0] * s), max: Math.round(r.gems[1] * s), pct: pct(r.gemCut - r.coinCut) },
      tickets: { min: r.tickets[0], max: r.tickets[1], pct: pct(r.ticketCut - r.gemCut) },
      cosmetic: { pct: Math.max(1, pct(1 - r.ticketCut)) },
      guaranteedCoins: {
        min: Math.max(1, Math.round(r.coins[0] * s * CHEST_GUARANTEED_COIN_SHARE)),
        max: Math.max(1, Math.round(r.coins[1] * s * CHEST_GUARANTEED_COIN_SHARE)),
      },
      rolls: chestRollCount(validType),
      upgrade: { to: upgradeTo, pct: upgradeTo ? pct(CHEST_UPGRADE_CHANCE) : 0 },
      bonus: {
        count: Math.max(0, chestRollCount(validType) - 2),
        coinsPct: pct(CHEST_BONUS_ODDS.coins), gemsPct: pct(CHEST_BONUS_ODDS.gems),
        ticketsPct: pct(CHEST_BONUS_ODDS.tickets), boosterPct: pct(CHEST_BONUS_ODDS.booster),
        coins: { min: Math.max(1, Math.round(10 * s)), max: Math.max(1, Math.round((9 + bonusCoinSpan) * s)) },
        gems: { min: Math.max(1, Math.round(s)), max: Math.max(1, Math.round(bonusGemSpan * s)) },
      },
    };
  }

  /* ===================== Iconos y bordes del jugador ===================== */
  /* ===================== Rarity (rareza cosmética) =====================
   * Sistema transversal de rareza para iconos, bordes, tableros, temas y logros.
   * Es puramente cosmético/organizativo: agrupa y colorea la colección, no toca
   * reglas, puntuación ni economía. Cada def cosmética lleva un campo `rarity`.
   */
  const Rarity = {
    ORDER: ['common', 'rare', 'epic', 'legendary'],
    DEFS: {
      common: { label: 'rarity_common', plural: 'rarity_commons', accent: '#9fb0d6', accent2: '#6c7aa6', glow: 'rgba(159,176,214,.45)' },
      rare: { label: 'rarity_rare', plural: 'rarity_rares', accent: '#3fb2ff', accent2: '#1f76d8', glow: 'rgba(63,178,255,.55)' },
      epic: { label: 'rarity_epic', plural: 'rarity_epics', accent: '#b46bff', accent2: '#7a34d8', glow: 'rgba(180,107,255,.55)' },
      legendary: { label: 'rarity_legendary', plural: 'rarity_legendaries', accent: '#ffc23d', accent2: '#ff8a1e', glow: 'rgba(255,194,61,.6)' },
    },
    of(def) { return def && this.DEFS[def.rarity] ? def.rarity : 'common'; },
    label(r) { const d = this.DEFS[r] || this.DEFS.common; return I18n.t(d.label); },
    plural(r) { const d = this.DEFS[r] || this.DEFS.common; return I18n.t(d.plural); },
    accent(r) { return (this.DEFS[r] || this.DEFS.common).accent; },
    // Devuelve {common:{owned,total}, ...} para una lista [{rarity, owned}].
    tally(items) {
      const out = {};
      this.ORDER.forEach((r) => { out[r] = { owned: 0, total: 0 }; });
      items.forEach((it) => {
        const r = this.DEFS[it.rarity] ? it.rarity : 'common';
        out[r].total += 1;
        if (it.owned) out[r].owned += 1;
      });
      return out;
    },
  };

  const PlayerIcons = {
    DEFAULT: 'nova',
    DEFS: {
      nova: { name: 'Nova', cost: 0, rarity: 'common', asset: 'img/player-icons/nova.png' },
      comet: { name: 'Cometa', cost: 260, rarity: 'common', asset: 'img/player-icons/comet.png' },
      prism: { name: 'Prisma', cost: 320, rarity: 'common', asset: 'img/player-icons/prism.png' },
      sentinel: { name: 'Centinela', cost: 420, rarity: 'rare', asset: 'img/player-icons/sentinel.png' },
      nebula: { name: 'Nébula', cost: 560, rarity: 'rare', asset: 'img/player-icons/nebula.png' },
      orbit: { name: 'Órbita', cost: 720, rarity: 'rare', asset: 'img/player-icons/orbit.png' },
      flare: { name: 'Llama', cost: 920, rarity: 'epic', asset: 'img/player-icons/flare.png' },
      crystal: { name: 'Cristal', cost: 1150, rarity: 'epic', asset: 'img/player-icons/crystal.png' },
      void: { name: 'Vacío', cost: 1450, rarity: 'legendary', asset: 'img/player-icons/void.png' },
      pulse: { name: 'Pulso', cost: 1750, rarity: 'legendary', asset: 'img/player-icons/pulse.png' },
    },
    order: ['nova', 'comet', 'prism', 'sentinel', 'nebula', 'orbit', 'flare', 'crystal', 'void', 'pulse'],
    html(id, cls) {
      const d = this.DEFS[id] || this.DEFS[this.DEFAULT];
      const klass = cls ? ` ${cls}` : '';
      return `<img class="player-icon-png${klass}" src="${d.asset}" alt="${esc(d.name)}" draggable="false">`;
    },
  };

  const PlayerBorders = {
    DEFAULT: 'starlight',
    DEFS: {
      starlight: { name: 'Luz estelar', cost: 0, rarity: 'common', asset: 'img/player-borders/starlight.png' },
      plasma: { name: 'Plasma', cost: 320, rarity: 'common', asset: 'img/player-borders/plasma.png' },
      royal: { name: 'Real', cost: 420, rarity: 'common', asset: 'img/player-borders/royal.png' },
      aurora: { name: 'Aurora', cost: 560, rarity: 'rare', asset: 'img/player-borders/aurora.png' },
      comet: { name: 'Cometa', cost: 700, rarity: 'rare', asset: 'img/player-borders/comet.png' },
      crystal: { name: 'Cristal', cost: 920, rarity: 'rare', asset: 'img/player-borders/crystal.png' },
      eclipse: { name: 'Eclipse', cost: 1150, rarity: 'epic', asset: 'img/player-borders/eclipse.png' },
      circuit: { name: 'Circuito', cost: 1380, rarity: 'epic', asset: 'img/player-borders/circuit.png' },
      bloom: { name: 'Bloom', cost: 1580, rarity: 'epic', asset: 'img/player-borders/bloom.png' },
      mythic: { name: 'Mítico', cost: 1900, rarity: 'legendary', asset: 'img/player-borders/mythic.png' },
    },
    order: ['starlight', 'plasma', 'royal', 'aurora', 'comet', 'crystal', 'eclipse', 'circuit', 'bloom', 'mythic'],
    html(id, cls) {
      const d = this.DEFS[id] || this.DEFS[this.DEFAULT];
      const klass = cls ? ` ${cls}` : '';
      return `<img class="player-border-png${klass}" src="${d.asset}" alt="" aria-hidden="true" draggable="false">`;
    },
  };

  function playerAvatarHtml(iconId, borderId, cls) {
    const icon = PlayerIcons.DEFS[iconId] ? iconId : PlayerIcons.DEFAULT;
    const border = PlayerBorders.DEFS[borderId] ? borderId : PlayerBorders.DEFAULT;
    return `<span class="player-avatar-shell ${cls || ''}" data-player-frame="${border}"><span class="player-avatar-aura" aria-hidden="true"></span><span class="player-avatar-art">${PlayerIcons.html(icon)}</span><img class="player-avatar-frame" src="${PlayerBorders.DEFS[border].asset}" alt="" aria-hidden="true" draggable="false"></span>`;
  }

  /* ===================== Meta (progresión persistente) ===================== */

  const Meta = (() => {
    const KEY = 'cv_meta';
    const SCHEMA = 10;
    const def = { _v: SCHEMA, xp: 0, level: 1, games: 0, totalRemoved: 0, coins: 0, gems: 0, tickets: 0, chests: 0, xpBoostUntil: 0, achievements: {}, daily: { date: '' }, streak: { count: 0, date: '' }, reward: { date: '', day: 0 }, adventure: { maxLevel: 1 }, worlds: {}, boards: { owned: { classic: 1 }, equipped: 'classic' }, survBest: 0, survBestWave: 0, stats: { totalScore: 0, bestCombo: 0, totalTime: 0 }, modes: {}, weekly: { week: '', id: '', progress: 0, done: false }, mastery: { classicPerfect: 0, bestClassicPerfect: 0 }, cosmetics: { owned: {}, theme: 'default', skin: 'default', fx: 'default', avatarIcon: PlayerIcons.DEFAULT, avatarBorder: PlayerBorders.DEFAULT, avatarIcons: { nova: 1 }, avatarBorders: { starlight: 1 }, iconPack: IconPacks.DEFAULT, iconPacks: { cosmos: 1 } } };
    Object.assign(def, { chestInventory: [], chestUnlock: null, chestSlots: 3, chestSeq: 0 });
    // Esquema 5 (CH-2): pipeline universal de cofres — objetivos de CUALQUIER modo
    // avanzan un ciclo determinista de cofres; cofre diario de primera victoria.
    Object.assign(def, {
      chestPipeline: { wins: 0, cycle: 0 }, dailyChest: { date: '' }, chestReady: [], chestNotifiedReady: [],
      boosterStock: { bomb: 0, freeze: 0, clearLine: 0, wild: 0, x2: 0 },
    });
    let m;
    try { m = Object.assign({}, def, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (_) { m = JSON.parse(JSON.stringify(def)); }
    // Migración de esquema (rellena campos nuevos sin perder progreso previo).
    if (!m.cosmetics) m.cosmetics = JSON.parse(JSON.stringify(def.cosmetics));
    if (!m.cosmetics.owned || typeof m.cosmetics.owned !== 'object') m.cosmetics.owned = {};
    if (!m.cosmetics.avatarIcons || typeof m.cosmetics.avatarIcons !== 'object') m.cosmetics.avatarIcons = {};
    if (!m.cosmetics.avatarBorders || typeof m.cosmetics.avatarBorders !== 'object') m.cosmetics.avatarBorders = {};
    m.cosmetics.avatarIcons[PlayerIcons.DEFAULT] = m.cosmetics.avatarIcons[PlayerIcons.DEFAULT] || 1;
    m.cosmetics.avatarBorders[PlayerBorders.DEFAULT] = m.cosmetics.avatarBorders[PlayerBorders.DEFAULT] || 1;
    if (!PlayerIcons.DEFS[m.cosmetics.avatarIcon] || !m.cosmetics.avatarIcons[m.cosmetics.avatarIcon]) m.cosmetics.avatarIcon = PlayerIcons.DEFAULT;
    if (!PlayerBorders.DEFS[m.cosmetics.avatarBorder] || !m.cosmetics.avatarBorders[m.cosmetics.avatarBorder]) m.cosmetics.avatarBorder = PlayerBorders.DEFAULT;
    // Packs de iconos de tablero (retrocompatible: partidas viejas reciben el pack por defecto).
    if (!m.cosmetics.iconPacks || typeof m.cosmetics.iconPacks !== 'object') m.cosmetics.iconPacks = {};
    m.cosmetics.iconPacks[IconPacks.DEFAULT] = m.cosmetics.iconPacks[IconPacks.DEFAULT] || 1;
    if (!IconPacks.DEFS[m.cosmetics.iconPack] || !m.cosmetics.iconPacks[m.cosmetics.iconPack]) m.cosmetics.iconPack = IconPacks.DEFAULT;
    if (!m.streak || typeof m.streak !== 'object') m.streak = { count: Number(m.streak) || 0, date: '' };
    if (typeof m.streak.count !== 'number') m.streak.count = 0;
    if (!m.reward) m.reward = { date: '', day: 0 };
    if (!m.adventure) m.adventure = { maxLevel: 1 };
    if (!m.stats) m.stats = { totalScore: 0, bestCombo: 0, totalTime: 0 };
    if (!m.modes) m.modes = {};
    if (!m.weekly) m.weekly = { week: '', id: '', progress: 0, done: false };
    if (!m.mastery) m.mastery = { classicPerfect: 0, bestClassicPerfect: 0 };
    if (typeof m.mastery.classicPerfect !== 'number') m.mastery.classicPerfect = 0;
    if (typeof m.mastery.bestClassicPerfect !== 'number') m.mastery.bestClassicPerfect = 0;
    if (!m.dailyRun) m.dailyRun = { date: '', best: 0, plays: 0 }; // reto diario (tablero seedeado por fecha)
    if (typeof m.coins !== 'number') m.coins = 0;
    if (!Number.isFinite(m.xpBoostUntil) || m.xpBoostUntil < 0) m.xpBoostUntil = 0;
    if (typeof m.survBestWave !== 'number') m.survBestWave = 0;
    if (!m.survBestWaves || typeof m.survBestWaves !== 'object') m.survBestWaves = { facil: 0, normal: 0, dificil: 0 };
    // Hoja de Servicio del Superviviente (SV-30): acumulación VITALICIA — nada caduca
    // ni decae. `feats`/`boonsSeen`/`mutsWon` son mapas {id:1}; `weekBest` es la marca
    // de la semana ISO en curso (se reinicia sola al cambiar de semana, solo hacia arriba).
    if (!m.surv || typeof m.surv !== 'object') m.surv = {};
    if (typeof m.surv.totalWaves !== 'number') m.surv.totalWaves = 0;
    if (typeof m.surv.totalBosses !== 'number') m.surv.totalBosses = 0;
    if (typeof m.surv.runs !== 'number') m.surv.runs = 0;
    if (!m.surv.feats || typeof m.surv.feats !== 'object') m.surv.feats = {};
    if (!m.surv.boonsSeen || typeof m.surv.boonsSeen !== 'object') m.surv.boonsSeen = {};
    if (!m.surv.mutsWon || typeof m.surv.mutsWon !== 'object') m.surv.mutsWon = {};
    if (!m.surv.weekBest || typeof m.surv.weekBest !== 'object') m.surv.weekBest = { week: '', wave: 0, mut: 'none' };
    // Bestiario de encuentros (JF-ε): {id: {seen, kills, flawless, maxLvl}} — vitalicio, nada decae.
    if (!m.surv.bossDex || typeof m.surv.bossDex !== 'object') m.surv.bossDex = {};
    if (typeof m.surv.masterRounds !== 'number') m.surv.masterRounds = 0;
    // Esquema 3: economía ampliada (gemas/tickets/cofres), tableros de tienda y mundos del modo Clásico.
    if (typeof m.gems !== 'number') m.gems = 0;
    if (typeof m.tickets !== 'number') m.tickets = 0;
    if (typeof m.chests !== 'number') m.chests = 0;
    if (!Array.isArray(m.chestInventory)) m.chestInventory = [];
    if (!m.chestUnlock || typeof m.chestUnlock !== 'object') m.chestUnlock = null;
    if (!Number.isFinite(m.chestSlots)) m.chestSlots = 3;
    m.chestSlots = clamp(m.chestSlots | 0, 3, 4);
    if (!Number.isSafeInteger(Number(m.chestSeq)) || Number(m.chestSeq) < 0) m.chestSeq = 0;
    else m.chestSeq = Math.min(Number(m.chestSeq), 1000000000);
    // Esquema 5 (CH-2): partidas guardadas anteriores empiezan el ciclo desde cero.
    if (!m.chestPipeline || typeof m.chestPipeline !== 'object') m.chestPipeline = { wins: 0, cycle: 0 };
    if (!Number.isFinite(m.chestPipeline.wins)) m.chestPipeline.wins = 0;
    if (!Number.isFinite(m.chestPipeline.cycle)) m.chestPipeline.cycle = 0;
    if (!m.dailyChest || typeof m.dailyChest !== 'object') m.dailyChest = { date: '' };
    // CH-3: cofres terminados y sin recoger (no bloquean el siguiente temporizador).
    if (!Array.isArray(m.chestReady)) m.chestReady = [];
    if (!Array.isArray(m.chestNotifiedReady)) m.chestNotifiedReady = [];
    // Esquema 7 (CH-4): inventario persistente de potenciadores ganados en cofres.
    if (!m.boosterStock || typeof m.boosterStock !== 'object' || Array.isArray(m.boosterStock)) m.boosterStock = {};
    CHEST_BOOSTER_IDS.forEach((id) => {
      const value = Number(m.boosterStock[id]);
      m.boosterStock[id] = Number.isSafeInteger(value) ? clamp(value, 0, 1000000) : 0;
    });
    if (!m.worlds || typeof m.worlds !== 'object') m.worlds = {};
    if (!m.boards || typeof m.boards !== 'object') m.boards = { owned: { classic: 1 }, equipped: 'classic' };
    if (!m.boards.owned) m.boards.owned = { classic: 1 };
    m.boards.owned.classic = 1; // el tablero Clásico es siempre propiedad (gratis)
    if (!m.boards.equipped || !m.boards.owned[m.boards.equipped]) m.boards.equipped = 'classic';
    m._v = SCHEMA;
    const save = () => {
      try {
        const value = JSON.stringify(m);
        localStorage.setItem(KEY, value);
        Platform.mirrorStorage(KEY, value);
      } catch (_) { }
    };
    const today = () => new Date().toISOString().slice(0, 10);
    const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
    const CHEST_DROP_SEQUENCE = [
      'wood', 'bronze', 'wood', 'silver', 'bronze', 'wood', 'gold', 'bronze',
      'silver', 'magic', 'wood', 'bronze', 'royal', 'wood', 'silver', 'bronze',
      'supreme', 'gold', 'wood', 'gold', 'bronze', 'silver', 'wood', 'champion',
      'gold', 'bronze', 'magic', 'wood', 'silver', 'royal', 'bronze', 'divine',
    ];
    const validChestType = (id) => CHEST_TYPES[id] ? id : 'wood';
    function nextChestType(preferred) {
      if (preferred && CHEST_TYPES[preferred]) return preferred;
      const id = CHEST_DROP_SEQUENCE[m.chestSeq % CHEST_DROP_SEQUENCE.length];
      return validChestType(id);
    }
    function freshChestUid() {
      m.chestSeq = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number(m.chestSeq) || 0) + 1);
      return `ch-${Date.now().toString(36)}-${m.chestSeq.toString(36)}`;
    }
    function makeChest(type, source, durationMs, snapshot) {
      const validType = validChestType(type);
      const chest = {
        uid: freshChestUid(),
        type: validType,
        source: source || 'reward',
        earnedAt: Date.now(),
        // Snapshot: futuros rebalanceos no cambian un cofre ya ganado.
        durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : CHEST_TYPES[validType].durationMs,
      };
      // Solo se admiten los dos payloads versionados: un snapshot nunca puede
      // sobreescribir uid/tipo/duración ni colar campos arbitrarios en la UI.
      if (snapshot && typeof snapshot === 'object') {
        if (snapshot.choice) chest.choice = JSON.parse(JSON.stringify(snapshot.choice));
        if (snapshot.event) chest.event = JSON.parse(JSON.stringify(snapshot.event));
      }
      return chest;
    }
    function utcDayOrdinal(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
      const parts = String(value).split('-').map(Number);
      const stamp = Date.UTC(parts[0], parts[1] - 1, parts[2]);
      const normalized = new Date(stamp).toISOString().slice(0, 10);
      return Number.isFinite(stamp) && normalized === String(value) ? Math.floor(stamp / 86400000) : null;
    }
    function dailyChoiceOptions(type) {
      const defn = CHEST_TYPES[type] || CHEST_TYPES.bronze, r = defn.reward;
      const scale = chestLevelScale(m.level);
      const ranged = ([min, max]) => min === max ? min : min + Math.floor(Math.random() * (max - min + 1));
      const thirdIsBooster = Math.random() < .5;
      const third = thirdIsBooster
        ? {
          id: 'booster', kind: 'booster',
          boosterId: CHEST_BOOSTER_IDS[Math.floor(Math.random() * CHEST_BOOSTER_IDS.length)], amount: 1, rarity: 'rare',
        }
        : { id: 'tickets', kind: 'ticket', amount: Math.max(1, ranged(r.tickets)), rarity: r.rarity };
      return [
        { id: 'coins', kind: 'coins', amount: Math.max(1, Math.round(ranged(r.coins) * scale)), rarity: r.rarity },
        { id: 'gems', kind: 'gems', amount: Math.max(1, Math.round(ranged(r.gems) * scale)), rarity: r.rarity },
        third,
      ];
    }
    const CHEST_REWARD_RARITIES = new Set(['common', 'rare', 'epic', 'legendary', 'mythic', 'special']);
    function validChoiceOption(option) {
      if (!option || typeof option !== 'object' || !/^[a-z][a-z0-9_-]{0,31}$/.test(String(option.id || ''))) return false;
      if (!['coins', 'gems', 'ticket', 'booster'].includes(option.kind)) return false;
      const amount = option.amount;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) return false;
      if (!CHEST_REWARD_RARITIES.has(option.rarity)) return false;
      return option.kind !== 'booster' || (amount <= 10 && CHEST_BOOSTER_IDS.includes(option.boosterId));
    }
    function validChestChoice(choice) {
      return !!choice && typeof choice === 'object' && choice.id === `daily:${choice.date}`
        && utcDayOrdinal(choice.date) !== null && ['bronze', 'silver'].includes(choice.tier)
        && typeof choice.catchUp === 'boolean' && (choice.catchUp ? choice.tier === 'silver' : choice.tier === 'bronze')
        && Array.isArray(choice.options) && choice.options.length === 3 && choice.options.every(validChoiceOption)
        && new Set(choice.options.map((option) => option.id)).size === 3;
    }
    function makeDailyChoice(date, tier, catchUp) {
      return {
        id: `daily:${date}`, date, tier, catchUp: !!catchUp,
        options: dailyChoiceOptions(tier),
      };
    }
    function validChestEvent(event) {
      return !!event && typeof event === 'object' && !Array.isArray(event)
        && utcDayOrdinal(event.week) !== null && /^w_(games|remove|score|combo)$/.test(String(event.challengeId || ''))
        && event.id === `weekly:${event.week}:${event.challengeId}`
        && CHEST_BOOSTER_IDS.includes(event.featuredBooster)
        && /^[a-z0-9-]{1,32}$/.test(String(event.source || ''));
    }
    function makeChestEventSnapshot(source) {
      const weekly = weeklyChallenge();
      const safeSource = /^[a-z0-9-]{1,32}$/.test(String(source || '')) ? String(source) : 'weekly';
      const seed = Math.abs(hashStr(`${weekly.week}:${weekly.id}`));
      return {
        id: `weekly:${weekly.week}:${weekly.id}`, week: weekly.week, challengeId: weekly.id,
        featuredBooster: CHEST_BOOSTER_IDS[seed % CHEST_BOOSTER_IDS.length], source: safeSource,
      };
    }
    function ensureChestInventory() {
      const wanted = Math.max(0, m.chests | 0);
      const seen = new Set();
      let changed = false;
      let list = (Array.isArray(m.chestInventory) ? m.chestInventory : []).map((entry) => {
        if (typeof entry === 'string') {
          changed = true;
          const type = validChestType(entry);
          return makeChest(type, 'legacy', LEGACY_CHEST_DURATIONS[type]);
        }
        return entry;
      }).filter((entry) => {
        if (!entry || typeof entry !== 'object') { changed = true; return false; }
        const oldUid = entry.uid, duplicate = typeof oldUid === 'string' && seen.has(oldUid);
        if (typeof oldUid !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(oldUid) || duplicate) {
          entry.uid = freshChestUid(); changed = true;
          // Un UID corrupto se repara sin perder el cofre ni su estado de timer.
          // En duplicados, las referencias siguen perteneciendo al primer cofre.
          if (!duplicate && typeof oldUid === 'string') {
            if (m.chestUnlock && m.chestUnlock.uid === oldUid) m.chestUnlock.uid = entry.uid;
            m.chestReady = m.chestReady.map((uid) => uid === oldUid ? entry.uid : uid);
            m.chestNotifiedReady = m.chestNotifiedReady.map((uid) => uid === oldUid ? entry.uid : uid);
          }
        }
        seen.add(entry.uid);
        if (!CHEST_TYPES[entry.type]) { entry.type = 'wood'; changed = true; }
        if (!Number.isFinite(Number(entry.durationMs)) || Number(entry.durationMs) <= 0) {
          entry.durationMs = LEGACY_CHEST_DURATIONS[entry.type] || CHEST_TYPES[entry.type].durationMs;
          changed = true;
        } else if (typeof entry.durationMs !== 'number') {
          entry.durationMs = Number(entry.durationMs); changed = true;
        }
        // Choice Chests inválidos degradan a un cofre normal del mismo tier: nunca
        // se pierde el cofre ni se acepta una opción manipulada/incompleta.
        if (entry.choice && (!validChestChoice(entry.choice) || entry.choice.tier !== entry.type)) { delete entry.choice; changed = true; }
        if (entry.type === 'event' && !validChestEvent(entry.event)) {
          // Cofres de evento ganados antes de CH-5 reciben una foto del evento
          // vigente una única vez: conservan el cofre y cumplen la promesa del catálogo.
          entry.event = makeChestEventSnapshot(entry.source || 'legacy'); changed = true;
        } else if (entry.type !== 'event' && entry.event) { delete entry.event; changed = true; }
        return true;
      });
      if (list.length > wanted) { list = list.slice(0, wanted); changed = true; }
      // Los contadores de partidas antiguas no tenían tipo. Se migran a madera de
      // forma determinista para no consumir Math.random ni alterar tiradas existentes.
      while (list.length < wanted) { list.push(makeChest('wood', 'legacy')); changed = true; }
      m.chestInventory = list;
      if (m.chestUnlock && !list.some((entry) => entry.uid === m.chestUnlock.uid)) { m.chestUnlock = null; changed = true; }
      if (Array.isArray(m.chestReady)) {
        const readySeen = new Set();
        const pruned = m.chestReady.filter((uid) => list.some((entry) => entry.uid === uid) && !readySeen.has(uid) && readySeen.add(uid));
        if (pruned.length !== m.chestReady.length) { m.chestReady = pruned; changed = true; }
      }
      if (Array.isArray(m.chestNotifiedReady)) {
        const notified = m.chestNotifiedReady.filter((uid) => m.chestReady.includes(uid));
        if (notified.length !== m.chestNotifiedReady.length) { m.chestNotifiedReady = notified; changed = true; }
      }
      if (changed) save();
      return list;
    }
    const xpForLevel = (lvl) => 300 + (lvl - 1) * 250;
    const RANKS = ['Novato', 'Aprendiz', 'Hábil', 'Experto', 'Maestro', 'Leyenda', 'Mítico'];
    const ACH = [
      { id: 'first', name: 'Primer paso', desc: 'Completa tu primera partida', rarity: 'common', t: c => c.games >= 1 },
      { id: 'combo10', name: 'En racha', desc: 'Consigue un combo ×10', rarity: 'common', t: c => c.maxCombo >= 10 },
      { id: 'combo20', name: 'Imparable', desc: 'Consigue un combo ×20', rarity: 'epic', t: c => c.maxCombo >= 20 },
      { id: 'perfect', name: 'Impecable', desc: 'Deja el tablero vacío', rarity: 'rare', t: c => c.perfect },
      { id: 'score3k', name: 'Triple millar', desc: 'Supera 3000 puntos', rarity: 'epic', t: c => c.score >= 3000 },
      { id: 'score8k', name: 'Leyenda viva', desc: 'Supera 8000 puntos', rarity: 'legendary', t: c => c.score >= 8000 },
      { id: 'level5', name: 'Escalador', desc: 'Alcanza el nivel 5', rarity: 'rare', t: c => c.level >= 5 },
      { id: 'remove200', name: 'Demoledor', desc: 'Elimina 200 iconos (total)', rarity: 'epic', t: c => m.totalRemoved >= 200 },
      { id: 'fever', name: '¡Fiebre!', desc: 'Entra en modo Fever', rarity: 'legendary', t: c => c.fever },
      { id: 'streak3', name: 'Constante', desc: 'Juega 3 días seguidos', rarity: 'common', t: c => m.streak.count >= 3 },
      { id: 'variety5', name: 'Explorador', desc: 'Juega los 5 modos principales', rarity: 'rare', t: () => ['clasico', 'aventura', 'contrarreloj', 'supervivencia', 'zen'].every(k => ((m.modes[k] && m.modes[k].plays) || 0) > 0) },
    ];
    const MISSIONS = [
      { id: 'm_combo', text: 'Consigue un combo ×8', target: 8, kind: 'combo' },
      { id: 'm_remove', text: 'Elimina 80 iconos en una partida', target: 80, kind: 'remove' },
      { id: 'm_score', text: 'Haz 2500 puntos en una partida', target: 2500, kind: 'score' },
      { id: 'm_perfect', text: 'Deja el tablero vacío una vez', target: 1, kind: 'perfect' },
    ];
    function dailyMission() {
      const d = today();
      if (m.daily.date !== d) { const idx = Math.abs(hashStr(d)) % MISSIONS.length; m.daily = { date: d, id: MISSIONS[idx].id, progress: 0, done: false }; save(); }
      return Object.assign({}, MISSIONS.find(x => x.id === m.daily.id), m.daily);
    }
    // Reto semanal (acumulativo durante la semana)
    const WEEKLY = [
      { id: 'w_games', text: 'Juega 12 partidas esta semana', target: 12, kind: 'games' },
      { id: 'w_remove', text: 'Elimina 800 iconos esta semana', target: 800, kind: 'remove' },
      { id: 'w_score', text: 'Suma 20.000 puntos esta semana', target: 20000, kind: 'score' },
      { id: 'w_combo', text: 'Consigue un combo ×15', target: 15, kind: 'combo' },
    ];
    function weekId(dt) { const t = dt || new Date(); const o = new Date(t); o.setHours(0, 0, 0, 0); o.setDate(o.getDate() - ((o.getDay() + 6) % 7)); return o.toISOString().slice(0, 10); }
    function weeklyChallenge() {
      const w = weekId();
      if (m.weekly.week !== w) { const idx = Math.abs(hashStr(w)) % WEEKLY.length; m.weekly = { week: w, id: WEEKLY[idx].id, progress: 0, done: false }; save(); }
      return Object.assign({}, WEEKLY.find(x => x.id === m.weekly.id), m.weekly);
    }
    return {
      get state() { return m; },
      level: () => m.level, xp: () => m.xp, xpForLevel, streak: () => m.streak.count,
      rank: () => RANKS[Math.min(RANKS.length - 1, Math.floor((m.level - 1) / 3))],
      dailyMission, weeklyChallenge,
      // ---- Estadísticas / leaderboard local ----
      stats: () => ({ games: m.games || 0, totalRemoved: m.totalRemoved || 0, totalScore: m.stats.totalScore || 0, bestCombo: m.stats.bestCombo || 0, totalTime: m.stats.totalTime || 0 }),
      modeBest: (mode) => (m.modes[mode] && m.modes[mode].best) || 0,
      modePlays: (mode) => (m.modes[mode] && m.modes[mode].plays) || 0,
      // Racha de VICTORIAS de Clásico (GM-05): niveles seguidos completados; solo la
      // derrota la reinicia (salir/pausar no castiga). Bonus de monedas +10%/nivel
      // de racha desde la 2ª victoria seguida, tope +50%.
      classicWinStreak: () => m.mastery.winStreak || 0,
      recordClassicWin(won) {
        if (!m.mastery) m.mastery = {};
        m.mastery.winStreak = won ? (m.mastery.winStreak || 0) + 1 : 0;
        save();
        return m.mastery.winStreak;
      },
      classicPerfectStreak: () => m.mastery.classicPerfect || 0,
      classicBestPerfectStreak: () => m.mastery.bestClassicPerfect || 0,
      recordClassicPerfect(perfect) {
        const before = m.mastery.classicPerfect || 0;
        m.mastery.classicPerfect = perfect ? before + 1 : 0;
        if (m.mastery.classicPerfect > (m.mastery.bestClassicPerfect || 0)) m.mastery.bestClassicPerfect = m.mastery.classicPerfect;
        save();
        return { streak: m.mastery.classicPerfect, best: m.mastery.bestClassicPerfect || 0, changed: before !== m.mastery.classicPerfect, perfect: !!perfect };
      },
      // ---- Economía (monedas) ----
      coins: () => m.coins || 0,
      addCoins(n) { m.coins = (m.coins || 0) + Math.max(0, n | 0); save(); return m.coins; },
      spend(n) {
        n = Number(n);
        if (!Number.isSafeInteger(n) || n < 0 || (m.coins || 0) < n) return false;
        if (!n) return true;
        m.coins -= n; save(); return true;
      },
      // ---- Economía (gemas: divisa premium) ----
      gems: () => m.gems || 0,
      addGems(n) { m.gems = (m.gems || 0) + Math.max(0, n | 0); save(); return m.gems; },
      spendGems(n) {
        n = Number(n);
        if (!Number.isSafeInteger(n) || n < 0 || (m.gems || 0) < n) return false;
        if (!n) return true;
        m.gems -= n; save(); return true;
      },
      // ---- Economía (tickets: entradas a partidas especiales) ----
      tickets: () => m.tickets || 0,
      addTickets(n) { m.tickets = (m.tickets || 0) + Math.max(0, n | 0); save(); return m.tickets; },
      spendTicket(n) {
        n = n === undefined ? 1 : Number(n);
        if (!Number.isSafeInteger(n) || n <= 0 || (m.tickets || 0) < n) return false;
        m.tickets -= n; save(); return true;
      },
      // ---- Arsenal persistente (CH-4): los boosters ganados en cofres solo entran
      // a una partida mediante una preparación confirmada. Nunca son una reserva
      // implícita disponible durante la run. ----
      boosterInventory() {
        const out = {};
        CHEST_BOOSTER_IDS.forEach((id) => { out[id] = this.boosterCount(id); });
        return out;
      },
      boosterCount(id) {
        const value = Number(m.boosterStock && m.boosterStock[id]);
        return CHEST_BOOSTER_IDS.includes(id) && Number.isSafeInteger(value) ? clamp(value, 0, 1000000) : 0;
      },
      addBooster(id, n) {
        if (!CHEST_BOOSTER_IDS.includes(id)) return 0;
        const units = n === undefined ? 1 : Math.max(0, Math.floor(Number(n) || 0));
        m.boosterStock[id] = clamp(this.boosterCount(id) + units, 0, 1000000);
        save(); return m.boosterStock[id];
      },
      spendBooster(id, n) {
        n = Math.max(1, Math.floor(Number(n) || 1));
        if (!CHEST_BOOSTER_IDS.includes(id) || this.boosterCount(id) < n) return false;
        m.boosterStock[id] -= n; save(); return true;
      },
      // Cotización y confirmación atómicas para cualquier preparación. Cada id
      // representa una unidad: primero sale del stock; si no hay, se compra con
      // monedas. La UI puede cotizar libremente y solo commit muta/persiste una vez.
      quoteBoosterLoadout(ids, maxUnits) {
        const max = Math.max(0, Math.floor(Number(maxUnits) || 0));
        const unique = [];
        (Array.isArray(ids) ? ids : []).forEach((id) => {
          if (Object.prototype.hasOwnProperty.call(Config.BOOSTER_PRICES, id) && !unique.includes(id)) unique.push(id);
        });
        if (unique.length > max) return null;
        const stock = [], purchased = [];
        let coinCost = 0;
        unique.forEach((id) => {
          if (this.boosterCount(id) > 0) stock.push(id);
          else { purchased.push(id); coinCost += Config.BOOSTER_PRICES[id]; }
        });
        return { ids: unique, stock, purchased, coinCost };
      },
      commitBoosterLoadout(ids, maxUnits) {
        const quote = this.quoteBoosterLoadout(ids, maxUnits);
        if (!quote || (m.coins || 0) < quote.coinCost) return null;
        if (quote.stock.some((id) => this.boosterCount(id) < 1)) return null;
        m.coins -= quote.coinCost;
        quote.stock.forEach((id) => { m.boosterStock[id] = this.boosterCount(id) - 1; });
        save();
        return quote;
      },
      // ---- Cofres tipados + ranuras. `m.chests` sigue siendo el contador canónico
      // para mantener compatibilidad con partidas y pruebas anteriores. ----
      chests() { ensureChestInventory(); return m.chests || 0; },
      chestInventory() {
        return ensureChestInventory().map((entry) => {
          const clone = Object.assign({}, entry);
          if (entry.choice) clone.choice = JSON.parse(JSON.stringify(entry.choice));
          if (entry.event) clone.event = Object.assign({}, entry.event);
          return clone;
        });
      },
      chestSlotLimit: () => clamp(m.chestSlots | 0, 3, 4),
      CHEST_SLOT_GEMS: 150,
      unlockChestSlot() {
        if ((m.chestSlots | 0) >= 4) return true;
        if (!this.spendGems(this.CHEST_SLOT_GEMS)) return false;
        m.chestSlots = 4; save(); return true;
      },
      // ---- Temporizadores (CH-3): un solo cofre EN CURSO a la vez; los terminados
      // pasan a "listos" (no bloquean) y el siguiente más corto en espera se
      // auto-encadena arrancando en el INSTANTE exacto de la finalización anterior,
      // también con la app cerrada. Mejora deliberada sobre el modelo de CR. ----
      advanceChestTimers() {
        const list = ensureChestInventory();
        if (!Array.isArray(m.chestReady)) m.chestReady = [];
        let changed = false, guard = 0;
        // Cada vuelta consume como mínimo un cofre distinto; el tamaño real del
        // inventario es un límite seguro incluso con una reserva superior a 12.
        while (m.chestUnlock && (Number(m.chestUnlock.endsAt) || 0) <= Date.now() && guard++ < list.length) {
          const doneUid = m.chestUnlock.uid;
          const anchor = Number(m.chestUnlock.endsAt) || Date.now();
          if (list.some((entry) => entry.uid === doneUid) && !m.chestReady.includes(doneUid)) m.chestReady.push(doneUid);
          m.chestUnlock = null; changed = true;
          const next = this._shortestWaitingChest();
          if (next) {
            const durationMs = storedChestDuration(next);
            m.chestUnlock = { uid: next.uid, startedAt: anchor, endsAt: anchor + durationMs, durationMs, auto: true };
          }
        }
        if (changed) save();
      },
      _shortestWaitingChest() {
        const list = ensureChestInventory();
        const ready = Array.isArray(m.chestReady) ? m.chestReady : [];
        const running = m.chestUnlock && m.chestUnlock.uid;
        return list.map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.uid !== running && !ready.includes(entry.uid))
          .sort((a, b) => storedChestDuration(a.entry) - storedChestDuration(b.entry)
            || (Number(a.entry.earnedAt) || 0) - (Number(b.entry.earnedAt) || 0)
            || a.index - b.index)[0]?.entry || null;
      },
      chestReadyUids() { this.advanceChestTimers(); return (m.chestReady || []).slice(); },
      chestNotifiedReadyUids() {
        ensureChestInventory();
        return (m.chestNotifiedReady || []).slice();
      },
      markChestReadyNotified(uids) {
        const ready = new Set(this.chestReadyUids());
        const merged = new Set((m.chestNotifiedReady || []).filter((uid) => ready.has(uid)));
        (Array.isArray(uids) ? uids : [uids]).forEach((uid) => { if (ready.has(uid)) merged.add(uid); });
        m.chestNotifiedReady = Array.from(merged); save();
        return m.chestNotifiedReady.slice();
      },
      chestAutoQueue() {
        this.advanceChestTimers();
        const list = ensureChestInventory();
        const ready = new Set(m.chestReady || []), running = m.chestUnlock && m.chestUnlock.uid;
        return list.map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.uid !== running && !ready.has(entry.uid))
          .sort((a, b) => storedChestDuration(a.entry) - storedChestDuration(b.entry)
            || (Number(a.entry.earnedAt) || 0) - (Number(b.entry.earnedAt) || 0)
            || a.index - b.index)
          .map(({ entry }) => Object.assign({}, entry));
      },
      chestDurationMs(uid) {
        const chest = ensureChestInventory().find((entry) => entry.uid === uid);
        return chest ? storedChestDuration(chest) : 0;
      },
      chestTimerState(uid) {
        this.advanceChestTimers();
        if ((m.chestReady || []).includes(uid)) return 'ready';
        if (m.chestUnlock && m.chestUnlock.uid === uid) return 'running';
        return 'waiting';
      },
      // Vista del desbloqueo EN CURSO (los listos se consultan con chestReadyUids).
      chestUnlock() {
        this.advanceChestTimers();
        const list = ensureChestInventory();
        if (!m.chestUnlock) return null;
        const chest = list.find((entry) => entry.uid === m.chestUnlock.uid);
        if (!chest) { m.chestUnlock = null; save(); return null; }
        const now = Date.now();
        const endsAt = Number(m.chestUnlock.endsAt) || now;
        const durationMs = Number(m.chestUnlock.durationMs) || storedChestDuration(chest);
        return Object.assign({}, m.chestUnlock, chest, {
          endsAt, durationMs, remainingMs: Math.max(0, endsAt - now), ready: false,
        });
      },
      startChestUnlock(uid) {
        this.advanceChestTimers();
        const list = ensureChestInventory();
        const chest = list.find((entry) => entry.uid === uid);
        if (!chest || (m.chestReady || []).includes(uid)) return null;
        if (m.chestUnlock) return m.chestUnlock.uid === uid ? this.chestUnlock() : null;
        const durationMs = storedChestDuration(chest);
        m.chestUnlock = { uid, startedAt: Date.now(), endsAt: Date.now() + durationMs, durationMs };
        save();
        return this.chestUnlock();
      },
      chestInstantCost(uid) {
        this.advanceChestTimers();
        const chest = ensureChestInventory().find((entry) => entry.uid === uid);
        if (!chest) return 0;
        if ((m.chestReady || []).includes(uid)) return 0;
        const current = m.chestUnlock;
        const remainingMs = !current || current.uid !== uid
          ? storedChestDuration(chest)
          : Math.max(0, (Number(current.endsAt) || 0) - Date.now());
        if (remainingMs <= 0) return 0;
        return Math.max(1, Math.ceil(CHEST_SKIP_GEMS_PER_HOUR * remainingMs / CHEST_HOUR_MS));
      },
      addChest(n, type, source, snapshot) {
        const list = ensureChestInventory();
        const count = Math.max(1, n | 0);
        for (let i = 0; i < count; i++) {
          const chestType = nextChestType(type);
          const captured = chestType === 'event' && !(snapshot && validChestEvent(snapshot.event))
            ? Object.assign({}, snapshot, { event: makeChestEventSnapshot(source) }) : snapshot;
          list.push(makeChest(chestType, source, undefined, captured));
        }
        m.chests = (m.chests || 0) + count;
        m.chestInventory = list;
        save();
        return m.chests;
      },
      // Evento semanal offline: el snapshot viaja dentro del cofre. Cambiar de
      // semana no altera el booster temático de un cofre ya ganado.
      currentChestEvent(source) {
        return makeChestEventSnapshot(source);
      },
      addEventChest(source) {
        const event = this.currentChestEvent(source);
        this.addChest(1, 'event', `event:${event.id}:${event.source}`, { event });
        return event;
      },
      dailyChoiceChests() {
        return ensureChestInventory().filter((entry) => validChestChoice(entry.choice)).map((entry) => ({
          uid: entry.uid, type: entry.type, source: entry.source, earnedAt: entry.earnedAt,
          durationMs: storedChestDuration(entry), state: this.chestTimerState(entry.uid),
          choice: JSON.parse(JSON.stringify(entry.choice)),
        }));
      },
      chestChoiceInfo(uid) {
        const chest = ensureChestInventory().find((entry) => entry.uid === uid && validChestChoice(entry.choice));
        if (!chest) return null;
        return {
          uid: chest.uid, type: chest.type, state: this.chestTimerState(chest.uid),
          choice: JSON.parse(JSON.stringify(chest.choice)),
        };
      },
      makeChestChoiceReady(uid) {
        this.advanceChestTimers();
        const list = ensureChestInventory();
        const chest = list.find((entry) => entry.uid === uid && validChestChoice(entry.choice));
        if (!chest) return null;
        if (!(m.chestReady || []).includes(uid)) {
          if (m.chestUnlock && m.chestUnlock.uid === uid) m.chestUnlock = null;
          m.chestReady.push(uid);
          if (!m.chestUnlock) {
            const next = this._shortestWaitingChest();
            if (next) {
              const durationMs = storedChestDuration(next);
              m.chestUnlock = { uid: next.uid, startedAt: Date.now(), endsAt: Date.now() + durationMs, durationMs, auto: true };
            }
          }
          save();
        }
        return this.chestChoiceInfo(uid);
      },
      claimChestChoice(uid, optionId) {
        this.advanceChestTimers();
        if (!(m.chestReady || []).includes(uid)) return null;
        const list = ensureChestInventory(), index = list.findIndex((entry) => entry.uid === uid && validChestChoice(entry.choice));
        if (index < 0) return null;
        const chest = list[index], selected = chest.choice.options.find((option) => option.id === optionId);
        if (!selected) return null;
        const reward = Object.assign({}, selected, {
          chestType: chest.type, baseChestType: chest.type, choice: true, catchUp: !!chest.choice.catchUp,
        });
        reward.items = [Object.assign({}, reward)];
        list.splice(index, 1); m.chestInventory = list; m.chests = Math.max(0, (m.chests || 0) - 1);
        m.chestReady = (m.chestReady || []).filter((readyUid) => readyUid !== uid);
        m.chestNotifiedReady = (m.chestNotifiedReady || []).filter((readyUid) => readyUid !== uid);
        this._applyChestReward(reward);
        if (!m.chestUnlock) {
          const next = this._shortestWaitingChest();
          if (next) {
            const durationMs = storedChestDuration(next);
            m.chestUnlock = { uid: next.uid, startedAt: Date.now(), endsAt: Date.now() + durationMs, durationMs, auto: true };
          }
        }
        save();
        return reward;
      },
      // ---- Pipeline universal (CH-2): cada objetivo cumplido en CUALQUIER modo
      // suma; a cada TARGET objetivos cae el siguiente cofre del ciclo determinista
      // CHEST_DROP_SEQUENCE (cadencia garantizada de tiers altos, estilo chest cycle
      // de CR). La escalera de Supervivencia sigue aparte como bonus de hito. ----
      CHEST_PIPELINE_TARGET: 3,
      chestPipelineInfo() {
        if (!m.chestPipeline || typeof m.chestPipeline !== 'object') m.chestPipeline = { wins: 0, cycle: 0 };
        const p = m.chestPipeline, len = CHEST_DROP_SEQUENCE.length;
        const at = Math.max(0, p.cycle | 0);
        let chestsToMythic = len;
        for (let i = 0; i < len; i++) {
          const t = CHEST_DROP_SEQUENCE[(at + i) % len];
          if (CHEST_TYPES[t].rarityKey === 'chest_tier_mythic') { chestsToMythic = i + 1; break; }
        }
        return {
          wins: Math.max(0, p.wins | 0),
          target: this.CHEST_PIPELINE_TARGET,
          nextType: CHEST_DROP_SEQUENCE[at % len],
          chestsToMythic,
        };
      },
      recordChestProgress(source) {
        if (!m.chestPipeline || typeof m.chestPipeline !== 'object') m.chestPipeline = { wins: 0, cycle: 0 };
        if (!m.dailyChest || typeof m.dailyChest !== 'object') m.dailyChest = { date: '' };
        const p = m.chestPipeline;
        p.wins = Math.max(0, p.wins | 0) + 1;
        let chest = null, daily = null, dailyChoice = null;
        if (p.wins >= this.CHEST_PIPELINE_TARGET) {
          p.wins -= this.CHEST_PIPELINE_TARGET;
          const type = CHEST_DROP_SEQUENCE[Math.max(0, p.cycle | 0) % CHEST_DROP_SEQUENCE.length];
          p.cycle = Math.max(0, p.cycle | 0) + 1;
          this.addChest(1, type, 'pipeline:' + (source || 'win'));
          chest = type;
        }
        // CH-5: el PRIMER objetivo del día crea un Choice Chest real e inmediato:
        // tres opciones se fijan ahora y sobreviven a recargas. Si el último día
        // jugado queda antes de ayer, el catch-up sube exactamente Bronce→Plata.
        const d = today();
        if (m.dailyChest.date !== d) {
          const previous = utcDayOrdinal(m.dailyChest.date), current = utcDayOrdinal(d);
          const catchUp = previous !== null && current !== null && current - previous > 1;
          const tier = catchUp ? 'silver' : 'bronze';
          const choice = makeDailyChoice(d, tier, catchUp);
          m.dailyChest.date = d;
          this.addChest(1, tier, 'daily-choice', { choice });
          daily = tier;
          dailyChoice = this.dailyChoiceChests().find((entry) => entry.choice.id === choice.id) || null;
          // U5 es una recompensa diaria, no otra ranura de espera: queda lista al
          // ganarse. Evita arbitraje de gemas al acelerar y hace que el catch-up
          // sea realmente amable (mejor premio sin cinco horas extra de castigo).
          if (dailyChoice) dailyChoice = this.makeChestChoiceReady(dailyChoice.uid);
        }
        save();
        return { chest, daily, dailyChoice, wins: p.wins, target: this.CHEST_PIPELINE_TARGET, source: source || 'win' };
      },
      openChest(uid) {
        const list = ensureChestInventory();
        if (!list.length || (m.chests || 0) <= 0) return null;
        const index = uid ? list.findIndex((entry) => entry.uid === uid) : 0;
        if (index < 0) return null;
        const chest = list[index];
        // Un Choice Chest solo se consume por claimChestChoice(): ni recargar ni
        // llamar por error a la ruta aleatoria puede saltarse la elección.
        if (validChestChoice(chest.choice)) return null;
        // CH-4: ruleta de mejora — el cofre puede subir UN tier justo al abrirse
        // (CHEST_UPGRADE_CHANCE, publicada en el catálogo).
        let openType = chest.type, tierUp = null;
        const upgradeTo = CHEST_UPGRADE_PATH[openType];
        if (upgradeTo && CHEST_TYPES[upgradeTo] && Math.random() < CHEST_UPGRADE_CHANCE) {
          tierUp = { from: openType, to: upgradeTo };
          openType = upgradeTo;
        }
        const defn = CHEST_TYPES[openType] || CHEST_TYPES.wood;
        const profile = defn.reward;
        const scale = chestLevelScale(m.level);
        const ranged = ([min, max]) => min === max ? min : min + Math.floor(Math.random() * (max - min + 1));
        // Primer premio: monedas garantizadas. Se conserva una fracción moderada
        // del rango para que la ceremonia no multiplique sin control el EV antiguo.
        const guaranteed = {
          kind: 'coins',
          amount: Math.max(1, Math.round(ranged(profile.coins) * scale * CHEST_GUARANTEED_COIN_SHARE)),
          rarity: 'common', guaranteed: true,
        };
        // Tirada principal: tabla histórica; monedas Y gemas escalan con el nivel.
        const roll = Math.random();
        let reward;
        if (roll < profile.coinCut) reward = { kind: 'coins', amount: Math.round(ranged(profile.coins) * scale), rarity: profile.rarity };
        else if (roll < profile.gemCut) reward = { kind: 'gems', amount: Math.round(ranged(profile.gems) * scale), rarity: profile.rarity };
        else if (roll < profile.ticketCut) reward = { kind: 'ticket', amount: ranged(profile.tickets), rarity: profile.rarity };
        else reward = this._rollCosmetic();
        if (!reward) reward = openType === 'wood'
          ? { kind: 'gems', amount: Math.round((8 + Math.floor(Math.random() * 8)) * scale), rarity: 'common', fallback: 'cosmetic' }
          : { kind: 'coins', amount: Math.round(profile.coins[1] * 1.35 * scale), rarity: 'jackpot', fallback: 'cosmetic' };
        reward.chestType = openType;
        reward.baseChestType = chest.type;
        reward.upgradeRoll = upgradeTo ? { from: chest.type, to: upgradeTo, chance: CHEST_UPGRADE_CHANCE, upgraded: !!tierUp } : null;
        // CH-4: 2–4 premios serializables. Copiar la tirada principal evita la
        // autorreferencia histórica reward.items[0] === reward.
        const primary = Object.assign({}, reward);
        const items = [guaranteed, primary];
        while (items.length < chestRollCount(openType)) {
          // Los cofres de evento capturan un booster temático al ganarse. Al menos
          // una tirada menor refleja ese evento sin cambiar después de semana.
          if (chest.event && chest.event.featuredBooster && items.length === chestRollCount(openType) - 1) {
            items.push({ kind: 'booster', boosterId: chest.event.featuredBooster, amount: 1, rarity: 'rare', bonus: true, event: true });
          } else items.push(this._chestBonusRoll(defn, scale));
        }
        reward.items = items;
        if (tierUp) reward.tierUp = tierUp;
        list.splice(index, 1);
        m.chestInventory = list;
        m.chests = Math.max(0, (m.chests || 0) - 1);
        if (m.chestUnlock && m.chestUnlock.uid === chest.uid) m.chestUnlock = null;
        if (Array.isArray(m.chestReady)) m.chestReady = m.chestReady.filter((uid) => uid !== chest.uid);
        if (Array.isArray(m.chestNotifiedReady)) m.chestNotifiedReady = m.chestNotifiedReady.filter((uid) => uid !== chest.uid);
        // CH-3: al recoger, si no queda temporizador en curso el siguiente cofre
        // más corto arranca solo — la cola nunca se queda muerta.
        if (!m.chestUnlock) {
          const next = this._shortestWaitingChest();
          if (next) {
            const durationMs = storedChestDuration(next);
            m.chestUnlock = { uid: next.uid, startedAt: Date.now(), endsAt: Date.now() + durationMs, durationMs, auto: true };
          }
        }
        reward.items.forEach((item) => this._applyChestReward(item));
        save();
        return reward;
      },
      // Tirada menor de la ceremonia (CH-4): recursos pequeños o un booster para
      // el arsenal persistente. Monedas y gemas escalan con el nivel.
      _chestBonusRoll(defn, scale) {
        const r = Math.random();
        if (r < CHEST_BONUS_ODDS.coins) {
          const span = Math.max(10, Math.round(defn.reward.coins[1] * 0.12));
          return { kind: 'coins', amount: Math.round((10 + Math.floor(Math.random() * span)) * (scale || 1)), rarity: 'common', bonus: true };
        }
        if (r < CHEST_BONUS_ODDS.coins + CHEST_BONUS_ODDS.gems) {
          const amount = 1 + Math.floor(Math.random() * Math.max(2, Math.round(defn.reward.gems[1] * 0.2)));
          return { kind: 'gems', amount: Math.max(1, Math.round(amount * (scale || 1))), rarity: 'common', bonus: true };
        }
        if (r < CHEST_BONUS_ODDS.coins + CHEST_BONUS_ODDS.gems + CHEST_BONUS_ODDS.tickets) {
          return { kind: 'ticket', amount: 1, rarity: 'common', bonus: true };
        }
        return {
          kind: 'booster', boosterId: CHEST_BOOSTER_IDS[Math.floor(Math.random() * CHEST_BOOSTER_IDS.length)],
          amount: 1, rarity: 'rare', bonus: true,
        };
      },
      // ---- Cofre premium: sumidero de gemas. Mejor tabla, sin gemas (sería circular). ----
      PREMIUM_CHEST_GEMS: 25,
      openPremiumChest() {
        if (!this.spendGems(this.PREMIUM_CHEST_GEMS)) return null;
        const defn = CHEST_TYPES.magic, scale = chestLevelScale(m.level);
        const roll = Math.random();
        let reward;
        if (roll < 0.52) reward = { kind: 'coins', amount: Math.round((200 + Math.floor(Math.random() * 300)) * scale), rarity: 'common' };
        else if (roll < 0.82) reward = { kind: 'ticket', amount: 2, rarity: 'common' };
        else if (roll < 0.92) reward = { kind: 'coins', amount: Math.round((600 + Math.floor(Math.random() * 400)) * scale), rarity: 'jackpot' };
        else reward = this._rollCosmetic();
        if (!reward) reward = { kind: 'coins', amount: Math.round((600 + Math.floor(Math.random() * 400)) * scale), rarity: 'jackpot', fallback: 'cosmetic' };
        reward.chestType = 'magic'; reward.baseChestType = 'magic'; reward.upgradeRoll = null;
        const guaranteed = {
          kind: 'coins', amount: Math.max(1, Math.round((80 + Math.floor(Math.random() * 81)) * scale)),
          rarity: 'common', guaranteed: true,
        };
        reward.items = [guaranteed, Object.assign({}, reward), this._chestBonusRoll(defn, scale)];
        reward.items.forEach((item) => this._applyChestReward(item));
        save();
        return reward;
      },
      // ---- Reto diario: mismo tablero para todos (semilla = fecha). ----
      DAILY_FIRST_GEMS: 5,
      DAILY_MEDALS: [750, 1500, 2500],
      dailyMedal(score) {
        score = Math.max(0, score | 0);
        const m = this.DAILY_MEDALS;
        return score >= m[2] ? 'gold' : score >= m[1] ? 'silver' : score >= m[0] ? 'bronze' : 'none';
      },
      dailyNextMedal(score) {
        score = Math.max(0, score | 0);
        return this.DAILY_MEDALS.find((n) => score < n) || null;
      },
      dailyRunInfo() {
        const d = today();
        if (m.dailyRun.date !== d) return { date: d, best: 0, plays: 0 };
        const info = Object.assign({}, m.dailyRun);
        info.medal = this.dailyMedal(info.best);
        return info;
      },
      recordDailyRun(score) {
        const d = today();
        const fresh = m.dailyRun.date !== d;
        // El historial y el ghost sobreviven al cambio de día (GM-14/12).
        const hist = m.dailyRun.history || {};
        const rewarded = m.dailyRun.streakRewarded || 0;
        if (fresh) m.dailyRun = { date: d, best: 0, plays: 0, history: hist, streakRewarded: rewarded };
        if (!m.dailyRun.history) m.dailyRun.history = hist;
        m.dailyRun.plays++;
        const newBest = score > m.dailyRun.best;
        if (newBest) m.dailyRun.best = score | 0;
        if (fresh) m.gems = (m.gems || 0) + this.DAILY_FIRST_GEMS; // premio por el primer intento del día
        // Calendario de medallas (GM-14): la mejor medalla de cada día, tope 60 días FIFO.
        m.dailyRun.history[d] = this.dailyMedal(m.dailyRun.best);
        const keys = Object.keys(m.dailyRun.history).sort();
        while (keys.length > 60) delete m.dailyRun.history[keys.shift()];
        // Racha de medallas: hito cada 7 días seguidos → +1 cofre (una sola vez por hito).
        const streak = this.dailyStreak();
        let streakChest = false;
        if (streak < (m.dailyRun.streakRewarded || 0)) m.dailyRun.streakRewarded = 0; // racha nueva: re-armar hitos
        if (streak > 0 && streak % 7 === 0 && (m.dailyRun.streakRewarded || 0) < streak) {
          m.dailyRun.streakRewarded = streak;
          this.addEventChest('daily-streak');
          streakChest = true;
        }
        // Pipeline (CH-2): la primera medalla del día en el Reto cuenta como objetivo.
        let pipeline = null;
        if (this.dailyMedal(score) !== 'none' && m.dailyRun.chestPoint !== d) {
          m.dailyRun.chestPoint = d;
          pipeline = this.recordChestProgress('reto');
        }
        save();
        return { firstToday: fresh, newBest, best: m.dailyRun.best, medal: this.dailyMedal(score), bestMedal: this.dailyMedal(m.dailyRun.best), streak, streakChest, pipeline };
      },
      // Racha de medallas del reto (GM-14): días consecutivos con medalla ≥ bronce.
      // ÉTICA: 1 "congelación" de regalo + 1 extra por cada 7 días de racha — un día
      // perdido no borra la racha (se pausa); dos seguidos sin margen, sí.
      dailyStreak() {
        const h = (m.dailyRun && m.dailyRun.history) || {};
        const key = (dt) => dt.toISOString().slice(0, 10);
        let day = new Date();
        const todayMedal = h[key(day)];
        if (!todayMedal || todayMedal === 'none') day = new Date(day.getTime() - 86400000);
        let streak = 0, freezes = 1;
        for (let i = 0; i < 90; i++) {
          const med = h[key(day)];
          if (med && med !== 'none') { streak++; if (streak % 7 === 0) freezes++; }
          else if (freezes > 0) freezes--;
          else break;
          day = new Date(day.getTime() - 86400000);
        }
        return streak;
      },
      // Últimos `n` días como [{date, medal}] para el calendario compacto (GM-14).
      dailyCalendar(n) {
        const h = (m.dailyRun && m.dailyRun.history) || {};
        const out = [];
        for (let i = (n || 14) - 1; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          out.push({ date: d, medal: h[d] || 'none' });
        }
        return out;
      },
      // ---- Ghost personal (GM-12): línea de tiempo de score del mejor intento. ----
      modeGhost: (mode) => (m.modes[mode] && m.modes[mode].ghost) || null,
      setModeGhost(mode, samples) { const md = m.modes[mode] || (m.modes[mode] = { best: 0, plays: 0 }); md.ghost = (samples || []).slice(0, 60); save(); },
      dailyGhost() { return (m.dailyRun && m.dailyRun.date === today() && m.dailyRun.ghost) || null; },
      setDailyGhost(samples) { m.dailyRun.ghost = (samples || []).slice(0, 60); save(); },
      // ---- Jardín zen (GM-23): colección sin fallo posible — cada tablero limpio
      // en Zen suma una flor; los hitos regalan (cofre a las 10, skin a las 50). ----
      zenFlowers: () => (m.zen && m.zen.flowers) || 0,
      addZenFlower() { if (!m.zen) m.zen = { flowers: 0 }; m.zen.flowers++; save(); return m.zen.flowers; },
      grantBoard(id) { if (!m.boards.owned[id]) { m.boards.owned[id] = 1; save(); return true; } return false; },
      grantTheme(id) { if (this.owns(id)) return false; m.cosmetics.owned[id] = today(); save(); return true; },
      chestCosmeticPool() {
        const pool = [];
        Boards.order.forEach((id) => {
          const b = Boards.DEFS[id];
          if (b && id !== 'classic' && !b.exclusive && !this.ownsBoard(id)) pool.push({ cosmeticKind: 'board', id, name: b.name });
        });
        Themes.order.forEach((id) => {
          const t = Themes.DEFS[id];
          if (t && id !== 'default' && !this.owns(id)) pool.push({ cosmeticKind: 'theme', id, name: t.name });
        });
        PlayerIcons.order.forEach((id) => {
          const item = PlayerIcons.DEFS[id];
          if (item && id !== PlayerIcons.DEFAULT && !this.ownsAvatarIcon(id)) pool.push({ cosmeticKind: 'avatarIcon', id, name: item.name });
        });
        PlayerBorders.order.forEach((id) => {
          const item = PlayerBorders.DEFS[id];
          if (item && id !== PlayerBorders.DEFAULT && !this.ownsAvatarBorder(id)) pool.push({ cosmeticKind: 'avatarBorder', id, name: item.name });
        });
        return pool;
      },
      _rollCosmetic() {
        const pool = this.chestCosmeticPool();
        if (!pool.length) return null;
        const item = pool[Math.floor(Math.random() * pool.length)];
        return Object.assign({ kind: 'cosmetic', rarity: 'cosmetic' }, item);
      },
      _applyChestReward(reward) {
        if (!reward) return null;
        if (reward.kind === 'coins') m.coins = (m.coins || 0) + reward.amount;
        else if (reward.kind === 'gems') m.gems = (m.gems || 0) + reward.amount;
        else if (reward.kind === 'ticket') m.tickets = (m.tickets || 0) + reward.amount;
        else if (reward.kind === 'booster' && CHEST_BOOSTER_IDS.includes(reward.boosterId)) {
          m.boosterStock[reward.boosterId] = clamp(this.boosterCount(reward.boosterId) + Math.max(1, reward.amount | 0), 0, 1000000);
        }
        else if (reward.kind === 'cosmetic') {
          if (reward.cosmeticKind === 'board') this.grantBoard(reward.id);
          else if (reward.cosmeticKind === 'theme') this.grantTheme(reward.id);
          else if (reward.cosmeticKind === 'avatarIcon') this.grantAvatarIcon(reward.id);
          else if (reward.cosmeticKind === 'avatarBorder') this.grantAvatarBorder(reward.id);
        }
        return reward;
      },
      // ---- Reroll de la misión diaria: sumidero de tickets (1 por cambio). ----
      rerollDaily() {
        const cur = dailyMission(); // asegura que exista la misión de hoy
        if (cur.done || !this.spendTicket(1)) return null;
        const idx = MISSIONS.findIndex((x) => x.id === cur.id);
        const next = MISSIONS[(idx + 1) % MISSIONS.length];
        m.daily = { date: today(), id: next.id, progress: 0, done: false };
        save();
        return Object.assign({}, next, m.daily);
      },
      // ---- Cosméticos (propiedad y equipado) ----
      cosmetics: () => m.cosmetics,
      owns: (id) => id === 'default' || !!(m.cosmetics.owned && m.cosmetics.owned[id]),
      buy(id, cost) { if (this.owns(id)) return true; if (!this.spend(cost)) return false; m.cosmetics.owned[id] = today(); save(); return true; },
      equip(slot, id) { if (!this.owns(id)) return false; m.cosmetics[slot] = id; save(); return true; },
      avatarIcon: () => PlayerIcons.DEFS[m.cosmetics.avatarIcon] ? m.cosmetics.avatarIcon : PlayerIcons.DEFAULT,
      avatarBorder: () => PlayerBorders.DEFS[m.cosmetics.avatarBorder] ? m.cosmetics.avatarBorder : PlayerBorders.DEFAULT,
      ownsAvatarIcon: (id) => id === PlayerIcons.DEFAULT || !!(m.cosmetics.avatarIcons && m.cosmetics.avatarIcons[id]),
      ownsAvatarBorder: (id) => id === PlayerBorders.DEFAULT || !!(m.cosmetics.avatarBorders && m.cosmetics.avatarBorders[id]),
      grantAvatarIcon(id) {
        if (!PlayerIcons.DEFS[id]) return false;
        m.cosmetics.avatarIcons = m.cosmetics.avatarIcons || { [PlayerIcons.DEFAULT]: 1 };
        if (this.ownsAvatarIcon(id)) return false;
        m.cosmetics.avatarIcons[id] = today(); save(); return true;
      },
      grantAvatarBorder(id) {
        if (!PlayerBorders.DEFS[id]) return false;
        m.cosmetics.avatarBorders = m.cosmetics.avatarBorders || { [PlayerBorders.DEFAULT]: 1 };
        if (this.ownsAvatarBorder(id)) return false;
        m.cosmetics.avatarBorders[id] = today(); save(); return true;
      },
      buyAvatarIcon(id) {
        const item = PlayerIcons.DEFS[id];
        if (!item) return false;
        m.cosmetics.avatarIcons = m.cosmetics.avatarIcons || { [PlayerIcons.DEFAULT]: 1 };
        if (this.ownsAvatarIcon(id)) return true;
        if (!this.spend(item.cost || 0)) return false;
        m.cosmetics.avatarIcons[id] = today(); save(); return true;
      },
      buyAvatarBorder(id) {
        const item = PlayerBorders.DEFS[id];
        if (!item) return false;
        m.cosmetics.avatarBorders = m.cosmetics.avatarBorders || { [PlayerBorders.DEFAULT]: 1 };
        if (this.ownsAvatarBorder(id)) return true;
        if (!this.spend(item.cost || 0)) return false;
        m.cosmetics.avatarBorders[id] = today(); save(); return true;
      },
      equipAvatarIcon(id) {
        if (!PlayerIcons.DEFS[id] || !this.ownsAvatarIcon(id)) return false;
        m.cosmetics.avatarIcon = id; save(); return true;
      },
      equipAvatarBorder(id) {
        if (!PlayerBorders.DEFS[id] || !this.ownsAvatarBorder(id)) return false;
        m.cosmetics.avatarBorder = id; save(); return true;
      },
      avatarIconOwnedCount: () => PlayerIcons.order.filter((id) => id === PlayerIcons.DEFAULT || !!(m.cosmetics.avatarIcons && m.cosmetics.avatarIcons[id])).length,
      avatarBorderOwnedCount: () => PlayerBorders.order.filter((id) => id === PlayerBorders.DEFAULT || !!(m.cosmetics.avatarBorders && m.cosmetics.avatarBorders[id])).length,
      // ---- Packs de iconos de tablero (propiedad y equipado) ----
      ownsIconPack: (id) => id === IconPacks.DEFAULT || !!(m.cosmetics.iconPacks && m.cosmetics.iconPacks[id]),
      equippedIconPack: () => IconPacks.DEFS[m.cosmetics.iconPack] ? m.cosmetics.iconPack : IconPacks.DEFAULT,
      equipIconPack(id) {
        if (!IconPacks.DEFS[id] || !this.ownsIconPack(id)) return false;
        m.cosmetics.iconPack = id; save();
        IconPacks.preload(id); // A: calienta el pack recién equipado
        return true;
      },
      buyIconPack(id) {
        const item = IconPacks.DEFS[id];
        if (!item) return false;
        m.cosmetics.iconPacks = m.cosmetics.iconPacks || { [IconPacks.DEFAULT]: 1 };
        if (this.ownsIconPack(id)) return true;
        if (!this.spend(item.cost || 0)) return false;
        m.cosmetics.iconPacks[id] = today(); save(); return true;
      },
      iconPackOwnedCount: () => IconPacks.order.filter((id) => id === IconPacks.DEFAULT || !!(m.cosmetics.iconPacks && m.cosmetics.iconPacks[id])).length,
      // ---- Tableros de la tienda (propiedad y equipado) ----
      boardsOwned: () => m.boards.owned,
      ownsBoard: (id) => id === 'classic' || !!(m.boards.owned && m.boards.owned[id]),
      equippedBoard: () => m.boards.equipped || 'classic',
      buyBoard(id, cost) {
        if (this.ownsBoard(id)) return true;
        if (!this.spend(cost)) return false;
        m.boards.owned[id] = 1; save(); return true;
      },
      equipBoard(id) { if (!this.ownsBoard(id)) return false; m.boards.equipped = id; save(); return true; },
      // ---- Progresión del modo Clásico (mundos × niveles, estrellas 0..3) ----
      worldData: (wid) => (m.worlds[wid] || (m.worlds[wid] = { levels: {} })),
      levelStars(wid, lvl) { const w = m.worlds[wid]; return (w && w.levels && w.levels[lvl]) || 0; },
      worldStars(wid) { const w = m.worlds[wid]; if (!w || !w.levels) return 0; let s = 0; for (const k in w.levels) s += w.levels[k] || 0; return s; },
      worldCleared(wid) { const w = m.worlds[wid]; if (!w || !w.levels) return 0; let n = 0; for (const k in w.levels) if (w.levels[k] > 0) n++; return n; },
      worldMaxLevel(wid) { const w = m.worlds[wid]; if (!w || !w.levels) return 1; let mx = 0; for (const k in w.levels) if (w.levels[k] > 0 && +k > mx) mx = +k; return Math.min(mx + 1, 50); },
      setLevelStars(wid, lvl, stars) {
        const w = m.worlds[wid] || (m.worlds[wid] = { levels: {} });
        if (!w.levels) w.levels = {};
        const prev = w.levels[lvl] || 0;
        if (stars > prev) { w.levels[lvl] = stars; save(); return stars - prev; }
        return 0;
      },
      // ---- Recompensa diaria ----
      rewardReady: () => m.reward.date !== today(),
      rewardDay: () => m.reward.day || 0,
      rewardNextDay() {
        const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        return m.reward.date === y ? (m.reward.day || 0) + 1 : 1;
      },
      advMax: () => (m.adventure && m.adventure.maxLevel) || 1,
      advReach(level) { if (level > ((m.adventure && m.adventure.maxLevel) || 1)) { m.adventure.maxLevel = level; save(); } },
      // Intro de capítulo vista (una vez por capítulo). Campo nuevo tolerante a esquema.
      advChapterSeen(ch) { return !!(m.adventure && m.adventure.seen && m.adventure.seen[ch]); },
      markAdvChapterSeen(ch) { if (!m.adventure.seen) m.adventure.seen = {}; if (!m.adventure.seen[ch]) { m.adventure.seen[ch] = 1; save(); } },
      survBest: () => m.survBest || 0,
      survRecord(sec) { sec = Math.floor(sec); if (sec > (m.survBest || 0)) { m.survBest = sec; save(); return true; } return false; },
      survBestWave: () => m.survBestWave || 0,
      // Récord por dificultad (SV-12): el lanzador muestra "tu marca" en cada chip.
      // Retrocompatible: el global survBestWave se conserva como antes.
      survBestWaveFor: (diff) => (m.survBestWaves && m.survBestWaves[diff]) || 0,
      survWaveRecord(wave) {
        wave = Math.max(0, wave | 0);
        if (m.survBestWaves && wave > (m.survBestWaves[State.diff] || 0)) { m.survBestWaves[State.diff] = wave; save(); }
        if (wave > (m.survBestWave || 0)) { m.survBestWave = wave; save(); return true; }
        return false;
      },
      // ---- Hoja de Servicio del Superviviente (SV-30/31/32) ----
      // Rango vitalicio por oleadas acumuladas — señal de maestría pura, sin economía.
      // Umbrales validados con el sim (oleada ~18/run ⇒ Veterano ≈ 22 runs).
      SURV_RANKS: [
        { id: 'recluta', at: 0 }, { id: 'explorador', at: 50 }, { id: 'curtido', at: 150 },
        { id: 'veterano', at: 400 }, { id: 'elite', at: 900 }, { id: 'leyenda', at: 2000 },
      ],
      survData: () => m.surv,
      survRank() {
        const tot = m.surv.totalWaves || 0;
        const R = this.SURV_RANKS; let i = 0;
        for (let k = 0; k < R.length; k++) if (tot >= R[k].at) i = k;
        const next = R[i + 1] || null;
        return { id: R[i].id, index: i, total: tot, at: R[i].at, next: next ? next.id : null, nextAt: next ? next.at : null };
      },
      survWeekBest: () => m.surv.weekBest,
      survFeatDone: (id) => !!(m.surv.feats && m.surv.feats[id]),
      survFeatCount: () => Object.keys(m.surv.feats || {}).length,
      // Desbloquea una hazaña (idempotente). Devuelve true solo la primera vez.
      survUnlockFeat(id) {
        if (!m.surv.feats) m.surv.feats = {};
        if (m.surv.feats[id]) return false;
        m.surv.feats[id] = today(); save();
        return true;
      },
      // Marca una bendición como vista alguna vez (para la hazaña 'coleccionista').
      survSeeBoon(id) {
        if (!m.surv.boonsSeen) m.surv.boonsSeen = {};
        if (!m.surv.boonsSeen[id]) { m.surv.boonsSeen[id] = 1; save(); }
        return Object.keys(m.surv.boonsSeen).length;
      },
      survBoonsSeenCount: () => Object.keys(m.surv.boonsSeen || {}).length,
      // Bestiario de encuentros (JF-ε): visto/derrotado/flawless/nivel máx por jefe.
      _bossDexEntry(id) { if (!m.surv.bossDex) m.surv.bossDex = {}; return m.surv.bossDex[id] || (m.surv.bossDex[id] = { seen: 0, kills: 0, flawless: 0, maxLvl: 0 }); },
      survBossSeen(id) { const d = Meta._bossDexEntry(id); d.seen++; save(); },
      survBossKill(id, lvl, flawless) {
        const d = Meta._bossDexEntry(id);
        d.kills++;
        if (flawless) { d.flawless++; m.surv.masterRounds = (m.surv.masterRounds || 0) + 1; }
        if ((lvl || 1) > d.maxLvl) d.maxLvl = lvl || 1;
        save();
        return d;
      },
      survBossDex: () => m.surv.bossDex || {},
      survBossKillsTotal: () => Object.values(m.surv.bossDex || {}).reduce((a, d) => a + (d.kills || 0), 0),
      survMasterRounds: () => m.surv.masterRounds || 0,
      // Récord semanal ligado al mutador (SV-32): se reinicia solo al cambiar de semana
      // ISO (nunca se muestra como pérdida). Devuelve {isRecord, distinctMuts}.
      survWeekRecord(week, wave, mut) {
        const wb = m.surv.weekBest || (m.surv.weekBest = { week: '', wave: 0, mut: 'none' });
        if (wb.week !== week) { wb.week = week; wb.wave = 0; wb.mut = mut; }
        let isRecord = false;
        if (wave > wb.wave) {
          wb.wave = wave; wb.mut = mut; isRecord = true;
          if (mut && mut !== 'none') { if (!m.surv.mutsWon) m.surv.mutsWon = {}; m.surv.mutsWon[mut] = 1; }
          save();
        }
        return { isRecord, distinctMuts: Object.keys(m.surv.mutsWon || {}).length };
      },
      // Registro de fin de run (SV-30): acumula lo vitalicio. Devuelve el rango antes/después.
      recordSurvivalRun(ctx) {
        const before = this.survRank().id;
        m.surv.runs = (m.surv.runs || 0) + 1;
        m.surv.totalWaves = (m.surv.totalWaves || 0) + Math.max(0, ctx.wave | 0);
        m.surv.totalBosses = (m.surv.totalBosses || 0) + Math.max(0, ctx.bosses | 0);
        save();
        const after = this.survRank();
        // Pipeline (CH-2): una run digna (oleada ≥5) cuenta como objetivo; la
        // escalera de cofres por oleada 10/20/… sigue intacta como bonus aparte.
        const pipeline = (ctx.wave | 0) >= 5 ? this.recordChestProgress('supervivencia') : null;
        return { rankUp: before !== after.id, rank: after, pipeline };
      },
      claimReward() {
        if (m.reward.date === today()) return 0;
        const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        m.reward.day = (m.reward.date === y) ? (m.reward.day + 1) : 1;
        const amount = 20 + 10 * Math.min(m.reward.day, 7);
        m.reward.date = today(); m.coins = (m.coins || 0) + amount; save();
        return amount;
      },
      achievements: () => ACH.map(a => ({ id: a.id, name: a.name, desc: a.desc, rarity: a.rarity || 'common', unlocked: !!m.achievements[a.id] })),
      xpBoost(now) {
        const at = Number.isFinite(now) ? now : Date.now();
        const endsAt = Number.isFinite(m.xpBoostUntil) && m.xpBoostUntil > 0 ? m.xpBoostUntil : 0;
        const remainingMs = Math.max(0, endsAt - at);
        return { active: remainingMs > 0, multiplier: remainingMs > 0 ? XP_BOOST_MULTIPLIER : 1, endsAt, remainingMs };
      },
      activateXpBoost(durationMs, now) {
        const duration = Math.floor(Number(durationMs));
        const at = Number.isFinite(now) ? now : Date.now();
        if (!Number.isSafeInteger(duration) || duration <= 0) return this.xpBoost(at);
        const base = Math.max(at, Number.isFinite(m.xpBoostUntil) ? m.xpBoostUntil : 0);
        m.xpBoostUntil = Math.min(Number.MAX_SAFE_INTEGER, base + duration);
        save();
        return this.xpBoost(at);
      },
      addXp(n) { m.xp += n; let up = 0; while (m.xp >= xpForLevel(m.level)) { m.xp -= xpForLevel(m.level); m.level++; up++; } save(); return up; },
      recordGame(ctx) {
        m.games = (m.games || 0) + 1;
        m.totalRemoved = (m.totalRemoved || 0) + ctx.removed;
        const d = today(), y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (m.streak.date !== d) { m.streak.count = (m.streak.date === y) ? (m.streak.count + 1) : 1; m.streak.date = d; }
        const dm = dailyMission(); let missionDone = false;
        if (!m.daily.done) {
          const val = dm.kind === 'combo' ? ctx.maxCombo : dm.kind === 'remove' ? ctx.removed : dm.kind === 'score' ? ctx.score : (ctx.perfect ? 1 : 0);
          m.daily.progress = Math.max(m.daily.progress || 0, val);
          if (m.daily.progress >= dm.target) { m.daily.done = true; missionDone = true; }
        }
        // Reto semanal (acumulativo)
        const wk = weeklyChallenge(); let weeklyDone = false;
        if (!m.weekly.done) {
          const inc = wk.kind === 'games' ? 1 : wk.kind === 'remove' ? ctx.removed : wk.kind === 'score' ? ctx.score : 0;
          if (wk.kind === 'combo') m.weekly.progress = Math.max(m.weekly.progress || 0, ctx.maxCombo);
          else m.weekly.progress = (m.weekly.progress || 0) + inc;
          if (m.weekly.progress >= wk.target) {
            m.weekly.done = true; weeklyDone = true;
            // CH-2: el reto semanal deja de pagar solo XP — suelta el cofre de evento
            // (su fuente natural; antes el tipo 'event' era casi huérfano).
            this.addEventChest('weekly');
          }
        }
        // Estadísticas de por vida + mejor por modo (leaderboard local)
        m.stats.totalScore = (m.stats.totalScore || 0) + ctx.score;
        m.stats.totalTime = (m.stats.totalTime || 0) + (ctx.elapsed || 0);
        if (ctx.maxCombo > (m.stats.bestCombo || 0)) m.stats.bestCombo = ctx.maxCombo;
        const md = m.modes[ctx.mode] || (m.modes[ctx.mode] = { best: 0, plays: 0 });
        md.plays = (md.plays || 0) + 1;
        if (ctx.score > (md.best || 0)) md.best = ctx.score;
        // Pipeline (CH-2): en Contrarreloj libre el objetivo es puntuar ≥1000 en la
        // run (el Reto diario puntúa por medalla en recordDailyRun, no aquí).
        const pipeline = (ctx.mode === 'contrarreloj' && !ctx.daily && ctx.score >= 1000)
          ? this.recordChestProgress('contrarreloj') : null;
        let xpBase = Math.round(ctx.score / 10 + ctx.maxCombo * 5 + ctx.level * 20 + (ctx.perfect ? 100 : 0));
        if (missionDone) xpBase += 150;
        if (weeklyDone) xpBase += 400;
        const xpMultiplier = Number(ctx.xpMultiplier) === XP_BOOST_MULTIPLIER ? XP_BOOST_MULTIPLIER : 1;
        const xpGained = xpBase * xpMultiplier;
        const xpBoostBonus = xpGained - xpBase;
        const leveledUp = this.addXp(xpGained);
        // Monedas de la partida (motor de economía/tienda).
        let coinsGained = ctx.awardBaseCoins === false
          ? 0
          : Math.round(ctx.score / 40 + ctx.maxCombo * 2 + ctx.level * 5 + (ctx.perfect ? 40 : 0));
        // Las recompensas globales de misión/reto siguen aplicándose aunque un modo
        // (Clásico) ya tenga su propia recompensa base de nivel.
        if (missionDone) coinsGained += 60;
        if (weeklyDone) coinsGained += 200;
        m.coins = (m.coins || 0) + coinsGained;
        const cctx = Object.assign({ games: m.games }, ctx);
        const newAch = [];
        ACH.forEach(a => { if (!m.achievements[a.id] && a.t(cctx)) { m.achievements[a.id] = d; newAch.push(a); } });
        save();
        return { xpBase, xpMultiplier, xpBoostBonus, xpGained, coinsGained, leveledUp, newAch, missionDone, weeklyDone, weeklyChest: weeklyDone, pipeline };
      },
    };
  })();

  /* ===================== Econ (barra de economía reutilizable) =====================
   * Actualiza CUALQUIER elemento con data-econ="coins|gems|streak|tickets|chests"
   * en toda la app (home, selección de modo, mapa Clásico, juego). Una sola llamada
   * Econ.refresh() sincroniza todas las píldoras visibles con el estado de Meta.
   */
  const Econ = {
    ICONS: { coins: 'coin', gems: 'gem', streak: 'fire', tickets: 'ticket', chests: 'chest' },
    valueOf(kind) {
      switch (kind) {
        case 'coins': return Meta.coins();
        case 'gems': return Meta.gems();
        case 'streak': return Meta.streak();
        case 'tickets': return Meta.tickets();
        case 'chests': return Meta.chests();
        default: return 0;
      }
    },
    refresh(root) {
      const scope = root || document;
      scope.querySelectorAll('[data-econ]').forEach((el) => {
        const kind = el.dataset.econ;
        el.innerHTML = (this.ICONS[kind] ? iconInline(this.ICONS[kind]) + ' ' : '') + fmtNum(this.valueOf(kind));
      });
      // Pills del nuevo sistema base: solo el número (el icono es un SVG aparte).
      scope.querySelectorAll('[data-econ-num]').forEach((el) => {
        const value = this.valueOf(el.dataset.econNum);
        // Inicio mantiene la economía en una línea incluso con saldos grandes;
        // el resto del producto conserva el valor completo con separadores.
        el.textContent = (el.closest('#screen-start') || el.hasAttribute('data-econ-compact')) ? fmtCompact(value) : fmtNum(value);
      });
      const runCoins = $('#hud-run-coins');
      const runWrap = $('#hud-run-coins-wrap');
      if (runCoins) runCoins.textContent = fmtSigned(State.coinsRun || 0);
      if (runWrap) runWrap.hidden = State.mode === 'supervivencia' || !(State.coinsRun > 0);
      updateSinkBadges();
      refreshXpBoostIndicators();
    },
  };

  /* ===================== Storefront (recursos + XP) =====================
   * Adaptador de comercio deliberadamente pequeño. Durante las pruebas el
   * checkout se liquida de forma local e inmediata. La UI acepta adaptadores
   * síncronos o Promise; una futura pasarela encapsulará aquí validación,
   * idempotencia y liquidación de servidor sin rehacer la tienda visual.
   */
  const Storefront = {
    PAYMENT_MODE: 'mock-auto',
    CURRENCY_OFFERS: Object.freeze([
      Object.freeze({ id: 'gems-spark', kind: 'gems', amount: 100, priceEur: 1.09, asset: 'img/ui-generated/shop/gems-spark.png' }),
      Object.freeze({ id: 'gems-cache', kind: 'gems', amount: 330, compareAt: 300, priceEur: 3.39, best: true, asset: 'img/ui-generated/shop/gems-cache.png' }),
      Object.freeze({ id: 'gems-vault', kind: 'gems', amount: 1200, compareAt: 1000, priceEur: 11.99, asset: 'img/ui-generated/shop/gems-vault.png' }),
      Object.freeze({ id: 'coins-pouch', kind: 'coins', amount: 1000, priceEur: 1.09, asset: 'img/ui-generated/shop/coins-pouch.png' }),
      Object.freeze({ id: 'coins-crate', kind: 'coins', amount: 6000, compareAt: 5000, priceEur: 3.39, best: true, asset: 'img/ui-generated/shop/coins-crate.png' }),
      Object.freeze({ id: 'coins-vault', kind: 'coins', amount: 18000, compareAt: 15000, priceEur: 5.99, asset: 'img/ui-generated/shop/coins-vault.png' }),
    ]),
    XP_BOOST_OFFERS: Object.freeze([
      Object.freeze({ id: 'xp-6h', durationMs: 6 * 60 * 60 * 1000, multiplier: XP_BOOST_MULTIPLIER, gemCost: 25, labelKey: 'xp_pack_6h', asset: 'img/ui-generated/shop/xp-6h.png' }),
      Object.freeze({ id: 'xp-3d', durationMs: 3 * 24 * 60 * 60 * 1000, multiplier: XP_BOOST_MULTIPLIER, gemCost: 80, labelKey: 'xp_pack_3d', best: true, asset: 'img/ui-generated/shop/xp-3d.png' }),
      Object.freeze({ id: 'xp-7d', durationMs: 7 * 24 * 60 * 60 * 1000, multiplier: XP_BOOST_MULTIPLIER, gemCost: 160, labelKey: 'xp_pack_7d', best: true, asset: 'img/ui-generated/shop/xp-7d.png' }),
    ]),
    /* Compra directa de cofres con gemas (sink de la divisa premium). Sigue el
     * orden de rareza de CHEST_TYPE_ORDER sin el cofre de evento (ese solo se
     * gana jugando). Precios pensados para ser caros pero asequibles: el cofre
     * comprado entra al inventario y se abre por el flujo normal (ranura/instantáneo). */
    CHEST_OFFERS: Object.freeze([
      Object.freeze({ id: 'wood', gemCost: 30 }),
      Object.freeze({ id: 'bronze', gemCost: 50 }),
      Object.freeze({ id: 'silver', gemCost: 90 }),
      Object.freeze({ id: 'gold', gemCost: 140 }),
      Object.freeze({ id: 'magic', gemCost: 210 }),
      Object.freeze({ id: 'royal', gemCost: 300 }),
      Object.freeze({ id: 'supreme', gemCost: 450 }),
      Object.freeze({ id: 'champion', gemCost: 650 }),
      Object.freeze({ id: 'divine', gemCost: 900 }),
    ]),
    checkoutCurrency(id) {
      const offer = this.CURRENCY_OFFERS.find((item) => item.id === id);
      if (!offer || !['coins', 'gems'].includes(offer.kind)) return null;
      if (offer.kind === 'coins') Meta.addCoins(offer.amount);
      else Meta.addGems(offer.amount);
      return {
        id: `mock-${Date.now().toString(36)}-${offer.id}`,
        status: 'paid', paymentMode: this.PAYMENT_MODE,
        offerId: offer.id, kind: offer.kind, amount: offer.amount,
      };
    },
    buyXpBoost(id, now) {
      const offer = this.XP_BOOST_OFFERS.find((item) => item.id === id);
      if (!offer) return null;
      if (!Meta.spendGems(offer.gemCost)) return { status: 'declined', reason: 'insufficient-gems', offerId: id };
      const boost = Meta.activateXpBoost(offer.durationMs, now);
      return { status: 'paid', paymentMode: 'gems', offerId: id, gemCost: offer.gemCost, boost };
    },
    buyChest(id) {
      const offer = this.CHEST_OFFERS.find((item) => item.id === id);
      // El cofre de evento no se vende: no está en CHEST_OFFERS y este guard lo blinda.
      if (!offer || id === 'event' || !CHEST_TYPES[id]) return null;
      if (!Meta.spendGems(offer.gemCost)) return { status: 'declined', reason: 'insufficient-gems', offerId: id };
      Meta.addChest(1, id, 'shop');
      return { status: 'paid', paymentMode: 'gems', offerId: id, gemCost: offer.gemCost, chestType: id };
    },
  };

  function formatBoostTime(ms) {
    const totalMin = Math.max(0, Math.ceil((Number(ms) || 0) / 60000));
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${Math.max(1, mins)}m`;
  }

  // Token compacto de un solo trozo para el pill de energía de la cabecera
  // (batería del booster de XP): 3d · 6h · 45m. Sin espacios para caber en la cápsula.
  function compactBoostTime(ms) {
    const totalMin = Math.max(0, Math.ceil((Number(ms) || 0) / 60000));
    const days = Math.floor(totalMin / 1440);
    if (days > 0) return `${days}d`;
    const hours = Math.floor(totalMin / 60);
    if (hours > 0) return `${hours}h`;
    return `${Math.max(1, totalMin)}m`;
  }
  function refreshXpBoostIndicators() {
    const boost = Meta.xpBoost();
    const status = $('#xp-boost-status');
    if (status) {
      status.classList.toggle('is-active', boost.active);
      status.textContent = boost.active
        ? I18n.t('xp_boost_active').replace('{t}', formatBoostTime(boost.remainingMs))
        : I18n.t('xp_boost_inactive');
    }
    document.querySelectorAll('[data-xp-boost-remaining]').forEach((el) => {
      el.hidden = !boost.active;
      if (boost.active) el.textContent = I18n.t('xp_boost_active').replace('{t}', formatBoostTime(boost.remainingMs));
    });
    // Pill "Energía" de la cabecera: la energía ES el booster de XP. Muestra el
    // tiempo restante como una batería que se agota; el + de la cápsula recarga.
    document.querySelectorAll('[data-energy-value]').forEach((el) => {
      el.textContent = boost.active ? compactBoostTime(boost.remainingMs) : I18n.t('energy_off');
      const wallet = el.closest('.hub-header-wallet');
      if (wallet) {
        wallet.classList.toggle('is-charged', boost.active);
        wallet.setAttribute('aria-label', `${I18n.t('energy_label')}: ${boost.active ? I18n.t('xp_boost_active').replace('{t}', formatBoostTime(boost.remainingMs)) : I18n.t('xp_boost_inactive')}`);
      }
    });
    const hud = $('#hud-xp-boost');
    if (hud) hud.hidden = !(State.status !== 'idle' && State.xpMultiplier === XP_BOOST_MULTIPLIER);
  }
  // Badges de descubribilidad de sumideros de economía: avisan de que puedes gastar gemas
  // (cofre premium, 25💎) o tickets (reroll de misión diaria). Se recalculan en cada
  // Econ.refresh, así que reaccionan a cualquier cambio de la economía sin cableado extra.
  function updateSinkBadges() {
    const md = $('#missions-dot');
    if (md) {
      const d = Meta.dailyMission(), w = Meta.weeklyChallenge();
      const rerollable = d && !d.done && Meta.tickets() > 0;
      md.hidden = !((d && d.done) || (w && w.done) || rerollable);
    }
    const cd = $('#chests-dot');
    if (cd) cd.hidden = Meta.gems() < Meta.PREMIUM_CHEST_GEMS;
  }

  /* ===================== Iconos PNG (pack "Free Icon Pack" de @gvesster, en img/ui) =====================
   * Reemplazan a los emojis por toda la UI. `icon()` rellena su contenedor (data-art,
   * .econ-ic, emblemas de modal…); `iconInline()` se mete dentro de texto (precios,
   * toasts, leaderboard). Las fichas del tablero siguen siendo SVG (ver Icons).
   */
  const ICONS_DIR = 'img/ui';
  // RS-5 (docs/RENDER_STABILITY_PLAN.md): decoding="async" evita que la imagen decodifique en
  // el hilo principal al pintarse (jank + "imágenes a medias" al navegar bajo presión de memoria).
  const icon = (name, cls) => `<img class="ic${cls ? ' ' + cls : ''}" src="${ICONS_DIR}/${name}.png" alt="" decoding="async" draggable="false">`;
  const iconInline = (name) => icon(name, 'ic-inline');
  const ICONS_V2_DIR = 'img/icons-v2';
  const V2_ICONS = {
    'mode-classic': '8-ui/grid',
    'mode-survival': '3-gear/shield',
    'mode-multi': '8-ui/user-group',
    cactus: '4-nature/cactus',
    mountain: '4-nature/mountain',
    town: '6-buildings/town',
    meteor: '4-nature/meteor',
    snowflake: '4-nature/snowflake',
    'circle-ring': '8-ui/circle-ring',
    rest: '8-ui/rest',
    brush: '10-editing/brush',
    double: '1-game/double',
    'mobile-phone': '9-media/mobile-phone',
    font: '10-editing/font',
    radiation: '12-misc/radiation',
    link: '9-media/link',
    connection: '9-media/connection',
    prohibited: '8-ui/prohibited',
    drought: '4-nature/drought',
    download: '9-media/download',
    share: '9-media/share',
    notification: '9-media/notification',
    'wi-fi': '9-media/wi-fi',
    'four-pointed-star': '12-misc/four-pointed-star',
    flag: '6-buildings/flag',
    hourglass: '9-media/time',
    warning: '8-ui/exclamation',
    'arrow-left': '8-ui/arrow-left',
    play: '9-media/play',
    pause: '9-media/pause',
    refresh: '8-ui/refresh',
    cross: '8-ui/cross',
  };
  const iconV2Path = (name) => `${ICONS_V2_DIR}/${V2_ICONS[name] || name}.svg`;
  const iconV2 = (name, cls) => `<span class="icv2${cls ? ' ' + cls : ''}" style="--icv2-url:url('${iconV2Path(name)}')" aria-hidden="true"></span>`;
  const iconV2Inline = (name) => iconV2(name, 'icv2-inline');
  const isV2Icon = (name) => typeof name === 'string' && name.startsWith('v2:');
  const iconAny = (name, cls) => isV2Icon(name) ? iconV2(name.slice(3), cls) : icon(name, cls);
  const iconAnyInline = (name) => isV2Icon(name) ? iconV2Inline(name.slice(3)) : iconInline(name);
  // Estructuras que guardan un glyph emoji: si la id tiene equivalente PNG se usa; si no, se mantiene el emoji.
  const MODE_IMG = { tutorial: 'book', clasico: 'pin', aventura: 'rocket', contrarreloj: 'clock', supervivencia: 'heart', zen: 'v2:rest' };
  const BIOME_IMG = { nebula: 'planet', asteroid: 'v2:meteor', ice: 'v2:snowflake', core: 'planet-hell', void: 'v2:circle-ring', crystal: 'crystal' };
  const WORLD_IMG = { bosque: 'leaf', desierto: 'v2:cactus', montana: 'v2:mountain', cueva: 'potion', neon: 'v2:town' };
  const BOOSTER_IMG = { bomb: 'bomb', freeze: 'v2:snowflake', clearLine: 'bolt', wild: 'v2:brush', x2: 'v2:double' };
  // Emojis sueltos (novedades de mundo, toasts, resúmenes) con icono equivalente en el pack.
  const EMOJI_IMG = { '🎯': 'target', '💎': 'crystal', '🌀': 'teleporter', '💣': 'bomb', '🎁': 'gift', '⚡': 'bolt', '➕': 'plus', '🔒': 'lock', '🏆': 'trophy', '🪙': 'coin', '🏅': 'medal', '⬆️': 'upgrade', '🗓️': 'calendar', '✅': 'check', '🔥': 'fire', '⭐': 'star', '🌟': 'star', '👑': 'crown', '🧊': 'v2:snowflake', '❄️': 'v2:snowflake', '☣️': 'v2:radiation', '⛓️': 'v2:link', '🕸️': 'v2:connection', '🚧': 'v2:prohibited', '🟫': 'v2:drought', '🏜️': 'v2:cactus', '🏔️': 'v2:mountain', '🏙️': 'v2:town', '🪨': 'v2:meteor', '🕳️': 'v2:circle-ring', '🧹': 'v2:brush', '🃏': 'v2:double', '📳': 'v2:mobile-phone', '🔠': 'v2:font', '📲': 'v2:download', '📤': 'v2:share', '🔔': 'v2:notification', '📶': 'v2:wi-fi', '🎉': 'v2:four-pointed-star', '✨': 'v2:four-pointed-star', '🏁': 'v2:flag' };
  // <img> en línea si el emoji tiene equivalente; si no, el propio emoji (texto).
  const emojiIcon = (e) => EMOJI_IMG[e] ? iconAnyInline(EMOJI_IMG[e]) : e;

  /* ===================== Preload (universo de assets de la UI) =====================
   * Fuente única de verdad de las URLs de iconos/arte que la UI inserta por
   * innerHTML al abrir vistas y modales. Como esas vistas se construyen bajo
   * demanda, sus assets no están en el DOM al arrancar y provocaban un
   * "parpadeo" la primera vez que se abrían. El preloader de arranque y el
   * calentado en segundo plano consumen estas listas para tener el 100% de los
   * iconos listos ANTES de que el usuario navegue. */
  const Preload = {
    // Todos los PNG del pack de UI (img/ui). Mantener sincronizado con la carpeta
    // img/ui/ y con UI_ICONS de sw.js: son los iconos de cabeceras, filas, chips,
    // econ y emblemas de modal repartidos por todo el juego.
    UI_ICONS: [
      'aura', 'bolt', 'bomb', 'book', 'calendar', 'cart', 'check', 'chest', 'clock',
      'close', 'coin', 'crown', 'crystal', 'dice', 'fire', 'friend', 'gem', 'gift',
      'heart', 'house', 'info', 'leaf', 'lock', 'luckyblock', 'magnet', 'medal',
      'minus', 'music-off', 'music-on', 'pencil', 'pin', 'planet-hell', 'planet',
      'player', 'players', 'plus', 'potion', 'question', 'rocket', 'search',
      'settings', 'shield', 'skull', 'sound-off', 'sound-on', 'star-empty', 'star',
      'stats', 'target', 'teleporter', 'ticket', 'trophy', 'upgrade', 'verify', 'warning',
    ],
    // URLs del universo de iconos: PNG de UI + SVG de iconografía v2 (máscaras CSS
    // --icv2-url). Cubre el 100% de nombres que icon()/iconV2() pueden producir.
    iconUrls() {
      const urls = this.UI_ICONS.map((n) => `${ICONS_DIR}/${n}.png`);
      Object.keys(V2_ICONS).forEach((n) => urls.push(iconV2Path(n)));
      return urls;
    },
    // Arte de menús/modales que se construye al abrir la vista (aún no está en el
    // DOM): se toma de las estructuras de datos para no depender del render.
    menuArtUrls() {
      const urls = [];
      try {
        Object.values(PlayerIcons.DEFS).forEach((d) => urls.push(d.asset));
        Object.values(PlayerBorders.DEFS).forEach((d) => urls.push(d.asset));
        Object.values(CHEST_TYPES).forEach((c) => urls.push(c.asset));
        Storefront.CURRENCY_OFFERS.forEach((o) => urls.push(o.asset));
        Storefront.XP_BOOST_OFFERS.forEach((o) => urls.push(o.asset));
        Boards.order.forEach((id) => urls.push('img/board-themes/v2/' + id + '/preview.jpg'));
        // Modal de lanzamiento de modo: emblema + icono de CTA de cada modo, que
        // se construyen al abrirlo (por eso parpadeaban la primera vez).
        Object.values(MODE_LAUNCH_META).forEach((m) => { urls.push(m.emblem); urls.push(m.startIcon); });
      } catch (_) { /* estructura inesperada: devolvemos lo reunido */ }
      return urls.filter(Boolean);
    },
    // Todo lo precargable de golpe (iconos + arte de menús), deduplicado.
    allUrls() {
      const seen = new Set();
      return [].concat(this.iconUrls(), this.menuArtUrls()).filter((u) => u && !seen.has(u) && seen.add(u));
    },
  };

  /* ===================== Art (ilustraciones SVG hechas a mano, 0 imágenes externas) =====================
   * Librería de SVGs fieles a los mockups: avatar robot, cohete, regalo, trofeo,
   * tableros, VS, isla, corazón+enemigos, libro e iconos de navegación. Cada función
   * devuelve un <svg> inline que rellena su contenedor. Se reutilizan en Inicio,
   * Selección de modo y (a futuro) el resto del juego.
   */
  const Art = {
    _s(inner, vb) { return `<svg viewBox="${vb || '0 0 100 100'}" width="100%" height="100%" fill="none" aria-hidden="true" focusable="false">${inner}</svg>`; },
    // --- Tokens de 1 concepto: ahora PNG del pack (img/ui) ---
    avatar() { return icon('player'); },
    plus() { return icon('plus'); },
    coin() { return icon('coin'); },
    gem() { return icon('gem'); },
    fire() { return icon('fire'); },
    pencil() { return icon('pencil'); },
    gift() { return icon('gift'); },
    rocket() { return icon('rocket'); },
    trophy() { return icon('trophy'); },
    chest() { return icon('chest'); },
    book() { return icon('book'); },
    target() { return icon('target'); },
    calendar() { return icon('calendar'); },
    crownLock() { return icon('crown'); },
    friends() { return icon('friend'); },
    medal() { return icon('medal'); },
    cart() { return icon('cart'); },
    home() { return icon('house'); },
    gear() { return icon('settings'); },
    // --- Sin equivalente de 1 icono en el pack: se mantienen como SVG propio ---
    bell() { return this._s(`<path d="M50 18 C36 18 30 28 30 42 C30 60 22 64 22 70 H78 C78 64 70 60 70 42 C70 28 64 18 50 18 Z" fill="#d7e2ff" stroke="#9fb0e0" stroke-width="3"/><circle cx="50" cy="78" r="7" fill="#d7e2ff"/><rect x="46" y="10" width="8" height="8" rx="4" fill="#d7e2ff"/>`); },
    // Ilustraciones compuestas (tarjetas de modo / inicio): se mantienen como SVG
    boardMini() { return iconV2('mode-classic'); },
    island() { return iconV2('mode-classic'); },
    heartFoes() { return iconV2('mode-survival'); },
    vsBalls() { return iconV2('mode-multi'); },
    vsPeople() { return iconV2('mode-multi'); },
    // (target/calendar/crownLock/friends/medal/cart/home/gear → ya definidos arriba como icon())
  };


  const Tiles = {
    DEFS: {
      rock: { glyph: '🪨', solid: true, cls: 'tile-rock', desc: 'Roca: estorba y no converge' },
      locked: { glyph: '🔒', solid: true, cls: 'tile-locked', desc: 'Bloqueada' },
      frozen: { glyph: '🧊', solid: true, cls: 'tile-frozen', taps: 2, breakable: true, desc: 'Helada: toca para descongelar' },
      // `infected` retirado en V1 (nunca tuvo lógica de propagación). Reintroducir con ROADMAP 3.4.
      crystal: { glyph: '💎', solid: false, cls: 'tile-crystal', bonus: 3, desc: 'Vale puntos extra' },
      // --- Obstáculos del mockup ---
      chains: { glyph: '⛓️', solid: true, cls: 'tile-chains', taps: 2, breakable: true, desc: 'Cadenas: toca 2 veces para liberar' },
      web: { glyph: '🕸️', solid: true, cls: 'tile-web', taps: 2, breakable: true, desc: 'Telaraña: toca 2 veces para liberar' },
      barrier: { glyph: '🚧', solid: true, cls: 'tile-barrier', desc: 'Barrera: sólo se quita con objetos especiales' },
      mud: { glyph: '🟫', solid: false, cls: 'tile-mud', taps: 2, breakable: true, desc: 'Lodo: ralentiza y cuesta limpiar' },
      // --- Objetos especiales del mockup (tap = efecto) ---
      bonus: { glyph: '+30', trigger: 'bonus', cls: 'tile-bonus', desc: 'Bonus: +30 puntos al instante' },
      portal: { glyph: '🌀', trigger: 'portal', cls: 'tile-portal', desc: 'Portal: teletransporta una figura' },
      magicbox: { glyph: '🎁', trigger: 'magicbox', cls: 'tile-magicbox', desc: 'Caja mágica: libera figuras cercanas' },
      bomb: { glyph: '💣', trigger: 'bomb', cls: 'tile-bomb', desc: 'Bomba oculta: detona figuras cercanas' },
      slowdown: { glyph: '⏳', trigger: 'slowdown', cls: 'tile-slowdown', desc: 'Ralentizador: reduce la velocidad de aparición' },
      timecap: { glyph: '⏰', trigger: 'timecap', cls: 'tile-timecap', desc: 'Cápsula: +5s al detonarla por adyacencia' },
      // --- Sistema de jefes (JF-02, docs/BOSS_SYSTEM_MASTER_PLAN.md §3.3) ---
      // Ancla: PV del jefe. No-sólida como el cristal (vive BAJO un icono; converger
      // ese icono = 1 golpe). La variante blindada lleva `hits`>0 y solid=true en la
      // INSTANCIA: el icono queda atrapado (semántica de hielo) hasta romper el
      // blindaje por adyacencia. Inmune a objetos/alivio (_powerClear): al jefe se
      // le vence jugando, no gastando.
      boss: { glyph: '◆', solid: false, cls: 'tile-boss', desc: 'Ancla de jefe: converge el icono de encima para dañarla' },
      // Jaula: guarda algo robado por el jefe (potenciador). Sólida, se rompe por
      // adyacencia como un candado; al romperse devuelve el botín (t.loot).
      cage: { glyph: '🔒', solid: true, cls: 'tile-cage', desc: 'Jaula del jefe: rompe por adyacencia para recuperar lo robado' },
    },
    // Lista de clases CSS de casilla (para limpiar/aplicar en Render.setTile).
    CLASSES: ['tile-rock', 'tile-locked', 'tile-frozen', 'tile-crystal', 'tile-chains', 'tile-web', 'tile-barrier', 'tile-mud', 'tile-bonus', 'tile-portal', 'tile-magicbox', 'tile-bomb', 'tile-slowdown', 'tile-timecap', 'tile-boss', 'tile-cage'],
    make(type) { const d = this.DEFS[type]; return d ? Object.assign({ type }, d) : null; },
  };

  /* ===================== Boosters (potenciadores) =====================
   * Catálogo de potenciadores. `apply(ctx)` se conecta en la Fase 5 (Supervivencia).
   */
  const Boosters = {
    DEFS: {
      bomb: { name: 'Bomba', glyph: '💣', start: 0, desc: 'Elimina una zona 3×3' },
      freeze: { name: 'Congelación', glyph: '❄️', start: 0, desc: 'Pausa la aparición de figuras' },
      clearLine: { name: 'Rayo', glyph: '⚡', start: 0, desc: 'Elimina una fila o columna' },
      wild: { name: 'Escoba', glyph: '🧹', start: 0, desc: 'Limpia el grupo más repetido' },
      x2: { name: 'Comodín', glyph: '🃏', start: 0, desc: 'Duplica los puntos un tiempo' },
    },
    order: ['bomb', 'freeze', 'x2', 'clearLine', 'wild'],
  };

  /* ===================== Modifiers (reglas de bioma/oleada) =====================
   * Bloques reutilizables que combinan los modos Aventura/Supervivencia (Fases 4/5).
   */
  const Modifiers = {
    DEFS: {
      rocks: { name: 'Asteroides', tile: 'rock', density: 0.06 },
      ice: { name: 'Hielo', tile: 'frozen', density: 0.05 },
      rush: { name: 'Núcleo', spawnMult: 0.8 },
      scarce: { name: 'Vacío', hints: 1 },
      crystals: { name: 'Cristales', tile: 'crystal', density: 0.04 },
    },
  };

  /* ===================== Themes + Cosmetics (tienda) =====================
   * Cada tema = sobrescritura de variables CSS (coste de runtime cero). Se aplican
   * en :root; el equipado se guarda en Meta.cosmetics.theme.
   */
  const Themes = {
    DEFS: {
      default: { name: 'Cosmos', cost: 0, rarity: 'common', vars: {} },
      neon: { name: 'Neón', cost: 150, rarity: 'rare', vars: { '--bg-0': '#0a0420', '--bg-1': '#12063a', '--bg-2': '#1e0a5c', '--panel': '#1a1052', '--panel-2': '#241466', '--accent': '#b14bff', '--accent-2': '#19f0d0', '--level': '#ff5cf0', '--score': '#19f0d0' } },
      sunset: { name: 'Ocaso', cost: 200, rarity: 'rare', vars: { '--bg-0': '#1a0a14', '--bg-1': '#2e0f1e', '--bg-2': '#4a1530', '--panel': '#34122a', '--panel-2': '#451a38', '--accent': '#ff7a59', '--accent-2': '#ffd23f', '--level': '#ff5b6e', '--score': '#ffb24d' } },
      forest: { name: 'Bosque', cost: 200, rarity: 'rare', vars: { '--bg-0': '#04140f', '--bg-1': '#08231a', '--bg-2': '#0e3a2b', '--panel': '#0c3024', '--panel-2': '#114433', '--accent': '#2fbf71', '--accent-2': '#9be15d', '--level': '#27b6a0', '--score': '#9be15d' } },
      aurora: { name: 'Aurora', cost: 300, rarity: 'epic', vars: { '--bg-0': '#04101c', '--bg-1': '#082236', '--bg-2': '#0c3a52', '--panel': '#0b2c45', '--panel-2': '#103a59', '--accent': '#19f0d0', '--accent-2': '#7a5cff', '--level': '#3ad07f', '--score': '#19f0d0' } },
      mono: { name: 'Eclipse', cost: 250, rarity: 'common', vars: { '--bg-0': '#0c0c10', '--bg-1': '#16161c', '--bg-2': '#24242e', '--panel': '#1c1c24', '--panel-2': '#26262f', '--accent': '#8a90a6', '--accent-2': '#cfd6ea', '--level': '#aeb6cc', '--score': '#cfd6ea' } },
    },
    order: ['default', 'neon', 'sunset', 'forest', 'aurora', 'mono'],
    allVars() { const s = {}; this.order.forEach((id) => Object.keys(this.DEFS[id].vars).forEach((k) => s[k] = 1)); return Object.keys(s); },
    swatch(id) { const v = this.DEFS[id].vars; return `linear-gradient(135deg, ${v['--bg-2'] || '#101a3e'}, ${v['--accent-2'] || '#00d0ff'})`; },
  };
  const Cosmetics = {
    _set(id) {
      const root = document.documentElement;
      Themes.allVars().forEach((k) => root.style.removeProperty(k));
      const t = Themes.DEFS[id] || Themes.DEFS.default;
      Object.keys(t.vars).forEach((k) => root.style.setProperty(k, t.vars[k]));
      const tm = document.querySelector('meta[name=theme-color]');
      if (tm && t.vars['--bg-1']) tm.setAttribute('content', t.vars['--bg-1']);
    },
    apply() { this._set(Meta.cosmetics().theme); },
    previewTheme(id) { this._set(id); },
  };

  /* ===================== Boards (tableros comprables de la tienda) =====================
   * Son cosmeticos puros: cambian marco, patron y color de casillas, sin tocar reglas,
   * puntuacion, economia, spawns, dificultad ni power-ups.
   */
  const Boards = {
    DEFS: {
      classic: { name: 'Tablero Clásico', cost: 0, rarity: 'common', sw: 'linear-gradient(135deg,#1b2a52,#2f6bff)', chars: ['Marco espacial azul', 'Casillas limpias y legibles'] },
      // Exclusivo del Jardín Zen (GM-23): se gana con 50 flores, no se compra.
      jardin: { name: 'Jardín Zen', cost: 0, rarity: 'legendary', exclusive: true, sw: 'linear-gradient(135deg,#1d3a24,#9be15d 60%,#ffb7d5)', chars: ['Se gana con 50 flores zen', 'Pétalos y musgo en calma'] },
      madera: { name: 'Tablero de Madera', cost: 500, rarity: 'common', sw: 'linear-gradient(135deg,#5a3a1e,#a86a36)', chars: ['Vetas cálidas de madera', 'Marco artesanal'] },
      hielo: { name: 'Tablero de Hielo', cost: 800, rarity: 'rare', sw: 'linear-gradient(135deg,#2a6a9e,#9fe6ff)', chars: ['Cristal frío y brillo polar', 'Casillas translúcidas'] },
      lava: { name: 'Tablero de Lava', cost: 1200, rarity: 'rare', sw: 'linear-gradient(135deg,#7a1e10,#ff5b2e)', chars: ['Roca oscura y magma', 'Borde incandescente'] },
      cristal: { name: 'Tablero de Cristal', cost: 1500, rarity: 'epic', sw: 'linear-gradient(135deg,#5a2a8e,#c08bff)', chars: ['Prismas violetas', 'Destellos de vidrio'] },
      magico: { name: 'Tablero Mágico', cost: 2000, rarity: 'epic', sw: 'linear-gradient(135deg,#3a1e6e,#8a5cff)', chars: ['Runas arcanas sutiles', 'Brillo encantado'] },
      futurista: { name: 'Tablero Futurista', cost: 2500, rarity: 'epic', sw: 'linear-gradient(135deg,#0e3a4a,#19f0d0)', chars: ['Circuitos neón', 'Paneles tecnológicos'] },
      dorado: { name: 'Tablero Dorado', cost: 3000, rarity: 'legendary', sw: 'linear-gradient(135deg,#7a5a10,#ffd84d)', chars: ['Oro pulido', 'Detalles premium'] },
      bosque: { name: 'Tablero del Bosque', cost: 1800, rarity: 'rare', sw: 'linear-gradient(135deg,#1e4a2a,#6bd36b)', chars: ['Textura de hojas', 'Tonos naturales'] },
      cosmico: { name: 'Tablero Cósmico', cost: 2200, rarity: 'epic', sw: 'linear-gradient(135deg,#2a1a5e,#a06bff)', chars: ['Nebulosa profunda', 'Estrellas en el marco'] },
    },
    order: ['classic', 'madera', 'hielo', 'lava', 'cristal', 'magico', 'futurista', 'dorado', 'bosque', 'cosmico', 'jardin'],
    apply(id) {
      const current = id || Meta.equippedBoard();
      ['#screen-game', '.board-wrap', '#board'].forEach((sel) => {
        const el = $(sel);
        if (el) el.dataset.board = current;
      });
    },
  };

  /* ===================== Adventure (modo Aventura: biomas procedurales infinitos) =====================
   * Capítulos infinitos; cada capítulo = `perChapter` niveles de un bioma (paleta +
   * modificadores + objetivo) y termina en un nodo de mini-jefe. La dificultad escala
   * sin fin con el capítulo. Usa los registros Tiles/Modifiers de la Fase 0.
   */
  const Adventure = {
    perChapter: 5,
    BIOMES: [
      { id: 'nebula', name: 'Nebulosa', glyph: '🌌', mods: [], accent: '#7a5cff' },
      { id: 'asteroid', name: 'Cinturón de Asteroides', glyph: '🪨', mods: ['rocks'], accent: '#ff9838' },
      { id: 'ice', name: 'Campo de Hielo', glyph: '🧊', mods: ['ice'], accent: '#2bd4e6' },
      { id: 'core', name: 'Núcleo Ardiente', glyph: '🔥', mods: ['rush'], accent: '#ff5b6e' },
      { id: 'void', name: 'El Vacío', glyph: '🕳️', mods: ['scarce'], accent: '#a06bff' },
      { id: 'crystal', name: 'Cristalia', glyph: '💎', mods: ['crystals'], accent: '#19f0d0' },
    ],
    objective: 'clear', target: 0, levelScore0: 0, levelStart: 0,
    chapterOf(level) { return Math.floor((level - 1) / this.perChapter); },
    licOf(level) { return (level - 1) % this.perChapter; },
    biomeOf(level) { return this.BIOMES[this.chapterOf(level) % this.BIOMES.length]; },
    isBoss(level) { return this.licOf(level) === this.perChapter - 1; },
    resumeLevel() { return Meta.advMax(); },

    /* ---- Rutas de capítulo (GM-06) y reliquias de jefe (GM-07) ----
     * La identidad "expedición": el jugador COMPONE su run. Ruta = trade-off del
     * capítulo (más obstáculos por más puntos, o calma sin bonus). Reliquia =
     * pasiva de run ganada al superar un jefe (máx. 3, FIFO). Estado de run
     * volátil: no persiste en RunSave/Meta (una expedición interrumpida retoma
     * el nivel, no las elecciones). */
    ROUTES: [
      { id: 'dense', icon: '🪨' },   // +obstáculos → puntos ×1.25 (visible en el chip)
      { id: 'calm', icon: '🌿' },    // spawn ×1.15 más lento, sin bonus
    ],
    RELICS: [
      { id: 'combo', icon: '⏱️' },   // ventana de combo +400ms
      { id: 'crystal', icon: '💎' }, // cristales valen +30 extra
      { id: 'hint', icon: '🔍' },    // +1 pista por nivel
      { id: 'shield', icon: '🛡️' },  // 1ª derrota del capítulo: despeje 30% en vez de fin
    ],
    route: null, relics: [], shieldUsed: false, _routeChapter: -1, log: [],
    resetRun() { this.route = null; this.relics = []; this.shieldUsed = false; this._routeChapter = -1; this.log = []; this.bossAcc = 0; this._bossWarned = false; this._rHp = -1; this._rNext = -1; document.documentElement.style.removeProperty('--boss-accent'); },
    hasRelic(id) { return this.relics.indexOf(id) !== -1; },
    _applyRoute() {
      if (this.route === 'calm') State.spawnRate = Math.round(State.spawnRate * 1.15);
      else if (this.route === 'dense') {
        State.tempMult = 1.25; // bonus legible en el chip de multiplicador (GM-16)
        const biome = this.biomeOf(State.level);
        if (biome.mods.includes('rocks')) this._placeOnEmpty('rock', 0.05);
        else if (biome.mods.includes('ice')) this._placeFrozen(0.05);
        else if (biome.mods.includes('crystals')) this._placeCrystals(2);
        else this._placeOnEmpty('rock', 0.04);
        Render.syncAll();
      }
    },
    maybeOfferRoute(level) {
      if (this.licOf(level) !== 0) return;
      const ch = this.chapterOf(level);
      if (this._routeChapter === ch) return;
      this._routeChapter = ch;
      const biome = this.biomeOf(level);
      Picker.open({
        title: I18n.t('route_title'), sub: I18n.t('chapter') + ' ' + (ch + 1) + ' · ' + this.biomeName(biome), accent: biome.accent,
        options: this.ROUTES.map((r) => ({ id: r.id, icon: r.icon, name: I18n.t('route_' + r.id), desc: I18n.t('route_' + r.id + '_d') })),
        onPick: (id) => {
          this.route = id;
          this._applyRoute();
          this.log.push({ t: 'ch', n: ch + 1, biome: biome.id, route: id }); // registro (GM-09)
          Toasts.show(I18n.t('route_' + id), 'good', 1600, '🧭');
          this.banner(level);
        },
      });
    },
    offerRelic(then) {
      const have = new Set(this.relics);
      const pool = this.RELICS.filter((r) => !have.has(r.id));
      if (!pool.length) { if (then) then(); return; }
      const opts = []; const bag = pool.slice();
      while (opts.length < 3 && bag.length) opts.push(bag.splice(rand(bag.length), 1)[0]);
      Sound.milestone();
      Picker.open({
        title: I18n.t('relic_title'), sub: I18n.t('relic_sub'), accent: '#b46cff',
        options: opts.map((r) => ({ id: r.id, icon: r.icon, name: I18n.t('relic_' + r.id), desc: I18n.t('relic_' + r.id + '_d') })),
        onPick: (id) => {
          if (this.relics.length >= 3) this.relics.shift(); // se sustituye la más antigua
          this.relics.push(id);
          if (id === 'combo') State.comboWindow += 400; // efecto inmediato; setup lo re-deriva por nivel
          this.log.push({ t: 'relic', id }); // registro (GM-09)
          Toasts.show(I18n.t('relic_' + id), 'good', 1900, '🏺');
          Sound.record(); Haptics.milestone();
          if (then) then();
        },
      });
    },
    // Registro de expedición (GM-09): la run como historia contable en el resumen.
    expeditionHtml() {
      if (!this.log.length) return '';
      const parts = this.log.map((e) => {
        if (e.t === 'ch') {
          const bi = this.BIOMES.find((b) => b.id === e.biome) || {};
          return `${bi.glyph || ''} C${e.n} · ${esc(I18n.t('route_' + e.route))}`;
        }
        const relic = this.RELICS.find((r) => r.id === e.id) || {};
        return `${relic.icon || '🏺'} ${esc(I18n.t('relic_' + e.id))}`;
      });
      return `<b>${esc(I18n.t('exped_title'))}</b><span>${parts.join(' → ')}</span>`;
    },
    // Jefe con comportamiento (GM-08): en niveles jefe, cada 20s el bioma ACTÚA
    // (telegrafiado 3s antes). El jefe deja de ser "más cristales": hace cosas.
    BOSS_MS: 20000, bossAcc: 0, _bossWarned: false, _rHp: -1, _rNext: -1,
    // Fase 2 del jefe de bioma (JF-52, gated B-J6): con ≤2 cristales restantes el
    // jefe acelera su reloj de ataque 20s→15s — el remate se disputa.
    _bossMsFor() { return this.crystalsLeft() <= 2 ? 15000 : this.BOSS_MS; },
    onTick(dt) {
      if (this.objective !== 'boss' || State.status !== 'playing') return;
      this.bossAcc += dt;
      const ms = this._bossMsFor();
      if (!this._bossWarned && this.bossAcc >= ms - 3000) {
        this._bossWarned = true;
        Toasts.show(I18n.t('advboss_warn'), 'warn', 1900, '⚠️');
        Render.boardEvent('surv-wave-soon', 620);
        Sound.danger();
      }
      if (this.bossAcc >= ms) { this.bossAcc -= ms; this._bossWarned = false; this.bossAction(); }
      // Cara del jefe (JF-ζ): pips de cristales + cuenta del próximo ataque, con
      // diffing de 1s (mismo presupuesto que el banner de Supervivencia).
      const hp = $('#adv-boss-hp');
      if (hp) { const n = this.crystalsLeft(); if (this._rHp !== n) { this._rHp = n; hp.textContent = '◆'.repeat(Math.min(8, n)); } }
      const nx = $('#adv-boss-next');
      if (nx) { const s = Math.max(0, Math.ceil((ms - this.bossAcc) / 1000)); if (this._rNext !== s) { this._rNext = s; nx.textContent = '▲ ' + s + 's'; } }
    },
    _placeK(type, k) { const e = this._emptyIdx(); for (let x = 0; x < k && e.length; x++) State.tiles[e.splice(rand(e.length), 1)[0]] = Tiles.make(type); },
    _freezeK(k) { const f = this._filledIdx(); for (let x = 0; x < k && f.length; x++) State.tiles[f.splice(rand(f.length), 1)[0]] = Tiles.make('frozen'); },
    bossAction() {
      const b = this.biomeOf(State.level).id;
      if (b === 'asteroid') this._placeK('rock', 2);
      else if (b === 'ice') this._freezeK(2);
      else if (b === 'core') State.spawnRate = Math.max(300, Math.round(State.spawnRate * 0.9));
      else if (b === 'void') { State.hintsLeft = Math.max(0, State.hintsLeft - 1); Render.hud(); }
      else if (b === 'crystal') { if (this.crystalsLeft() < 6) { this._placeCrystals(1); this.refreshGoal(); } }
      else { for (let k = 0; k < 3; k++) Engine.spawnOne(); } // nebulosa: andanada
      Render.syncAll(); Render.boardShake();
      Toasts.show(I18n.t('advboss_' + b), 'bad', 1800, this.biomeOf(State.level).glyph);
      Sound.quake(); Haptics.quake();
      if (State.status === 'playing') Game.evaluate();
    },

    setup(level) {
      const biome = this.biomeOf(level), lic = this.licOf(level), chapter = this.chapterOf(level), boss = this.isBoss(level);
      this.levelScore0 = State.score; this.levelStart = State.elapsed;
      this.bossAcc = 0; this._bossWarned = false; // reloj del jefe activo (GM-08)
      // Frontera de capítulo: la ruta anterior caduca (se vuelve a elegir) y el
      // escudo de reliquia se recarga (es "1ª derrota DEL CAPÍTULO", GM-06/07).
      if (lic === 0 && chapter !== this._routeChapter) { this.route = null; State.tempMult = 1; this.shieldUsed = false; }
      // Escalada infinita: más presión de spawn por capítulo.
      State.spawnRate = Math.max(360, Math.round(State.spawnRate / (1 + chapter * 0.12)));
      // Objetivo del nivel
      this.objective = boss ? 'boss' : (lic === 2 ? 'score' : (lic === 3 && chapter > 0 ? 'survive' : 'clear'));
      this.target = 0;
      // Modificadores de bioma (densidad creciente con el capítulo)
      if (biome.mods.includes('rocks')) this._placeOnEmpty('rock', Math.min(0.16, 0.06 + chapter * 0.012));
      if (biome.mods.includes('ice')) this._placeFrozen(Math.min(0.14, 0.05 + chapter * 0.012));
      if (biome.mods.includes('rush')) State.spawnRate = Math.max(340, Math.round(State.spawnRate * 0.8));
      if (biome.mods.includes('scarce')) State.hintsLeft = 1;
      if (biome.mods.includes('crystals') && !boss) this._placeCrystals(2 + Math.min(chapter, 3));
      if (this.objective === 'score') this.target = this.scoreTarget(level);
      if (this.objective === 'survive') this.target = 18 + chapter * 4;
      if (this.objective === 'boss') this._placeCrystals(2 + Math.min(chapter, 4));
      // Referencia de cristales para la barra de progreso del héroe (HUD-A3): cuenta
      // tras colocar (los cristales pueden regenerarse, así que la barra clampa).
      this.bossCrystals0 = this.objective === 'boss' ? Math.max(1, this.crystalsLeft()) : 0;
      // Efectos de run elegidos por el jugador (GM-06/07), tras los del bioma.
      if (this.route) this._applyRoute();
      if (this.hasRelic('combo')) State.comboWindow += 400;
      if (this.hasRelic('hint')) State.hintsLeft = Math.min(9, State.hintsLeft + 1);
      this.banner(level);
      // Cara del jefe de bioma (JF-ζ): card de presentación + acento; se limpia en
      // niveles normales. Presentación pura — la mecánica (GM-08) no cambia.
      this._rHp = -1; this._rNext = -1;
      if (boss) {
        document.documentElement.style.setProperty('--boss-accent', biome.accent);
        const bossSr = I18n.t('surv_boss_enter_sr').replace('{b}', I18n.t('advdex_' + biome.id)).replace('{n}', this.chapterOf(level) + 1).replace('{k}', this.crystalsLeft());
        Render.bossCard(I18n.t('advdex_' + biome.id), I18n.t('advdex_' + biome.id + '_e'), null, bossSr);
      } else if (State.mode === 'aventura') {
        document.documentElement.style.removeProperty('--boss-accent');
      }
    },

    _emptyIdx() { const a = []; for (let i = 0; i < State.board.length; i++) if (State.board[i] === null && !State.tiles[i]) a.push(i); return a; },
    _filledIdx() { const a = []; for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null && !State.tiles[i]) a.push(i); return a; },
    _placeOnEmpty(type, density) { const e = this._emptyIdx(), n = Math.floor(e.length * density); for (let k = 0; k < n && e.length; k++) State.tiles[e.splice(rand(e.length), 1)[0]] = Tiles.make(type); },
    _placeFrozen(density) { const f = this._filledIdx(), n = Math.floor(State.board.length * density); for (let k = 0; k < n && f.length; k++) State.tiles[f.splice(rand(f.length), 1)[0]] = Tiles.make('frozen'); },
    _placeCrystals(k) { const f = this._filledIdx(); for (let x = 0; x < k && f.length; x++) State.tiles[f.splice(rand(f.length), 1)[0]] = Tiles.make('crystal'); },
    crystalsLeft() { let n = 0; for (let i = 0; i < State.tiles.length; i++) if (State.tiles[i] && State.tiles[i].type === 'crystal') n++; return n; },
    scoreTarget(level) {
      const chapter = this.chapterOf(level);
      return Math.round(level * (300 + 50 * chapter));
    },

    winCheck() {
      if (this.objective === 'score') return (State.score - this.levelScore0) >= this.target ? 'win' : undefined;
      if (this.objective === 'survive') return (State.elapsed - this.levelStart) >= this.target ? 'win' : undefined;
      if (this.objective === 'boss') return this.crystalsLeft() === 0 ? 'win' : undefined;
      return undefined; // 'clear' => regla por defecto (tablero vacío)
    },
    objectiveText() {
      if (this.objective === 'boss') return I18n.t('obj_boss_live').replace('{n}', this.crystalsLeft());
      if (this.objective === 'score') {
        const p = Math.max(0, State.score - this.levelScore0);
        return I18n.t('obj_score_live').replace('{p}', Math.min(p, this.target)).replace('{n}', this.target);
      }
      if (this.objective === 'survive') return I18n.t('obj_survive').replace('{n}', this.target);
      return I18n.t('obj_clear');
    },
    // Etiqueta CORTA y estática del objetivo, para el banner (identidad). El progreso
    // VIVO va al héroe del marcador (heroInfo), evitando duplicar el dato (HUD-A1).
    objectiveLabel() { return I18n.t('objlabel_' + this.objective); },
    // Métrica dominante del nivel para Render.hero() (HUD-A). El slot es el mismo en
    // todas las misiones; solo cambia el contenido (limpiar/puntuar/sobrevivir/jefe).
    heroInfo() {
      const obj = this.objective;
      if (obj === 'score') {
        const p = Math.min(this.target, Math.max(0, State.score - this.levelScore0));
        return { val: fmtNum(p) + ' / ' + fmtNum(this.target), frac: this.target ? p / this.target : 0 };
      }
      if (obj === 'survive') {
        const left = Math.max(0, this.target - (State.elapsed - this.levelStart));
        return { val: fmtTime(left), sub: I18n.t('hud_survive_sub'), frac: this.target ? 1 - left / this.target : 0, urgent: left <= 5 };
      }
      if (obj === 'boss') {
        const n = this.crystalsLeft(), tot = this.bossCrystals0 || n || 1;
        return { val: '◆ ' + n, sub: I18n.t('hud_boss_sub'), frac: 1 - Math.min(1, n / tot), urgent: n > 0 && n <= 2 };
      }
      const n = State.iconCount; // 'clear'
      return { val: n, sub: I18n.t('hud_remaining'), urgent: n > 0 && n <= 5 };
    },
    completionReason() {
      if (this.objective === 'score') return I18n.t('level_reason_score').replace('{n}', this.target);
      if (this.objective === 'survive') return I18n.t('level_reason_survive').replace('{n}', this.target);
      if (this.objective === 'boss') return I18n.t('level_reason_boss');
      return I18n.t('level_reason_clear');
    },
    // Objetivo del nivel `level` SIN mutar estado (para previsualizar el siguiente).
    previewObjective(level) {
      const lic = this.licOf(level), chapter = this.chapterOf(level), boss = this.isBoss(level);
      const obj = boss ? 'boss' : (lic === 2 ? 'score' : (lic === 3 && chapter > 0 ? 'survive' : 'clear'));
      if (obj === 'boss') return I18n.t('obj_boss');
      if (obj === 'score') return I18n.t('obj_score').replace('{n}', this.scoreTarget(level));
      if (obj === 'survive') return I18n.t('obj_survive').replace('{n}', 18 + chapter * 4);
      return I18n.t('obj_clear');
    },
    biomeName(bi) { return I18n.lang === 'en' ? (I18n.t('biome_' + bi.id) || bi.name) : bi.name; },
    biomeModText(bi) { return bi.mods.length ? I18n.t('biomemod_' + bi.id) : ''; },
    banner(level) {
      const el = $('#obj-banner'); if (!el) return;
      const biome = this.biomeOf(level);
      el.hidden = false; el.style.borderColor = '';
      const relicsHtml = this.relics.length
        ? `<span class="obj-relics" aria-label="${esc(I18n.t('relic_title'))}">${this.relics.map((id) => ((this.RELICS.find((r) => r.id === id) || {}).icon || '')).join('')}</span>`
        : '';
      // La cara del jefe de bioma (JF-ζ): en niveles jefe, el banner de objetivo
      // muestra nombre + epíteto + PV (cristales como pips) + próximo ataque —
      // misma presentación que Supervivencia, CERO cambio de reglas (§6).
      let bossHtml = '';
      if (this.isBoss(level)) {
        el.style.borderColor = biome.accent;
        bossHtml = `<span class="obj-boss-face"><b class="obf-name">${esc(I18n.t('advdex_' + biome.id))}</b><i class="obf-epithet">${esc(I18n.t('advdex_' + biome.id + '_e'))}</i><span class="obf-hp" id="adv-boss-hp" aria-hidden="true"></span><span class="obf-next" id="adv-boss-next" aria-hidden="true"></span></span>`;
      }
      el.innerHTML = `<span class="obj-biome">${BIOME_IMG[biome.id] ? iconAnyInline(BIOME_IMG[biome.id]) : biome.glyph} ${I18n.t('chapter')} ${this.chapterOf(level) + 1} · ${this.biomeName(biome)}</span>${bossHtml}<span class="obj-goal" id="obj-goal">${this.objectiveLabel()}</span>${relicsHtml}`;
    },
    // El progreso vivo lo pinta el héroe (Render.hero); el banner solo lleva la
    // etiqueta estática, así que refreshGoal ya no reescribe texto por frame.
    refreshGoal() { const g = $('#obj-goal'); if (g && g.textContent !== this.objectiveLabel()) g.textContent = this.objectiveLabel(); },
    // Intro de capítulo: un único evento del HUD, nunca una capa sobre el tablero.
    // Al terminar encadena las decisiones de ruta/reliquia que sí requieren interacción.
    maybeChapterIntro(level, then) {
      if (this.licOf(level) !== 0) return false;
      const chapter = this.chapterOf(level);
      if (Meta.advChapterSeen(chapter)) return false;
      Meta.markAdvChapterSeen(chapter);
      const biome = this.biomeOf(level);
      const next = () => {
        if (then) then(); else this.maybeOfferRoute(level);
      };
      const accepted = Toasts.event({
        key: `adventure-chapter-${chapter}`,
        kicker: `${I18n.t('chapter')} ${chapter + 1}`,
        title: this.biomeName(biome),
        detail: `${this.biomeModText(biome) || I18n.t('ci_no_mods')} · ${this.objectiveText()}`,
        icon: BIOME_IMG[biome.id] || biome.glyph,
        kind: 'info', priority: 86, ms: 2800,
        onFinish: next,
      });
      if (!accepted) next();
      return true;
    },
  };

  /* ===================== Survival (Supervivencia 2.0: oleadas, vidas, boosters, trampas) ===================== */
  const Survival = {
    WAVE_MS: 22000, MAX_LIVES: 3, CHARGE_PER: 9, BOOSTERS: ['bomb', 'freeze', 'clearLine', 'wild', 'x2'],
    // El anillo interior ya no imprime boosters aleatorios: convierte juego hábil
    // en monedas para que el jugador elija qué llevar en la siguiente preparación.
    // La carga se completa muchas veces en una run larga: el pago es deliberadamente
    // pequeño para no triplicar la economía persistente (validado por simulación).
    SUPPLY_COIN_BASE: 2, SUPPLY_COIN_PER_WAVE: 0, SUPPLY_COIN_CAP: 2,
    SPECIAL_CAP: { facil: 6, normal: 7, dificil: 8 },
    BLOCK_CAP: { facil: 4, normal: 5, dificil: 6 },
    BOMB_CAP: { facil: 2, normal: 2, dificil: 3 },
    // Tabla de escalado por dificultad (curva "perfecta", iterable desde un solo sitio).
    // waveMs: duración de oleada · lives: vidas · spawnDecay/Floor: aceleración de spawns ·
    // trapBase/Cap: densidad de trampas (·oleada) · varEvery: cada cuántas oleadas suben los iconos ·
    // bossEvery: cadencia de jefe · coinMult: multiplicador de recompensa.
    TUNE: {
      facil: { waveMs: 32000, lives: 4, spawnDecay: 0.985, spawnFloor: 2000, trapBase: 0.008, trapCap: 0.05, varEvery: 8, bossEvery: 8, coinMult: 0.85 },
      normal: { waveMs: 28000, lives: 3, spawnDecay: 0.975, spawnFloor: 1400, trapBase: 0.010, trapCap: 0.07, varEvery: 6, bossEvery: 6, coinMult: 1.0 },
      dificil: { waveMs: 22000, lives: 3, spawnDecay: 0.960, spawnFloor: 900, trapBase: 0.016, trapCap: 0.10, varEvery: 5, bossEvery: 5, coinMult: 1.3 },
    },
    tune() { return this.TUNE[State.diff] || this.TUNE.normal; },
    // Nivel efectivo de dificultad: sube con las oleadas y MANDA sobre el catálogo de
    // iconos (Engine.poolForLevel/varietyFor) → entran iconos más difíciles y se dejan
    // atrás los fáciles; además escala la puntuación base.
    dlevel() { return 1 + Math.floor((this.wave - 1) / this.tune().varEvery); },
    // Hazañas del Superviviente (SV-31): metas ORTOGONALES a la velocidad — el sim
    // demostró que la dificultad del modo es de atención, no mecánica; estas premian
    // estilo, no rapidez. Vitalicias, se celebran una vez. Icono para el medallero.
    FEATS: [
      { id: 'impecable', icon: '🛡️' },   // superar un jefe sin perder vida esa oleada
      { id: 'purista', icon: '✋' },       // llegar a oleada 10 sin usar potenciadores
      { id: 'fenix', icon: '🔥' },         // batir tu récord en una run donde reviviste
      { id: 'coleccionista', icon: '📖' }, // haber elegido las 8 bendiciones (vitalicio)
      { id: 'semana_completa', icon: '📅' },// récord semanal en 3 mutadores distintos
      { id: 'frenetico', icon: '⚡' },     // 3 frenesíes tier 3 en una run
      { id: 'al_limite', icon: '💔' },     // 2 oleadas completas con 1 vida
      { id: 'economo', icon: '💰' },       // oleada 15 sin revivir
      // Hazañas de caza (JF-ε): metas del sistema de encuentros.
      { id: 'cazador', icon: '⚔️' },       // derrotar a los 5 Señores (vitalicio)
      { id: 'ronda_maestra', icon: '✦' },  // 3 Rondas maestras (vitalicio)
      { id: 'domaecos', icon: '🔁' },      // derrotar un eco de nivel III+
    ],
    _feat(id) {
      if (Meta.survUnlockFeat(id)) {
        Toasts.show(I18n.t('feat_' + id) + ' · ' + I18n.t('feat_unlocked'), 'good', 2600, 'medal');
        Sound.record(); Haptics.record();
      }
    },
    lives: 3, wave: 1, waveAcc: 0, survSec: 0, charge: 0, frenzy: 0, frenzyUntil: 0, freezeUntil: 0, x2Until: 0, lockUntil: 0,
    runCoins: 0, runGems: 0, runChests: 0, newWaveRecord: false,
    inv: {}, pendingLoadout: null,
    _beatQ: [], _beatSeq: 0,
    _r: {},
    start() {
      const tn = this.tune();
      this.WAVE_MS = tn.waveMs; this.MAX_LIVES = tn.lives;
      this.lives = this.MAX_LIVES; this.wave = 1; this.waveAcc = 0; this.survSec = 0; this.charge = 0; this.frenzy = 0;
      this.freezeUntil = 0; this.x2Until = 0; this.frenzyUntil = 0; this.lockUntil = 0; this.runCoins = 0; this.runGems = 0; this.runChests = 0; this.newWaveRecord = false; this.revives = 0; State.tempMult = 1; this._r = { waveWarned: false, bossWarned: false };
      this.armed = null; this._preview = null; document.body.classList.remove('aiming');
      this.slowWaves = 0; this._boonAt = 0; this._beatQ = []; this._beatSeq = 0;
      this._bossSurvivedAt = 0; this._noBoosterSinceBoss = true; this._frenzyT3Seen = false; this._liveRecord = false; // hitos SV-20/21
      this._boonLog = []; this._bossesSurvived = 0; // resumen de la run (SV-22)
      this._bossesDefeated = 0; this._lastDefeat = null; this._defeatBeat = null; // encuentros (JF-γ)
      this._anyBoosterUsed = false; this._t3Count = 0; this._livesLostThisWave = 0; this._waves1Life = 0; // hazañas (SV-31)
      this._lastBossType = null; // eco/jefes SV-40/43 (el override de sim/tests NO se toca aquí)
      Bosses.abort(); // sin encuentro heredado de la run anterior (JF-α)
      Bosses._miniDry = 0; Bosses._lastWaveMini = false; Bosses._heraldEmpower = false; Bosses._heraldSlain = false; // minijefes (JF-δ)
      this._minisSeen = 0; this._minisKilled = 0;
      this.scoreBoost = 0; this.magnetMoves = 0; this.goldenWaveWaves = 0;
      this._introUntil = 0; this._introPauseRemaining = 0; this._pauseAt = 0; // gracia/reloj de pausa (FBK-07)
      this.mut = this.weeklyMut(); // mutador semanal (GM-22)
      // El tema semanal se explica antes de entrar, en el lanzador del modo. Durante
      // la partida no ocupa HUD: aquí solo permanece la información accionable.
      const gtop = document.querySelector('.gtop-context');
      if (gtop && !this._buildBound) {
        this._buildBound = true;
        gtop.addEventListener('click', (e) => {
          const expEl = e.target.closest('[data-explain]');
          if (expEl) {
            const key = expEl.getAttribute('data-explain');
            Toasts.show(I18n.t(key), 'info', 2400, '💡');
          }
        });
      }
      this._planBoss();
      this._setFrenzyClass();
      // Progresión de iconos desde la oleada 1: la puntuación base usa State.level (= dlevel).
      State.level = this.dlevel();
      State.pool = Engine.poolForLevel(State.level);
      // Solo entra lo confirmado en el lanzador. Reiniciar o arrancar por una ruta
      // técnica no regala ni vuelve a cobrar consumibles.
      const loadout = this.pendingLoadout && typeof this.pendingLoadout === 'object' ? this.pendingLoadout : {};
      this.pendingLoadout = null;
      this.inv = {}; this.BOOSTERS.forEach((id) => { this.inv[id] = Math.max(0, loadout[id] | 0); });
      this.buildBar(); this.render();
    },
    cleanup() {
      this.disarm();
      Bosses.abort(); // el encuentro no sobrevive al fin de partida (JF-α)
      this._introUntil = 0; this._introPauseRemaining = 0; this._pauseAt = 0;
      this._beatQ = [];
      this.frenzyUntil = 0; this.x2Until = 0; this.freezeUntil = 0; this.lockUntil = 0;
      State.tempMult = 1;
      document.body.classList.remove('aiming', 'surv-frenzy-active', 'surv-frenzy-1', 'surv-frenzy-2', 'surv-frenzy-3');
    },
    // ---- Arranque de partida (FBK-07): objetivo breve en el centro de eventos + gracia --
    // El tablero queda completamente libre. La cola enseña una sola idea cada vez y
    // la ventana de gracia conserva el tiempo de lectura sin crear una capa modal.
    INTRO_MS: 3200,
    _introUntil: 0, _introPauseRemaining: 0, _pauseAt: 0,
    _introActive() { return performance.now() < (this._introUntil || 0); },
    pauseIntro() {
      this._introPauseRemaining = this._introActive() ? Math.max(1, this._introUntil - performance.now()) : 0;
    },
    resumeIntro() {
      if (this._introPauseRemaining > 0) this._introUntil = performance.now() + this._introPauseRemaining;
      this._introPauseRemaining = 0;
    },
    pauseClock() {
      if (this._pauseAt) return;
      this._pauseAt = performance.now();
      this.pauseIntro();
    },
    resumeClock() {
      const pausedAt = this._pauseAt;
      if (!pausedAt) { this.resumeIntro(); return; }
      const delta = Math.max(0, performance.now() - pausedAt);
      const shift = (obj, key) => { if (obj[key] > pausedAt) obj[key] += delta; };
      ['freezeUntil', 'x2Until', 'frenzyUntil', 'lockUntil', '_bossSurvivedAt', '_boonAt'].forEach((key) => shift(this, key));
      ['spawnHoldUntil', 'comboUntil', 'warmupUntil'].forEach((key) => shift(State, key));
      (this._beatQ || []).forEach((beat) => { if (beat.at > pausedAt) beat.at += delta; });
      if (Bosses.face && Bosses.face.resolveUntil > pausedAt) Bosses.face.resolveUntil += delta;
      if (Bosses.enc && Bosses.enc.phaseContextUntil > pausedAt) Bosses.enc.phaseContextUntil += delta;
      this._pauseAt = 0;
      this.resumeIntro();
    },
    intro() {
      const reduced = Settings.reducedFx;
      const introMs = reduced ? 1600 : this.INTRO_MS;
      this._introUntil = performance.now() + introMs;
      Toasts.event({
        key: 'survival-intro', kicker: I18n.t('hud_survival_title'),
        title: I18n.t('surv_intro_goal'), detail: I18n.t('surv_intro_merge'),
        icon: 'target', kind: 'info', priority: 84, ms: reduced ? 900 : 1900, expiresAt: false,
      });
      // Se encola ya (sin timer paralelo): Pausa congela ambos beats y mantiene la
      // coreografía sincronizada con la gracia de spawn.
      Toasts.event({
        key: 'survival-go', kicker: I18n.t('hud_survival_ready'),
        title: I18n.t('hud_survival_go'), icon: 'fire', kind: 'good',
        priority: 83, ms: reduced ? 650 : 1050,
        expiresAt: false,
        onStart: () => { Sound.waveUp(); Haptics.combo(); },
      });
    },
    // Telegrafiado del jefe (GM-18): si la PRÓXIMA oleada trae evento jefe, se decide
    // ya el tipo (pre-roll) para poder avisar de forma específica antes de que llegue.
    // La anticipación es la mitad del valor emocional del jefe; sin aviso solo hay susto.
    bossNext: false, _nextBoss: null, _lastBossType: null, _bossOverride: null,
    ENRAGE_WAVE: 24, // desde aquí los jefes salen "enfurecidos" (+1 intensidad, SV-43)
    // Registro declarativo de jefes (SV-40): metadata (aviso/icono/disponibilidad) +
    // el método que ejecuta el evento. Añadir un jefe nuevo = 1 entrada aquí + su
    // método + 2 claves i18n. `base` entra siempre; `chaosOnly` solo en semana del
    // caos; `echo` solo si ya hubo un jefe previo que repetir.
    BOSS_DEFS: {
      meteor: { warn: 'surv_boss_meteor_warn', icon: 'v2:meteor', base: true, fn: 'meteorRain' },
      tide: { warn: 'surv_boss_tide_warn', icon: '🌊', base: true, fn: 'tideSurge' },
      frost: { warn: 'surv_boss_frost_warn', icon: 'v2:snowflake', base: true, fn: 'frostSurge' },
      lockdown: { warn: 'surv_boss_lockdown_warn', icon: '🔒', base: true, fn: 'lockdown' },
      eco: { warn: 'surv_boss_eco_warn', icon: '🔁', echo: true, fn: 'echoBoss' },
      quake: { warn: 'surv_boss_quake_warn', icon: 'teleporter', chaosOnly: true, fn: 'quake' },
      // Acto III (JF-ε): `base:false` — NUNCA entran al pool del jefe-evento clásico
      // (flag apagado); existen aquí para el aviso específico de 3s (GM-18), el
      // override de sim/tests y el fallback sin sustrato (fn = efecto legacy afín).
      crystalid: { warn: 'surv_boss_crystalid_warn', icon: '💠', base: false, fn: 'frostSurge' },
      void: { warn: 'surv_boss_void_warn', icon: '🕳️', base: false, fn: 'lockdown' },
      puppeteer: { warn: 'surv_boss_puppeteer_warn', icon: '🎭', base: false, fn: 'quake' },
    },
    _bossPool() {
      const chaos = this.weeklyMut().id === 'chaos' || this.mut.id === 'chaos';
      return Object.keys(this.BOSS_DEFS).filter((id) => {
        const d = this.BOSS_DEFS[id];
        if (d.chaosOnly) return chaos;
        if (d.echo) return this._lastBossType != null; // eco necesita un jefe que repetir
        return d.base;
      });
    },
    _planBoss() {
      this.bossNext = (this.wave + 1) % this.tune().bossEvery === 0;
      if (!this.bossNext) { this._nextBoss = null; return; }
      // Override para sim/tests (espejo de _mutOverride): fuerza el tipo de jefe.
      if (this._bossOverride && this.BOSS_DEFS[this._bossOverride]) { this._nextBoss = this._bossOverride; return; }
      // Encuentros (JF-α): identidad sorteada por actos (pools por tramo de oleada,
      // sin repetición inmediata, eco como regla) — el CUÁNDO no cambia (§3.6).
      if (Bosses.ENCOUNTERS) { this._nextBoss = Bosses.pick(this.wave + 1); return; }
      const pool = this._bossPool();
      this._nextBoss = pool[rand(pool.length)];
    },
    // Mutador semanal (GM-22): hashStr(semana ISO) elige un tema determinista sin
    // servidor — cada semana el modo tiene una razón nueva de visita.
    WEEKLY_MUTS: [
      { id: 'none' },
      { id: 'ice', coinMult: 1.15 },   // trampas siempre heladas · monedas ×1.15
      { id: 'chaos' },                 // el terremoto vuelve al pool de jefes
      { id: 'frenzy', frenzyDur: 1.3 },// frenesí +30% de duración
    ],
    _mutOverride: null,                // el simulador fija 'none' (reproducibilidad)
    _weekKey() { const d = new Date(); const day = (d.getDay() + 6) % 7; return new Date(d - day * 86400000).toISOString().slice(0, 10); },
    weeklyMut() {
      if (this._mutOverride) return this.WEEKLY_MUTS.find((x) => x.id === this._mutOverride) || this.WEEKLY_MUTS[0];
      return this.WEEKLY_MUTS[hash32('survmut:' + this._weekKey()) % this.WEEKLY_MUTS.length];
    },
    // Bendiciones post-jefe (GM-17): sobrevivir a un evento jefe abre una elección
    // de 1 entre 3 mejoras. El jefe pasa de molestia aleatoria a ciclo miedo→codicia,
    // y la run gana dirección de build (la decisión estratégica que faltaba al modo).
    BOONS: [
      { id: 'life', icon: '❤️', rarity: 'common', weight: 45 },
      { id: 'charge', icon: '⚡', rarity: 'common', weight: 45 },
      { id: 'slow', icon: '🐌', rarity: 'common', weight: 45 },
      { id: 'pack', icon: '💣', rarity: 'uncommon', weight: 35 },
      { id: 'frenzy', icon: '🔥', rarity: 'uncommon', weight: 35 },
      { id: 'magnet', icon: '🧲', rarity: 'rare', weight: 15 },
      { id: 'score_boost', icon: '📈', rarity: 'rare', weight: 15 },
      { id: 'golden_wave', icon: '👑', rarity: 'epic', weight: 4 },
    ],
    SCORE_BOOST_CAP: 0.5,
    slowWaves: 0, _boonAt: 0, mut: { id: 'none' },
    scoreBoost: 0, magnetMoves: 0, goldenWaveWaves: 0,
    _scheduleBeat(channel, delayMs, fn) {
      if (typeof channel !== 'string') { fn = delayMs; delayMs = channel; channel = 'misc'; }
      if (typeof fn !== 'function') return 0;
      const beat = { id: ++this._beatSeq, channel, at: performance.now() + Math.max(0, delayMs || 0), fn };
      this._beatQ.push(beat);
      this._beatQ.sort((a, b) => a.at - b.at || a.id - b.id);
      return beat.id;
    },
    _clearBeats(channel) {
      if (!channel) { this._beatQ = []; return; }
      this._beatQ = (this._beatQ || []).filter((b) => b.channel !== channel);
    },
    _pumpBeats(now = performance.now()) {
      const q = this._beatQ || [];
      if (!q.length) return;
      const due = [], pending = [];
      q.forEach((b) => (b.at <= now ? due : pending).push(b));
      this._beatQ = pending;
      due.sort((a, b) => a.at - b.at || a.id - b.id).forEach((b) => {
        if (State.status !== 'playing') return;
        try { b.fn(); } catch (err) { console.error('survival beat failed', b.channel, err); }
      });
    },
    spawnFactor() { return this.slowWaves > 0 ? 1.25 : 1; },
    offerBoons() {
      // Se excluyen las bendiciones sin efecto posible (vida al tope, impulso al tope):
      // ofrecer una elección muerta es peor que repetir el pool.
      const pool = this.BOONS.filter((b) =>
        (b.id !== 'life' || this.lives < this.MAX_LIVES + 1) &&
        (b.id !== 'score_boost' || (this.scoreBoost || 0) < this.SCORE_BOOST_CAP));
      const opts = []; const bag = pool.slice();
      while (opts.length < 3 && bag.length) {
        let totalWeight = bag.reduce((sum, b) => sum + b.weight, 0);
        // RNG seedeado, no Math.random: la premisa del simulador (mismo seed ⇒
        // misma partida) cubre también qué bendiciones se ofrecen.
        let r = RNG.random() * totalWeight;
        let selectedIdx = 0;
        for (let i = 0; i < bag.length; i++) {
          r -= bag[i].weight;
          if (r <= 0) { selectedIdx = i; break; }
        }
        opts.push(bag.splice(selectedIdx, 1)[0]);
      }
      if (!opts.length) return;
      const doOpenPicker = () => {
        Sound.milestone(); Haptics.milestone();
        Picker.open({
          title: I18n.t('boon_title'), sub: I18n.t('boon_sub'), accent: '#ffd24d',
          options: opts.map((b) => ({ id: b.id, icon: b.icon, name: I18n.t('boon_' + b.id), desc: I18n.t('boon_' + b.id + '_d'), rarity: b.rarity })),
          onPick: (id) => this.applyBoon(id),
          safeDelayMs: 500
        });
      };
      if (BossCoach.check('boss_boons', '✨', doOpenPicker)) {
        // La 1ª vez se abre el tutorial de bendiciones; al pulsar ¡Entendido! se ejecutará doOpenPicker
      } else {
        doOpenPicker();
      }
    },
    applyBoon(id) {
      if (id === 'life') this.lives = Math.min(this.MAX_LIVES + 1, this.lives + 1);
      else if (id === 'charge') this.addSupplyCharge(50);
      else if (id === 'pack') { this.inv.bomb = (this.inv.bomb || 0) + 1; this.inv.clearLine = (this.inv.clearLine || 0) + 1; this.buildBar(); }
      else if (id === 'slow') this.slowWaves = 3;
      else if (id === 'frenzy') this.activateFrenzy();
      else if (id === 'magnet') this.magnetMoves = 5;
      else if (id === 'score_boost') this.scoreBoost = Math.min(this.SCORE_BOOST_CAP, (this.scoreBoost || 0) + 0.25);
      else if (id === 'golden_wave') this.goldenWaveWaves = 2;
      // Registro de la run (SV-22): la cadena de bendiciones elegidas se muestra en
      // el resumen como "hoja de la run" del Superviviente.
      const bd = this.BOONS.find((b) => b.id === id);
      (this._boonLog || (this._boonLog = [])).push({ id, icon: bd ? bd.icon : '✨' });
      // Hazaña 'coleccionista' (SV-31): haber elegido las 8 bendiciones alguna vez.
      if (Meta.survSeeBoon(id) >= this.BOONS.length) this._feat('coleccionista');
      Toasts.event(I18n.t('boon_' + id), 'good', 1800, '✨');
      Sound.record(); Haptics.milestone();
      Render.multChip(); // impulso/oleada dorada entran en el multiplicador visible
      this.render();
    },
    // Multiplicador propio del modo por bendiciones (impulso + oleada dorada).
    // Centralizado: puntos, chip GM-16 y popup DEBEN compartirlo — si divergen,
    // el multiplicador visible miente (regresión N1 del plan de Supervivencia).
    scoreMult() { return (1 + (this.scoreBoost || 0)) * (this.goldenWaveWaves > 0 ? 2 : 1); },
    frenzyTier() { return clamp(Math.floor((this.wave - 1) / 4) + 1, 1, 3); },
    frenzyActive() { return performance.now() < this.frenzyUntil; },
    frenzyMult() { return this.frenzyActive() ? 1.55 + this.frenzyTier() * 0.1 : 1; },
    _syncMult() { State.tempMult = (this.x2Active() ? 2 : 1) * this.frenzyMult(); Render.multChip(); },
    _syncIntensity() {
      if (!Settings.music) return;
      const base = 0.12 + Math.min(0.55, (this.wave - 1) * 0.045);
      Music.setIntensity(clamp(base + (this.frenzyActive() ? 0.35 : 0), 0, 1));
    },
    _setFrenzyClass() {
      const inSurv = State.mode === 'supervivencia' && State.status === 'playing';
      const active = inSurv && this.frenzyActive();
      document.body.classList.toggle('surv-frenzy-active', active);
      for (let i = 1; i <= 3; i++) document.body.classList.toggle('surv-frenzy-' + i, inSurv && this.frenzyTier() === i);
      Render.fever(!!(State.fever || active));
    },
    addFrenzy(n) {
      if (this.frenzyActive()) return;
      this.frenzy = Math.min(100, this.frenzy + Math.max(0, n || 0));
      if (this.frenzy >= 100) this.activateFrenzy();
    },
    activateFrenzy() {
      this.frenzy = 0;
      this.frenzyUntil = performance.now() + (7200 + this.frenzyTier() * 900) * (this.mut.frenzyDur || 1);
      this._syncMult(); this._setFrenzyClass(); this._syncIntensity();
      // B2a: captura las celdas nuevas y sincroniza SOLO esas (antes syncAll de las 64).
      const spawned = [];
      for (let k = 0; k < 2 + this.frenzyTier(); k++) { const i = Engine.spawnOne(); if (i >= 0) spawned.push(i); }
      Render.syncCells(spawned); Render.fever(true); Render.flash();
      this._deferFx(() => FX.confetti(36)); // B2b: el enjambre, fuera del frame de mutación
      // Primera FURIA MÁXIMA (tier 3) de la run: callout propio, una sola vez (SV-21).
      if (this.frenzyTier() === 3 && !this._frenzyT3Seen) {
        this._frenzyT3Seen = true;
        Toasts.event({ key: 'frenzy-max', kicker: I18n.t('hud_narr_fever_title'), title: I18n.t('surv_frenzy_max'), icon: 'fire', kind: 'warn', priority: 76, ms: 2000 });
      } else {
        Toasts.event({ key: 'frenzy-ready', title: I18n.t('surv_frenzy_ready'), icon: 'fire', kind: 'warn', priority: 72, ms: 1800 });
      }
      // Hazaña 'frenetico' (SV-31): 3 frenesíes tier 3 en una run.
      if (this.frenzyTier() === 3) { this._t3Count = (this._t3Count || 0) + 1; if (this._t3Count === 3) this._feat('frenetico'); }
      Sound.fever(); Haptics.fever(); this.render();
    },
    _waveReward(clearedWave) {
      if (clearedWave <= 0) return;
      if (this.goldenWaveWaves > 0) { this.goldenWaveWaves--; if (!this.goldenWaveWaves) Render.multChip(); }
      let coins = Math.round((4 + clearedWave * 1.45) * this.tune().coinMult * (this.mut.coinMult || 1));
      if (clearedWave >= 15) coins += Math.round(Math.pow(clearedWave - 14, 1.5) * 2); // Kicker
      coins = Math.max(3, coins);
      Meta.addCoins(coins); State.coinsRun += coins; this.runCoins += coins; Econ.refresh();
      // Las monedas son feedback inmediato del marcador, nunca otro evento en cola.
      Render.coinsReward(coins, I18n.t('coins'));
      if (clearedWave % 5 === 0) {
        let txt, ic;
        if (clearedWave % 10 === 0) {
          const ladder = ['wood', 'bronze', 'silver', 'gold', 'magic', 'royal', 'supreme', 'champion', 'divine'];
          Meta.addChest(1, ladder[Math.min(ladder.length - 1, Math.max(0, clearedWave / 10 - 1))], 'survival');
          this.runChests++; txt = '+1 ' + I18n.t('tab_chests'); ic = 'chest';
        }
        else { const gems = 2 + Math.floor(clearedWave / 5); Meta.addGems(gems); this.runGems += gems; txt = '+' + gems + ' 💎'; ic = 'gem'; }
        Toasts.event({
          key: 'survival-milestone-' + clearedWave,
          kicker: I18n.t('surv_milestone').replace('{w}', clearedWave),
          title: txt, icon: ic, kind: 'good', priority: 58, ms: 2200,
          expiresAt: Date.now() + 7000,
        });
        Render.flash(); FX.confetti(70); Sound.record(); Haptics.record(); Econ.refresh();
      }
    },
    _checkWaveRecord() {
      if (this.wave <= 1) return;
      if (Meta.survWaveRecord(this.wave)) {
        this.newWaveRecord = true;
        this._liveRecord = true; // el récord batido se saborea el resto de la run (SV-21)
        Toasts.event(I18n.t('surv_wave_record').replace('{w}', this.wave), 'good', 2200, 'trophy');
        Render.flash(); FX.confetti(80); Sound.record(); Haptics.record();
      }
    },
    // Suministro económico: la habilidad durante la run financia decisiones futuras
    // en lugar de sortear una ventaja. Se mantiene el ritmo de CHARGE_PER y solo
    // cambia el premio, cerrando el bucle jugar → ganar → preparar → jugar.
    addSupplyCharge(amount) {
      this.charge += Math.max(0, Number(amount) || 0);
      let paid = 0;
      while (this.charge >= 100) { this.charge -= 100; paid += this.redeemSupply(); }
      return paid;
    },
    redeemSupply() {
      const raw = Math.min(this.SUPPLY_COIN_CAP, this.SUPPLY_COIN_BASE + Math.max(0, (this.wave | 0) - 1) * this.SUPPLY_COIN_PER_WAVE);
      const coins = Math.max(1, Math.round(raw * this.tune().coinMult * ((this.mut && this.mut.coinMult) || 1)));
      Meta.addCoins(coins); State.coinsRun = (State.coinsRun || 0) + coins; this.runCoins += coins; Econ.refresh();
      Render.coinsReward(coins, I18n.t('coins'));
      return coins;
    },
    // Convierte iconos huérfanos (del pool anterior) a iconos del pool actual para que
    // el tablero siempre sea 100% vaciable tras un cambio de tanda.
    _reconcileOrphans() {
      const set = new Set(State.pool);
      for (let i = 0; i < State.board.length; i++) {
        const v = State.board[i];
        if (v !== null && !set.has(v)) { State.board[i] = State.pool[rand(State.pool.length)]; Render.syncCell(i); }
      }
    },
    setup() { const tn = this.tune(); if (this.wave >= 3) this._traps(Math.min(tn.trapCap, tn.trapBase * (this.wave - 2))); this._placeBombs(1); },
    frozen() { return performance.now() < this.freezeUntil; },
    locked() { return performance.now() < this.lockUntil; },
    blockSpawn() { return this.frozen() || this.locked() || this._introActive(); },
    // Grupo B · B1 (docs/RENDER_STABILITY_PLAN.md RS-13): señal PREDICTIVA para el gobernador.
    // El gobernador reactivo (EMA sostenido 2s) llega tarde a las ráfagas de Supervivencia — un
    // evento de jefe dura ~1-2s, se acaba antes de que reaccione. Aquí devolvemos un "suelo" de
    // nivel a partir de lo que YA sabemos: ocupación del tablero + evento de estrés en curso. Así
    // la degradación por capas (cortar ambientales/pulsos + acotar FX.cap) ocurre DURANTE la
    // ráfaga. Con el tablero holgado devuelve 0: los eventos son baratos y no se degrada nada.
    perfStress() {
      if (State.status !== 'playing') return 0;
      const cap = State.size * State.size;
      const occ = cap ? State.iconCount / cap : 0;
      if (occ < 0.6) return 0;                       // tablero holgado: sin presión de capas
      const boss = Bosses.enc && Bosses.enc.kind === 'boss' && !Bosses.enc.resolved;
      const eventActive = this.frenzyActive() || this.locked() || boss;
      if (!eventActive) return occ >= 0.9 ? 1 : 0;   // casi lleno ya presiona por sí solo
      return occ >= 0.82 ? 2 : 1;                    // lleno + evento = la ráfaga que lagea el tap
    },
    // Grupo B · B2 (RS-13): saca el trabajo DECORATIVO (enjambre de partículas) del frame que
    // muta el estado del juego, al frame siguiente. 16ms invisibles, pero el frame del evento
    // —y un posible tap del jugador en él— deja de cargar con el coste de crear decenas de
    // animaciones WAAPI de golpe. Si no hay rAF (tests/Node) se ejecuta en el acto.
    _deferFx(fn) {
      if (typeof requestAnimationFrame !== 'function') { fn(); return; }
      requestAnimationFrame(() => { if (State.status === 'playing') fn(); });
    },
    _lock(ms, cls) {
      this.lockUntil = Math.max(this.lockUntil || 0, performance.now() + ms);
      if (cls) Render.boardEvent(cls, ms);
    },
    x2Active() { return performance.now() < this.x2Until; },
    _emptyIdx() { const a = []; for (let i = 0; i < State.board.length; i++) if (State.board[i] === null && !State.tiles[i]) a.push(i); return a; },
    _filledIdx() { const a = []; for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null && !State.tiles[i]) a.push(i); return a; },
    _specialCap() { return this.SPECIAL_CAP[State.diff] || this.SPECIAL_CAP.normal; },
    _blockCap() { return this.BLOCK_CAP[State.diff] || this.BLOCK_CAP.normal; },
    _bombCap() { return this.BOMB_CAP[State.diff] || this.BOMB_CAP.normal; },
    _blockHits() {
      const start = State.diff === 'dificil' ? 5 : State.diff === 'normal' ? 7 : 9;
      return this.wave >= start ? 2 : 1;
    },
    _specialIdx() { const a = []; for (let i = 0; i < State.tiles.length; i++) if (State.tiles[i] && State.tiles[i].type !== 'crystal') a.push(i); return a; },
    _specialRoom(reserve = 0) { return Math.max(0, this._specialCap() - this._specialIdx().length - Math.max(0, reserve || 0)); },
    _isBlockTile(t) { return !!(t && (t.type === 'rock' || t.type === 'locked') && t.hits != null); },
    _blockIdx() { const a = []; for (let i = 0; i < State.tiles.length; i++) if (this._isBlockTile(State.tiles[i])) a.push(i); return a; },
    _bombIdx() { const a = []; for (let i = 0; i < State.tiles.length; i++) { const t = State.tiles[i]; if (t && t.trigger === 'bomb') a.push(i); } return a; },
    // Coloca pickups-bomba en casillas vacías (tope para no saturar). Detonan al
    // eliminar un icono adyacente (encadenan) o al tocarlas.
    _placeBombs(n) {
      const room = Math.min(this._bombCap() - this._bombIdx().length, this._specialRoom()); if (room <= 0) return;
      const e = this._emptyIdx(), k = Math.min(n, room, e.length); const placed = [];
      for (let x = 0; x < k; x++) { const idx = e.splice(rand(e.length), 1)[0]; State.tiles[idx] = Tiles.make('bomb'); placed.push(idx); }
      if (placed.length) { Render.syncAll(); placed.forEach((i) => Render.cellPulse(i, 'bomb-cleared', 600)); }
    },
    SLOWDOWN_CAP: 1,
    _slowdownIdx() { return State.tiles.map((t, i) => (t && t.type === 'slowdown' ? i : -1)).filter((i) => i >= 0); },
    _placeSlowdown() {
      if (this._slowdownIdx().length >= this.SLOWDOWN_CAP) return;
      if (this._specialRoom() <= 0) return;
      const e = this._emptyIdx(); if (!e.length) return;
      const idx = e[rand(e.length)];
      State.tiles[idx] = Tiles.make('slowdown');
      Render.syncAll(); Render.cellPulse(idx, 'slowdown-placed', 700);
    },
    _traps(density) {
      const e = this._emptyIdx();
      const bombReserve = this._bombIdx().length < this._bombCap() ? 1 : 0;
      let n = Math.min(e.length, this._specialRoom(bombReserve), Math.max(this.wave >= 3 ? 1 : 0, Math.floor(e.length * density)));
      let blocks = this._blockIdx().length;   // tope de cobertura: el tablero nunca se "brickea"
      for (let k = 0; k < n && e.length; k++) {
        const idx = e.splice(rand(e.length), 1)[0];
        // Los candados son bloqueos rompibles y respetan el tope de cobertura.
        // Semana del hielo (GM-22): todas las trampas son heladas.
        if (this.mut.id !== 'ice' && blocks < this._blockCap() && RNG.random() < 0.55) {
          const t = Tiles.make('locked'); t.hits = this._blockHits(); State.tiles[idx] = t; blocks++;
        } else { State.tiles[idx] = Tiles.make('frozen'); }
      }
      Render.syncAll();
    },
    onTick(dt) {
      if (State.status !== 'playing') return;
      // Ventana de gracia del arranque (FBK-07): el reloj de oleada no avanza ni caen
      // eventos hasta que termina la cuenta atrás; el tablero se ve pero no amenaza.
      if (this._introActive()) { this.render(); return; }
      this.survSec = State.elapsed;
      const wasFrenzy = this._r.frenzyActive;
      if (this.x2Until && !this.x2Active()) { this.x2Until = 0; this._syncMult(); }
      if (this.frenzyUntil && !this.frenzyActive()) { this.frenzyUntil = 0; this._syncMult(); }
      this.waveAcc += dt;
      if (this.waveAcc >= this.WAVE_MS) { this.waveAcc -= this.WAVE_MS; this.newWave(); }
      else if (!this._r.waveWarned && this.waveAcc / this.WAVE_MS >= 0.78) {
        this._r.waveWarned = true;
        Feedback.event('waveSoon');
        Render.boardEvent('surv-wave-soon', 560);
      }
      // Aviso ESPECÍFICO del jefe entrante ~3s antes (GM-18): da tiempo a reaccionar
      // (guardar un freeze, despejar zona) y convierte el susto en tensión anticipada.
      if (this.bossNext && !this._r.bossWarned && this.WAVE_MS - this.waveAcc <= 3000) {
        this._r.bossWarned = true;
        const def = this.BOSS_DEFS[this._nextBoss] || this.BOSS_DEFS.meteor;
        // Aviso enfurecido si la próxima oleada cae en zona de enfurecimiento (SV-43).
        const willEnrage = (this.wave + 1) >= this.ENRAGE_WAVE;
        const warnKey = willEnrage ? 'surv_boss_enraged_warn' : def.warn;
        Feedback.event('bossWarn', { msg: I18n.t(warnKey), icon: def.icon });
        Render.boardEvent('surv-wave-soon', 700);
      }
      // Encuentro de jefe activo (JF-α): telegrafiado de ataque, ataques y expiración
      // van por acumuladores de dt (a prueba de pausas y del reloj virtual del sim).
      Bosses.tick(dt);
      // Beat «¡SUPERADO!» (SV-20): entre el peligro y la bendición.
      if (this._bossSurvivedAt && performance.now() >= this._bossSurvivedAt) { this._bossSurvivedAt = 0; this._bossSurvived(); }
      this._pumpBeats();
      // Bendición post-jefe pendiente (GM-17): se ofrece cuando el evento se asentó.
      if (this._boonAt && performance.now() >= this._boonAt) { this._boonAt = 0; this.offerBoons(); }
      const isFrenzy = this.frenzyActive();
      if (wasFrenzy !== isFrenzy || this._r.intWave !== this.wave) {
        this._r.frenzyActive = isFrenzy; this._r.intWave = this.wave;
        this._setFrenzyClass(); this._syncIntensity();
      }
      this.render();
    },
    newWave() {
      const clearedWave = this.wave;
      // Hazaña 'al_limite' (SV-31): completar oleadas con 1 sola vida. La oleada que
      // se acaba de superar contaba con las vidas actuales.
      if (this.lives === 1) { this._waves1Life = (this._waves1Life || 0) + 1; if (this._waves1Life === 2) this._feat('al_limite'); }
      this._waveReward(clearedWave);
      this.wave++;
      this._livesLostThisWave = 0; // reinicia el contador para 'impecable' de la nueva oleada
      this._r.waveWarned = false;
      this._r.bossWarned = false;
      // Hazañas de progreso (SV-31): llegar a la 10 sin potenciadores / a la 15 sin revivir.
      if (this.wave === 10 && !this._anyBoosterUsed) this._feat('purista');
      if (this.wave === 15 && this.revives === 0) this._feat('economo');
      if (this.slowWaves > 0) this.slowWaves--; // bendición de ralentización (GM-17)
      const tn = this.tune();
      State.spawnRate = Math.max(tn.spawnFloor, Math.round(State.spawnRate * tn.spawnDecay));
      // Progresión de iconos: al subir el nivel efectivo, avanza la ventana del catálogo
      // (entran iconos nuevos/más difíciles, se dejan atrás los iniciales) y crece la variedad.
      const lvl = this.dlevel();
      const isBossWave = this.wave % tn.bossEvery === 0;
      if (lvl !== State.level) {
        State.level = lvl;
        State.pool = Engine.poolForLevel(lvl);
        this._reconcileOrphans();
        // "Nuevos iconos" se retrasa 1.2s (SV-13) para no pisar el toast de oleada/jefe.
        const atWave = this.wave;
        this._scheduleBeat('toast', 1200, () => { if (this.wave === atWave) Toasts.event(I18n.t('surv_new_icons'), 'info', 1500, 'v2:four-pointed-star'); });
      }
      // El toast "Oleada N" se SUPRIME en frontera de jefe (SV-13): la bandera ⚠ y el
      // aviso específico ya lo anuncian; dos avisos a la vez saturan. El sonido/anuncio
      // accesible se mantienen.
      // En frontera de jefe el toast de oleada se suprime (la bandera ⚠ y el aviso ya
      // lo anuncian) y el propio evento del jefe aporta su sonido; fuera de jefe, un
      // solo aviso de oleada con sonido propio (ya no comparte `danger` con los avisos).
      if (!isBossWave) Feedback.event('waveUp', {
        key: 'wave-' + this.wave,
        kicker: I18n.t('hud_event_wave'),
        title: I18n.t('st_wave') + ' ' + this.wave,
        priority: 80,
      });
      this.addFrenzy(8 + this.frenzyTier() * 3);
      this._traps(Math.min(tn.trapCap, tn.trapBase * Math.max(0, this.wave - 2)));
      this._placeBombs(1 + Math.floor(this.wave / 6));
      if (this.wave >= 2 && RNG.random() < 0.25) this._placeSlowdown();
      if (this.wave % tn.bossEvery === 0) this.bossEvent();
      this._planBoss(); // decide ya si la PRÓXIMA oleada trae jefe (telegrafiado GM-18)
      Bosses.maybeMini(); // sorteo de minijefe (JF-δ): sorpresa con pity, tras conocer bossNext
      this._checkWaveRecord();
      this._setFrenzyClass(); this._syncIntensity();
      if (!isBossWave) Render.boardEvent('surv-wave-up', 900);
      this.render();
    },
    bossEvent() {
      // Usa el evento pre-decidido por _planBoss (para que el aviso previo coincida).
      const pool = this._bossPool();
      const ev = this._nextBoss != null ? this._nextBoss : (this._bossOverride || pool[rand(pool.length)] || 'meteor');
      this._nextBoss = null;
      // Sistema de encuentros (JF-α, docs/BOSS_SYSTEM_MASTER_PLAN.md §3): con el flag
      // encendido el jefe deja de ser un evento instantáneo y pasa a ser una criatura
      // con anclas/PV/fases que vive ~2 oleadas. El beat de cierre y la bendición se
      // programan al RESOLVERSE el encuentro (_encounterEnd), no aquí.
      if (Bosses.ENCOUNTERS) { Bosses.startEncounter(ev); return; }
      const enraged = this.wave >= this.ENRAGE_WAVE; // jefe enfurecido (SV-43)
      this._runBoss(ev, enraged);
      this._afterBossEvent();
    },
    // Pico del jefe (SV-20): la secuencia es anticipación → PELIGRO → «¡SUPERADO!»
    // (beat propio, +1.2s) → codicia (bendición, +1.7s). El confeti NO va en el
    // peligro (celebraba la amenaza, N6): se mueve al beat de superación. Lo comparten
    // el jefe-evento clásico y el fallback sin sustrato del encuentro (JF-α).
    _afterBossEvent() {
      Haptics.milestone();
      this._bossSurvivedAt = performance.now() + 1200;
      this._noBoosterSinceBoss = true; // se anula si el jugador gasta un booster
      this._boonAt = performance.now() + 1700;
    },
    // Cierre de un ENCUENTRO (JF-α): mismo ritual pico→bendición que el evento
    // clásico. La derrota reemplaza el beat «¡SUPERADO!» por «¡DERROTADO!» (JF-β);
    // el botín de derrota y la Ronda maestra llegan en JF-γ (puerta B-J1).
    _encounterEnd(e, outcome) {
      this._lastBossType = e.id;
      if (outcome === 'defeat') {
        this._bossesDefeated = (this._bossesDefeated || 0) + 1;
        this._lastDefeat = { id: e.id, lvl: e.lvl, flawless: !!e.flawless, eco: !!e.eco };
        this._defeatBeat = e;
      } else { this._defeatBeat = null; }
      Haptics.milestone();
      const now = performance.now();
      this._bossSurvivedAt = now + (outcome === 'defeat' ? 1300 : 1200);
      this._boonAt = now + (outcome === 'defeat' ? 3600 : 3000);
    },
    // Beat «¡SUPERADO!» (SV-20): el clímax "he sobrevivido al jefe" — el mejor
    // momento del modo por fin tiene su propia fanfarria. Solo si sigues vivo (el
    // jefe pudo desbordar el tablero y matarte). Gancho de audio para QP-4: aquí va
    // la fanfarria corta de victoria de jefe.
    _bossSurvived() {
      if (State.status !== 'playing' || this.lives <= 0) return;
      this._bossesSurvived = (this._bossesSurvived || 0) + 1;
      // Hazaña 'impecable' (SV-31): superar el jefe sin perder vida en esa oleada.
      if (!this._livesLostThisWave) this._feat('impecable');
      // Beat «¡DERROTADO!» (JF-β): si el encuentro cayó por anclas, el clímax es la
      // kill (nombre propio + confeti mayor). Gancho de audio QP-4: fanfarria de
      // derrota de jefe. El botín y la Ronda maestra llegan en JF-γ.
      const d = this._defeatBeat; this._defeatBeat = null;
      if (d) {
        const msg = I18n.t('surv_boss_defeated').replace('{b}', Bosses.name(d.id));
        Toasts.event({
          key: 'boss-defeated-' + d.id, kicker: I18n.t('hud_event_boss'),
          title: msg, icon: 'trophy', kind: 'good', priority: 96, ms: 2200,
        });
        Render.flash(); this._deferFx(() => FX.confetti(d.flawless ? 74 : 60)); // B2b
        Sound.bossDefeat(); Haptics.record();
        // Botín del jefe (JF-γ, gated B-J1): monedas por nivel del encuentro.
        const coins = 8 + 4 * (d.lvl || 1);
        Meta.addCoins(coins); State.coinsRun += coins; this.runCoins += coins; Econ.refresh();
        const rewardSource = d.rewardSource || Render.bossRewardSourcePoint();
        this._scheduleBeat('bossReward', 620, () => {
          Render.coinsReward(coins, I18n.t('coins'), rewardSource);
          Render.boardEvent('boss-reward', 760);
          Sound.bossReward(); Haptics.reward();
        });
        // Ronda maestra (§3.8, homenaje a Gungeon): derrota sin perder vida ni gastar
        // potenciador durante el ENCUENTRO → +1 vida (o +50 carga si está al tope).
        if (d.flawless) {
          let masterMsg, masterIcon;
          if (this.lives < this.MAX_LIVES + 1) {
            this.lives++;
            masterMsg = I18n.t('surv_master_round'); masterIcon = '🛡️';
          } else {
            this.addSupplyCharge(50);
            masterMsg = I18n.t('surv_master_round_charge'); masterIcon = '⚡';
          }
          this._scheduleBeat('bossReward', 1120, () => Toasts.event(masterMsg, 'good', 2200, masterIcon));
        }
        // Bestiario y hazañas de caza (JF-ε).
        Meta.survBossKill(d.id, d.lvl, d.flawless);
        const dex = Meta.survBossDex();
        if (['meteor', 'tide', 'frost', 'lockdown', 'quake'].every((k) => (dex[k] || {}).kills > 0)) this._feat('cazador');
        if (Meta.survMasterRounds() >= 3) this._feat('ronda_maestra');
        if (d.eco && d.lvl >= 3) this._feat('domaecos');
        this.render();
        return;
      }
      const clean = !!this._noBoosterSinceBoss;
      Toasts.event({
        key: 'boss-cleared', kicker: I18n.t('hud_event_boss'),
        title: I18n.t(clean ? 'surv_boss_cleared_clean' : 'surv_boss_cleared'),
        icon: 'trophy', kind: 'good', priority: 92, ms: 1900,
      });
      Render.flash(); this._deferFx(() => FX.confetti(clean ? 54 : 40)); // B2b
      Sound.record(); Haptics.record();
    },
    // Dispatcher declarativo (SV-40): ejecuta el jefe `id` con su intensidad. El eco
    // repite el último jefe real; los demás quedan registrados como "último".
    _runBoss(id, enraged) {
      const def = this.BOSS_DEFS[id] || this.BOSS_DEFS.meteor;
      if (id === 'eco') { this.echoBoss(enraged); return; }
      this._lastBossType = id;
      this[def.fn](enraged);
    },
    // Marea (GM-20): marca las 2 filas exteriores y 1.2s después las llena de
    // iconos. Amenaza legible con counterplay: despeja esas zonas antes. Enfurecida
    // (SV-43): además las 2 columnas exteriores → marco completo.
    tideSurge(enraged) {
      this._lock(900, 'surv-tide');
      const size = State.size, set = new Set();
      [0, size - 1].forEach((r) => { for (let c = 0; c < size; c++) set.add(r * size + c); });
      if (enraged) [0, size - 1].forEach((c) => { for (let r = 0; r < size; r++) set.add(r * size + c); });
      const cells = [...set];
      cells.forEach((j) => Render.cellPulse(j, 'tide-warn', 1200));
      Feedback.event('tide', { enraged });
      setTimeout(() => {
        if (State.status !== 'playing') return;
        let filled = 0;
        cells.forEach((j) => {
          if (State.board[j] === null && !State.tiles[j]) {
            State.board[j] = State.pool[rand(State.pool.length)];
            State.iconCount++; filled++;
            Render.syncCell(j); Render.cellPulse(j, 'tide-fill', 600);
          }
        });
        if (filled) { Render.hudSoon(); if (State.status === 'playing') Game.evaluate(); }
      }, 1200);
    },
    meteorRain(enraged) {
      this._lock(900, 'surv-meteor-board');
      const placed = [], n = enraged ? 10 : 8;
      for (let k = 0; k < n; k++) { const idx = Engine.spawnOne(); if (idx >= 0) placed.push(idx); }
      Render.syncCells(placed); Render.meteor(placed); // A3: solo las celdas nuevas
      Feedback.event('meteor', { enraged });
    },
    quake() {
      this._lock(1150, 'surv-quake');
      Feedback.event('quake');
      setTimeout(() => {
        if (State.status !== 'playing') return;
        this._shuffle(true);
        Render.boardEvent('surv-quake-settle', 420);
      }, 620);
    },
    frostSurge(enraged) {
      this._lock(760, 'surv-frost');
      const f = this._filledIdx(), placed = [];
      const n = Math.min(3 + Math.floor(this.wave / 4) + (enraged ? 2 : 0), f.length, this._specialRoom());
      for (let k = 0; k < n && f.length; k++) {
        const idx = f.splice(rand(f.length), 1)[0];
        if (!State.tiles[idx]) { State.tiles[idx] = Tiles.make('frozen'); placed.push(idx); }
      }
      Render.syncCells(placed); placed.forEach(i => Render.iceHit(i)); // A3: solo las celdas heladas
      Feedback.event('frost', { enraged });
    },
    // Cierre (SV-43): siembra candados de 1 golpe sobre huecos — amenaza de bloqueo
    // con counterplay barato (rompen con UNA convergencia adyacente). Respeta el tope
    // de bloqueos para no brickear el tablero.
    lockdown(enraged) {
      this._lock(760, 'surv-lockdown');
      const e = this._emptyIdx();
      const room = Math.min(this._specialRoom(), Math.max(0, this._blockCap() - this._blockIdx().length));
      const n = Math.min(enraged ? 4 : 3, e.length, room);
      const placed = [];
      for (let k = 0; k < n && e.length; k++) {
        const idx = e.splice(rand(e.length), 1)[0];
        const t = Tiles.make('locked'); t.hits = 1; State.tiles[idx] = t; placed.push(idx);
      }
      Render.syncCells(placed); placed.forEach(i => Render.cellPulse(i, 'lock-stamp', 520)); // A3: solo los candados
      Feedback.event('lockdown');
    },
    // Eco (SV-43): "ha vuelto a por ti" — repite el último jefe real con intensidad +1
    // (enfurecido forzado). Si no hay jefe previo, cae en meteoro.
    echoBoss() {
      const prev = (this._lastBossType && this.BOSS_DEFS[this._lastBossType] && !this.BOSS_DEFS[this._lastBossType].echo) ? this._lastBossType : 'meteor';
      Feedback.event('echo', { msg: I18n.t('surv_eco').replace('{b}', I18n.t('bossname_' + prev)) });
      this._runBoss(prev, true);
    },
    _shuffle(animate) {
      const idx = [];
      for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null && !State.tiles[i]) idx.push(i);
      const n = idx.length; if (!n) return;
      const oldVals = idx.map((p) => State.board[p]);
      const perm = idx.map((_, k) => k);
      for (let i = n - 1; i > 0; i--) { const j = rand(i + 1); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
      const srcOf = {};   // celda-destino → celda-origen (para el deslizamiento FLIP)
      idx.forEach((dest, k) => { State.board[dest] = oldVals[perm[k]]; srcOf[dest] = idx[perm[k]]; });
      Render.syncAll();
      if (animate && !motionOff()) Render.quakeSlide(srcOf);
    },
    onConverge(ctx) {
      const combo = ctx ? ctx.combo : 0;
      this.addSupplyCharge(this.CHARGE_PER + Math.min(combo || 0, 6));
      const removed = ctx ? (ctx.removed || 0) : 0;
      this.addFrenzy(4 + Math.min(22, removed * 2 + Math.min(combo || 0, 10)));
      if (this.frenzyActive()) this.addSupplyCharge(4);
      // Romper bloqueos ortogonalmente adyacentes a la acción: la casilla
      // central tocada + cada icono eliminado. Da agencia y evita el bloqueo permanente.
      if (ctx) {
        const seen = new Set(), seenBoss = new Set();
        const mark = (idx) => {
          const r = idx / 8 | 0, c = idx % 8;
          const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
          for (const [rr, cc] of nb) {
            if (rr < 0 || cc < 0 || rr > 7 || cc > 7) continue;
            const j = rr * 8 + cc, t = State.tiles[j];
            if (this._isBlockTile(t) && !seen.has(j)) seen.add(j);
            // Blindaje de ancla y jaulas (JF-02): también se agrietan por adyacencia.
            else if (t && ((t.type === 'boss' && (t.hits || 0) > 0) || t.type === 'cage') && !seenBoss.has(j)) seenBoss.add(j);
          }
        };
        if (ctx.center != null) mark(ctx.center);
        if (ctx.cells) ctx.cells.forEach(mark);
        seen.forEach((j) => this._crackBlock(j));
        seenBoss.forEach((j) => Bosses.crackAt(j));
      }
      this.render();
    },
    _crackBlock(j) {
      const t = State.tiles[j]; if (!this._isBlockTile(t)) return;
      t.hits = (t.hits || 1) - 1;
      if (t.hits > 0) { Render.setTile(j); Sound.tap(); return; }
      // Rota: desaparece (libera la casilla) con estallido.
      FX.burst(j, '#c2cbe0', 5);
      Render.cells[j].classList.remove('rock-cracked', 'lock-cracked');
      State.tiles[j] = null; Render.syncCell(j);
      Sound.eliminate(1); Haptics.tap();
    },
    onOverflow() {
      this.lives--;
      this._livesLostThisWave = (this._livesLostThisWave || 0) + 1; // hazaña 'impecable' (SV-31)
      if (Bosses.enc) Bosses.enc.flawless = false; // Ronda maestra (JF-γ): perder vida rompe el flawless
      if (this.lives <= 0) { this.lastChance(); return; }
      Feedback.event('lifeLost', { announce: false });
      announce(I18n.t('sr_life').replace('{n}', this.lives));
      // Marco ROJO de daño (FBK-10), no el destello dorado de la revivida: perder una
      // vida debe leerse como daño. El alivio (limpieza) sigue ocurriendo debajo.
      this._lock(880, 'surv-damage');
      Render.livesHit();
      this._relief(0.4, null); this.render();   // sin marco dorado: el marco rojo de daño ya está puesto (FBK-10)
      if (State.status === 'playing') Game.evaluate();
    },
    _relief(frac, frame) {
      const f = [];
      for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null) f.push(i);
      let n = Math.floor(f.length * frac);
      const cleared = [];
      for (let k = 0; k < n && f.length; k++) {
        const idx = f.splice(rand(f.length), 1)[0];
        this._powerClear(idx, cleared, 4);
      }
      // El alivio también ROMPE bloqueos: quita ~la mitad para dar respiro real.
      const blocks = this._blockIdx(); let rn = Math.ceil(blocks.length * 0.5);
      for (let k = 0; k < rn && blocks.length; k++) {
        const idx = blocks.splice(rand(blocks.length), 1)[0];
        this._powerClear(idx, cleared, 4);
      }
      Render.syncAll();
      Render.lifeClear(cleared, frame === undefined ? 'life-blast' : frame);
      if (cleared.length) State.lastActionCell = cleared[0];
    },
    // GM-19: el precio de revivir CRECE con cada uso en la misma run (120→240→480,
    // máx. 3). Plano a 120 trivializaba la muerte en runs largas (a oleada 20+ se
    // recupera en ~4 oleadas); la escalada restaura el peso emocional de morir sin
    // castigar la primera muerte del jugador nuevo.
    REVIVE_BASE: 120, REVIVE_CAP: 480, REVIVE_MAX: 3,
    revives: 0,
    reviveCost() { return Math.min(this.REVIVE_CAP, this.REVIVE_BASE * Math.pow(2, this.revives)); },
    lastChance() {
      if (this.revives >= this.REVIVE_MAX) { this.giveUp(); return; }
      // Fade suave de música (SV-14): el corte seco (Music.stop(true)) se leía como
      // fallo técnico; el desvanecido da dramatismo. Sin cuenta atrás (regla ética).
      this.pauseClock(); State.status = 'paused'; Toasts.pause(); Loop.stop(); Music.stop();
      const cost = this.reviveCost(); const cc = $('#revive-cost'); if (cc) cc.textContent = cost;
      const short = Math.max(0, cost - Meta.coins());
      const rb = $('#btn-revive'); if (rb) rb.disabled = short > 0;
      // "Te faltan {n} monedas": el botón deshabilitado por fin dice por qué.
      const se = $('#revive-short');
      if (se) { se.hidden = short <= 0; if (short > 0) se.textContent = I18n.t('revive_short').replace('{n}', short); }
      // Contador de usos: hace visible el tope de 3 (evita el "me estafaron" al 4º).
      const ce = $('#revive-count'); if (ce) ce.textContent = I18n.t('revive_count').replace('{n}', this.revives + 1).replace('{max}', this.REVIVE_MAX);
      Modal.open('modal-revive');
    },
    revive() {
      const cost = this.reviveCost();
      if (!Meta.spend(cost)) { Toasts.show(I18n.t('no_coins'), 'warn', 1500); return; }
      this.revives++;
      this.lives = 1; Sound.lifeBlast(); Haptics.life(); this._lock(900, 'life-blast'); this._relief(0.6);
      Modal.close(); this.resumeClock(); State.status = 'playing'; Toasts.resume(); Loop.start(); if (Settings.music) Music.start();
      this.render();
    },
    giveUp() { Modal.close(); Game.gameOver(I18n.t('reason_surv').replace('{s}', Math.floor(this.survSec))); },
    // Power-ups ESPACIALES (el jugador elige dónde) vs GLOBALES (efecto instantáneo).
    SPATIAL: ['bomb', 'clearLine', 'wild'],
    isSpatial(id) { return this.SPATIAL.indexOf(id) !== -1; },
    boosterAvailable(id) {
      // En partida solo existe el loadout confirmado y las bendiciones ganadas.
      // El stock persistente nunca se mezcla ni se drena de forma implícita.
      return Math.max(0, this.inv[id] | 0);
    },
    _spendBooster(id) {
      if ((this.inv[id] | 0) > 0) { this.inv[id]--; return true; }
      return false;
    },
    // Pulsar un power-up: los globales se aplican ya; los espaciales entran en
    // "modo apuntar" (toca una casilla para aplicarlo ahí).
    armBooster(id) {
      if (this.boosterAvailable(id) <= 0) { Toasts.show(I18n.t('powerup_empty'), 'warn', 1100); Sound.ui(); return; }
      if (this.locked()) { Sound.ui(); return; }
      if (!this.isSpatial(id)) { this._applyGlobal(id); return; }
      if (this.armed === id) { this.disarm(); return; }   // volver a pulsar = cancelar
      this.armed = id;
      document.body.classList.add('aiming');
      this.buildBar();
      Toasts.show(I18n.t('aim_hint'), 'info', 1600, BOOSTER_IMG[id] || Boosters.DEFS[id].glyph);
      Sound.ui();
    },
    disarm() {
      if (!this.armed) return;
      this.armed = null;
      document.body.classList.remove('aiming');
      this._clearPreview();
      this.buildBar();
    },
    _applyGlobal(id) {
      if (!this._spendBooster(id)) { Toasts.show(I18n.t('powerup_empty'), 'warn', 1100); this.buildBar(); return; }
      this._noBoosterSinceBoss = false; this._anyBoosterUsed = true; // hazañas (SV-20/21/31)
      if (Bosses.enc) Bosses.enc.flawless = false; // Ronda maestra (JF-γ): gastar rompe el flawless
      Render.boosterPulse(id);
      if (id === 'freeze') { this.freezeUntil = performance.now() + 7000; Toasts.show(I18n.t('pu_freeze'), 'info', 1500, BOOSTER_IMG.freeze); Render.boardEvent('boost-freeze', 1200); }
      else if (id === 'x2') { this.x2Until = performance.now() + 11000; this._syncMult(); Toasts.show(I18n.t('pu_x2'), 'good', 1500, BOOSTER_IMG.x2); Render.boardEvent('boost-x2', 1200); }
      Sound.booster(id); Haptics.combo(); this.buildBar(); this.render();
      if (State.status === 'playing') Game.evaluate();
    },
    // Celdas afectadas por un power-up espacial centrado en `i` (para previsualizar y aplicar).
    _affectedCells(id, i) {
      const size = State.size, r = i / size | 0, c = i % size, out = [];
      if (id === 'bomb') {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < size && cc < size) out.push(rr * size + cc); }
      } else if (id === 'clearLine') {
        this._lineCells('row', r).forEach((j) => out.push(j));
        this._lineCells('col', c).forEach((j) => { if (out.indexOf(j) === -1) out.push(j); });
      } else if (id === 'wild') {
        const type = State.board[i];
        if (type != null) for (let j = 0; j < State.board.length; j++) if (State.board[j] === type) out.push(j);
      }
      return out;
    },
    previewAt(i) {
      this._clearPreview();
      if (!this.armed || i == null) return;
      const cells = this._affectedCells(this.armed, i);
      this._preview = cells;
      cells.forEach((j) => { const el = Render.cells[j]; if (el) el.classList.add('aim-target'); });
    },
    _clearPreview() {
      if (this._preview) this._preview.forEach((j) => { const el = Render.cells[j]; if (el) el.classList.remove('aim-target'); });
      this._preview = null;
    },
    // Aplica el power-up espacial armado en la casilla elegida por el jugador.
    applyBoosterAt(id, i) {
      if (this.boosterAvailable(id) <= 0) { this.disarm(); return; }
      this._noBoosterSinceBoss = false; this._anyBoosterUsed = true; // hazañas (SV-20/21/31)
      if (Bosses.enc) Bosses.enc.flawless = false; // Ronda maestra (JF-γ): gastar rompe el flawless
      // Escoba sobre casilla vacía: barrido automático del grupo más repetido.
      if (id === 'wild' && State.board[i] == null) {
        if (!this._spendBooster(id)) { this.disarm(); return; }
        Render.boosterPulse(id); this._lock(420, 'boost-wild'); this._wild();
        Sound.booster(id); Haptics.combo(); this.disarm(); this.render();
        if (State.status === 'playing') Game.evaluate();
        return;
      }
      const cells = this._affectedCells(id, i);
      if (!this._spendBooster(id)) { this.disarm(); return; }
      Render.boosterPulse(id); this._lock(420, 'boost-' + id);
      const cleared = []; let icons = 0;
      const fxN = id === 'bomb' ? 5 : id === 'clearLine' ? 4 : 6;
      cells.forEach((j) => { icons += this._powerClear(j, cleared, fxN); });
      // La bomba no destruye anclas/jaulas (inmunes en _powerClear) pero SÍ agrieta
      // su blindaje 1 nivel (JF-02): el arsenal conserva un rol contra el jefe.
      if (id === 'bomb') cells.forEach((j) => { const t = State.tiles[j]; if (t && ((t.type === 'boss' && (t.hits || 0) > 0) || t.type === 'cage')) Bosses.crackAt(j); });
      State.removedTotal += icons; State.lastActionCell = i;
      Render.syncAll();
      const msg = id === 'bomb' ? I18n.t('pu_bomb') : id === 'clearLine' ? I18n.t('pu_ray') : icons + ' ' + I18n.t('pu_icons');
      Toasts.show(msg, 'good', 1200, BOOSTER_IMG[id]);
      this.addFrenzy(Math.min(24, 6 + icons * 3));
      const pulse = id === 'bomb' ? 'bomb-cleared' : id === 'clearLine' ? 'line-cleared' : 'wild-cleared';
      cleared.forEach((j) => Render.cellPulse(j, pulse, 760));
      Sound.booster(id); Haptics.combo(); this.disarm(); this.render();
      if (State.status === 'playing') Game.evaluate();
    },
    _powerClear(j, cleared, fxN = 5) {
      const t = State.tiles[j], hadIcon = State.board[j] !== null;
      // Carne del jefe (JF-02): anclas y jaulas son inmunes a objetos y al alivio —
      // ni el tile ni el icono que vive encima. Al jefe se le vence jugando; la
      // bomba agrieta blindaje aparte (applyBoosterAt), sin pasar por aquí.
      if (t && (t.type === 'boss' || t.type === 'cage')) return 0;
      if (!hadIcon && !t) return 0;
      if (hadIcon) {
        FX.burst(j, IconPacks.colorOf(Meta.equippedIconPack(), State.board[j]), fxN);
        State.board[j] = null;
        State.iconCount = Math.max(0, State.iconCount - 1);
      } else {
        FX.burst(j, t && (t.type === 'rock' || t.type === 'locked') ? '#c2cbe0' : '#dffbff', Math.max(3, fxN - 1));
      }
      if (t) {
        if (t.type === 'frozen') Render.iceBreak(j);
        if (t.type === 'rock') Render.cells[j].classList.remove('rock-cracked');
        if (t.type === 'locked') Render.cells[j].classList.remove('lock-cracked');
        State.tiles[j] = null;
      }
      cleared.push(j);
      return hadIcon ? 1 : 0;
    },
    _lineCells(axis, n) {
      const cells = [], size = State.size;
      for (let k = 0; k < size; k++) cells.push(axis === 'row' ? n * size + k : k * size + n);
      return cells;
    },
    _lineScore(cells) {
      return cells.reduce((sum, j) => {
        const t = State.tiles[j];
        return sum + (State.board[j] !== null ? 2 : 0) + (t ? (t.type === 'rock' || t.type === 'locked' ? 1.35 : 1) : 0);
      }, 0);
    },
    _bomb() {
      let best = 0, bestN = -1, size = State.size;
      for (let i = 0; i < State.board.length; i++) {
        const r = i / size | 0, c = i % size; let n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < size && cc < size) {
            const j = rr * size + cc;
            n += (State.board[j] !== null ? 2 : 0) + (State.tiles[j] ? 1 : 0);
          }
        }
        if (n > bestN) { bestN = n; best = i; }
      }
      const r = best / size | 0, c = best % size;
      State.lastActionCell = best;
      const cleared = []; let icons = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < size && cc < size) icons += this._powerClear(rr * size + cc, cleared, 5);
      }
      State.removedTotal += icons;
      Render.syncAll(); Toasts.show(I18n.t('pu_bomb'), 'good', 1300, BOOSTER_IMG.bomb);
      this.addFrenzy(Math.min(24, 8 + icons * 3));
      cleared.forEach(i => Render.cellPulse(i, 'bomb-cleared', 760));
    },
    _clearLine() {
      let best = { axis: 'row', n: 0, cells: this._lineCells('row', 0), score: -1 };
      for (const axis of ['row', 'col']) {
        for (let n = 0; n < State.size; n++) {
          const cells = this._lineCells(axis, n), score = this._lineScore(cells);
          if (score > best.score || (score === best.score && RNG.random() < 0.5)) best = { axis, n, cells, score };
        }
      }
      const cleared = []; let icons = 0;
      State.lastActionCell = best.cells[Math.floor(best.cells.length / 2)];
      best.cells.forEach(j => { icons += this._powerClear(j, cleared, 4); });
      State.removedTotal += icons;
      Render.syncAll(); Toasts.show(best.axis === 'row' ? I18n.t('pu_row') : I18n.t('pu_col'), 'good', 1300, BOOSTER_IMG.wild);
      this.addFrenzy(Math.min(24, 8 + icons * 2));
      cleared.forEach(i => Render.cellPulse(i, 'line-cleared', 760));
    },
    _wild() {
      const by = new Map();
      for (let i = 0; i < State.board.length; i++) {
        const v = State.board[i], t = State.tiles[i];
        if (v !== null && !(t && t.type === 'rock')) {
          if (!by.has(v)) by.set(v, []);
          by.get(v).push(i);
        }
      }
      let best = null;
      by.forEach((arr, id) => { if (!best || arr.length > best.arr.length) best = { id, arr }; });
      if (!best || best.arr.length < 2) {
        const fallback = [];
        for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null) fallback.push(i);
        if (!fallback.length) { Toasts.show(I18n.t('pu_no_target'), 'warn', 1200, BOOSTER_IMG.x2); return; }
        const cleared = [], idx = fallback[rand(fallback.length)];
        State.lastActionCell = idx;
        State.removedTotal += this._powerClear(idx, cleared, 6);
        Render.syncAll(); cleared.forEach(i => Render.cellPulse(i, 'wild-cleared', 820));
        this.addFrenzy(10);
        Toasts.show(I18n.t('pu_wild_emergency'), 'good', 1300, BOOSTER_IMG.x2);
        return;
      }
      const cleared = best.arr.slice(0, 8);
      State.lastActionCell = cleared[0];
      const pulsed = []; let icons = 0;
      cleared.forEach(i => { icons += this._powerClear(i, pulsed, 6); });
      State.removedTotal += icons;
      Render.syncAll(); pulsed.forEach(i => Render.cellPulse(i, 'wild-cleared', 820));
      this.addFrenzy(Math.min(26, 8 + icons * 3));
      Toasts.show(I18n.t('pu_wild_icons').replace('{n}', icons), 'good', 1400, BOOSTER_IMG.x2);
    },
    buildBar() {
      const el = $('#boosters'); if (!el) return;
      // Clásico (GM-03): solo consumibles equipados en la preparación confirmada;
      // sin unidades en Survival.inv, la barra se oculta.
      const list = State.mode === 'clasico'
        ? Object.keys(Config.PRELEVEL_BOOSTERS).filter((id) => this.boosterAvailable(id) > 0)
        : this.BOOSTERS;
      if (State.mode === 'clasico') { const bb = $('#booster-bar'); if (bb) bb.hidden = list.length === 0; }
      el.innerHTML = list.map((id) => {
        const d = Boosters.DEFS[id], n = this.boosterAvailable(id);
        const arming = this.armed === id ? ' arming' : '';
        const label = ({ freeze: 'Hielo', wild: 'Barrido', x2: 'Doble' }[id]) || d.name;
        return `<button class="booster${n <= 0 ? ' empty' : ''}${arming}" data-b="${id}" aria-label="${d.name}: ${n}" ${n <= 0 ? 'aria-disabled="true"' : ''}><span class="b-ic">${BOOSTER_IMG[id] ? iconAnyInline(BOOSTER_IMG[id]) : d.glyph}</span><span class="b-label">${esc(label)}</span><span class="b-count" data-bc="${id}">${fmtNum(n)}</span></button>`;
      }).join('');
      el.querySelectorAll('.booster').forEach((b) => b.addEventListener('click', () => this.armBooster(b.dataset.b)));
    },
    render() {
      const r = this._r;
      if (r.lives !== this.lives) {
        r.lives = this.lives; const lv = $('#surv-lives');
        if (lv) { lv.innerHTML = this.lives > 0 ? iconInline('heart').repeat(this.lives) : iconInline('skull'); lv.classList.toggle('last-life', this.lives === 1); }
      }
      if (r.wave !== this.wave) { r.wave = this.wave; const w = $('#surv-wave'); if (w) w.textContent = I18n.t('st_wave') + ' ' + this.wave; }
      const tier = this.dlevel(); if (r.tier !== tier) { r.tier = tier; const tEl = $('#surv-tier'); if (tEl) tEl.textContent = 'N' + tier; }
      const sec = Math.floor(this.survSec); if (r.sec !== sec) { r.sec = sec; const t = $('#surv-time'); if (t) t.textContent = sec + 's'; }
      // Progreso a la siguiente oleada (telegrafía que la presión va a subir).
      const wp = Math.min(100, Math.round(this.waveAcc / this.WAVE_MS * 100));
      if (r.wp !== wp) {
        r.wp = wp;
        const wf = $('#surv-waveprog-fill'); if (wf) wf.style.width = wp + '%';
        const sb = $('#surv-bar'); if (sb) sb.classList.toggle('soon', wp >= 78);
      }
      // Bandera de jefe entrante (GM-18): visible durante TODA la oleada previa.
      const bossSoon = !!this.bossNext && !(Bosses.enc && Bosses.enc.kind === 'boss');
      if (r.bossNext !== bossSoon) {
        r.bossNext = bossSoon;
        const sb = $('#surv-bar'); if (sb) sb.classList.toggle('boss-soon', bossSoon);
        const bf = $('#surv-boss-flag'); if (bf) { bf.hidden = !bossSoon; bf.textContent = I18n.t('surv_boss_soon'); }
      }
      // Anillos concéntricos (GM-21): interior = suministro (→ monedas), exterior =
      // frenesí (→ furia). Un solo widget en vez de dos barras que subían a la par.
      const C_CHARGE = 106.8, C_FRENZY = 150.8; // 2π·r (r=17 / r=24 del SVG)
      const ch = Math.round(this.charge);
      if (r.charge !== ch) { r.charge = ch; const c = $('#pr-charge'); if (c) c.style.strokeDashoffset = (C_CHARGE * (1 - Math.min(ch, 100) / 100)).toFixed(1); }
      const fActive = this.frenzyActive();
      const fVal = fActive ? 100 : Math.round(this.frenzy);
      if (r.frenzyVal !== fVal || r.frenzyOn !== fActive) {
        r.frenzyVal = fVal; r.frenzyOn = fActive;
        const f = $('#pr-frenzy'); if (f) f.style.strokeDashoffset = (C_FRENZY * (1 - Math.min(fVal, 100) / 100)).toFixed(1);
        const pr = $('#power-rings'); if (pr) pr.classList.toggle('on', fActive);
      }
      const ready = this.charge >= 100;
      if (r.ready !== ready) {
        r.ready = ready;
        const bb = $('#booster-bar'); if (bb) bb.classList.toggle('ready', ready);
        const pr = $('#power-rings'); if (pr) pr.classList.toggle('ready', ready);
      }
      // Banner del encuentro (JF-β): la cara del jefe ENCIMA de vidas/oleada/tiempo.
      // Diffing por firma (id|nivel|fase|PV|segundos|telegraph): 1 escritura DOM por
      // cambio y la cuenta atrás solo re-escribe al cambiar el segundo (§5.6).
      // Banner del encuentro y Carrusel vertical de tarjetas (JF-β):
      // Conmuta suavemente entre Oleadas -> Jefe activo -> Resultado dedicado -> Oleadas
      const activeEnc = Bosses.enc;
      const faceEnc = Bosses.face;
      const cardState = activeEnc ? 'boss' : (faceEnc ? 'result' : 'wave');

      if (r.cardState !== cardState) {
        r.cardState = cardState;
        r.encSig = ''; r.encIcon = '';
        const sb2 = $('#surv-bar'); if (sb2) sb2.classList.toggle('encounter', !!activeEnc || !!faceEnc);

        const setCardStatus = (el, st) => {
          if (!el) return;
          if (st === 'active') {
            el.hidden = false;
            void el.offsetWidth;
            el.classList.remove('exit-up', 'enter-down');
            el.classList.add('active');
          } else if (st === 'exit-up') {
            el.classList.remove('active', 'enter-down');
            el.classList.add('exit-up');
            el.hidden = true;
          } else if (st === 'enter-down') {
            el.classList.remove('active', 'exit-up');
            el.classList.add('enter-down');
            el.hidden = true;
          }
        };

        const waveCard = $('#surv-wave-wrap');
        const bossCard = $('#surv-boss');
        const resCard = $('#surv-boss-result');

        if (cardState === 'boss') {
          setCardStatus(waveCard, 'exit-up');
          setCardStatus(resCard, 'enter-down');
          setCardStatus(bossCard, 'active');
        } else if (cardState === 'result') {
          setCardStatus(bossCard, 'exit-up');
          setCardStatus(waveCard, 'enter-down');
          setCardStatus(resCard, 'active');
        } else {
          setCardStatus(bossCard, 'exit-up');
          setCardStatus(resCard, 'exit-up');
          setCardStatus(waveCard, 'active');
        }
      }

      if (activeEnc) {
        const enc = activeEnc;
        const mini = enc.kind === 'mini';
        const def = (mini ? Bosses.MINIDEX[enc.id] : Bosses.DEX[enc.id]) || {};
        // Jefes: cuenta atrás del ataque · minijefes: tiempo que les queda en el tablero.
        const secs = mini
          ? Math.max(0, Math.ceil((enc.durMs - enc.ms) / 1000))
          : Math.max(0, Math.ceil((enc.attackEvery - enc.atkAcc) / 1000));
        const leaveSecs = Math.max(0, Math.ceil((enc.durMs - enc.ms) / 1000));
        const sig = enc.id + '|' + enc.lvl + '|' + enc.phase + '|' + enc.anchorsLeft + '|' + secs + '|' + leaveSecs + '|' + (enc.telegraphed ? 1 : 0);
        if (r.encSig !== sig) {
          r.encSig = sig;
          const eb = $('#surv-boss');
          if (eb) {
            eb.classList.toggle('mini', mini);
            eb.classList.toggle('phase2', enc.phase > 1);
            eb.classList.toggle('lvl-high', !mini && enc.lvl >= 3);
          }
          if (r.encIcon !== enc.id) {
            r.encIcon = enc.id;
            const ic = $('#surv-boss-icon'); if (ic) ic.innerHTML = Bosses.portraitHTML(def);
            const nm = $('#surv-boss-name'); if (nm) nm.textContent = mini ? Bosses.miniName(enc.id) : Bosses.name(enc.id);
          }
          const lv = $('#surv-boss-lvl'); if (lv) lv.textContent = mini ? '' : Bosses.lvlLabel(enc.lvl);
          const hp = $('#surv-boss-hp');
          if (hp) {
            hp.textContent = '◆'.repeat(enc.anchorsLeft) + '◇'.repeat(Math.max(0, enc.anchorsMax - enc.anchorsLeft));
            hp.setAttribute('aria-label', I18n.t('surv_boss_hp_sr').replace('{n}', enc.anchorsLeft).replace('{m}', enc.anchorsMax));
          }
          const nx = $('#surv-boss-next');
          if (nx) {
            nx.textContent = mini ? ((def.atkIcon || '⚠') + ' ' + secs + 's') : (Bosses.atkName(enc) + ' ' + secs + 's');
            nx.classList.toggle('telegraph', !!enc.telegraphed);
          }
          const blv = $('#surv-boss-leave');
          if (blv) {
            blv.textContent = I18n.t('surv_boss_leave').replace('{s}', leaveSecs);
          }
        }
      }
    },
  };

  /* ===================== Bosses (sistema de jefes: encuentros JF-α) =====================
   * docs/BOSS_SYSTEM_MASTER_PLAN.md — framework de encuentros: el jefe pasa de evento
   * instantáneo a criatura con cuerpo (anclas en el tablero), PV, fases, nivel y actos
   * (pools por tramo de oleada, como los pisos de Enter the Gungeon).
   *
   * APAGADO por defecto (ENCOUNTERS=false): hasta que JF-γ valide las puertas de
   * balance B-J1/B-J3 con el simulador, el jefe-evento clásico sigue intacto y este
   * módulo solo se ejercita desde tests y sim. Garantía de diseño nº1 del plan:
   * ignorar al jefe = experiencia equivalente a la actual (los ataques reparten la
   * intensidad del evento único y al retirarse hay bendición como siempre);
   * derrotarlo (romper todas sus anclas) es upside opcional.
   *
   * Mecánica de daño (§3.3): las anclas son tiles `boss` NO-sólidos colocados BAJO
   * iconos existentes (los spawns nunca caen sobre tiles: un ancla en celda vacía
   * sería invulnerable, por eso _reincarnate re-encarna el icono si desaparece por
   * vías indirectas). Converger el icono de encima = 1 golpe (rama en Game.converge).
   * Blindada = hits>0 y solid=true en la instancia: Engine.converging ya trata solid
   * como hielo (icono atrapado, corta línea de visión); la adyacencia (o una bomba)
   * agrieta el blindaje. Anclas y jaulas son inmunes a _powerClear: al jefe se le
   * vence jugando, no gastando.
   */
  const Bosses = {
    // ENCENDIDO en JF-γ (v2.6.17) tras las puertas B-J1/B-J3 (batería en
    // BALANCE_BASELINE.md). Con false se recupera el jefe-evento clásico intacto —
    // interruptor de emergencia deliberado.
    ENCOUNTERS: true,
    TELEGRAPH_MS: 2500, // pre-marca de celdas antes de cada ataque (§5.3)
    FIRST_ATTACK_MS: 9500, // BP-0: lectura real de card + anclas antes del primer tell
    PHASE_ATTACK_GRACE_MS: 6200, // BP-0: fase 2 nunca encadena un ataque inmediato
    RESOLVE_FACE_MS: 2600, // BP-0: el banner se queda tras derrota/retirada
    ECO_P: 0.15,        // prob. de que el sorteo devuelva un eco «ha vuelto» (§4.4)
    // Registro de jefes (JF-01). Nombres/epítetos i18n (`bossdex_*`) llegan en JF-β;
    // acentos y nº de anclas según el mockup aprobado por el propietario
    // (docs/mockups/boss-system-visual-index.html). attackMs e intensidades de ataque
    // son PROVISIONALES hasta la puerta B-J3 (JF-γ): la intensidad total del
    // encuentro (~4 ataques) debe equivaler al evento único de hoy.
    DEX: {
      meteor: { acto: 1, accent: '#ff755b', icon: 'v2:meteor', atkIcon: '☄', anchors: 3, armored: 0, attackMs: 12000, atk: 'rain', frame: 'surv-meteor-board' },
      tide: { acto: 1, accent: '#59d6ff', icon: '🌊', atkIcon: '≈', anchors: 3, armored: 0, attackMs: 13000, atk: 'tide', frame: 'surv-tide', edgeAnchors: true },
      frost: { acto: 1, accent: '#94e8ff', icon: 'v2:snowflake', atkIcon: '❄', anchors: 2, armored: 0, attackMs: 12000, atk: 'frost', frame: 'surv-frost' },
      lockdown: { acto: 2, accent: '#d6dce8', icon: '🔒', atkIcon: '▣', anchors: 3, armored: 1, attackMs: 13000, atk: 'locks', frame: 'surv-lockdown' },
      quake: { acto: 2, accent: '#ffb24d', icon: 'teleporter', atkIcon: '▤', anchors: 3, armored: 1, attackMs: 14000, atk: 'shuffle', frame: 'surv-quake', chaosPromote: true },
      // --- Acto III: La Corte Profunda (JF-ε) — twists mentales ---
      crystalid: { acto: 3, accent: '#19f0d0', icon: '💠', atkIcon: '✷', anchors: 4, armored: 0, attackMs: 12000, atk: 'shards', frame: 'surv-frost', regenMs: 12000 },
      void: { acto: 3, accent: '#a06bff', icon: '🕳️', atkIcon: '◉', anchors: 2, armored: 0, attackMs: 11000, atk: 'devour', frame: 'surv-lockdown', growCap: 4 },
      puppeteer: { acto: 3, accent: '#ff6cb0', icon: '🎭', atkIcon: '✚', anchors: 3, armored: 1, attackMs: 13000, atk: 'threads', frame: 'surv-quake' },
    },
    // ---- Minijefes (JF-δ, §3.7/§4.3): entidades de 1 ancla y 1 mecánica que
    // aparecen POR SORPRESA en oleadas normales (p=0.22, pity 4). Enseñan el
    // vocabulario del jefe de su acto en versión pequeña; sin card ni bendición.
    MINI_P: 0.22, MINI_PITY: 4, MINI_FROM_WAVE: 3,
    MINIDEX: {
      magpie: { acto: 1, accent: '#ffd84d', icon: '🐦', atkIcon: '✧', beatMs: 7000, lifeWaves: 1 },   // roba 1 icono/7s; al morir lo devuelve TODO agrupado
      firefly: { acto: 1, accent: '#ffe14d', icon: '✨', atkIcon: '✦', beatMs: 3000, lifeMs: 15000, bonus: true }, // vaga; matarla = frenesí + monedas
      sentinel: { acto: 2, accent: '#7ad7ff', icon: '🗼', atkIcon: '❄', beatMs: 8000, lifeWaves: 1, armor: 1 },     // congela en su fila/columna; al morir la limpia
      herald: { acto: 2, accent: '#ff5d73', icon: '📯', atkIcon: '▲', beatMs: 99000, lifeWaves: 1, armor: 1, preBoss: true }, // vivo al llegar el jefe = jefe +1 nivel
    },
    _miniDry: 0, _lastWaveMini: false, _heraldEmpower: false, _heraldSlain: false,
    miniName(id) { return I18n.t('minidex_' + id); },
    // Sorteo por frontera de oleada (lo llama Survival.newWave). El Heraldo es la
    // excepción diseñada: SOLO aparece en la oleada previa a jefe (Acto II+).
    maybeMini() {
      if (!this.ENCOUNTERS || this.enc) { this._lastWaveMini = false; return; }
      if (Survival.wave < this.MINI_FROM_WAVE) return;
      if (Survival.wave % Survival.tune().bossEvery === 0) return; // oleada de jefe
      const acto = this.actoForWave(Survival.wave);
      if (Survival.bossNext) {
        // Oleada previa a jefe: solo el Heraldo (y no siempre) — el telegrafiado manda.
        if (acto >= 2 && !this._lastWaveMini && RNG.random() < 0.35) this.startMini('herald');
        else this._lastWaveMini = false;
        return;
      }
      if (this._lastWaveMini) { this._lastWaveMini = false; return; } // nunca 2 seguidos
      this._miniDry++;
      if (RNG.random() < this.MINI_P || this._miniDry >= this.MINI_PITY) {
        const pool = Object.keys(this.MINIDEX).filter((id) => { const d = this.MINIDEX[id]; return d.acto <= acto && !d.preBoss; });
        if (pool.length) this.startMini(pool[rand(pool.length)]);
      }
    },
    startMini(id) {
      if (this.enc) return null;
      this.face = null;
      const def = this.MINIDEX[id];
      // 1 ancla bajo un icono (la Luciérnaga y la Urraca se mueven después).
      const f = Survival._filledIdx();
      if (!f.length || Survival._specialRoom() <= 0) return null;
      const idx = f[rand(f.length)];
      const t = Tiles.make('boss');
      if (def.armor) { t.hits = def.armor; t.solid = true; }
      State.tiles[idx] = t;
      Render.syncCell(idx); Render.cellPulse(idx, 'tide-warn', 700);
      this.enc = {
        kind: 'mini', id, lvl: this.actoForWave(Survival.wave), phase: 1,
        anchorsMax: 1, anchorsLeft: 1, at: idx,
        ms: 0, atkAcc: 0, reincAcc: 0, attackEvery: def.beatMs,
        durMs: def.lifeMs || Math.round(Survival.WAVE_MS * 0.9),
        telegraphed: false, targets: null, flawless: true, attacks: 0, stolen: [],
      };
      this._miniDry = 0; this._lastWaveMini = true;
      Survival._minisSeen = (Survival._minisSeen || 0) + 1;
      document.documentElement.style.setProperty('--boss-accent', def.accent);
      Toasts.event(this.miniName(id) + ' · ' + I18n.t('minidex_' + id + '_e'), def.bonus ? 'good' : 'warn', 1900, def.icon);
      announce(I18n.t('sr_mini_enter').replace('{b}', this.miniName(id)));
      Sound.danger(); Haptics.tap();
      Render.hudSoon();
      return this.enc;
    },
    // Comportamiento por latido del minijefe (desde tick, cadencia beatMs).
    _miniBeat(e) {
      const size = State.size;
      if (e.id === 'magpie') {
        // Roba 1 icono visible (no sobre tiles) y lo guarda bajo el ala.
        const f = Survival._filledIdx().filter((i) => i !== e.at);
        if (f.length && State.iconCount > 6) {
          const j = f[rand(f.length)];
          e.stolen.push(State.board[j]);
          State.board[j] = null; State.iconCount--;
          Render.syncCell(j); FX.burst(j, '#ffd84d', 4);
          if (e.stolen.length === 1) Toasts.event(I18n.t('mini_steal').replace('{b}', this.miniName(e.id)), 'warn', 1500, '🐦');
        }
      } else if (e.id === 'sentinel') {
        // Congela 1 celda de su fila o columna (territorio visible).
        const r = e.at / size | 0, c = e.at % size, cand = [];
        for (let k = 0; k < size; k++) {
          const a = r * size + k, b = k * size + c;
          if (State.board[a] !== null && !State.tiles[a]) cand.push(a);
          if (State.board[b] !== null && !State.tiles[b]) cand.push(b);
        }
        if (cand.length && Survival._specialRoom() > 0) {
          const j = cand[rand(cand.length)];
          State.tiles[j] = Tiles.make('frozen');
          Render.syncAll(); Render.iceHit(j);
        }
      }
      // Las entidades vagabundas se recolocan tras actuar.
      if (e.id === 'firefly' || e.id === 'magpie') this._miniMove(e);
    },
    // La entidad se recoloca a una celda vecina con icono (ancla móvil).
    _miniMove(e) {
      const size = State.size, r = e.at / size | 0, c = e.at % size;
      const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([rr, cc]) => rr >= 0 && cc >= 0 && rr < size && cc < size);
      const spots = nb.map(([rr, cc]) => rr * size + cc).filter((j) => State.board[j] !== null && !State.tiles[j]);
      if (!spots.length) return;
      const to = spots[rand(spots.length)];
      const t = State.tiles[e.at];
      State.tiles[e.at] = null; Render.syncCell(e.at);
      State.tiles[to] = t; e.at = to;
      Render.syncCell(to); Render.cellPulse(to, 'tide-warn', 420);
    },
    // Muerte del minijefe (su ancla cayó): efecto-firma + botín pequeño.
    _miniKill(e) {
      let coins = 3 + (e.lvl || 1);
      if (e.id === 'magpie' && e.stolen.length) {
        // Devuelve TODO lo robado agrupado alrededor de su celda (convergencia servida).
        const size = State.size, r = e.at / size | 0, c = e.at % size;
        const dist = (i) => { const rr = i / size | 0, cc = i % size; return Math.abs(rr - r) + Math.abs(cc - c); };
        const near = [];
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < size && cc < size) { const j = rr * size + cc; if (State.board[j] === null && !State.tiles[j]) near.push(j); }
        }
        const fallback = Survival._emptyIdx().filter((j) => !near.includes(j)).sort((a, b) => dist(a) - dist(b));
        const spots = near.concat(fallback);
        e.stolen.forEach((v) => { if (spots.length) { const j = spots.shift(); State.board[j] = v; State.iconCount++; Render.syncCell(j); Render.spawnAnim(j); } });
        Toasts.event(I18n.t('mini_return').replace('{n}', e.stolen.length), 'good', 1800, '🐦');
      } else if (e.id === 'firefly') {
        Survival.addFrenzy(24); coins += 8;
        Toasts.event(I18n.t('mini_firefly_gift'), 'good', 1700, '✨');
      } else if (e.id === 'sentinel') {
        // Limpia su fila y columna (con el mismo suelo anti-inflación de derrotas).
        const size = State.size, r = e.at / size | 0, c = e.at % size, cleared = [];
        let budget = Math.max(0, (State.iconCount || 0) - 8);
        for (let k = 0; k < size && budget > 0; k++) {
          [r * size + k, k * size + c].forEach((j) => {
            if (budget > 0 && State.board[j] !== null && Survival._powerClear(j, cleared, 4)) budget--;
          });
        }
        if (cleared.length) { Render.syncAll(); Render.lifeClear(cleared, null); }
        Toasts.event(I18n.t('mini_sentinel_gift'), 'good', 1700, '🗼');
      } else if (e.id === 'herald') {
        this._heraldEmpower = false; this._heraldSlain = true; // el jefe llega debilitado (−1 nivel)
        Toasts.event(I18n.t('mini_herald_down'), 'good', 1900, '📯');
      }
      Meta.addCoins(coins); State.coinsRun += coins; Survival.runCoins += coins; Econ.refresh();
      Render.coinsReward(coins, I18n.t('coins'));
      Survival._minisKilled = (Survival._minisKilled || 0) + 1;
      Sound.record(); Haptics.combo();
      announce(I18n.t('sr_mini_down').replace('{b}', this.miniName(e.id)));
      if (State.status === 'playing') Game.evaluate();
    },
    ROMAN: ['I', 'II', 'III', 'IV'],
    name(id) { return I18n.t('bossdex_' + id); },
    lvlLabel(lvl) { return I18n.t('surv_boss_lvl').replace('{n}', this.ROMAN[lvl - 1] || lvl); },
    atkName(e) { return I18n.t('bossatk_' + e.id + (e.phase > 1 ? '_2' : '_1')); },
    warnClass(e) {
      const kind = (this.DEX[e && e.id] || {}).atk;
      return ({
        rain: 'boss-warn-meteor',
        tide: 'boss-warn-tide',
        frost: 'boss-warn-frost',
        locks: 'boss-warn-lock',
        shuffle: 'boss-warn-quake',
        shards: 'boss-warn-shards',
        devour: 'boss-warn-void',
        threads: 'boss-warn-thread',
      })[kind] || 'boss-warn-tide';
    },
    // Retrato del banner: icono v2/png del registro, o el propio emoji como texto.
    portraitHTML(def) {
      const n = def && def.icon; if (!n) return '';
      return /^[a-z0-9:_-]+$/i.test(n) ? iconAnyInline(n) : esc(n);
    },
    enc: null, // encuentro activo — INVARIANTE: máximo uno (jefe o minijefe)
    face: null, // BP-0: presencia visual post-encuentro (banner de resolución)
    // ---- Niveles y actos (§3.5): de más bajos a más altos, visibles como Nv. I-III ----
    actoForWave(w) { return w >= 24 ? 3 : w >= 12 ? 2 : 1; },
    levelForWave(w, opts) {
      let lvl = Math.min(3, 1 + Math.floor(w / 12));
      if (opts && opts.eco) lvl++;    // «ha vuelto a por ti»: retorno a nivel +1
      if (opts && opts.herald) lvl++; // el Heraldo vivo sube el nivel (JF-δ)
      return Math.min(4, lvl);        // 4 = PESADILLA, solo por acumulación eco+heraldo
    },
    // ---- Sorteo de identidad (§3.6): aleatorio el CUÁL, determinista el CUÁNDO ----
    pick(wave) {
      const last = Survival._lastBossType;
      if (last && this.DEX[last] && RNG.random() < this.ECO_P) return 'eco';
      const acto = this.actoForWave(wave);
      const chaos = Survival.weeklyMut().id === 'chaos';
      let pool = Object.keys(this.DEX).filter((id) => {
        const d = this.DEX[id];
        // La semana del caos promueve a Tectónico (quake) desde el Acto I (§3.5).
        return d.acto <= acto || (chaos && d.chaosPromote);
      });
      if (pool.length > 1 && last) pool = pool.filter((id) => id !== last); // sin repetición inmediata
      return pool[rand(pool.length)] || 'meteor';
    },
    // ---- Ciclo de vida (FSM §3.2): entrada → activo → derrota/retirada ----
    startEncounter(id) {
      // El jefe manda: un minijefe vivo se marcha (el Heraldo consuma su anuncio).
      if (this.enc && this.enc.kind === 'mini') this.resolve('miniExpire');
      if (this.enc) return null; // invariante: un solo encuentro a la vez
      this.face = null;
      let eco = false;
      if (id === 'eco' || !this.DEX[id]) {
        const prev = Survival._lastBossType;
        eco = id === 'eco';
        id = (prev && this.DEX[prev]) ? prev : 'meteor';
        if (eco) Feedback.event('echo', { msg: I18n.t('surv_eco').replace('{b}', I18n.t('bossname_' + id)) });
      }
      const def = this.DEX[id];
      // El Heraldo (JF-δ): si escapó, el jefe entra a nivel +1; si fue cazado, −1.
      const herald = this._heraldEmpower, slain = this._heraldSlain;
      this._heraldEmpower = false; this._heraldSlain = false;
      let lvl = this.levelForWave(Survival.wave, { eco, herald });
      if (slain) lvl = Math.max(1, lvl - 1);
      const anchors = this._placeAnchors(def, lvl);
      if (!anchors.length) {
        // Sin sustrato para el cuerpo (tablero anómalo): cae al jefe-evento clásico
        // con su ritual intacto — el jugador nunca se queda sin jefe ni sin bendición.
        Survival._runBoss(id, lvl >= 3);
        Survival._afterBossEvent();
        return null;
      }
      Survival._lastBossType = id;
      Survival._noBoosterSinceBoss = true;
      this.enc = {
        id, lvl, kind: 'boss', phase: 1, eco,
        anchorsMax: anchors.length, anchorsLeft: anchors.length,
        ms: 0, atkAcc: Math.max(0, def.attackMs - this.FIRST_ATTACK_MS), // BP-0: entrada legible antes del primer ataque
        reincAcc: 0, regenAcc: 0, attackEvery: def.attackMs,
        durMs: Math.round(Survival.WAVE_MS * 2.5), // ~100s de permanencia en pantalla (margen justo)
        telegraphed: false, targets: null, threads: null, devoured: [],
        flawless: true, attacks: 0,
      };
      Meta.survBossSeen(id); // bestiario (JF-ε)
      BossCoach.check('boss_intro', def.icon || '👑');
      if (anchors.some(idx => State.tiles[idx] && State.tiles[idx].hits > 0)) {
        BossCoach.check('boss_armored', '🛡️');
      }
      // La cara del jefe (JF-β): acento global (banner/anclas/card lo heredan por
      // CSS), tarjeta de presentación estilo Gungeon y announce accesible. El sting
      // reutiliza bossWarn hasta los leitmotivs de QP-4.
      document.documentElement.style.setProperty('--boss-accent', def.accent);
      const bossSr = I18n.t('surv_boss_enter_sr').replace('{b}', this.name(id)).replace('{n}', this.enc.lvl).replace('{k}', this.enc.anchorsMax);
      Render.bossCard(this.name(id), I18n.t('bossdex_' + id + '_e'), def.icon, bossSr);
      // Presentación del jefe (§5.2): breve retención de entrada para que la boss card
      // sea LEGIBLE y el jugador tenga tiempo de reacción antes de que el encuentro
      // corra. Sin este lock la entrada se sentía instantánea (la card pasaba volando).
      // BP-0: el primer ataque llega a ~9.5s; primero se lee jefe + anclas, luego tell.
      Survival._lock(1200, def.frame);
      Sound.bossWarn(); Haptics.fire(26, 'warning');
      Render.hudSoon();
      return this.enc;
    },
    // Coloca las anclas BAJO iconos existentes. Las anclas son el CUERPO del jefe
    // (transitorias: se retiran al resolver el encuentro) y son la ÚNICA vía para
    // dañarlo, así que NO se gatean por SPECIAL_CAP: si el tablero ya viene saturado
    // de especiales (hielos/candados acumulados o los traps de la propia oleada de
    // jefe, que se siembran antes), el jefe DEBE aparecer igualmente. Gatearlas por
    // `_specialRoom()` era la causa del bug «avisa un jefe pero nunca aparece y da
    // SUPERADO directo»: sin sitio → 0 anclas → fallback al jefe-evento clásico
    // (mecánica vieja). El exceso sobre el cap es temporal y se autocura al resolver;
    // mientras dura, `_specialRoom()`→0 frena los ataques que siembran especiales, así
    // que el jefe no sobrecarga el tablero. La Corriente ancla en el anillo exterior.
    _placeAnchors(def, lvl) {
      const size = State.size;
      const edge = (i) => { const r = i / size | 0, c = i % size; return r === 0 || c === 0 || r === size - 1 || c === size - 1; };
      let f = Survival._filledIdx();
      if (def.edgeAnchors) { const e = f.filter(edge); if (e.length >= def.anchors) f = e; }
      const n = Math.min(def.anchors, f.length);
      // Nivel III+ blinda un ancla extra, pero siempre queda ≥1 sin blindar (legibilidad).
      const armored = Math.min((def.armored || 0) + (lvl >= 3 ? 1 : 0), Math.max(0, n - 1));
      const placed = [];
      for (let k = 0; k < n && f.length; k++) {
        const idx = f.splice(rand(f.length), 1)[0];
        const t = Tiles.make('boss');
        if (k < armored) { t.hits = 1; t.solid = true; }
        State.tiles[idx] = t; placed.push(idx);
        Render.syncCell(idx); Render.cellPulse(idx, 'tide-warn', 900);
      }
      return placed;
    },
    _anchorIdx() { const a = []; for (let i = 0; i < State.tiles.length; i++) { const t = State.tiles[i]; if (t && t.type === 'boss') a.push(i); } return a; },
    // Re-encarnación: un ancla cuyo icono desapareció por vías indirectas (imán,
    // reconciliación de pool…) recupera icono — sobre celda vacía sería invulnerable.
    _reincarnate() {
      this._anchorIdx().forEach((i) => {
        if (State.board[i] === null && State.pool && State.pool.length) {
          State.board[i] = State.pool[rand(State.pool.length)];
          State.iconCount++;
          Render.syncCell(i); Render.spawnAnim(i);
        }
      });
    },
    // ---- Bucle del encuentro: acumuladores de dt (a prueba de pausas y del reloj
    // virtual del sim; ver Survival.onTick, único llamador) ----
    tick(dt) {
      if (!this.enc && this.face && performance.now() >= (this.face.resolveUntil || 0)) {
        this.face = null;
        this._faceOff();
        Render.hudSoon();
      }
      const e = this.enc; if (!e || State.status !== 'playing') return;
      e.ms += dt; e.atkAcc += dt; e.reincAcc += dt;
      if (e.reincAcc >= 900) { e.reincAcc = 0; this._reincarnate(); }
      // Minijefes (JF-δ): latido propio sin telegrafiado de celdas, y se marchan solos.
      if (e.kind === 'mini') {
        if (e.atkAcc >= e.attackEvery) {
          e.atkAcc -= e.attackEvery;
          this._miniBeat(e); e.attacks++;
          if (this.enc !== e || State.status !== 'playing') return;
        }
        if (e.ms >= e.durMs) this.resolve('miniExpire');
        return;
      }
      // Rebrote del Cristálido (JF-ε): en fase 2, regenera 1 ancla cada regenMs si
      // no están todas rotas — hay que rematarlo con tempo (counterplay: ráfaga).
      const defR = this.DEX[e.id];
      if (defR && defR.regenMs && e.phase > 1 && e.anchorsLeft < e.anchorsMax) {
        e.regenAcc += dt;
        if (e.regenAcc >= defR.regenMs) {
          e.regenAcc = 0;
          if (this._regrow(e)) Toasts.event(I18n.t('surv_boss_regrow').replace('{b}', this.name(e.id)), 'bad', 1500, defR.icon);
        }
      }
      if (!e.telegraphed && e.atkAcc >= e.attackEvery - this.TELEGRAPH_MS) {
        e.telegraphed = true;
        e.targets = this._pickTargets(e);
        const warn = this.warnClass(e);
        if (e.targets && e.targets.length) e.targets.forEach((j) => Render.cellPulse(j, warn, this.TELEGRAPH_MS));
        else Render.boardEvent('boss-warn-board', this.TELEGRAPH_MS);
        // El banner enciende la píldora (render) y el lector de pantalla oye QUÉ viene.
        announce(I18n.t('surv_boss_prep').replace('{b}', this.name(e.id)).replace('{a}', this.atkName(e)));
      }
      if (e.atkAcc >= e.attackEvery) {
        e.atkAcc -= e.attackEvery; e.telegraphed = false;
        this._attack(e); e.attacks++;
        if (this.enc !== e || State.status !== 'playing') return; // el ataque pudo desbordar (revivir/fin)
      }
      if (e.ms >= e.durMs) this.resolve('retreat');
    },
    // ---- Golpes, fases y resolución ----
    onAnchorHit(idx) {
      const e = this.enc; if (!e) return; // ancla huérfana (defensivo)
      e.anchorsLeft = Math.max(0, e.anchorsLeft - 1);
      e.durMs += 6000; // +6s de bonificación de tiempo al golpear anclas para premiar el esfuerzo activo
      Render.hudSoon();
      if (e.anchorsLeft <= 0) { this.resolve(e.kind === 'mini' ? 'miniKill' : 'defeat'); return; }
      // Fase 2 al caer la mitad de las anclas (§3.4): el patrón cambia, no solo escala.
      if (e.phase === 1 && e.anchorsLeft <= Math.floor(e.anchorsMax / 2)) {
        e.phase = 2;
        e.phaseContextUntil = performance.now() + 3500;
        const maxAcc = Math.max(0, e.attackEvery - this.PHASE_ATTACK_GRACE_MS);
        if (e.atkAcc > maxAcc) {
          e.atkAcc = maxAcc;
          e.telegraphed = false;
          e.targets = null;
        }
        Feedback.event('bossPhase', { msg: I18n.t('surv_boss_phase2').replace('{b}', this.name(e.id)) });
        BossCoach.check('boss_phase2', '⚠️');
        Render.boardEvent('surv-wave-soon', 500);
      }
    },
    // Re-planta un ancla viva (rebrote del Cristálido / crecimiento del Vacío /
    // curación del Titiritero). `grow` amplía también el máximo (el Vacío crece).
    _regrow(e, grow) {
      const f = Survival._filledIdx();
      if (!f.length || Survival._specialRoom() <= 0) return false;
      const idx = f[rand(f.length)];
      State.tiles[idx] = Tiles.make('boss');
      Render.syncCell(idx); Render.cellPulse(idx, 'tide-warn', 700);
      if (grow) { e.anchorsMax++; e.anchorsLeft++; }
      else e.anchorsLeft = Math.min(e.anchorsMax, e.anchorsLeft + 1);
      Render.hudSoon();
      return true;
    },
    // Titiritero (JF-ε): ¿este tipo de icono está enhebrado? (lo consulta Render.syncCell)
    isThreaded(v) { const e = this.enc; return !!(e && e.threads && (e.threads[0] === v || e.threads[1] === v)); },
    // Converger un tipo enhebrado CURA al Titiritero 1 ancla — inversión mental (§4.2).
    // Counterplay: juega los tipos libres; purga los marcados con objetos (no convergen).
    onThreadedConverge(conv) {
      const e = this.enc; if (!e || !e.threads || e.anchorsLeft >= e.anchorsMax) return;
      const hit = conv.some((j) => { const v = State.board[j]; return v === e.threads[0] || v === e.threads[1]; });
      if (!hit) return;
      if (this._regrow(e)) {
        Toasts.event(I18n.t('surv_boss_heal').replace('{b}', this.name(e.id)), 'bad', 1500, '🎭');
        Sound.danger();
      }
    },
    // Agrieta blindaje de ancla o jaula por adyacencia/bomba (JF-02).
    crackAt(j) {
      const t = State.tiles[j]; if (!t) return;
      if (t.type === 'boss' && (t.hits || 0) > 0) {
        t.hits--;
        if (t.hits <= 0) { t.hits = 0; t.solid = false; } // expuesta: ya se puede golpear
        Render.setTile(j); Sound.tap();
        FX.burst(j, '#d6dce8', 8);
        if (t.hits <= 0) {
          Toasts.event(I18n.t('surv_armored_broken'), 'good', 1400, '🛡️');
        }
        return;
      }
      if (t.type === 'cage') {
        t.hits = (t.hits || 1) - 1;
        if (t.hits > 0) { Render.setTile(j); Sound.tap(); return; }
        const loot = t.loot;
        State.tiles[j] = null; Render.syncCell(j); FX.burst(j, '#ffd84d', 6);
        if (loot) { Survival.inv[loot] = (Survival.inv[loot] || 0) + 1; Survival.buildBar(); }
        Sound.eliminate(1); Haptics.tap();
      }
    },
    _setResolveFace(e, outcome) {
      const defeat = outcome === 'defeat' || outcome === 'miniKill';
      const def = (e.kind === 'mini' ? this.MINIDEX[e.id] : this.DEX[e.id]) || {};
      const name = e.kind === 'mini' ? this.miniName(e.id) : this.name(e.id);
      this.face = {
        id: e.id, lvl: e.lvl, kind: e.kind || 'boss', phase: e.phase,
        anchorsMax: e.anchorsMax,
        anchorsLeft: defeat ? 0 : Math.max(0, e.anchorsLeft || 0),
        resolved: outcome,
        resolveLabel: (defeat ? I18n.t('surv_boss_defeated') : I18n.t('surv_boss_retreat')).replace('{b}', name),
        resolveUntil: performance.now() + this.RESOLVE_FACE_MS,
        attackEvery: e.attackEvery || (def.attackMs || 12000),
        atkAcc: 0,
        telegraphed: false,
      };

      const resCard = $('#surv-boss-result');
      if (resCard) {
        resCard.classList.add('resolved');
        resCard.classList.toggle('defeated', defeat);
        resCard.classList.toggle('retreating', !defeat);
      }
      const iconEl = $('#surv-boss-result-icon');
      if (iconEl) {
        iconEl.textContent = defeat ? (def.icon || '👑') : '💨';
      }
      const titleEl = $('#surv-boss-result-title');
      if (titleEl) {
        titleEl.textContent = defeat
          ? I18n.t('surv_boss_defeated').replace('{b}', '').trim()
          : I18n.t('surv_boss_retreat').replace('{b}', '').trim();
      }
      const nameEl = $('#surv-boss-result-name');
      if (nameEl) {
        nameEl.textContent = name + (e.lvl > 1 ? ' · Niv. ' + e.lvl : '');
      }
      const eb = $('#surv-boss');
      if (eb) eb.classList.add('resolved');
      Survival.render();
    },
    resolve(outcome) {
      const e = this.enc; if (!e) return;
      if (e.kind === 'boss') e.rewardSource = Render.bossRewardSourcePoint();
      this.enc = null;
      // Las anclas restantes se retiran con el jefe (en derrota ya no quedan).
      this._anchorIdx().forEach((i) => { State.tiles[i] = null; Render.syncCell(i); });
      // Minijefes: sin bendición ni beat grande — botín pequeño al cazarlo, o se
      // marcha solo (el Heraldo que escapa EMPODERA al jefe entrante, §4.3).
      if (e.kind === 'mini') {
        if (outcome === 'miniKill') this._miniKill(e);
        else if (e.id === 'herald') {
          this._heraldEmpower = true;
          Toasts.event(I18n.t('mini_herald_up'), 'bad', 2000, '📯');
        } else {
          Toasts.event(I18n.t('mini_gone').replace('{b}', this.miniName(e.id)), 'info', 1300, (this.MINIDEX[e.id] || {}).icon);
        }
        this._faceOff();
        Survival.render();
        return;
      }
      if (outcome === 'defeat') this._defeatEffect(e);
      if (outcome === 'retreat') {
        const def = this.DEX[e.id] || {};
        Toasts.event(I18n.t('surv_boss_retreat').replace('{b}', this.name(e.id)), 'info', 1400, def.icon);
      }
      if (e.threads) Render.syncAll(); // despinta los hilos del Titiritero (enc ya es null)
      this._setResolveFace(e, outcome);
      Survival._encounterEnd(e, outcome);
    },
    // Efecto-firma de derrota (JF-γ, §4.1): cada Señor deja un regalo al caer —
    // la kill se SIENTE en el tablero, no solo en el toast.
    _defeatEffect(e) {
      const cleared = [];
      // Presupuesto de limpieza (B-J1): los regalos de derrota NUNCA dejan el tablero
      // por debajo de 8 iconos — sin esto alimentaban el bonus de tablero vacío y el
      // refill, inflando monedas +18% y score +63% (medido en el A/B del sim).
      let budget = Math.max(0, (State.iconCount || 0) - 8);
      const clearOne = (idx) => {
        if (State.board[idx] === null) { Survival._powerClear(idx, cleared, 4); return; } // solo tile: no gasta presupuesto
        if (budget > 0 && Survival._powerClear(idx, cleared, 4)) budget--;
      };
      if (e.id === 'meteor') {
        // El cielo escampa: limpia ~12% de los iconos (con suelo de 8).
        const f = []; for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null) f.push(i);
        const n = Math.max(2, Math.floor(f.length * 0.12));
        for (let k = 0; k < n && f.length && budget > 0; k++) clearOne(f.splice(rand(f.length), 1)[0]);
      } else if (e.id === 'tide') {
        // La marea se retira: vacía las filas exteriores (con suelo de 8 iconos).
        const size = State.size;
        [0, size - 1].forEach((r) => { for (let c = 0; c < size && budget > 0; c++) clearOne(r * size + c); });
      } else if (e.id === 'frost') {
        // Deshielo total +25 de suministro.
        for (let i = 0; i < State.tiles.length; i++) {
          const t = State.tiles[i];
          if (t && t.type === 'frozen') { State.tiles[i] = null; cleared.push(i); Render.iceBreak(i); }
        }
        Survival.addSupplyCharge(25);
      } else if (e.id === 'lockdown') {
        // Las jaulas se abren: devuelve exactamente lo enjaulado; no duplica stock.
        let returned = 0;
        for (let i = 0; i < State.tiles.length; i++) {
          const t = State.tiles[i];
          if (t && t.type === 'cage') {
            if (t.loot) { Survival.inv[t.loot] = (Survival.inv[t.loot] || 0) + 1; returned++; }
            State.tiles[i] = null; cleared.push(i);
          }
        }
        if (!returned) Survival.addSupplyCharge(25);
        Survival.buildBar();
      } else if (e.id === 'quake') {
        // El mundo se ordena: agrupa el tipo más común en un clúster central (regalo de combo).
        this._clusterGift();
      } else if (e.id === 'crystalid') {
        // Estallido: todos los cristales del tablero puntúan y desaparecen.
        for (let i = 0; i < State.tiles.length; i++) {
          const t = State.tiles[i];
          if (t && t.type === 'crystal') {
            State.score += GameCore.ready() ? GameCore.core.CRYSTAL_POINTS : 50;
            State.tiles[i] = null; cleared.push(i);
          }
        }
        Render.bump($('#hud-score'));
      } else if (e.id === 'void') {
        // Colapsa: devuelve TODO lo devorado agrupado junto al centro (cascada servida).
        const size = State.size, spots = [];
        for (let i = 0; i < State.board.length; i++) if (State.board[i] === null && !State.tiles[i]) spots.push(i);
        const dist = (i) => { const r = (i / size | 0), c = i % size; return Math.abs(r - 3.5) + Math.abs(c - 3.5); };
        spots.sort((a, b) => dist(a) - dist(b));
        (e.devoured || []).forEach((v) => { const j = spots.shift(); if (j != null) { State.board[j] = v; State.iconCount++; Render.spawnAnim(j); } });
        if ((e.devoured || []).length) Render.syncAll();
      } else if (e.id === 'puppeteer') {
        // Corta los hilos: los tipos enhebrados se liberan (limpieza con suelo).
        const th = e.threads || [];
        for (let i = 0; i < State.board.length && budget > 0; i++) {
          if (th.includes(State.board[i]) && !State.tiles[i]) clearOne(i);
        }
      }
      if (cleared.length) { Render.syncAll(); Render.lifeClear(cleared, null); }
      if (State.status === 'playing') Game.evaluate();
    },
    // Regalo del Tectónico: mueve hasta 8 iconos del tipo más común hacia el centro
    // (intercambios puros: el conteo del tablero no cambia). FLIP como el terremoto.
    _clusterGift() {
      const size = State.size, counts = {};
      for (let i = 0; i < State.board.length; i++) { const v = State.board[i]; if (v !== null && !State.tiles[i]) counts[v] = (counts[v] || 0) + 1; }
      let best = null; for (const k in counts) if (!best || counts[k] > counts[best]) best = k;
      if (!best || counts[best] < 3) return;
      const srcs = [], spots = [];
      for (let i = 0; i < State.board.length; i++) {
        if (State.tiles[i]) continue;
        if (State.board[i] === best) srcs.push(i);
        spots.push(i);
      }
      const dist = (i) => { const r = (i / size | 0), c = i % size; return Math.abs(r - 3.5) + Math.abs(c - 3.5); };
      spots.sort((a, b) => dist(a) - dist(b));
      const dests = spots.slice(0, Math.min(8, srcs.length));
      const destSet = new Set(dests);
      const pending = srcs.filter((s) => !destSet.has(s));
      const srcOf = {};
      let pi = 0;
      for (const d of dests) {
        if (State.board[d] === best) continue;
        const s = pending[pi++]; if (s == null) break;
        const tmp = State.board[d];
        State.board[d] = State.board[s]; State.board[s] = tmp;
        srcOf[d] = s; if (tmp !== null) srcOf[s] = d;
      }
      Render.syncAll();
      if (!motionOff()) Render.quakeSlide(srcOf);
    },
    abort() {
      if (this.enc) {
        const th = !!this.enc.threads;
        this.enc = null;
        this._anchorIdx().forEach((i) => { State.tiles[i] = null; Render.syncCell(i); });
        if (th) Render.syncAll();
      }
      this.face = null;
      this._faceOff();
    },
    // Apaga la presencia visual del jefe (banner, tinte del panel, acento global).
    _faceOff() {
      this.face = null;
      document.documentElement.style.removeProperty('--boss-accent');
      Survival.render();
    },
    // ---- Ataques (JF-α: plomería con números provisionales; JF-γ los somete a B-J3).
    // Todos siguen el patrón de la marea (GM-20): objetivos elegidos al telegrafiar,
    // pre-marcados TELEGRAPH_MS antes, ejecutados con lock breve. Counterplay: la
    // ventana entre ataques es para golpear anclas (§2 P3).
    _pickTargets(e) {
      const def = this.DEX[e.id], size = State.size;
      const kind = def.atk;
      if (kind === 'rain') {
        const n = Math.min(1 + e.lvl + (e.phase > 1 ? 1 : 0), 6);
        const empt = Engine.emptyCells(), out = [];
        for (let k = 0; k < n && empt.length; k++) out.push(empt.splice(rand(empt.length), 1)[0]);
        return out;
      }
      if (kind === 'tide') {
        const set = new Set();
        const rows = e.phase > 1 ? [0, size - 1] : [RNG.random() < 0.5 ? 0 : size - 1];
        rows.forEach((r) => { for (let c = 0; c < size; c++) set.add(r * size + c); });
        if (e.phase > 1) [0, size - 1].forEach((c) => { for (let r = 0; r < size; r++) set.add(r * size + c); });
        return [...set].filter((j) => State.board[j] === null && !State.tiles[j]);
      }
      if (kind === 'frost') {
        // Fase 2 (JF-γ): clúster 2×2 compacto — roba movilidad local, no dispersa.
        if (e.phase > 1) {
          const room = Survival._specialRoom();
          const starts = [];
          for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
            const b = [r * size + c, r * size + c + 1, (r + 1) * size + c, (r + 1) * size + c + 1];
            if (b.every((j) => State.board[j] !== null && !State.tiles[j])) starts.push(b);
          }
          if (starts.length && room >= 4) return starts[rand(starts.length)];
        }
        const f = Survival._filledIdx(), out = [];
        const n = Math.min(1 + e.lvl + (e.phase > 1 ? 1 : 0), f.length, Survival._specialRoom());
        for (let k = 0; k < n && f.length; k++) out.push(f.splice(rand(f.length), 1)[0]);
        return out;
      }
      if (kind === 'locks') {
        const em = Survival._emptyIdx();
        const room = Math.min(Survival._specialRoom(), Math.max(0, Survival._blockCap() - Survival._blockIdx().length));
        const n = Math.min(e.phase > 1 ? 3 : 2, em.length, room);
        const out = [];
        for (let k = 0; k < n && em.length; k++) out.push(em.splice(rand(em.length), 1)[0]);
        return out;
      }
      if (kind === 'shuffle') {
        if (e.phase > 1) return null; // terremoto total: el aviso es de tablero, no de celdas
        const r1 = rand(size); let r2 = rand(size); if (r2 === r1) r2 = (r1 + 1) % size;
        const out = [];
        [r1, r2].forEach((r) => { for (let c = 0; c < size; c++) out.push(r * size + c); });
        return out;
      }
      if (kind === 'shards') {
        // Esquirlas: 2-3 spawns + 1 cristal (puntúa al romperse, pero ocupa).
        const n = Math.min(2 + (e.phase > 1 ? 1 : 0), 4);
        const empt = Engine.emptyCells(), out = [];
        for (let k = 0; k < n && empt.length; k++) out.push(empt.splice(rand(empt.length), 1)[0]);
        return out;
      }
      if (kind === 'devour') {
        // El Vacío devora 1 icono ortogonalmente adyacente a cada ancla.
        const out = new Set();
        this._anchorIdx().forEach((a) => {
          const r = a / size | 0, c = a % size;
          const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
            .filter(([rr, cc]) => rr >= 0 && cc >= 0 && rr < size && cc < size)
            .map(([rr, cc]) => rr * size + cc)
            .filter((j) => State.board[j] !== null && !State.tiles[j]);
          if (nb.length) out.add(nb[rand(nb.length)]);
        });
        return [...out];
      }
      return null; // threads: marca por TIPO, no por celda (el ataque hace syncAll)
    },
    _attack(e) {
      const def = this.DEX[e.id], kind = def.atk;
      const targets = e.targets; e.targets = null;
      Survival._lock(kind === 'shuffle' ? 1150 : 760, def.frame);
      if (kind === 'rain') {
        const placed = [];
        (targets || []).forEach((j) => {
          if (State.board[j] === null && !State.tiles[j]) { State.board[j] = State.pool[rand(State.pool.length)]; State.iconCount++; placed.push(j); }
        });
        // Fase 2 (JF-γ): el impacto deja 1 roca en el centro de la zona marcada.
        if (e.phase > 1 && placed.length) {
          const room = Math.min(Survival._specialRoom(), Math.max(0, Survival._blockCap() - Survival._blockIdx().length));
          if (room > 0) {
            const mid = placed[placed.length >> 1];
            State.board[mid] = null; State.iconCount--;
            const rk = Tiles.make('rock'); rk.hits = 1; State.tiles[mid] = rk;
          }
        }
        Render.syncAll(); if (placed.length) Render.meteor(placed);
        Feedback.event('meteor', { enraged: e.lvl >= 3 });
      } else if (kind === 'tide') {
        let filled = 0;
        (targets || []).forEach((j) => {
          if (State.board[j] === null && !State.tiles[j]) { State.board[j] = State.pool[rand(State.pool.length)]; State.iconCount++; filled++; Render.syncCell(j); Render.cellPulse(j, 'tide-fill', 600); }
        });
        if (filled) Render.hudSoon();
        Feedback.event('tide', { enraged: e.phase > 1 });
      } else if (kind === 'frost') {
        const placed = [];
        (targets || []).forEach((j) => {
          if (State.board[j] !== null && !State.tiles[j]) { State.tiles[j] = Tiles.make('frozen'); placed.push(j); }
        });
        Render.syncAll(); placed.forEach((i) => Render.iceHit(i));
        Feedback.event('frost', { enraged: e.lvl >= 3 });
      } else if (kind === 'locks') {
        // Fase 2 (JF-γ): la JAULA — el Cerrajero roba 1 potenciador del inventario
        // de este intento y lo
        // enjaula en el tablero; romper la jaula por adyacencia lo devuelve. Sin
        // inventario que robar, cae en el cierre normal (candados).
        let caged = false;
        if (e.phase > 1) caged = this._cageSteal(targets);
        if (!caged) {
          const placed = [];
          (targets || []).forEach((j) => {
            if (State.board[j] === null && !State.tiles[j]) { const tl = Tiles.make('locked'); tl.hits = e.phase > 1 ? 2 : 1; State.tiles[j] = tl; placed.push(j); }
          });
          Render.syncAll(); placed.forEach((i) => Render.cellPulse(i, 'lock-stamp', 520));
        }
        Feedback.event('lockdown');
      } else if (kind === 'shards') {
        // Cristálido: esquirlas — spawns + 1 cristal normal (ocupa, pero puntúa).
        const placed = [];
        (targets || []).forEach((j) => {
          if (State.board[j] === null && !State.tiles[j]) { State.board[j] = State.pool[rand(State.pool.length)]; State.iconCount++; placed.push(j); }
        });
        const f2 = Survival._filledIdx();
        if (f2.length && State.tiles.filter((t) => t && t.type === 'crystal').length < 4) {
          State.tiles[f2[rand(f2.length)]] = Tiles.make('crystal');
        }
        Render.syncAll(); if (placed.length) Render.meteor(placed);
        Feedback.event('frost', { msg: I18n.t('surv_boss_shards'), icon: '💠' });
      } else if (kind === 'devour') {
        // El Vacío: se TRAGA los iconos marcados (los guarda; los devuelve al caer).
        (targets || []).forEach((j) => {
          if (State.board[j] !== null && !State.tiles[j]) {
            e.devoured.push(State.board[j]);
            State.board[j] = null; State.iconCount--;
            Render.syncCell(j); FX.burst(j, '#a06bff', 5);
          }
        });
        // Fase 2: CRECE — brota un ancla nueva (cap growCap): empeora si lo ignoras.
        if (e.phase > 1 && e.anchorsMax < (def.growCap || 4)) {
          if (this._regrow(e, true)) Toasts.event(I18n.t('surv_boss_grow'), 'bad', 1600, '🕳️');
        }
        Feedback.event('lockdown', { msg: I18n.t('surv_boss_devour').replace('{n}', (targets || []).length), icon: '🕳️' });
      } else if (kind === 'threads') {
        // Titiritero: enhebra 2 TIPOS — convergerlos LE CURA; los demás le dañan.
        const present = [...new Set(State.board.filter((v, i) => v !== null && !State.tiles[i]))];
        if (present.length >= 2) {
          const a = present.splice(rand(present.length), 1)[0];
          const b = present.splice(rand(present.length), 1)[0];
          e.threads = [a, b];
          Render.syncAll(); // pinta .threaded en las celdas de esos tipos
        }
        // Fase 2: además 1 candado en el patrón.
        if (e.phase > 1) {
          const room = Math.min(Survival._specialRoom(), Math.max(0, Survival._blockCap() - Survival._blockIdx().length));
          const em = Survival._emptyIdx();
          if (room > 0 && em.length) { const tl = Tiles.make('locked'); tl.hits = 1; State.tiles[em[rand(em.length)]] = tl; Render.syncAll(); }
        }
        Feedback.event('quake', { msg: I18n.t('surv_boss_threads'), icon: '🎭', snd: 'lockdown', hap: 'clank' });
      } else if (kind === 'shuffle') {
        if (e.phase > 1) {
          // Fase 2 (JF-γ): terremoto total + 2 rocas donde asiente el polvo.
          Survival._shuffle(true);
          const room = Math.min(Survival._specialRoom(), Math.max(0, Survival._blockCap() - Survival._blockIdx().length), 2);
          const em = Survival._emptyIdx();
          for (let k = 0; k < room && em.length; k++) {
            const j = em.splice(rand(em.length), 1)[0];
            const rk = Tiles.make('rock'); rk.hits = 1; State.tiles[j] = rk;
          }
          if (room > 0) Render.syncAll();
        } else this._shuffleCells(targets);
        Feedback.event('quake');
        Render.boardEvent('surv-quake-settle', 420);
      }
      if (State.status === 'playing') Game.evaluate();
    },
    // La Jaula del Cerrajero (JF-γ): roba 1 potenciador aleatorio del inventario
    // de este intento y lo
    // planta como tile `cage` (hits=1, romper por adyacencia lo devuelve — ver
    // crackAt). Devuelve false si no hay nada que robar o dónde plantarla.
    _cageSteal(targets) {
      const ids = Survival.BOOSTERS.filter((id) => Survival.boosterAvailable(id) > 0);
      if (!ids.length) return false;
      const spot = (targets || []).find((j) => State.board[j] === null && !State.tiles[j]);
      const em = spot != null ? spot : (Survival._emptyIdx()[0]);
      if (em == null) return false;
      if (Survival._specialRoom() <= 0) return false;
      const id = ids[rand(ids.length)];
      if (!Survival._spendBooster(id)) return false;
      const cg = Tiles.make('cage'); cg.hits = 1; cg.loot = id;
      State.tiles[em] = cg;
      Survival.buildBar();
      Render.syncAll(); Render.cellPulse(em, 'lock-stamp', 620);
      const pname = ({ freeze: 'Hielo', wild: 'Barrido', x2: 'Doble' }[id]) || Boosters.DEFS[id].name;
      Toasts.event(I18n.t('surv_boss_cage_steal').replace('{b}', this.name('lockdown')).replace('{p}', pname), 'bad', 2000, '🔒');
      return true;
    },
    // Terremoto parcial: baraja solo los iconos de las celdas indicadas (2 filas).
    _shuffleCells(cells) {
      const idx = (cells || []).filter((i) => State.board[i] !== null && !State.tiles[i]);
      const n = idx.length; if (n < 2) return;
      const oldVals = idx.map((p) => State.board[p]);
      const perm = idx.map((_, k) => k);
      for (let i = n - 1; i > 0; i--) { const j = rand(i + 1); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
      const srcOf = {};
      idx.forEach((dest, k) => { State.board[dest] = oldVals[perm[k]]; srcOf[dest] = idx[perm[k]]; });
      Render.syncAll();
      if (!motionOff()) Render.quakeSlide(srcOf);
    },
  };

  /* ===================== Worlds (modo Clásico: mundos × niveles) =====================
   * Datos de los 5 mundos del mockup + render del mapa serpenteante (nodos 1..50 con
   * estrellas/candados, cofre de recompensa, novedades) y panel de mundos. Cada nivel
   * se lanza como una partida 'clasico' que reutiliza los obstáculos de Adventure
   * (Classic.setup) escalando por mundo y número de nivel.
   */
  const Worlds = {
    PER_WORLD: 50,
    REWARD_EVERY: 50,            // cofre de recompensa al completar el mundo
    LIST: [
      {
        id: 'bosque', name: 'Bosque Verde', glyph: '🌲', accent: '#3ad07f', mods: ['chains'],
        nov: [['⛓️', 'Cadenas', 'Toca la figura 2 veces para liberarla'], ['➕', 'Bonus +30', 'Tócalo para puntos extra'], ['🎯', 'Nuevos objetivos', 'Alcanza la meta en cada nivel']]
      },
      {
        id: 'desierto', name: 'Desierto Dorado', glyph: '🏜️', accent: '#ffb24d', mods: ['rocks'],
        nov: [['🪨', 'Rocas', 'Estorban y no convergen'], ['☀️', 'Calor', 'El tablero se llena más rápido'], ['💰', 'Tesoros', 'Más monedas por combo']]
      },
      {
        id: 'montana', name: 'Montaña Helada', glyph: '🏔️', accent: '#7ad7ff', mods: ['ice', 'web'],
        nov: [['🧊', 'Hielo', 'Casillas heladas: tócalas para romperlas'], ['🕸️', 'Telaraña', 'Toca 2 veces para liberar'], ['🎯', 'Objetivos', 'Despeja el tablero helado']]
      },
      {
        id: 'cueva', name: 'Cueva Misteriosa', glyph: '🔮', accent: '#a06bff', mods: ['crystals', 'portal', 'barrier'],
        nov: [['💎', 'Cristales', 'Valen puntos extra'], ['🌀', 'Portales', 'Teletransportan figuras'], ['🚧', 'Barreras', 'Sólo objetos especiales las quitan']]
      },
      {
        id: 'neon', name: 'Ciudad Neón', glyph: '🏙️', accent: '#ff5cf0', mods: ['rush', 'bomb', 'magicbox'],
        nov: [['⚡', 'Sobrecarga', 'Los iconos aparecen más rápido'], ['💣', 'Bomba oculta', 'Detona figuras cercanas'], ['🎁', 'Caja mágica', 'Libera figuras cercanas']]
      },
    ],
    sel: 'bosque',
    idx(wid) { return this.LIST.findIndex(w => w.id === wid); },
    get(wid) { return this.LIST.find(w => w.id === wid) || this.LIST[0]; },
    // Desbloqueo de mundo: el primero siempre; el resto al limpiar >=25 niveles del previo.
    unlocked(wid) {
      const i = this.idx(wid); if (i <= 0) return true;
      return Meta.worldCleared(this.LIST[i - 1].id) >= 25;
    },
    // Desbloqueo de nivel: el 1 siempre; el resto si el anterior tiene >=1 estrella.
    levelUnlocked(wid, n) { return n <= 1 || Meta.levelStars(wid, n - 1) > 0; },
    rewardClaimed(wid) { return !!(Meta.worldData(wid).reward); },
    open() {
      if (!this.unlocked(this.sel)) this.sel = 'bosque';
      this.render(); Screens.show('worlds'); Econ.refresh();
    },
    starsRow(n) { return iconInline('star').repeat(n) + iconInline('star-empty').repeat(3 - n); },
    render() {
      const w = this.get(this.sel);
      const root = document.documentElement; root.style.setProperty('--world-accent', w.accent);
      // Cabecera del mundo
      const stars = Meta.worldStars(this.sel), maxStars = this.PER_WORLD * 3;
      { const t = $('#world-name'); if (t) t.textContent = w.name; }
      { const g = $('#world-glyph'); if (g) g.innerHTML = WORLD_IMG[w.id] ? iconAnyInline(WORLD_IMG[w.id]) : w.glyph; }
      { const s = $('#world-stars'); if (s) s.innerHTML = `${iconInline('star')} ${stars}/${maxStars}`; }
      // Mapa de niveles (serpenteante: filas de 5, alternas)
      const map = $('#world-map'); if (map) {
        const cur = Meta.worldMaxLevel(this.sel);
        let html = '';
        for (let n = 1; n <= this.PER_WORLD; n++) {
          const unlocked = this.levelUnlocked(this.sel, n);
          const st = Meta.levelStars(this.sel, n);
          const isCur = n === cur && unlocked && st === 0;
          const cls = `lvl-node${unlocked ? '' : ' locked'}${isCur ? ' current' : ''}${st > 0 ? ' done' : ''}`;
          html += `<button type="button" class="${cls}" data-lvl="${n}" ${unlocked ? '' : 'aria-disabled="true"'} aria-label="Nivel ${n}">
            <span class="ln-num">${unlocked ? n : iconInline('lock')}</span>
            <span class="ln-stars" aria-hidden="true">${st > 0 ? this.starsRow(st) : ''}</span>
          </button>`;
        }
        // Nodo de recompensa del mundo (al final)
        const rc = Meta.worldCleared(this.sel) >= this.PER_WORLD;
        html += `<button type="button" class="lvl-reward${rc && !this.rewardClaimed(this.sel) ? ' ready' : ''}" data-reward="1" aria-label="Recompensa del mundo">${iconInline('crown')}</button>`;
        map.innerHTML = html;
      }
      // Novedades del mundo
      const nov = $('#world-nov'); if (nov) {
        nov.innerHTML = w.nov.map(([ic, t, d]) => `<div class="nov-item"><span class="nov-ic">${emojiIcon(ic)}</span><div class="nov-tx"><b>${esc(t)}</b><small>${esc(d)}</small></div></div>`).join('');
      }
      // Panel lateral de mundos
      const rail = $('#world-rail'); if (rail) {
        rail.innerHTML = this.LIST.map((x, i) => {
          const unl = this.unlocked(x.id);
          const cleared = Meta.worldCleared(x.id);
          return `<button type="button" class="wr-item${x.id === this.sel ? ' sel' : ''}${unl ? '' : ' locked'}" data-world="${x.id}" style="--wa:${x.accent}" ${unl ? '' : 'aria-disabled="true"'}>
            <span class="wr-glyph">${WORLD_IMG[x.id] ? iconAnyInline(WORLD_IMG[x.id]) : x.glyph}</span>
            <span class="wr-tx"><b>${i + 1} · ${esc(x.name)}</b><small>${unl ? iconInline('star') + ' ' + cleared + '/' + this.PER_WORLD : iconInline('lock') + ' Bloqueado'}</small></span>
          </button>`;
        }).join('');
      }
      this.wire();
    },
    wire() {
      const map = $('#world-map');
      if (map && !map._wired) {
        map._wired = true;
        map.addEventListener('click', (e) => {
          const node = e.target.closest('.lvl-node'); const rew = e.target.closest('.lvl-reward');
          if (node) {
            const n = +node.dataset.lvl;
            if (!this.levelUnlocked(this.sel, n)) { Sound.tap(); Toasts.show(I18n.t('locked_level'), 'warn', 1300); return; }
            Sound.ui(); PreLevel.open(this.sel, n);
          } else if (rew) { this.claimReward(); }
        });
      }
      const rail = $('#world-rail');
      if (rail && !rail._wired) {
        rail._wired = true;
        rail.addEventListener('click', (e) => {
          const it = e.target.closest('.wr-item'); if (!it) return;
          const id = it.dataset.world;
          if (!this.unlocked(id)) { Sound.tap(); Toasts.show(I18n.t('locked_world'), 'warn', 1500); return; }
          Sound.ui(); this.sel = id; this.render(); Econ.refresh();
        });
      }
    },
    claimReward() {
      const cleared = Meta.worldCleared(this.sel) >= this.PER_WORLD;
      if (!cleared) { Toasts.show(I18n.t('reward_locked'), 'warn', 1600); return; }
      if (this.rewardClaimed(this.sel)) { Toasts.show(I18n.t('reward_claimed'), 'info', 1400); return; }
      Meta.worldData(this.sel).reward = today2();
      Meta.addChest(1, 'royal', 'world'); Meta.addGems(20);
      Toasts.show(I18n.t('reward_got'), 'good', 2200, '👑');
      Sound.milestone(); FX.confetti(80); Econ.refresh(); this.render();
    },
    // Llamado por Game al completar un nivel Clásico: guarda estrellas y desbloqueos.
    recordLevel(stars) {
      Meta.setLevelStars(State.world, State.worldLevel, stars);
    },
  };
  // Fecha corta reutilizable (Meta usa una privada; aquí una equivalente para Worlds).
  function today2() { return new Date().toISOString().slice(0, 10); }

  /* ===================== Classic (setup de nivel del modo Clásico) =====================
   * Reutiliza los colocadores de obstáculos de Adventure escalando por mundo (bioma)
   * y número de nivel. Objetivo: vaciar el tablero (regla por defecto de Game).
   */
  const Classic = {
    _onEmpty(type, k) {
      const e = []; for (let i = 0; i < State.board.length; i++) if (State.board[i] === null && !State.tiles[i]) e.push(i);
      for (let x = 0; x < k && e.length; x++) State.tiles[e.splice(rand(e.length), 1)[0]] = Tiles.make(type);
    },
    _onFilled(type, k, init) {
      const f = []; for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null && !State.tiles[i]) f.push(i);
      for (let x = 0; x < k && f.length; x++) { const j = f.splice(rand(f.length), 1)[0]; const t = Tiles.make(type); if (init) init(t); State.tiles[j] = t; }
    },
    // setupLevel ya fijó pool/spawn y colocó iconos iniciales desde State.level (= n).
    // Aqui anadimos los obstaculos y objetos especiales propios del mundo; los tableros de tienda no alteran reglas.
    setup() {
      const w = Worlds.get(State.world), wi = Worlds.idx(State.world), n = State.worldLevel || 1;
      const dens = Math.min(0.13, 0.015 + n * 0.0021 + wi * 0.008);
      const k = (base) => base + Math.floor(n / 12);   // escala suave con el nivel
      (w.mods || []).forEach((mod) => {
        if (mod === 'rocks') Adventure._placeOnEmpty('rock', dens);
        else if (mod === 'ice') Adventure._placeFrozen(dens);
        else if (mod === 'crystals') Adventure._placeCrystals(2 + Math.min(8, Math.floor(n / 6)));
        else if (mod === 'chains') this._onFilled('chains', k(1));
        else if (mod === 'web') this._onFilled('web', k(1));
        else if (mod === 'barrier') this._onEmpty('barrier', k(1));
        else if (mod === 'portal') this._onEmpty('portal', 1);
        else if (mod === 'magicbox') this._onEmpty('magicbox', 1);
        else if (mod === 'bomb') this._onEmpty('bomb', 1);
        else if (mod === 'rush') State.spawnRate = Math.max(420, Math.round(State.spawnRate * 0.85));
      });
      if (n >= 2 && RNG.random() < 0.6) this._onEmpty('bonus', 1);
      Render.syncAll();
    },
  };

  /* ===================== Rules (hooks por modo) =====================
   * Punto de extensión: un modo puede definir funciones (onSetupLevel, onTick,
   * onActivate, winCheck, loseCheck, objective...) en su descriptor de Config.MODES
   * y Game/Loop las invocan si existen. Sin hooks => comportamiento clásico.
   */
  const Rules = {
    call(name, ctx) {
      const mode = Config.MODES[State.mode];
      const fn = mode && mode[name];
      return typeof fn === 'function' ? fn(ctx) : undefined;
    },
  };

  /* ===================== ModeSignals (identidad emocional por modo) =====================
   * Capa fina de feedback: no cambia reglas ni economía, solo hace más legible qué
   * persigue cada modo y qué debería intentar el jugador en la siguiente partida.
   */
  const ModeSignals = {
    classes: Config.MODE_ORDER.map((k) => 'mode-' + k).concat(['mode-daily', 'mode-surv', 'mode-timed', 'time-pressure', 'time-critical']),
    clear() {
      document.body.classList.remove(...this.classes);
      State.timePressure = 0;
      const time = $('#hud-time');
      if (time && time.parentElement) time.parentElement.classList.remove('urgent');
    },
    apply(mode) {
      this.clear();
      const m = Config.MODES[mode];
      if (!m) return;
      document.body.classList.add('mode-' + mode);
      document.documentElement.style.setProperty('--mode-accent', m.accent || 'var(--accent-2)');
    },
    markDaily(on) { document.body.classList.toggle('mode-daily', !!on); },
    icon(mode) {
      const key = MODE_IMG[mode];
      return key ? iconAnyInline(key) : esc((Config.MODES[mode] && Config.MODES[mode].emoji) || '');
    },
    dailyMedalIcon(medal) {
      return medal === 'gold' ? '🥇' : medal === 'silver' ? '🥈' : medal === 'bronze' ? '🥉' : '🎯';
    },
    dailyMedalLabel(medal) { return I18n.t('daily_medal_' + (medal || 'none')); },
    dailyNextMedalInfo(score = State.score) {
      const next = Meta.dailyNextMedal(score);
      if (!next) return null;
      const idx = Meta.DAILY_MEDALS.indexOf(next);
      const medal = ['bronze', 'silver', 'gold'][idx] || 'gold';
      return { threshold: next, medal, icon: this.dailyMedalIcon(medal), label: this.dailyMedalLabel(medal) };
    },
    dailyNoteText(score = State.score) {
      const next = this.dailyNextMedalInfo(score);
      if (!next) return I18n.t('daily_medal_max');
      return I18n.t('daily_note_next').replace('{m}', next.icon).replace('{n}', next.threshold);
    },
    noteText(mode) {
      if (mode === 'clasico') {
        const streak = Meta.classicPerfectStreak();
        return streak > 0 ? I18n.t('mode_note_clasico_streak').replace('{n}', streak) : I18n.t('mode_note_clasico');
      }
      if (mode === 'aventura') {
        const bi = Adventure.biomeOf(State.level);
        const mod = Adventure.biomeModText(bi) || Adventure.previewObjective(State.level);
        return I18n.t('mode_note_aventura').replace('{m}', mod);
      }
      if (mode === 'contrarreloj') return State.isDaily ? this.dailyNoteText() : I18n.t('mode_note_contrarreloj');
      if (mode === 'zen') {
        const fl = Meta.zenFlowers();
        return I18n.t('mode_note_zen') + (fl > 0 ? ' · 🌸 ' + fl : '');
      }
      return '';
    },
    noteHtml(mode) {
      const text = this.noteText(mode || State.mode);
      const daily = (mode || State.mode) === 'contrarreloj' && State.isDaily;
      return text ? `<span class="obj-mode-note"${daily ? ' id="daily-note"' : ''}>${esc(text)}</span>` : '';
    },
    brief(mode) {
      if (mode === 'tutorial') return false;
      const key = 'mode_brief_' + mode;
      const msg = I18n.t(key);
      if (!msg || msg === key) return false;
      const m = Config.MODES[mode] || {};
      return Toasts.event({
        key: `mode-start-${mode}-${State.seed}`,
        kicker: I18n.modeT(mode, 'name'),
        title: msg,
        icon: MODE_IMG[mode] || m.emoji,
        kind: 'info', priority: 68, ms: 2200,
      });
    },
    resultHtml() {
      const key = 'result_focus_' + State.mode;
      const msg = I18n.t(key);
      if (!msg || msg === key) return '';
      return `<div class="mode-result-note">${this.icon(State.mode)} <span>${esc(msg)}</span></div>`;
    },
    dailyResultHtml(result) {
      if (!State.isDaily || !result) return '';
      const medal = result.medal || 'none';
      const next = Meta.dailyNextMedal(State.score);
      const medalLine = I18n.t('daily_medal_result').replace('{m}', this.dailyMedalLabel(medal));
      const nextLine = next ? `<small>${esc(I18n.t('daily_next_medal').replace('{n}', next))}</small>` : '';
      const mut = State.dailyMut || DailyMut.pick(new Date().toISOString().slice(0, 10));
      const lesson = DailyMut.lesson(mut);
      const practice = I18n.t('daily_practice_cta').replace('{mode}', I18n.modeT(lesson.mode, 'name'));
      return `<div class="daily-medal-result medal-${medal}"><strong>${esc(medalLine)}</strong>${nextLine}</div><div class="daily-practice"><span><small>${esc(I18n.t('daily_learning_label'))}</small><b>${esc(I18n.t(lesson.skill))}</b></span><button type="button" class="btn btn-ghost btn-sm" data-act="daily-practice" data-mode="${lesson.mode}">${esc(practice)}</button></div>`;
    },
  };

  const NextActions = {
    mainModes: ['clasico', 'aventura', 'contrarreloj', 'supervivencia', 'zen'],
    shopGoal() {
      const coins = Meta.coins();
      const goals = [];
      if (typeof Boards !== 'undefined') {
        Boards.order.forEach((id) => {
          const b = Boards.DEFS[id];
          if (b && !Meta.ownsBoard(id) && b.cost > 0) goals.push({ name: b.name, cost: b.cost, kind: 'board' });
        });
      }
      if (typeof Themes !== 'undefined') {
        Themes.order.forEach((id) => {
          const t = Themes.DEFS[id];
          if (t && !Meta.owns(id) && t.cost > 0) goals.push({ name: t.name, cost: t.cost, kind: 'theme' });
        });
      }
      goals.sort((a, b) => a.cost - b.cost);
      const goal = goals[0];
      return goal ? Object.assign(goal, { have: coins, ready: coins >= goal.cost, left: Math.max(0, goal.cost - coins) }) : null;
    },
    variety() {
      const played = this.mainModes.filter((k) => Meta.modePlays(k) > 0);
      return { played: played.length, total: this.mainModes.length, left: this.mainModes.length - played.length };
    },
    progressRow(iconName, label, value, current, target, act) {
      const pct = target > 0 ? clamp(current / target * 100, 0, 100) : 0;
      const body = `<span class="npr-ic">${iconAnyInline(iconName)}</span><span class="npr-main"><span class="npr-top"><b>${esc(label)}</b><small>${esc(value)}</small></span><span class="npr-bar"><span style="width:${pct.toFixed(0)}%"></span></span></span>`;
      return act ? `<button class="next-progress-row" data-act="${act}" type="button">${body}</button>` : `<div class="next-progress-row">${body}</div>`;
    },
    progressHtml() {
      const rows = [];
      const dm = Meta.dailyMission(), wk = Meta.weeklyChallenge();
      const dCur = dm.done ? dm.target : Math.min(dm.progress || 0, dm.target || 1);
      const wCur = wk.done ? wk.target : Math.min(wk.progress || 0, wk.target || 1);
      rows.push(this.progressRow('target', I18n.t('progress_daily'), dm.done ? I18n.t('progress_ready') : `${dCur}/${dm.target}`, dCur, dm.target || 1, 'open-missions'));
      rows.push(this.progressRow('calendar', I18n.t('progress_weekly'), wk.done ? I18n.t('progress_ready') : `${wCur}/${wk.target}`, wCur, wk.target || 1, 'open-missions'));
      const variety = this.variety();
      rows.push(this.progressRow('medal', I18n.t('progress_variety'), variety.left <= 0 ? I18n.t('progress_ready') : I18n.t('progress_modes_left').replace('{n}', variety.left), variety.played, variety.total, variety.left > 0 ? 'go-play' : 'profile'));
      const dailyChoice = Meta.dailyChoiceChests().find((entry) => entry.state === 'ready');
      if (dailyChoice) rows.push(this.progressRow('chest', I18n.t('daily_choice_title'), I18n.t('daily_choice_ready'), 1, 1, 'open-daily-choice'));
      if (Meta.chests() > 0) rows.push(this.progressRow('chest', I18n.t('progress_chests'), I18n.t('progress_ready') + ' · ' + Meta.chests(), 1, 1, 'open-chests'));
      const shop = this.shopGoal();
      if (shop) rows.push(this.progressRow('cart', I18n.t('progress_cosmetic'), shop.ready ? I18n.t('progress_ready') : I18n.t('progress_left').replace('{n}', shop.left), Math.min(shop.have, shop.cost), shop.cost, 'open-shop'));
      return `<div class="next-progress"><h3>${esc(I18n.t('progress_title'))}</h3>${rows.slice(0, 4).join('')}</div>`;
    },
    recommendation(ctx = {}) {
      const dm = Meta.dailyMission(), wk = Meta.weeklyChallenge();
      const dailyChoice = Meta.dailyChoiceChests().find((entry) => entry.state === 'ready');
      if (dailyChoice) return { icon: 'chest', title: I18n.t('daily_choice_title'), sub: I18n.t('daily_choice_ready'), act: 'open-daily-choice' };
      if (Meta.chests() > 0) return { icon: 'chest', title: I18n.t('next_open_chest'), sub: I18n.t('next_open_chest_sub'), act: 'open-chests' };
      if (ctx.missionDone || ctx.weeklyDone || dm.done || wk.done || (!dm.done && Meta.tickets() > 0)) return { icon: 'target', title: I18n.t('next_missions'), sub: I18n.t('next_missions_sub'), act: 'open-missions' };
      if (State.isDaily && Meta.dailyMedal(State.score) !== 'gold') return { icon: 'medal', title: I18n.t('next_daily'), sub: I18n.t('next_daily_sub'), act: 'go-daily' };
      const shop = this.shopGoal();
      if (shop && shop.ready) return { icon: 'cart', title: I18n.t('next_shop'), sub: I18n.t('next_shop_sub'), act: 'open-shop' };
      if (State.mode === 'clasico') return { icon: 'pin', title: I18n.t('next_classic'), sub: I18n.t('next_classic_sub'), act: 'go-classic' };
      if (State.mode === 'aventura') return { icon: 'rocket', title: I18n.t('next_adventure'), sub: I18n.t('next_adventure_sub'), act: 'go-adventure' };
      if (State.mode === 'supervivencia') return { icon: 'heart', title: I18n.t('next_surv'), sub: I18n.t('next_surv_sub'), act: 'go-surv' };
      const variety = this.variety();
      if (variety.left > 0) return { icon: 'target', title: I18n.t('next_modes'), sub: I18n.t('next_modes_sub'), act: 'go-play' };
      return { icon: MODE_IMG[State.mode] || 'v2:play', title: I18n.t('next_modes'), sub: I18n.t('next_modes_sub'), act: 'go-play' };
    },
    html(ctx) {
      const r = this.recommendation(ctx);
      const card = `<div class="next-card"><span class="next-card-ic">${iconAnyInline(r.icon)}</span><span class="next-card-copy"><b>${esc(I18n.t('next_title'))}: ${esc(r.title)}</b><small>${esc(r.sub)}</small></span><button class="btn btn-primary btn-sm" data-act="${r.act}">${esc(r.title)}</button></div>`;
      return card + this.progressHtml();
    },
  };

  /* ===================== Picker (elección en partida) =====================
   * Overlay único de "elige 1 de N" reutilizado por las bendiciones post-jefe
   * (Supervivencia), las rutas de capítulo y reliquias (Aventura), el continuar
   * con gemas (Clásico/Aventura) y el ritmo de Zen. Pausa suave mientras se
   * decide y restaura el estado al elegir/cancelar. La elección es el latido
   * de agencia de la Fase GM-γ: una decisión significativa por sesión y modo.
   */
  const Picker = {
    pending: null, _wasPlaying: false, _returnFocus: null,
    open({ title, sub, accent, options, cancelLabel, onPick, onCancel, safeDelayMs }) {
      const ov = $('#pick-overlay');
      if (!ov) { if (options && options[0] && onPick) onPick(options[0].id); return; }
      this._returnFocus = document.activeElement || null;
      this.pending = { options, onPick, onCancel };
      this._wasPlaying = State.status === 'playing';
      if (this._wasPlaying) {
        if (State.mode === 'supervivencia') Survival.pauseClock();
        State.status = 'paused'; Toasts.pause();
      }
      ov.style.setProperty('--pick-accent', accent || 'var(--accent-2)');
      { const t = $('#pick-title'); if (t) t.textContent = title || ''; }
      { const s = $('#pick-sub'); if (s) { s.hidden = !sub; s.textContent = sub || ''; } }
      {
        const box = $('#pick-options'); if (box) box.innerHTML = (options || []).map((o) => `
        <button class="pick-opt ${o.rarity ? 'rarity-' + o.rarity : ''}" data-pick="${esc(o.id)}" type="button">
          <span class="po-ic" aria-hidden="true">${o.icon || ''}</span>
          <span class="po-tx"><b>${esc(o.name)}</b><small>${esc(o.desc || '')}</small></span>
        </button>`).join('');
      }
      if (safeDelayMs) {
        ov.classList.add('safe-delay-active');
        setTimeout(() => { if (this.pending) ov.classList.remove('safe-delay-active'); }, safeDelayMs);
      } else {
        ov.classList.remove('safe-delay-active');
      }
      { const cb = $('#pick-cancel'); if (cb) { cb.hidden = !cancelLabel; cb.textContent = cancelLabel || ''; } }
      this._wire(ov);
      ov.hidden = false;
      const focusFirst = () => {
        if (!this.pending || ov.hidden) return;
        const first = ov.querySelector('.pick-opt') || ov.querySelector('#pick-cancel');
        if (first && first.focus) first.focus();
      };
      if (window.requestAnimationFrame) window.requestAnimationFrame(focusFirst); else setTimeout(focusFirst, 0);
      announce(title || '');
    },
    _wire(ov) {
      if (ov._wired) return; ov._wired = true;
      ov.addEventListener('click', (e) => {
        const opt = e.target.closest && e.target.closest('[data-pick]');
        if (opt) { Sound.ui(); this.pick(opt.dataset.pick); return; }
        if (e.target.closest && e.target.closest('#pick-cancel')) { Sound.ui(); this.cancel(); }
      });
      ov.addEventListener('keydown', (e) => {
        if (!this.pending) return;
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation(); this.cancel(); return;
        }
        if (e.key !== 'Tab') return;
        const focusable = Array.from(ov.querySelectorAll('button')).filter((button) => !button.hidden && !button.disabled);
        if (!focusable.length) { e.preventDefault(); return; }
        const first = focusable[0], last = focusable[focusable.length - 1], active = document.activeElement;
        if (e.shiftKey && (active === first || !ov.contains(active))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      });
    },
    pick(id) {
      const p = this.pending; if (!p) return;
      this._close(false);
      try { if (p.onPick) p.onPick(id); }
      finally { this._restoreFocus(); }
    },
    cancel() {
      const p = this.pending; if (!p) return;
      this._close(false);
      try { if (p.onCancel) p.onCancel(); }
      finally { this._restoreFocus(); }
    },
    // B-06: cierre DEFENSIVO sin callbacks ni cambios de status — para fin de
    // partida/salida externa con una elección abierta (hoy ninguna ruta legítima
    // lo provoca, pero cualquier feature futura que llame gameOver()/quit() con
    // un Picker pendiente dejaría el overlay pegado sobre el menú).
    dismiss() {
      this.pending = null; this._wasPlaying = false; this._returnFocus = null;
      const ov = $('#pick-overlay'); if (ov) ov.hidden = true;
    },
    _restoreFocus() {
      const previous = this._returnFocus; this._returnFocus = null;
      const hiddenAncestor = previous && previous.closest && previous.closest('[hidden]');
      if (previous && previous.focus && previous.isConnected !== false && !hiddenAncestor) { previous.focus(); return; }
      const fallback = ['#btn-open-premium', '#btn-open-chest', '#btn-chest-catalog', '#btn-pause', '#nav-home']
        .map((selector) => $(selector))
        .find((element) => element && element.focus && !element.hidden && !element.disabled
          && !(element.closest && element.closest('[hidden]')));
      if (fallback) fallback.focus();
    },
    _close(restoreFocus) {
      const ov = $('#pick-overlay'); if (ov) ov.hidden = true;
      this.pending = null;
      if (restoreFocus !== false) this._restoreFocus();
      if (this._wasPlaying && State.status === 'paused') {
        if (State.mode === 'supervivencia') Survival.resumeClock();
        State.status = 'playing'; Toasts.resume(); Loop.kick();
      }
      this._wasPlaying = false;
    },
  };

  /* ===================== PreLevel (lanzador de nivel de Clásico, GM-03) =====================
   * Desde el 2º mundo, tocar un nivel abre una hoja con hasta 2 potenciadores
   * comprables con monedas (bomba 80 / congelar 60 / rayo 90 — los costes
   * históricos de Boosters.DEFS). Decisión estratégica pre-nivel + sumidero de
   * monedas permanente. Son consumibles POR INTENTO: reintentar no los devuelve
   * (estándar del género). El mundo 1 arranca directo (cero fricción al aprender).
   */
  const PreLevel = {
    world: null, n: 1, sel: {},
    open(worldId, n) {
      const ov = $('#prelevel');
      if (!ov || Worlds.idx(worldId) < Config.PRELEVEL_FROM_WORLD) { Game.startClassic(worldId, n); return; }
      this.world = worldId; this.n = n; this.sel = {};
      { const t = $('#pl-title'); if (t) t.textContent = `${I18n.t('lvl')} ${n} · ${Worlds.get(worldId).name}`; }
      this._render();
      this._wire(ov);
      ov.style.setProperty('--pick-accent', Worlds.get(worldId).accent);
      ov.hidden = false;
      if (!Storage.preboostSeen) { Storage.preboostSeen = '1'; Toasts.show(I18n.t('pl_first'), 'info', 3400, '💡'); }
    },
    _selIds() { return Object.keys(this.sel).filter((id) => this.sel[id]); },
    _selCost() {
      const quote = Meta.quoteBoosterLoadout(this._selIds(), Config.PRELEVEL_MAX);
      return quote ? quote.coinCost : Infinity;
    },
    _render() {
      const box = $('#pl-items'); if (!box) return;
      box.innerHTML = Object.keys(Config.PRELEVEL_BOOSTERS).map((id) => {
        const d = Boosters.DEFS[id], cost = Config.PRELEVEL_BOOSTERS[id], on = !!this.sel[id], stock = Meta.boosterCount(id);
        const price = stock > 0 ? I18n.t('booster_stock').replace('{n}', stock) : `${iconInline('coin')} ${cost}`;
        return `<button type="button" class="pl-chip${on ? ' on' : ''}${stock > 0 ? ' has-stock' : ''}" data-pl="${id}" aria-pressed="${on}">
          <span class="po-ic" aria-hidden="true">${BOOSTER_IMG[id] ? iconAnyInline(BOOSTER_IMG[id]) : d.glyph}</span>
          <span class="po-tx"><b>${esc(d.name)}</b><small>${price}</small></span>
        </button>`;
      }).join('');
      const play = $('#pl-play');
      if (play) {
        const cost = this._selCost();
        play.textContent = cost > 0 ? I18n.t('pl_play_cost').replace('{c}', cost) : I18n.t('pl_play');
        play.disabled = cost > Meta.coins();
      }
    },
    toggle(id) {
      if (this.sel[id]) this.sel[id] = false;
      else {
        if (this._selIds().length >= Config.PRELEVEL_MAX) { Toasts.show(I18n.t('pl_max').replace('{n}', Config.PRELEVEL_MAX), 'warn', 1300); return; }
        this.sel[id] = true;
      }
      Sound.ui();
      this._render();
    },
    _wire(ov) {
      if (ov._wired) return; ov._wired = true;
      ov.addEventListener('click', (e) => {
        const chip = e.target.closest && e.target.closest('[data-pl]');
        if (chip) { this.toggle(chip.dataset.pl); return; }
        if (e.target.closest && e.target.closest('#pl-play')) this._start(true);
        else if (e.target.closest && e.target.closest('#pl-skip')) this._start(false);
      });
    },
    _start(withBoosters) {
      const ov = $('#prelevel');
      const picked = withBoosters ? this._selIds() : [];
      const quote = Meta.commitBoosterLoadout(picked, Config.PRELEVEL_MAX);
      if (!quote) { Toasts.show(I18n.t('pl_no_coins'), 'warn', 1500); return; }
      if (quote.coinCost > 0 || quote.stock.length) Econ.refresh();
      if (ov) ov.hidden = true;
      Sound.ui();
      Game.startClassic(this.world, this.n);
      // El inventario se fija DESPUÉS de start() (que lo limpia para no-Supervivencia).
      if (picked.length) {
        Survival.inv = {};
        picked.forEach((id) => { Survival.inv[id] = 1; });
        Survival.buildBar();
        const bb = $('#booster-bar'); if (bb) bb.hidden = false;
      }
    },
  };

  /* ===================== DailyMut (mutador del Reto del día, GM-15) =====================
   * La fecha elige (hash determinista, sin servidor) 1 de 8 variantes del tablero
   * diario: cada día tiene tema, conversación y screenshot distintos, y el reto
   * sigue siendo idéntico para todos. Se aplican tras montar el nivel (consumen
   * RNG seedeado ⇒ mismas posiciones para todo el mundo). Las medallas no cambian:
   * unos días son más duros que otros, como un crucigrama.
   */
  const DailyMut = {
    LIST: ['pure', 'ice', 'window', 'variety', 'rocks', 'fast', 'crystal', 'nohints'],
    LESSONS: {
      pure: { skill: 'daily_skill_pure', mode: 'clasico' },
      ice: { skill: 'daily_skill_ice', mode: 'aventura' },
      window: { skill: 'daily_skill_window', mode: 'contrarreloj' },
      variety: { skill: 'daily_skill_variety', mode: 'clasico' },
      rocks: { skill: 'daily_skill_rocks', mode: 'aventura' },
      fast: { skill: 'daily_skill_fast', mode: 'contrarreloj' },
      crystal: { skill: 'daily_skill_crystal', mode: 'aventura' },
      nohints: { skill: 'daily_skill_nohints', mode: 'clasico' },
    },
    pick(dateStr) { return this.LIST[hash32('mut:' + dateStr) % this.LIST.length]; },
    lesson(id) { return this.LESSONS[id] || this.LESSONS.pure; },
    apply(id) {
      if (id === 'ice') this._onFilled('frozen', 4);
      else if (id === 'window') State.comboWindow = Math.max(1500, State.comboWindow - 500);
      else if (id === 'variety') State.pool = Engine.poolForLevel(7); // ventana de 6 iconos
      else if (id === 'rocks') this._onEmpty('rock', 3);
      else if (id === 'fast') State.mutFast = true; // doSpawn acelera la curva un 10%
      else if (id === 'crystal') this._onFilled('crystal', 2);
      else if (id === 'nohints') { State.hintsLeft = 0; Render.hud(); }
      if (id !== 'pure') Render.syncAll();
    },
    _onEmpty(type, k) {
      const e = []; for (let i = 0; i < State.board.length; i++) if (State.board[i] === null && !State.tiles[i]) e.push(i);
      for (let x = 0; x < k && e.length; x++) State.tiles[e.splice(rand(e.length), 1)[0]] = Tiles.make(type);
    },
    _onFilled(type, k) {
      const f = []; for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null && !State.tiles[i]) f.push(i);
      for (let x = 0; x < k && f.length; x++) State.tiles[f.splice(rand(f.length), 1)[0]] = Tiles.make(type);
    },
  };

  /* ===================== PWA (instalable + offline + actualización) ===================== */
  const PWA = {
    deferredPrompt: null,
    init() {
      const btn = $('#btn-install');
      if (Platform.isNative) {
        this.deferredPrompt = null;
        if (btn) btn.hidden = true;
        return;
      }
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('sw.js').then((reg) => {
            reg.addEventListener('updatefound', () => {
              const nw = reg.installing; if (!nw) return;
              nw.addEventListener('statechange', () => {
                if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                  showUpdateBanner(reg);
                }
              });
            });
          }).catch((e) => ErrLog.push('sw', e && e.message));
        });
      }

      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      if (btn && !isStandalone) btn.hidden = false;

      // Captura del prompt de instalación para ofrecer "Instalar" en el menú.
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); this.deferredPrompt = e;
        if (btn) btn.hidden = false;
      });
      window.addEventListener('appinstalled', () => {
        this.deferredPrompt = null; if (btn) btn.hidden = true;
      });
    },
    promptInstall() {
      if (Platform.isNative) return;
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        this.deferredPrompt.userChoice.finally(() => {
          this.deferredPrompt = null;
          const btn = $('#btn-install'); if (btn) btn.hidden = true;
        });
      } else {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS) {
          Toasts.show('Para instalar: toca Compartir y "Añadir a inicio"', 'info', 4500, 'v2:share');
        } else {
          Toasts.show('Instala desde el menú de opciones del navegador (⋮)', 'info', 4500);
        }
      }
    },
  };

  /* ===================== Share (tarjeta de resultado + Web Share API) =====================
   * Genera una imagen (canvas fuera del DOM -> blob, sin riesgo de compositing) y la
   * comparte con navigator.share; si no hay soporte, descarga la imagen.
   */
  const Share = {
    card() {
      const W = 600, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(W / 2, H * 0.34, 30, W / 2, H * 0.4, W);
      g.addColorStop(0, '#1a2a5e'); g.addColorStop(1, '#070b1c'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.textAlign = 'center';
      // Deco: 4 figuras del juego
      const C = ['#ff5b6e', '#4b8bff', '#3ad07f', '#ffd23f'];
      C.forEach((col, i) => { x.fillStyle = col; x.beginPath(); x.arc(150 + i * 100, 90, 16, 0, 6.283); x.fill(); });
      x.fillStyle = '#eaf0ff'; x.font = '800 52px system-ui,-apple-system,sans-serif'; x.fillText('Convergencia', W / 2, 185);
      x.fillStyle = '#9fb0e0'; x.font = '600 26px system-ui,sans-serif'; x.fillText('Modo ' + Config.MODES[State.mode].name, W / 2, 228);
      x.fillStyle = '#18e6e6'; x.font = '900 150px system-ui,sans-serif'; x.fillText(String(State.score), W / 2, 380);
      x.fillStyle = '#9fb0e0'; x.font = '600 28px system-ui,sans-serif'; x.fillText('PUNTOS', W / 2, 420);
      x.fillStyle = '#ffd84d'; x.font = '800 36px system-ui,sans-serif'; x.fillText('Combo ×' + State.maxCombo + '  ·  ' + Meta.rank(), W / 2, 490);
      x.fillStyle = '#6c7bff'; x.font = '600 26px system-ui,sans-serif'; x.fillText('¿Puedes superarlo?', W / 2, 545);
      return new Promise((res) => c.toBlob(res, 'image/png'));
    },
    async go() {
      try {
        const blob = await this.card();
        const text = `¡${State.score} puntos en Convergencia (${Config.MODES[State.mode].name})! Combo ×${State.maxCombo}. ¿Puedes superarlo?`;
        // Duelo por semilla: en modos de puntuación el enlace reproduce EXACTAMENTE
        // el mismo tablero (misma semilla → mismos spawns) para retar al receptor.
        const url = Config.MODES[State.mode].scoreAttack && State.seed != null
          ? `${location.origin}${location.pathname}?challenge=${encodeURIComponent(State.seed)}` : undefined;
        if (await Platform.share({ text, title: 'Convergencia', url })) return;
        const file = blob ? new File([blob], 'convergencia.png', { type: 'image/png' }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, title: 'Convergencia', url }); return; }
        if (navigator.share) { await navigator.share({ text, title: 'Convergencia', url }); return; }
        if (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'convergencia.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); Toasts.show('Imagen guardada 📥', 'good', 1800); }
      } catch (e) { if (e && e.name === 'AbortError') return; ErrLog.push('share', e && e.message); Toasts.show('No se pudo compartir', 'warn', 1800); }
    },
  };

  /* ===================== Coach (tutorial interactivo, coach-marks) =====================
   * Secuencia guiada con tableros deterministas: el jugador realiza sus primeras
   * convergencias reales (mismo motor/feedback) con una casilla resaltada y texto.
   * Se auto-lanza en el primer arranque y es rejugable desde "¿Cómo se juega?".
   */
  const Coach = {
    active: false, step: 0, targets: [], tIdx: 0,
    STEPS: [
      {
        textKey: 'coach1',
        build() { State.board[26] = 'circle_red'; State.board[28] = 'circle_red'; State.iconCount = 2; return 27; }
      },
      {
        textKey: 'coach2',
        build() { State.board[19] = 'star_yellow'; State.board[35] = 'star_yellow'; State.board[26] = 'star_yellow'; State.board[28] = 'star_yellow'; State.iconCount = 4; return 27; }
      },
      // Paso 3: dos parejas independientes (fila 1 y fila 6, sin columnas compartidas para
      // que no se crucen las líneas de visión); encadenarlas rápido enseña la ventana de combo.
      {
        textKey: 'coach3',
        build() { State.board[10] = 'circle_red'; State.board[12] = 'circle_red'; State.board[53] = 'circle_red'; State.board[55] = 'circle_red'; State.iconCount = 4; return [11, 54]; }
      },
    ],
    start() {
      this.active = true; this.step = 0; this.targets = []; this.tIdx = 0;
      Loop.stop(); Music.stop(true);
      State.mode = 'tutorial'; State.diff = 'facil'; State.level = 1;
      // HUD-T1: el tutorial debe tener el HUD más limpio del juego. `mode-tutorial`
      // oculta wallet/score/objetivo/combo/ocupación/toolbelt vía CSS (styles.css),
      // dejando solo pausa + tablero + coach.
      ModeSignals.apply('tutorial');
      State.comboWindow = Config.DIFFICULTY.facil.comboWindow; // para que el paso 3 encadene combo
      State.score = 0; State.displayScore = 0; State.combo = 0; State.comboMult = 1; State.comboAt = 0;
      State.maxCombo = 0; State.removedTotal = 0; State.mistakes = 0; State.elapsed = 0; State.timeLeft = 0;
      State.fever = false; State.recordHit = false;
      Render.fever(false); Render.danger(0);
      Game.ended = false; State.status = 'playing';
      Screens.show('game'); FX.resize();
      { const c = $('#coach'); if (c) c.hidden = false; }
      { const pl = $('#coach-play'); if (pl) pl.hidden = true; }
      { const sk = $('#coach-skip'); if (sk) { sk.hidden = false; sk.textContent = I18n.t('coach_skip'); } }
      this._render();
    },
    _clearHint() { const t = this.targets[this.tIdx]; if (t != null && t >= 0) Render.hint([t], false); },
    _render() {
      const s = this.STEPS[this.step];
      State.board = new Array(State.size * State.size).fill(null);
      State.tiles = new Array(State.size * State.size).fill(null);
      State.iconCount = 0; State.combo = 0; State.comboMult = 1;
      const r = s.build();
      this.targets = Array.isArray(r) ? r : [r];
      this.tIdx = 0;
      State.displayScore = State.score;
      Render.syncAll(); Render.combo(); Render.hud();
      Render.hint([this.targets[0]], true);
      { const st = $('#coach-step'); if (st) st.textContent = I18n.t('coach_step').replace('{n}', this.step + 1).replace('{t}', this.STEPS.length); }
      $('#coach-text').textContent = I18n.t(s.textKey);
    },
    notify() {
      if (!this.active) return;
      this._clearHint();
      this.tIdx++;
      // ¿Quedan más objetivos en este paso? (encadenar dentro de la ventana de combo)
      if (this.tIdx < this.targets.length) {
        const nx = this.targets[this.tIdx];
        setTimeout(() => { if (this.active) Render.hint([nx], true); }, 220);
        return;
      }
      this.step++;
      if (this.step >= this.STEPS.length) { setTimeout(() => this.finish(), 950); return; }
      setTimeout(() => { State.displayScore = State.score; this._render(); }, 800);
    },
    // Fin del tutorial: en vez de soltar al jugador en el menú, ofrecer arrancar ya en
    // el nivel 1 de Clásico (arranque dirigido) o ir al menú.
    finish() {
      if (!this.active) return;
      this.active = false;
      this._clearHint();
      State.status = 'idle'; Game.ended = true;
      Storage.tutorialDone = true;
      Sound.success();
      { const st = $('#coach-step'); if (st) st.textContent = ''; }
      { const ct = $('#coach-text'); if (ct) ct.textContent = I18n.t('coach_done'); }
      { const pl = $('#coach-play'); if (pl) { pl.hidden = false; pl.textContent = I18n.t('coach_play1'); } }
      { const sk = $('#coach-skip'); if (sk) sk.textContent = I18n.t('coach_menu'); }
    },
    // CTA "Jugar nivel 1": lanza Clásico mundo 1, nivel 1.
    play1() {
      { const c = $('#coach'); if (c) c.hidden = true; }
      { const pl = $('#coach-play'); if (pl) pl.hidden = true; }
      { const sk = $('#coach-skip'); if (sk) sk.textContent = I18n.t('coach_skip'); }
      Game.startClassic(Worlds.LIST[0].id, 1);
    },
    // Saltar (durante los pasos) o "Ir al menú" (al terminar): cerrar y volver al inicio.
    skip() {
      this.active = false;
      this._clearHint();
      { const c = $('#coach'); if (c) c.hidden = true; }
      { const st = $('#coach-step'); if (st) st.textContent = ''; }
      { const pl = $('#coach-play'); if (pl) pl.hidden = true; }
      { const sk = $('#coach-skip'); if (sk) sk.textContent = I18n.t('coach_skip'); }
      // HUD-T1: al volver al menú, retirar el HUD-limpio del tutorial.
      ModeSignals.clear();
      State.status = 'idle'; Game.ended = true; Storage.tutorialDone = true;
      showHome(Storage.lastMode || 'clasico');
    },
  };

  /* ===================== BossCoach (tutorial interactivo de jefes) ===================== */
  const BossCoach = {
    KEY: 'cv_bosstut_flags',
    active: false,
    _wasPlaying: false,
    _onCloseCb: null,
    _returnFocus: null,
    CONTENT: {
      boss_intro: { icons: ['◆', '✦'] },
      boss_armored: { icons: ['✣', '💣'] },
      boss_phase2: { icons: ['⚡', '⌖'] },
      boss_boons: { icons: [] },
    },
    _getFlags() {
      try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch (_) { return {}; }
    },
    hasSeen(key) {
      return !!this._getFlags()[key];
    },
    markSeen(key) {
      try {
        const f = this._getFlags();
        f[key] = true;
        localStorage.setItem(this.KEY, JSON.stringify(f));
      } catch (_) {}
    },
    check(key, icon, onCloseCb) {
      if (this.hasSeen(key)) return false;
      this.markSeen(key);
      this.show(key, icon, onCloseCb);
      return true;
    },
    show(key, icon, onCloseCb) {
      const el = $('#boss-coach'); if (!el) return;
      const content = this.CONTENT[key] || this.CONTENT.boss_intro;
      const titleEl = $('#boss-coach-title');
      const textEl = $('#boss-coach-text');
      const iconEl = $('#boss-coach-icon');
      if (titleEl) titleEl.textContent = I18n.t('bosstut_' + key + '_title');
      if (textEl) textEl.textContent = I18n.t('bosstut_' + key + '_body');
      if (iconEl) iconEl.textContent = (icon && !String(icon).startsWith('v2:')) ? icon : '👑';

      const isBoons = key === 'boss_boons';
      el.dataset.tutorial = key.replace(/^boss_/, '');
      el.setAttribute('aria-labelledby', isBoons ? 'boss-coach-boons-title' : 'boss-coach-title');
      el.setAttribute('aria-describedby', isBoons ? 'boss-coach-boons-text' : 'boss-coach-text');
      const standardEl = el.querySelector('.boss-coach-standard');
      const boonsEl = el.querySelector('.boss-coach-boons');
      if (standardEl) standardEl.setAttribute('aria-hidden', isBoons ? 'true' : 'false');
      if (boonsEl) boonsEl.setAttribute('aria-hidden', isBoons ? 'false' : 'true');

      if (isBoons) {
        const boonsTitle = $('#boss-coach-boons-title');
        const boonsText = $('#boss-coach-boons-text');
        const boonsTip = $('#boss-coach-boons-tip');
        if (boonsTitle) boonsTitle.textContent = I18n.t('bosstut_boss_boons_title');
        if (boonsText) boonsText.textContent = I18n.t('bosstut_boss_boons_body');
        if (boonsTip) boonsTip.textContent = I18n.t('bosstut_boss_boons_tip');
      } else {
        const prefix = 'bosstut_' + key;
        const assignments = [
          ['boss-coach-details-label', prefix + '_panel'],
          ['boss-coach-detail-title-1', prefix + '_detail1_title'],
          ['boss-coach-detail-text-1', prefix + '_detail1_body'],
          ['boss-coach-detail-title-2', prefix + '_detail2_title'],
          ['boss-coach-detail-text-2', prefix + '_detail2_body'],
          ['boss-coach-tip-title', prefix + '_tip_title'],
          ['boss-coach-tip-text', prefix + '_tip_body'],
        ];
        assignments.forEach(([id, i18nKey]) => {
          const node = $('#' + id);
          if (node) node.textContent = I18n.t(i18nKey);
        });
        content.icons.forEach((detailIcon, idx) => {
          const node = $('#boss-coach-detail-icon-' + (idx + 1));
          if (node) node.textContent = detailIcon;
        });
      }

      if (!this.active) {
        this._returnFocus = document.activeElement || null;
        this._wasPlaying = (State.status === 'playing');
        if (this._wasPlaying) {
          State.status = 'paused';
          Toasts.pause();
        }
      }
      this.active = true;
      this._onCloseCb = typeof onCloseCb === 'function' ? onCloseCb : null;
      el.hidden = false;

      const okBtn = $('#boss-coach-ok');
      if (okBtn) {
        if (!okBtn._bossCoachWired) {
          okBtn._bossCoachWired = true;
          okBtn.addEventListener('click', () => this.accept());
        }
        const focusOk = () => { if (this.active && okBtn.focus) okBtn.focus(); };
        if (window.requestAnimationFrame) window.requestAnimationFrame(focusOk); else setTimeout(focusOk, 0);
      }
    },
    accept() {
      const onCloseCb = this._onCloseCb;
      this._onCloseCb = null;
      this.hide();
      if (typeof onCloseCb === 'function') onCloseCb();
    },
    hide() {
      const el = $('#boss-coach'); if (el) el.hidden = true;
      if (this.active && this._wasPlaying && State.status === 'paused') {
        State.status = 'playing';
        Toasts.resume();
        Loop.last = performance.now();
        Loop.kick();
      }
      const returnFocus = this._returnFocus;
      this.active = false;
      this._wasPlaying = false;
      this._onCloseCb = null;
      this._returnFocus = null;
      if (returnFocus && returnFocus.focus) {
        try { returnFocus.focus(); } catch (_) {}
      }
    },
  };

  /* ===================== Gobernador de rendimiento (Perf, QP-2 P1) =====================
   * Degradación POR CAPAS con histéresis, en vez de perder frames a lo bruto. Loop.tick le
   * pasa cada frame el EMA del tiempo de frame (ms) y el dt; Perf decide un "nivel":
   *   0 = todo · 1 = sin ambientales de tablero (tope 28) · 2 = sin pulsos de tiles y popups
   *   sin escala (tope 18). El nivel se aplica con una clase en <body> (perf-1 / perf-2) ->
   *   el corte de animaciones es CSS puro (styles.css). Subir de nivel (peor) exige el umbral
   *   SOSTENIDO 2s; bajar (mejor) exige 10s buenos: nunca oscila. En móvil de alta densidad
   *   arranca en nivel 1 hasta acumular EMA bueno (evita el primer minuto tartamudo). */
  const Perf = {
    level: 0,
    CAP: [50, 28, 18],            // techo de partículas (FX.cap) por nivel
    UP: [20, 26],                 // EMA(ms) para subir a nivel 1 / a nivel 2
    GOOD: 16,                     // EMA(ms) considerado "bueno" (para bajar de nivel)
    UP_MS: 2000, DOWN_MS: 10000,  // ms sostenidos requeridos para subir / bajar
    FLOOR: 12,                    // tope mínimo de partículas
    FLOOR_HOLD: 700,              // ms que se mantiene un suelo PREDICTIVO antes de soltarlo (anti-parpadeo)
    SPIKE_MS: 55,                 // un frame por encima de esto = pico real (B3)
    SPIKE_UP: 120,                // ms de picos acumulados (con decaimiento) para escalar de nivel
    _badMs: 0, _goodMs: 0, _l2Ms: 0, _spikeMs: 0, _bootGuard: false, suggested: false,
    // Grupo B · B1 (RS-13): el nivel REACTIVO (this.level, histéresis por EMA) y el suelo
    // PREDICTIVO (this._floor, señal del modo) son independientes. El nivel EFECTIVO que se
    // pinta en <body> y acota FX.cap es el máximo de ambos (this.applied lo memoiza).
    _floor: 0, _floorHoldUntil: 0, applied: -1,
    init() {
      try { this.suggested = localStorage.getItem('cv_perf_suggested') === '1'; } catch (_) { }
      // RS-7 (docs/RENDER_STABILITY_PLAN.md): arranque conservador NO solo en iOS Pro (dpr≥3).
      // Las tablets Android de alta densidad (p. ej. Xiaomi Mi Pad 7) tienen menos margen de
      // memoria de GPU por su resolución altísima: cualquier táctil con dpr≥2 o poca RAM
      // arranca en nivel 1 hasta acumular EMA bueno (se relaja solo a los 5s).
      const touch = (navigator.maxTouchPoints || 0) > 0;
      const dpr = window.devicePixelRatio || 1;
      const lowMem = (navigator.deviceMemory || 8) <= 4;
      const hiDpiTouch = touch && (dpr >= 2 || lowMem);
      this._bootGuard = hiDpiTouch;   // el primer descenso desde el arranque móvil pide solo 5s
      this.level = -1;                // fuerza a apply() a escribir la clase aunque el nivel sea 0
      this.apply(hiDpiTouch ? 1 : 0);
    },
    apply(lvl) {           // fija el nivel REACTIVO (histéresis); el efectivo lo resuelve _render
      this.level = lvl < 0 ? 0 : lvl > 2 ? 2 : lvl;
      this._badMs = 0; this._goodMs = 0; this._spikeMs = 0;
      this._render();
    },
    _effective() { const f = this._floor; return this.level > f ? this.level : f; },
    // Pinta el nivel EFECTIVO (max reactivo/predictivo) en <body> y acota FX.cap a su techo.
    // Solo escribe el DOM cuando el nivel efectivo cambia (this.applied lo memoiza).
    _render() {
      const eff = this._effective();
      if (eff !== this.applied) {
        this.applied = eff;
        const b = document.body && document.body.classList;
        if (b) { b.toggle('perf-1', eff >= 1); b.toggle('perf-2', eff >= 2); }
      }
      const ceil = this.CAP[eff];
      if (FX.cap > ceil) FX.cap = ceil;   // baja YA; el EMA lo re-sube dentro del techo efectivo
    },
    // Grupo B · B1 (RS-13): suelo PREDICTIVO por frame desde la señal del modo (ocupación +
    // eventos activos). Sube al instante; al bajar mantiene el suelo FLOOR_HOLD ms (anti-parpadeo
    // en el límite de ocupación y colita suave al terminar la ráfaga).
    setFloor(f) {
      f = f < 0 ? 0 : f > 2 ? 2 : f;
      const now = performance.now();
      if (f >= this._floor) { this._floor = f; this._floorHoldUntil = now + this.FLOOR_HOLD; }
      else if (now >= this._floorHoldUntil) this._floor = f;
      this._render();
    },
    // Suelta el suelo predictivo de inmediato (arranque/cierre de partida): evita que la clase
    // perf-* quede pegada cuando el loop se detiene tras un game over en plena ráfaga.
    resetFloor() { this._floor = 0; this._floorHoldUntil = 0; this._render(); },
    // Un paso por frame: EMA (ms) y dt (ms) del frame.
    step(ema, dt) {
      const ceil = this.CAP[this._effective()];
      // Tope de partículas DENTRO del techo efectivo (clamp correcto: nunca lo supera — B-08).
      if (ema > 22) { if (FX.cap > this.FLOOR) FX.cap = Math.max(this.FLOOR, FX.cap - 6); }
      else if (ema < 17 && FX.cap < ceil) FX.cap = Math.min(ceil, FX.cap + 3);
      // Acumuladores de histéresis para el nivel REACTIVO (independiente del suelo predictivo).
      if (this.level < 2 && ema > this.UP[this.level]) { this._badMs += dt; this._goodMs = 0; }
      else if (ema < this.GOOD) { this._goodMs += dt; this._badMs = 0; }
      else { this._badMs = 0; this._goodMs = 0; }
      // Grupo B · B3 (RS-13): un frame-pico (dt real alto) es evidencia inmediata de ráfaga, que
      // el EMA (media) tarda en notar. Acumulador PROPIO con decaimiento (independiente de la
      // histéresis del EMA, que se resetea cada frame bueno): un pico aislado (GC) se olvida en
      // ~un frame equivalente; picos encadenados (la ráfaga real) escalan de nivel sin esperar.
      if (dt > this.SPIKE_MS && State.status === 'playing') {
        if (FX.cap > this.FLOOR) FX.cap = Math.max(this.FLOOR, FX.cap - 12); // suelta partículas YA
        this._spikeMs += dt;
        if (this.level < 2 && this._spikeMs >= this.SPIKE_UP) { this._spikeMs = 0; this.apply(this.level + 1); }
      } else if (this._spikeMs > 0) { this._spikeMs = Math.max(0, this._spikeMs - dt); }
      if (FX.cap > ceil) FX.cap = ceil; // invariante dura: el tope jamás rebasa el techo efectivo
      if (this.level < 2 && this._badMs >= this.UP_MS) this.apply(this.level + 1);
      else if (this.level > 0 && this._goodMs >= (this._bootGuard ? 5000 : this.DOWN_MS)) { this._bootGuard = false; this.apply(this.level - 1); }
      // Auto-sugerencia de modo ligero (P1-e): nivel REACTIVO 2 sostenido >30s (no por ráfagas
      // predictivas, que son transitorias), una sola vez por dispositivo.
      if (this.level >= 2) { this._l2Ms += dt; if (this._l2Ms > 30000) this.suggestLight(); }
      else this._l2Ms = 0;
      this._render();
    },
    suggestLight() {
      if (this.suggested) return;
      this.suggested = true;                                   // "toast único": no volver a preguntar
      try { localStorage.setItem('cv_perf_suggested', '1'); } catch (_) { }
      if (Settings.reducedFx) return;
      Toasts.show(I18n.t('perf_suggest'), 'info', 7000, 'aura', () => {
        Settings.reducedFx = true; applyReducedFx(); buildSettings();
        Toasts.show(I18n.t('perf_light_on'), 'good', 2200, 'check');
      });
    },
  };

  /* ===================== Loop (un único requestAnimationFrame) ===================== */
  const Loop = {
    raf: 0, last: 0, spawnAcc: 0, clockAcc: 0, ema: 16,
    start() { this.last = performance.now(); this.spawnAcc = 0; this.clockAcc = 0; cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this.tick); },
    // B1 (RS-13): al detener el loop se suelta el suelo predictivo del gobernador, para que la
    // clase perf-* no quede pegada si la partida acaba (game over/salir) en plena ráfaga.
    stop() { cancelAnimationFrame(this.raf); this.raf = 0; Perf.resetFloor(); },
    // Reinicia el rAF si está parado (para animar celebraciones aunque el juego no corra)
    kick() { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); } },
    tick: (now) => {
      const L = Loop;
      const dt = Math.min(100, now - L.last); L.last = now;

      // Gobernador de rendimiento: EMA del tiempo de frame -> nivel de FX + tope de partículas.
      L.ema += (dt - L.ema) * 0.1;
      Perf.step(L.ema, dt);
      // Grupo B · B1 (RS-13): suelo PREDICTIVO. Supervivencia sabe cuándo va a doler (tablero
      // cargado + jefe/marea/frenesí en curso); alimentamos esa señal al gobernador para degradar
      // por capas DURANTE la ráfaga, no 2s después. Fuera de Supervivencia (o sin ráfaga) es 0.
      if (State.status === 'playing' && State.mode === 'supervivencia') Perf.setFloor(Survival.perfStress());
      else Perf.setFloor(0);
      // C1 (RS-14): si el backend de canvas está activo, avanza/redibuja la capa única de
      // partículas (no-op inmediato si la bandera está OFF, que es el caso por defecto).
      if (FX.useCanvas) FX.stepCanvas(dt);

      if (State.status === 'playing') {
        L.clockAcc += dt;
        if (L.clockAcc >= 1000) {
          const secs = Math.floor(L.clockAcc / 1000); L.clockAcc -= secs * 1000;
          State.elapsed += secs;
          if (Config.MODES[State.mode].timed) {
            State.timeLeft -= secs;
            if (State.timeLeft <= 0) { State.timeLeft = 0; Render.hud(); Game.gameOver(I18n.t('reason_time')); }
          }
          // Aventura: revisar objetivos por tiempo (sobrevivir) cada segundo.
          if (State.mode === 'aventura' && State.status === 'playing') Game.evaluate();
          if (Config.MODES[State.mode].scoreAttack && State.status === 'playing') {
            Game.maybeTimecap(); // cápsula de tiempo (GM-13)
            // Ghost personal (GM-12): muestra de score cada 10s de partida.
            const gi = Math.floor(State.elapsed / 10);
            while (gi > 0 && State.ghostSamples.length < gi) State.ghostSamples.push(State.score);
          }
          Render.hud();
        }
        L.spawnAcc += dt;
        // Intervalo efectivo = spawnRate × warm-up (GM-26) × factor del modo
        // (GM-17: la bendición de ralentización de Supervivencia dura 2 oleadas).
        const sr = Math.max(120, Math.round(State.spawnRate * Game.warmupFactor(now) * (Rules.call('spawnFactor') || 1)));
        if (L.spawnAcc >= sr) { L.spawnAcc -= sr; Game.doSpawn(); }
        if (State.combo > 0) {
          const left = State.comboWindow - (now - State.comboAt);
          if (left <= 0) Game.resetCombo();
          else Render.comboRing(left / State.comboWindow);
        }
        // Hook de modo por frame (oleadas/jefes/eventos de Aventura y Supervivencia)
        Rules.call('onTick', dt);
        // HUD coalescido: como máximo una actualización por frame
        if (Render._hudDirty) { Render._hudDirty = false; Render.hud(); }
      }

      // Count-up del marcador (sensación de recompensa creciente)
      if (State.displayScore !== State.score) {
        const diff = State.score - State.displayScore;
        const stepv = Math.max(1, Math.ceil(Math.abs(diff) * 0.18));
        State.displayScore += diff > 0 ? Math.min(stepv, diff) : Math.max(-stepv, diff);
        $('#hud-score').textContent = fmtNum(State.displayScore);
      }

      // Las partículas se animan solas en el compositor (WAAPI); el bucle solo
      // necesita seguir vivo mientras hay juego activo o en pausa.
      const alive = State.status === 'playing' || State.status === 'paused';
      L.raf = alive ? requestAnimationFrame(L.tick) : 0;
    },
  };

  /* ===================== RunSave (guardado de partida en curso) =====================
   * Snapshot de la partida activa a localStorage para poder reanudar tras cerrar la
   * app (interrupciones de móvil). Se guarda al ocultarse la pestaña/página y se
   * limpia al terminar/abandonar. v1: excluye supervivencia (su estado de oleadas/
   * boosters/timers no es serializable de forma fiable todavía) y el tutorial.
   * Nota: no se guarda la posición del stream del RNG; al reanudar se re-seedea con
   * la semilla original (los spawns futuros divergen — no se exige replay exacto). */
  const RunSave = {
    KEY: 'cv_run',
    CHECKPOINT_MS: 10000,
    _timer: 0,
    _scheduled: false,
    // B-01: Contrarreloj (y el Reto del día, que es Contrarreloj seedeado) NO se
    // guarda: son runs de 2-4 min y reanudar rompía la integridad del reto
    // (isDaily/mutador/cápsula no viven en el snapshot). load() rechaza además
    // cualquier guardado antiguo de un modo hoy excluido.
    EXCLUDED: { supervivencia: 1, tutorial: 1, contrarreloj: 1 },
    schedule() {
      if (this._scheduled) return;
      this._scheduled = true;
      // Diferir al microtask captura el estado ya estabilizado. Es importante
      // en resumeSaved(): start() monta primero un tablero fresco y el snapshot
      // legacy lo sustituye síncronamente antes de ejecutar este checkpoint.
      Promise.resolve().then(() => {
        this._scheduled = false;
        this.save();
      });
    },
    startCheckpointing() {
      if (this._timer) return;
      this._timer = setInterval(() => {
        const active = State.status === 'playing' || State.status === 'paused';
        if (active && !Coach.active && !this.EXCLUDED[State.mode]) this.schedule();
      }, this.CHECKPOINT_MS);
    },
    save() {
      try {
        const playing = State.status === 'playing' || State.status === 'paused';
        if (!playing || Coach.active || this.EXCLUDED[State.mode]) { this.clear(); return; }
        const s = {
          v: 1, t: Date.now(),
          mode: State.mode, diff: State.diff, level: State.level, seed: State.seed,
          world: State.world, worldLevel: State.worldLevel,
          score: State.score, board: State.board, tiles: State.tiles,
          iconCount: State.iconCount, spawnRate: State.spawnRate,
          elapsed: State.elapsed, timeLeft: State.timeLeft,
          hintsLeft: State.hintsLeft, mistakes: State.mistakes,
          maxCombo: State.maxCombo, removedTotal: State.removedTotal,
          emptyBoards: State.emptyBoards, coinsRun: State.coinsRun,
          xpMultiplier: State.xpMultiplier,
        };
        // B-02: progreso del objetivo de nivel de Aventura (sin esto, un nivel de
        // score reanudado se ganaba al instante: levelScore0 se re-derivaba a 0).
        if (State.mode === 'aventura') { s.advScore0 = Adventure.levelScore0; s.advStart = Adventure.levelStart; }
        // B-03: consumibles pre-nivel de Clásico (reanudar ES el mismo intento).
        if (State.mode === 'clasico') s.inv = Survival.inv;
        const value = JSON.stringify(s);
        localStorage.setItem(this.KEY, value);
        Platform.mirrorStorage(this.KEY, value);
      } catch (e) { /* cuota llena o similar: nunca romper el juego por guardar */ }
    },
    load() {
      try {
        const raw = localStorage.getItem(this.KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || s.v !== 1 || !Config.MODES[s.mode] || this.EXCLUDED[s.mode]) return null;
        if (!Array.isArray(s.board) || s.board.length !== Config.SIZE * Config.SIZE) return null;
        return s;
      } catch (e) { return null; }
    },
    clear() {
      try {
        localStorage.removeItem(this.KEY);
        Platform.removeStorage(this.KEY);
      } catch (e) { /* no-op */ }
    },
  };

  /* ===================== Game (orquestador) ===================== */
  const Game = {
    hintCells: [], hintHideTimer: 0, ended: false,

    setupLevel() {
      const m = Config.MODES[State.mode];
      State.pool = Engine.poolForLevel(State.level);
      State.spawnRate = Engine.spawnRateForLevel(State.level);
      State.comboWindow = Config.DIFFICULTY[State.diff].comboWindow;
      State.hintsLeft = Config.HINTS_PER_LEVEL;
      State.hintReadyAt = 0;
      // Contrarreloj (score attack): reloj inicial fijo; se extiende con tope al jugar.
      if (m.timed) State.timeLeft = Config.TIMED_START;
      // Cápsula de tiempo (GM-13): 1 por partida, en un momento seedeado (40-80s).
      if (m.scoreAttack) { State.capAt = 40 + rand(40); State.capPlaced = false; }
      // Tablero fresco con la variedad de iconos del nivel actual
      State.board = new Array(State.size * State.size).fill(null);
      State.tiles = new Array(State.size * State.size).fill(null);
      State.iconCount = 0;
      State.combo = 0; State.comboMult = 1;
      Engine.placeInitial(m.initialIcons != null ? m.initialIcons : Config.DIFFICULTY[State.diff].initialIcons);
      State.minIcons = State.iconCount; // referencia near-miss del nivel (GM-01)
      // Warm-up de apertura (GM-26): por nivel, se desactiva solo en modos de calma.
      State.warmupUntil = performance.now() + Config.WARMUP.ms;
      State.warmupConvs = 0; State.warmupEndAt = 0;
      State.warmupDone = !!(m.relaxed || m.single);
      State.continueUsed = false; // oferta de continuar (GM-02): 1 por nivel
      // Hook de modo: permite a Aventura/Supervivencia sembrar tiles/objetivos.
      Rules.call('onSetupLevel', { level: State.level, mode: m });
      Render.syncAll();
      Render.combo();
      Render.hud();
    },

    // Lanza un nivel concreto del modo Clásico desde el mapa de mundos.
    startClassic(worldId, n) {
      State.world = worldId; State.worldLevel = n;
      this.start('clasico', 'normal', n);
    },

    start(mode, diff, startLevel, seed, opts) {
      Picker.dismiss();
      Toasts.reset();
      RunLog.start();
      opts = opts || {};
      { const pl = $('#prelevel'); if (pl) pl.hidden = true; }
      document.documentElement.style.removeProperty('--boss-accent'); // acento de jefe residual (JF-ζ)
      State.mode = mode;
      if (mode !== 'tutorial') Storage.lastMode = mode; // para marcar el modo actual en el catálogo
      State.diff = Config.MODES[mode].fixedDiff || diff;
      // Semilla de partida: reproducible si viene dada (reto diario/replay), aleatoria si no.
      // Normaliza semillas numéricas que llegan como string (p. ej. desde ?challenge= en
      // la URL): "12345" debe producir el mismo tablero que 12345.
      if (typeof seed === 'string' && /^\d+$/.test(seed)) seed = +seed;
      State.seed = seed != null ? seed : (Math.random() * 0xffffffff) >>> 0;
      RNG.seed(State.seed);
      State.score = 0; State.displayScore = 0; State.level = 1; State.elapsed = 0; State.timeLeft = 0;
      State.combo = 0; State.comboMult = 1; State.comboAt = 0;
      State.maxCombo = 0; State.removedTotal = 0; State.mistakes = 0; State.coinsRun = 0; State.tempMult = 1;
      State.xpMultiplier = Meta.xpBoost().multiplier;
      State.emptyBonusClaimed = false; State.emptyBoards = 0; State.lastActionCell = null;
      State.fever = false; State.feverEver = false; State.perfectEver = false; State.recordHit = false; State.recordNear = false;
      State.timePressure = 0;
      State.minIcons = 99; State.bestPlay = null; State.spawnHoldUntil = 0;
      State.mutFast = false; State.dailyMut = null; State.ghostSamples = []; // mutador diario (GM-15) · ghost (GM-12)
      State.isDaily = false; // startDaily() lo activa tras llamar aquí
      State.status = 'playing'; this.ended = false; this.dailyRunResult = null; this._dailyMedalSeen = Object.create(null); this.classicMastery = null; this._nearMiss = null;
      ModeSignals.apply(mode);
      // Aventura: reanuda en el nivel más lejano alcanzado; el resto empieza en 1.
      if (mode === 'aventura') State.level = Meta.advMax();
      // Clásico: arranca en el nivel elegido del mundo (HUD y escalado usan State.level).
      if (mode === 'clasico' && startLevel) State.level = startLevel;
      // Supervivencia 2.0: vidas, oleadas, boosters.
      const isSurv = mode === 'supervivencia';
      document.body.classList.toggle('mode-surv', isSurv);
      if (isSurv) Storage.survDiff = State.diff;
      // Tiempo en HUD solo cuando importa (Contrarreloj): top minimalista.
      document.body.classList.toggle('mode-timed', !!Config.MODES[mode].timed);
      { const sb = $('#surv-bar'); if (sb) sb.hidden = !isSurv; const bb = $('#booster-bar'); if (bb) bb.hidden = !isSurv; }
      Render.mountScoreRow(isSurv);
      if (isSurv) Survival.start();
      // No-Supervivencia: limpiar residuos de potenciadores (GM-03 los reintroduce
      // en Clásico tras el lanzador; reiniciar = consumibles del intento perdidos).
      else { Survival.disarm(); Survival.freezeUntil = 0; Survival.lockUntil = 0; Survival.inv = {}; }
      // Aventura: limpiar elecciones de run ANTES de montar el nivel (setup las lee).
      if (mode === 'aventura') Adventure.resetRun();
      Render.fever(false); Render.danger(0);
      this.clearHintHighlight();
      this.setupLevel();
      this.showGoalBanner();
      Render.combo();
      Boards.apply();
      Econ.refresh();
      Screens.show('game');
      FX.resize();
      Loop.start();
      if (Settings.music) Music.start();
      announce(`Partida iniciada. Modo ${Config.MODES[mode].name}.`);
      // Supervivencia usa el centro de eventos y una ventana de gracia; reanudaciones
      // y retos pueden componer su propio aviso único con `silentIntro`.
      let adventureIntroShown = false;
      // Aventura comunica el nuevo bioma en el mismo centro de eventos. Las únicas
      // capas que quedan son elecciones reales del jugador (ruta/reliquia).
      if (mode === 'aventura') {
        adventureIntroShown = Adventure.maybeChapterIntro(State.level);
        if (!adventureIntroShown) Adventure.maybeOfferRoute(State.level);
      }
      if (isSurv) Survival.intro();
      else if (!opts.silentIntro && !adventureIntroShown) ModeSignals.brief(mode);
      // Primer snapshot tras estabilizar start()/resumeSaved(), sin esperar al
      // siguiente lifecycle o al checkpoint periódico.
      RunSave.schedule();
    },

    // Reto del día: tablero de Contrarreloj idéntico para todos (semilla = fecha).
    // El primer intento del día premia gemas; se guarda la mejor marca diaria.
    startDaily() {
      const d = new Date().toISOString().slice(0, 10);
      this.start('contrarreloj', 'normal', undefined, 'daily:' + d, { silentIntro: true });
      State.isDaily = true;
      ModeSignals.markDaily(true);
      // Mutador del día (GM-15): mismo tema para todos, elegido por la fecha.
      const mut = DailyMut.pick(d);
      State.dailyMut = mut;
      DailyMut.apply(mut);
      this.showGoalBanner();
      Toasts.event({
        key: 'daily-start', kicker: I18n.t('daily_challenge'),
        title: mut === 'pure' ? I18n.t('lets_play') : I18n.t('dmut_' + mut),
        icon: 'target', kind: mut === 'pure' ? 'info' : 'warn', priority: 78, ms: 2400,
      });
    },

    // Reanuda la partida guardada por RunSave (si existe). Devuelve true si lo hizo.
    resumeSaved() {
      const s = RunSave.load();
      if (!s) return false;
      RunSave.clear();
      if (s.mode === 'clasico') { State.world = s.world; State.worldLevel = s.worldLevel; }
      // start() monta el nivel desde cero (objetivos/hooks de modo incluidos)...
      this.start(s.mode, s.diff, s.mode === 'clasico' ? s.worldLevel : undefined, s.seed, { silentIntro: true });
      // ...y el snapshot pisa tablero y progreso con lo que había al interrumpirse.
      State.level = s.level;
      State.pool = Engine.poolForLevel(s.level);
      State.board = s.board; State.tiles = s.tiles; State.iconCount = s.iconCount;
      State.score = s.score; State.displayScore = s.score;
      State.spawnRate = s.spawnRate; State.elapsed = s.elapsed; State.timeLeft = s.timeLeft;
      State.hintsLeft = s.hintsLeft; State.mistakes = s.mistakes;
      State.maxCombo = s.maxCombo; State.removedTotal = s.removedTotal;
      State.emptyBoards = s.emptyBoards; State.coinsRun = s.coinsRun;
      State.xpMultiplier = s.xpMultiplier === XP_BOOST_MULTIPLIER ? XP_BOOST_MULTIPLIER : 1;
      // B-02: restaurar el progreso del objetivo de Aventura. Fallback para guardados
      // antiguos sin estos campos: tratar el estado actual como inicio del nivel
      // (conservador — jamás regala la victoria instantánea).
      if (s.mode === 'aventura') {
        Adventure.levelScore0 = typeof s.advScore0 === 'number' ? s.advScore0 : State.score;
        Adventure.levelStart = typeof s.advStart === 'number' ? s.advStart : State.elapsed;
        Adventure.refreshGoal(State.level);
      }
      // B-03: restaurar los consumibles pre-nivel de Clásico y su barra.
      if (s.mode === 'clasico' && s.inv && typeof s.inv === 'object') {
        Survival.inv = s.inv;
        Survival.buildBar();
      }
      Render.syncAll(); Render.hud(); this.showGoalBanner();
      RunSave.schedule();
      Toasts.show(I18n.t('run_resumed'), 'good', 1600);
      return true;
    },

    restart() {
      if (Coach.active) return Coach.skip();
      if (State.isDaily) { Modal.close(); return this.startDaily(); }
      // Una nueva run de Supervivencia es una nueva decisión económica. Volver al
      // lanzador evita reintentar vacío o recomprar el loadout anterior en silencio.
      if (State.mode === 'supervivencia') {
        Modal.close(); Loop.stop(); Music.stop(); State.status = 'idle'; Toasts.reset(); Survival.cleanup();
        openSurvivalDiff(); return;
      }
      Modal.close(); this.start(State.mode, State.diff);
    },
    quit() {
      if (Coach.active) return Coach.skip();
      Picker.dismiss(); // B-06: ídem al salir al menú
      { const pl = $('#prelevel'); if (pl) pl.hidden = true; }
      Loop.stop(); Music.stop(); State.status = 'idle'; Modal.close();
      Toasts.reset();
      ModeSignals.clear(); this.clearHintHighlight();
      if (typeof Survival !== 'undefined') Survival.cleanup();
      // Clásico: salir devuelve al mapa de mundos (su hub natural).
      if (State.mode === 'clasico') { Worlds.open(); return; }
      showHome(State.mode, true);
    },

    pause() {
      if (Coach.active) return Coach.skip();
      if (State.status !== 'playing') return;
      // Aviso: Supervivencia no se guarda al salir (RunSave excluye este modo). Se muestra
      // solo aquí para que el jugador sepa que salir pierde la oleada en curso.
      // B-01: el aviso "no se guarda" aplica a TODO modo excluido de RunSave
      // (Supervivencia y Contrarreloj/Reto), no solo a Supervivencia.
      { const pn = $('#pause-note'); if (pn) pn.hidden = !RunSave.EXCLUDED[State.mode]; }
      renderPauseSummary();
      if (State.mode === 'supervivencia') Survival.pauseClock();
      State.status = 'paused'; Toasts.pause(); Music.stop(true); Modal.open('modal-pause'); announce('Juego en pausa.');
    },
    resume() {
      if (State.status !== 'paused') return;
      if (State.mode === 'supervivencia') Survival.resumeClock();
      State.status = 'playing'; Toasts.resume(); Modal.close(); Loop.last = performance.now(); Loop.kick();
      if (Settings.music) Music.start();
    },

    /* Activación de una casilla (clic/tecla) */
    feverNeed() {
      // Zen (GM-24): sin Fiebre — el modo santuario no evalúa ni acelera.
      if (Config.MODES[State.mode].noFever) return Infinity;
      if (State.mode !== 'supervivencia') return Config.FEVER_COMBO;
      return Math.max(6, Config.FEVER_COMBO - Survival.frenzyTier());
    },
    feverBoost() {
      if (!State.fever) return 1;
      return Config.FEVER_BOOST + (State.mode === 'supervivencia' ? Survival.frenzyTier() * 0.06 : 0);
    },
    // Sprint final (GM-10): en score-attack, con el reloj a <=10s todos los puntos
    // van ×1.5. Como el tiempo puede volver a subir, el jugador puede ELEGIR
    // cabalgar el borde del abismo (riesgo-recompensa continuo).
    sprintMult() {
      const m = Config.MODES[State.mode];
      return m && m.scoreAttack && State.timeLeft > 0 && State.timeLeft <= Config.SPRINT_WINDOW ? Config.SPRINT_MULT : 1;
    },
    // Warm-up de apertura (GM-26): factor del intervalo de spawn. ×0.55 los
    // primeros 10s del nivel (o hasta la 3ª convergencia), con rampa de salida
    // de 2s hacia el ritmo normal. No aplica a Zen/tutorial (calma).
    warmupFactor(now) {
      if (State.warmupDone) return 1;
      const W = Config.WARMUP;
      if (now < State.warmupUntil && State.warmupConvs < W.convs) return W.factor;
      if (!State.warmupEndAt) State.warmupEndAt = now;
      const k = (now - State.warmupEndAt) / W.rampMs;
      if (k >= 1) { State.warmupDone = true; return 1; }
      return W.factor + (1 - W.factor) * k;
    },

    activate(i) {
      if (State.status !== 'playing') return;
      if (Survival.locked()) { Render.boardShake(); Sound.tap(); return; }
      this.clearHintHighlight();
      const ti = State.tiles[i];
      // Objeto especial con efecto al tocar (bonus/portal/caja mágica/bomba oculta).
      if (ti && ti.trigger) { Sound.tap(); return; }
      // Casilla rompible: tocar para liberar (helada/cadenas/telaraña/lodo). No es error.
      if (ti && ti.breakable) {
        ti.taps = (ti.taps != null ? ti.taps : (Tiles.DEFS[ti.type].taps || 1)) - 1;
        if (ti.type === 'frozen') Render.iceHit(i);
        else Render.boardShake();
        if (ti.taps <= 0) {
          State.tiles[i] = null;
          if (ti.type === 'frozen') { Sound.iceBreak(); Render.iceBreak(i); } else Sound.eliminate(3);
        } else {
          if (ti.type === 'frozen') Sound.iceCrack(ti.taps); else Sound.tap();
        }
        Render.setTile(i); Render.syncCell(i); Haptics.ice();
        // B6: en Supervivencia, el esfuerzo de romper hielo/bloqueos alimenta la
        // carga (+2 por toque) — el "busywork" pasa a contribuir al build.
        if (State.mode === 'supervivencia') {
          Survival.addSupplyCharge(2);
          Survival.render();
        }
        return;
      }
      if (State.board[i] !== null) {
        const t = State.tiles[i];
        if (t && t.type === 'boss' && (t.hits || 0) > 0) {
          const el = Render.cells[i];
          if (el) {
            el.classList.remove('metallic-shake');
            void el.offsetWidth;
            el.classList.add('metallic-shake');
          }
          Sound.tap();
          Haptics.tap();
          Toasts.event(I18n.t('surv_armored_hint'), 'warn', 1800, '🛡️');
          BossCoach.check('boss_armored', '🛡️');
          return;
        }
        Render.miss(i); Sound.tap(); return;
      }     // ocupada: nada (ahora con feedback visual)
      const conv = Engine.converging(i);
      if (conv.length < 2) { this.mistake(i); return; }          // error → penalización

      // Combo (registrar tier anterior para detectar subidas de rango)
      const prevMult = State.comboMult;
      const now = performance.now();
      if (State.combo > 0 && now - State.comboAt <= State.comboWindow) State.combo++;
      else State.combo = 1;
      State.comboAt = now;
      State.comboMult = 1;
      for (const [thr, mult] of Config.COMBO_MULTIPLIERS) { if (State.combo >= thr) { State.comboMult = mult; break; } }
      if (State.combo > State.maxCombo) State.maxCombo = State.combo;

      // Color por tier de combo (blanco→teal→morado→rosa→oro). Se calcula aquí
      // para tintar la animación de estrellas y se reutiliza en popup/rango.
      const color = State.comboMult >= 8 ? '#ffd84d' : State.comboMult >= 5 ? '#ff5cf0' : State.comboMult >= 3 ? '#b46cff' : State.comboMult >= 2 ? '#00d0ff' : State.comboMult >= 1.5 ? '#34e29b' : '#fff';

      // FEVER: entrar al encadenar combo alto. La entrada es un ESPECTÁCULO (GM-27):
      // micro-pausa de spawns (aspiración) + zoom/barrido del tablero + aro en llamas.
      if (!State.fever && State.combo >= this.feverNeed()) {
        State.fever = true; State.feverEver = true;
        State.spawnHoldUntil = performance.now() + 500;
        Render.fever(true); Render.feverBurst(); Sound.fever(); Haptics.fever();
        if (Settings.music) Music.setIntensity(1);
        Toasts.event({
          key: 'fever-on', kicker: I18n.t('hud_narr_fever_title'),
          title: I18n.t('hud_narr_fever'), detail: I18n.t('fever_on'),
          icon: 'fire', kind: 'warn', priority: 74, ms: 1500,
          expiresAt: Date.now() + 3200,
        });
      }

      // Puntos (icono×10×nivel × combo × dificultad × modo × fever)
      const scoreBefore = State.score;
      if (State.mode === 'supervivencia' && Survival.magnetMoves > 0) {
        // Imán (bendición): atrae la figura MÁS CERCANA al toque y la incorpora
        // al mismo burst radial de la convergencia. Si no hay nada que atraer,
        // el uso NO se consume.
        let extra = -1, bestD = Infinity;
        const r0 = i / 8 | 0, c0 = i % 8;
        for (let j = 0; j < State.board.length; j++) {
          if (State.board[j] !== null && !conv.includes(j) && (!State.tiles[j] || !State.tiles[j].solid)) {
            const dj = Math.abs((j / 8 | 0) - r0) + Math.abs(j % 8 - c0);
            if (dj < bestD) { bestD = dj; extra = j; }
          }
        }
        if (extra !== -1) {
          conv.push(extra);
          Survival.magnetMoves--;
          if (Survival.magnetMoves === 0) Toasts.show(I18n.t('magnet_done'), 'warn', 1500, '🧲');
        }
      }
      // Titiritero (JF-ε): converger un tipo enhebrado le cura — se evalúa ANTES de
      // vaciar las celdas (necesita leer los tipos que van a desaparecer).
      if (State.mode === 'supervivencia' && Bosses.enc && Bosses.enc.threads) Bosses.onThreadedConverge(conv);
      let removed = conv.length;
      State.removedTotal += removed;
      State.lastActionCell = i;
      const d = Config.DIFFICULTY[State.diff], m = Config.MODES[State.mode];
      const base = removed * 10 * State.level;
      const survMult = (State.mode === 'supervivencia') ? Survival.scoreMult() : 1;
      // Los seis modos puntúan con @convergence/game-core, el mismo módulo que
      // reejecuta el backend al verificar una partida. Si cliente y servidor
      // calcularan por separado, cualquier deriva convertiría un score legítimo
      // en un rechazo.
      //
      // Se llama a la fórmula común y no al envoltorio de cada modo: el motor ya
      // conoce sus factores vivos (nivel, fiebre, temporal, sprint, bendiciones)
      // y pasárselos es exactamente la expresión histórica. Los envoltorios por
      // modo existen para el backend, que no tiene motor y debe derivarlos.
      const points = GameCore.ready()
        ? GameCore.core.convergencePoints({
          removed, level: State.level, combo: State.combo,
          difficulty: State.diff, mode: State.mode,
          feverBoost: this.feverBoost(),
          tempMultiplier: State.tempMult || 1,
          sprintMultiplier: this.sprintMult(),
          survivalMultiplier: survMult,
        })
        : Math.floor(base * State.comboMult * d.scoreMult * m.mult * this.feverBoost() * (State.tempMult || 1) * this.sprintMult() * survMult);
      State.score += points;
      State.warmupConvs++; // el warm-up (GM-26) termina antes si el jugador ya fluye
      // Jugada pico de la partida (GM-28): se muestra en el resumen de fin (regla pico-final).
      if (!State.bestPlay || points > State.bestPlay.points) {
        State.bestPlay = { points, combo: State.combo, removed, wave: State.mode === 'supervivencia' ? Survival.wave : 0, level: State.level };
      }
      const milestone = GameCore.ready()
        ? GameCore.core.milestoneBonusFor(State.combo)
        : (Config.MILESTONES[State.combo] || 0);
      if (milestone) {
        State.score += milestone;
        Render.scoreFeedback(`Combo ×${State.combo} · +${milestone}`, color, 'combo');
        Sound.milestone(); Haptics.milestone();
      }

      // Contrarreloj: bonus de tiempo por convergencia (los combos suman más)
      if (m.timed) {
        // Tiempo ganado MODESTO, con TOPE de reloj y RENDIMIENTO DECRECIENTE: los
        // combos ya recompensan con puntos; el tiempo no se acumula sin límite ni
        // hace la partida infinita. (Antes: hasta +20s por convergencia, sin tope.)
        const tg = Config.TIMED_GAIN;
        const before = State.timeLeft;
        if (GameCore.timeAttack()) {
          State.timeLeft = GameCore.core.applyTimeGain(
            State.timeLeft,
            GameCore.core.timeGainFor(removed, State.combo, State.elapsed),
          );
        } else {
          const decay = clamp(1 - State.elapsed / tg.decaySec, tg.minDecay, 1);
          const raw = (tg.base + Math.min(removed, 4) * tg.perIcon + Math.min(State.combo, tg.comboCap) * tg.combo) * decay;
          State.timeLeft = Math.min(Config.TIMED_CAP, State.timeLeft + raw);
        }
        const got = Math.round(State.timeLeft - before);
        if (got > 0) Render.bump($('#hud-time'));
        Render.scoreFeedback(got > 0 ? `+${got}s` : '⏱️ tope', 'var(--time)', 'time');
      }

      // FX clona las fichas completas antes de vaciar el tablero: cuerpo cuadrado e
      // icono son atraídos al punto tocado; al colapsar allí recuperan el burst radial
      // anterior y una onda corta. Render.clearAnim vacía los originales en este tick.
      FX.converge(i, conv, color);
      const rewardTier = removed >= 4 ? 3 : removed >= 3 ? 2 : (State.comboMult >= 2 || State.combo >= 3 ? 1 : 0);
      if (rewardTier) Render.impact(rewardTier);
      FX.scoreToHud(i, color, rewardTier);

      // Aplicar al tablero (limpia también la casilla especial; cristal = bonus)
      // `crystalsHere` alimenta la bitácora: el servidor recalcula el valor del
      // cristal por su cuenta, así que solo necesita cuántos entraron.
      let crystalsHere = 0;
      conv.forEach(idx => {
        const t = State.tiles[idx];
        // Cristal: +50 base; la reliquia de Aventura (GM-07) añade +30.
        if (t) {
          if (t.type === 'crystal') {
            crystalsHere++;
            State.score += GameCore.ready()
              ? (State.mode === 'aventura'
                ? GameCore.core.adventureCrystalPoints(Adventure.hasRelic('crystal'))
                : GameCore.core.CRYSTAL_POINTS)
              : 50 + (State.mode === 'aventura' && Adventure.hasRelic('crystal') ? 30 : 0);
          }
          // Ancla de jefe (JF-02): converger el icono que vive encima = 1 golpe al
          // jefe. Las blindadas nunca llegan aquí: su solid=true las excluye de conv.
          if (t.type === 'boss') Bosses.onAnchorHit(idx);
          State.tiles[idx] = null;
        }
        State.board[idx] = null; State.iconCount--;
      });
      RunLog.convergence({
        removed, combo: State.combo, fever: State.fever, level: State.level,
        crystals: crystalsHere,
        wave: State.mode === 'supervivencia' ? Survival.wave : 1,
      });
      // Celdas calientes: las recién vaciadas + el punto tocado. Los spawns/rellenos
      // inmediatos las evitarán una ventana corta (ilusión "no desapareció").
      Engine.noteHot(conv.concat(i));
      Render.clearAnim(conv, i);
      conv.forEach(idx => { Render.setTile(idx); Render.cells[idx].setAttribute('aria-label', Render.cellLabel(idx)); });

      // Popup con el multiplicador TOTAL (combo × fiebre × temporal × sprint ×
      // bendiciones), no solo el de combo: lo que ves es lo que multiplicó (GM-16).
      const totMult = State.comboMult * this.feverBoost() * (State.tempMult || 1) * this.sprintMult() * survMult;
      Render.popup(i, totMult > 1.001 ? `+${fmtNum(points)} ×${totMult % 1 === 0 ? totMult : totMult.toFixed(1)}` : `+${fmtNum(points)}`, color);
      Render.bump($('#hud-score'));
      Render.combo();
      this.updateDailyObjective(scoreBefore);

      // Subida de rango → flash + sonido
      if (State.comboMult > prevMult && State.combo >= 3) {
        const labels = { 1.5: '¡BIEN!', 2: '¡GENIAL!', 3: '¡INCREÍBLE!', 5: '¡ÉPICO!', 8: '¡LEGENDARIO!', 10: '¡MÍTICO!' };
        Render.rankFlash(labels[State.comboMult] || '¡COMBO!', color); Sound.rank();
      }

      // Sonido + háptica de eliminación
      Sound.match(removed, State.combo, State.comboMult);
      if (removed >= 4) Haptics.milestone(); else if (State.combo >= 3) Haptics.combo(); else Haptics.tap();
      if (Settings.music) Music.setIntensity(clamp(State.combo / 18, 0, 1));

      // Récord en vivo (una sola vez por partida): confeti desde la última
      // eliminación, saliendo hacia fuera y cayendo al fondo de la pantalla.
      if (!State.recordHit && Storage.best > 0 && State.score > Storage.best) {
        State.recordHit = true; Render.flash(); Sound.record(); Haptics.record(); FX.celebrate(i);
        Toasts.show(I18n.t('new_record'), 'good', 1600, 'trophy');
      }
      // Récord CERCANO (HUD-TA4): aviso contextual al alcanzar el 85% del récord, una
      // sola vez y solo en modos de puntuación. El récord no vive en el HUD permanente
      // (se ocultó con .score-meta); aparece solo cuando puede cambiar tu decisión.
      else if (!State.recordNear && Config.MODES[State.mode].scoreAttack
        && Storage.best > 0 && State.score >= Storage.best * 0.85 && State.score < Storage.best) {
        State.recordNear = true;
        Toasts.show(I18n.t('rec_close').replace('{n}', fmtNum(Storage.best - State.score)), 'warn', 1700, 'trophy');
      }

      Render.hudSoon();
      // Anuncio a lector de pantalla: los hitos de combo (10/20/30) siempre; las
      // convergencias grandes (≥3 iconos) con throttle; las sueltas se omiten (spam).
      if (Config.MILESTONES[State.combo] != null) announce(I18n.t('sr_combo').replace('{n}', State.combo));
      else if (removed >= 3) announceGame(I18n.t('sr_converge').replace('{n}', removed));
      if (Coach.active) { Coach.notify(); return; }
      // Pickups-bomba del tablero: detonan si una eliminación queda adyacente (encadenan).
      this._chainDetonate(conv);
      Rules.call('onConverge', { removed, combo: State.combo, cells: conv, center: i });
      this.evaluate();
    },

    /* Error del jugador: penalización (salvo modos sin penalización) */
    mistake(i) {
      const prevStars = State.mode === 'clasico' ? this.starsForMistakes(State.mistakes) : 0;
      Render.miss(i); Sound.miss(); Haptics.error(); State.mistakes++; RunLog.mistake();
      // Clásico: refresca estrellas en vivo y avisa si se ha perdido una (transparencia).
      if (State.mode === 'clasico') {
        this.updateLiveStars();
        const now = this.starsForMistakes(State.mistakes);
        if (now < prevStars) {
          const el = $('#obj-stars'); if (el) { el.classList.remove('lost'); void el.offsetWidth; el.classList.add('lost'); }
          Toasts.show(I18n.t('star_lost'), 'bad', 1600, '★');
        }
      }
      const m = Config.MODES[State.mode];
      if (!m.penalties) return;
      Render.boardShake();
      // GM-11: en score-attack (Contrarreloj/Reto) el error cuesta TIEMPO, la moneda
      // real del modo. Añadir iconos ahí era un castigo-regalo: los iconos son la
      // materia prima de puntuar. Sin iconos extra y sin acelerar el spawn.
      if (m.scoreAttack) {
        State.timeLeft = GameCore.timeAttack()
          ? GameCore.core.applyMistakePenalty(State.timeLeft)
          : Math.max(0, State.timeLeft - Config.TIMED_MISTAKE_S);
        Render.bump($('#hud-time'));
        Toasts.show(I18n.t('mistake_time').replace('{n}', Config.TIMED_MISTAKE_S), 'bad', 1500);
        Render.hud();
        if (State.timeLeft <= 0) { this.gameOver(I18n.t('reason_time')); return; }
        this.evaluate();
        return;
      }
      if (State.mode === 'supervivencia') Render.boardEvent('surv-penalty', 520);
      // Añadir iconos de penalización (escala con dificultad y nivel)
      const d = Config.DIFFICULTY[State.diff];
      const n = GameCore.ready()
        ? GameCore.core.iconPenaltyCount(State.diff, State.level)
        : clamp(d.penaltyBase + Math.floor((State.level - 1) / 3), 1, 5);
      const placed = Engine.addPenalty(n);
      if (placed.length) Render.penalty(placed);
      // Subir velocidad de aparición
      State.spawnRate = GameCore.ready()
        ? GameCore.core.penalizedSpawnRate(State.diff, State.spawnRate)
        : Math.max(d.spawnMin, Math.round(State.spawnRate * 0.95));
      Toasts.show(`Error · +${placed.length} iconos · más rápido`, 'bad', 1800);
      Render.hud();
      this.evaluate();
    },

    // Casillas ortogonalmente adyacentes a `i` dentro del tablero.
    _adjacent(i) {
      const r = i / State.size | 0, c = i % State.size, s = State.size, out = [];
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([rr, cc]) => { if (rr >= 0 && cc >= 0 && rr < s && cc < s) out.push(rr * s + cc); });
      return out;
    },
    // Cuadrado (2·rad+1) centrado en `i`.
    _area(i, rad) {
      const r = i / State.size | 0, c = i % State.size, s = State.size, out = [];
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < s && cc < s) out.push(rr * s + cc); }
      return out;
    },
    // Elimina las figuras de `cells` (sin convergencia) actualizando contador y render.
    _removeCells(cells) {
      cells.forEach((idx) => { if (State.board[idx] !== null) { State.board[idx] = null; State.iconCount--; } });
      Engine.noteHot(cells);
      Render.clearAnim(cells);
      cells.forEach((idx) => { Render.setTile(idx); Render.syncCell(idx); });
    },
    // Pickups-bomba del tablero: si una eliminación (convergencia/detonación) queda
    // adyacente a una bomba, esta detona limpiando su 3×3, y encadena con otras bombas
    // que alcance. Reutiliza _adjacent/_area/_removeCells.
    _chainDetonate(seedCells) {
      const isPowerup = (j) => { const t = State.tiles[j]; return !!(t && t.trigger); };
      const seen = new Set(), queue = [];
      const enqueueAdj = (cells) => cells.forEach((idx) => this._adjacent(idx).forEach((j) => { if (isPowerup(j) && !seen.has(j)) { seen.add(j); queue.push(j); } }));
      enqueueAdj(seedCells);
      if (!queue.length) return;
      const triggered = [];
      let bombs = 0;
      while (queue.length) {
        const p = queue.shift();
        const ti = State.tiles[p];
        if (!ti || !ti.trigger) continue;
        if (ti.trigger === 'bomb') bombs++;
        triggered.push(p);
        const touched = this._triggerTile(p, ti, { defer: true }) || [p];
        enqueueAdj(touched);
      }
      if (triggered.length && State.lastActionCell == null) State.lastActionCell = triggered[0];
      Render.syncAll(); Render.bump($('#hud-score'));
      if (bombs) {
        Sound.booster('bomb'); Haptics.milestone();
        Toasts.show(I18n.t('chain_boom').replace('{n}', bombs), 'good', 1300, BOOSTER_IMG.bomb);
      }
    },
    // Objeto especial: efecto al tocar (bonus +30 / portal / caja mágica / bomba oculta).
    _triggerTile(i, ti, opts = {}) {
      const eff = ti.trigger;
      let touched = [i];
      State.tiles[i] = null;
      if (eff === 'bonus') {
        const bonusPoints = GameCore.ready() ? GameCore.core.BONUS_TILE_POINTS : 30;
        State.score += bonusPoints; RunLog.bonusTile(); Render.popup(i, `+${bonusPoints}`, 'var(--good)'); Render.bump($('#hud-score'));
        Sound.milestone(); Haptics.milestone();
      } else if (eff === 'portal') {
        const filled = [], empties = [];
        for (let k = 0; k < State.board.length; k++) {
          if (State.board[k] !== null && !State.tiles[k]) filled.push(k);
          else if (State.board[k] === null && !State.tiles[k]) empties.push(k);
        }
        if (filled.length && empties.length) {
          const from = filled[rand(filled.length)], to = empties[rand(empties.length)];
          State.board[to] = State.board[from]; State.board[from] = null;
          Render.syncCell(from); Render.syncCell(to);
          touched = [i, from, to];
        }
        Sound.booster('freeze'); Render.boardEvent('boost-freeze', 700);
      } else if (eff === 'magicbox') {
        touched = this._adjacent(i).concat(i);
        this._adjacent(i).forEach((j) => { const t = State.tiles[j]; if (t && t.solid) { State.tiles[j] = null; Render.setTile(j); Render.syncCell(j); } });
        FX.confetti(40); Sound.milestone(); Haptics.milestone();
      } else if (eff === 'bomb') {
        touched = this._area(i, 1);
        const cells = touched.filter((j) => State.board[j] !== null && !(State.tiles[j] && State.tiles[j].solid));
        const pts = GameCore.ready()
          ? GameCore.core.areaClearPoints(cells.length, State.level)
          : cells.length * 10 * State.level;
        this._removeCells(cells); State.score += pts; State.removedTotal += cells.length;
        RunLog.areaClear(cells.length, State.level);
        if (State.mode === 'supervivencia') Survival.addFrenzy(Math.min(28, 8 + cells.length * 2));
        if (cells.length) Render.popup(i, '+' + pts, 'var(--warn)');
        FX.celebrate(i); Sound.booster('bomb'); Haptics.milestone();
      } else if (eff === 'slowdown') {
        const d = Config.DIFFICULTY[State.diff];
        State.spawnRate = Math.min(d.spawnStart, Math.round(State.spawnRate * 1.6));
        Render.popup(i, '⏳ −Vel', 'var(--accent-2)'); Render.bump($('#hud-speed'));
        Sound.booster('freeze'); Haptics.milestone();
        Toasts.show('⏳ ¡Ralentizado!', 'good', 1200, 'v2:hourglass');
      } else if (eff === 'timecap') {
        // Cápsula de tiempo (GM-13, Contrarreloj): +5s con el tope de reloj de siempre.
        const before = State.timeLeft;
        State.timeLeft = Math.min(Config.TIMED_CAP, State.timeLeft + 5);
        const got = Math.round(State.timeLeft - before);
        Render.popup(i, got > 0 ? `+${got}s` : '⏱️', 'var(--time)'); Render.bump($('#hud-time'));
        RunLog.attachCapsule();
        Sound.milestone(); Haptics.milestone();
      }
      Render.setTile(i); Render.syncCell(i); Render.hud();
      if (!opts.defer) this.evaluate();
      return touched;
    },

    doSpawn() {
      // Micro-pausa de la entrada en Fiebre (GM-27): 500ms de "aspiración" sin spawns.
      if (State.spawnHoldUntil && performance.now() < State.spawnHoldUntil) return;
      if (Rules.call('blockSpawn')) return;   // potenciador de congelación (Supervivencia)
      const m = Config.MODES[State.mode];
      const idx = Engine.spawnOne();
      if (idx < 0) { // no queda casilla vacía colocable: el tablero está lleno
        if (m.endless) { Rules.call('onOverflow'); return; }     // surv/zen lo gestionan
        if (m.scoreAttack) { this.gameOver(I18n.t('reason_full')); return; }
        // Clásico/Aventura: tablero lleno = atasco real (sin huecos no hay jugada).
        // 1) Reliquia escudo de Aventura (GM-07): la 1ª derrota del capítulo se
        //    convierte en un despeje del 30% — gratis, la reliquia hace su trabajo.
        if (State.mode === 'aventura' && Adventure.hasRelic('shield') && !Adventure.shieldUsed) {
          Adventure.shieldUsed = true;
          this.softClear(0.30);
          Toasts.show(I18n.t('relic_shield_fired'), 'good', 2200, '🛡️');
          Render.hudSoon();
          return;
        }
        // 2) Continuar con gemas (GM-02): 1 oferta por nivel, precio visible, rechazar
        //    igual de fácil que aceptar, sin cuenta atrás. Ética antes que ingresos.
        if (!State.continueUsed && Meta.gems() >= Config.CONTINUE_GEMS) {
          State.continueUsed = true; // se consume la OFERTA, no solo la compra
          Sound.danger();
          Picker.open({
            title: I18n.t('continue_title'),
            sub: I18n.t('continue_sub').replace('{n}', Config.CONTINUE_GEMS),
            accent: '#b46cff',
            options: [{ id: 'yes', icon: '💎', name: I18n.t('continue_yes').replace('{n}', Config.CONTINUE_GEMS), desc: I18n.t('continue_yes_d') }],
            cancelLabel: I18n.t('continue_no'),
            onPick: () => {
              if (!Meta.spendGems(Config.CONTINUE_GEMS)) { this._overflowLose(); return; }
              Econ.refresh();
              this.softClear(Config.CONTINUE_CLEAR);
              Toasts.show(I18n.t('continue_done'), 'good', 1800, '💎');
              Render.hudSoon();
            },
            onCancel: () => this._overflowLose(),
          });
          return;
        }
        this._overflowLose(); return;
      }
      Render.syncCell(idx); Render.spawnAnim(idx);
      if (m.scoreAttack && !Engine.emptyCells().length) { this.gameOver(I18n.t('reason_full')); return; }
      if (m.scoreAttack) {
        // Contrarreloj: presión CRECIENTE con el tiempo => la partida es finita
        // aunque ganes tiempo (los spawns acaban superando al jugador).
        // `mutFast` = mutador diario "veloz" (GM-15): toda la curva un 10% más rápida.
        const d = Config.DIFFICULTY[State.diff];
        State.spawnRate = clamp(Math.round(d.spawnStart * (State.mutFast ? 0.9 : 1) * Math.pow(0.92, State.elapsed / 10)), 300, d.spawnStart);
      } else {
        // Aceleración progresiva suave dentro del nivel
        State.spawnRate = Math.max(Config.DIFFICULTY[State.diff].spawnMin, State.spawnRate - 3);
      }
      Render.hudSoon();
      this.evaluate();
      // Aviso anti-desconcierto: si tras el spawn sigue sin haber jugada posible,
      // dilo (el jugador no sabe si está ciego o atascado). Throttle de 9s.
      if (State.status === 'playing' && State.iconCount >= 2 && !Engine.hasMoves()) {
        const now = performance.now();
        if (now - (this._stuckAt || 0) > 9000) {
          this._stuckAt = now;
          Toasts.show(I18n.t('no_moves_wait'), 'info', 2200, '⏳');
          announce(I18n.t('no_moves_wait'));
        }
      }
    },

    // Cápsula de tiempo (GM-13): coloca el pickup ⏰ cuando llega su momento seedeado.
    maybeTimecap() {
      if (State.capPlaced || State.elapsed < State.capAt) return;
      const e = [];
      for (let i = 0; i < State.board.length; i++) if (State.board[i] === null && !State.tiles[i]) e.push(i);
      if (!e.length) return; // sin hueco: reintenta el próximo segundo
      State.capPlaced = true;
      const idx = e[rand(e.length)];
      State.tiles[idx] = Tiles.make('timecap');
      Render.setTile(idx); Render.syncCell(idx); Render.cellPulse(idx, 'slowdown-placed', 700);
      Toasts.show(I18n.t('timecap_hint'), 'info', 1800, '⏰');
    },

    // Derrota real por tablero lleno (Clásico/Aventura), con el encuadre near-miss
    // de GM-01. Separada de doSpawn porque el escudo (GM-07) y el continuar (GM-02)
    // pueden interceptar el desbordamiento antes de llegar aquí.
    _overflowLose() {
      if (State.minIcons <= 10 && State.elapsed > 45) this._nearMiss = State.minIcons;
      this.gameOver(I18n.t('reason_full'));
    },

    // Limpieza suave de una fracción de iconos (Zen: respiro sin fin de partida).
    softClear(frac) {
      const f = [];
      for (let i = 0; i < State.board.length; i++) if (State.board[i] !== null && !State.tiles[i]) f.push(i);
      let n = Math.floor(f.length * frac);
      const wiped = [];
      for (let k = 0; k < n && f.length; k++) { const idx = f.splice(rand(f.length), 1)[0]; FX.burst(idx, IconPacks.colorOf(Meta.equippedIconPack(), State.board[idx]), 4); State.board[idx] = null; State.iconCount--; wiped.push(idx); }
      Engine.noteHot(wiped);
      Render.syncAll();
    },

    // Banner de objetivo/identidad por modo (Aventura y Supervivencia usan su propia UI).
    showGoalBanner() {
      const el = $('#obj-banner'); if (!el) return;
      if (State.mode === 'aventura') return;            // lo gestiona Adventure.banner
      const m = Config.MODES[State.mode];
      if (State.mode === 'supervivencia' || !m.goal) { el.hidden = true; el.style.borderColor = ''; return; }
      el.hidden = false;
      el.style.borderColor = m.accent || '';
      const stars = State.mode === 'clasico'
        ? `<span class="obj-stars" id="obj-stars" title="${I18n.t('stars_help')}" aria-label="${I18n.t('stars_label')}"></span>` : '';
      const daily = State.isDaily && State.mode === 'contrarreloj';
      const identity = daily ? I18n.t('daily_challenge') : I18n.modeT(State.mode, 'name');
      const mutatorKey = daily && State.dailyMut ? 'dmut_' + State.dailyMut + '_n' : '';
      const goal = mutatorKey ? I18n.t(mutatorKey) : I18n.modeT(State.mode, 'goal');
      const icon = daily ? 'target' : MODE_IMG[State.mode];
      el.innerHTML = `<span class="obj-biome" style="color:${m.accent || 'var(--accent-2)'}">${icon ? iconAnyInline(icon) : m.emoji} ${identity}</span><span class="obj-goal">${goal}</span>${stars}`;
      this.updateLiveStars();
      this.updateDailyObjective(undefined, { toast: false });
    },

    // Estrellas según errores cometidos (criterio único y transparente).
    starsForMistakes(mistakes) {
      const e = Config.STAR_ERR;
      return mistakes <= e[0] ? 3 : mistakes <= e[1] ? 2 : 1;
    },
    // Refresca el indicador de estrellas en vivo del banner (solo Clásico).
    updateLiveStars() {
      if (State.mode !== 'clasico') return;
      const el = $('#obj-stars'); if (!el) return;
      const s = this.starsForMistakes(State.mistakes);
      el.innerHTML = [1, 2, 3].map((k) => `<span class="ols${k <= s ? ' on' : ''}">★</span>`).join('');
      el.dataset.stars = s;
    },
    updateDailyObjective(previousScore, opts = {}) {
      if (!State.isDaily) return;
      const note = $('#daily-note');
      if (note) note.textContent = ModeSignals.dailyNoteText(State.score);
      if (opts.toast === false || typeof previousScore !== 'number' || State.score <= previousScore) return;
      if (!this._dailyMedalSeen) this._dailyMedalSeen = Object.create(null);
      Meta.DAILY_MEDALS.forEach((threshold, idx) => {
        const medal = ['bronze', 'silver', 'gold'][idx];
        if (previousScore >= threshold || State.score < threshold || this._dailyMedalSeen[medal]) return;
        this._dailyMedalSeen[medal] = true;
        const next = Meta.dailyNextMedal(threshold);
        const msg = next
          ? I18n.t('daily_medal_up').replace('{m}', ModeSignals.dailyMedalLabel(medal)).replace('{n}', next)
          : I18n.t('daily_medal_max');
        Toasts.show(msg, 'good', 2200, ModeSignals.dailyMedalIcon(medal));
      });
    },

    /* Win/Lose: se evalúa tras cada cambio del tablero */
    evaluate() {
      if (State.status !== 'playing' || Coach.active) return;
      // Mínimo de iconos del nivel: mide "lo cerca que estuviste" para el near-miss (GM-01).
      if (State.iconCount < State.minIcons) State.minIcons = State.iconCount;
      // Hooks de modo: pueden forzar victoria/derrota propias (objetivos, oleadas…).
      // Devuelven 'win' | 'lose' | un texto de derrota, o nada para usar la regla base.
      const wc = Rules.call('winCheck', State);
      if (wc) { this.levelComplete(wc === 'perfect'); return; }
      const lc = Rules.call('loseCheck', State);
      if (lc) { this.gameOver(typeof lc === 'string' ? lc : I18n.t('reason_end')); return; }
      const m = Config.MODES[State.mode];
      // Modos sin progresión por niveles: la gestionan sus hooks/temporizador
      // (Supervivencia y Zen = endless; Contrarreloj = score attack).
      if (m.endless || m.scoreAttack) {
        if (State.iconCount > 0) State.emptyBonusClaimed = false;
        else if (!State.emptyBonusClaimed) this.emptyBoardBonus();
        return;
      }
      // VICTORIA = vaciar el tablero (si el objetivo del modo lo admite). NO hay
      // "victoria por estancamiento": si en un instante no hay jugada válida, se
      // espera al siguiente spawn (el spawn continuo creará nuevas convergencias).
      // La DERROTA real llega por overflow (tablero lleno) en doSpawn().
      const bcw = Rules.call('boardClearWins', State);
      if (State.iconCount === 0 && (bcw === undefined || bcw)) { this.levelComplete(true); return; }
    },

    emptyBoardBonus() {
      if (State.emptyBonusClaimed || State.iconCount !== 0) return;
      const m = Config.MODES[State.mode], d = Config.DIFFICULTY[State.diff];
      if (!m || !(m.endless || m.scoreAttack)) return;
      State.emptyBonusClaimed = true;
      State.emptyBoards = (State.emptyBoards || 0) + 1;
      State.perfectEver = true;

      const chain = State.emptyBoards;
      RunLog.attachEmptyBoardChain(chain);
      const wave = State.mode === 'supervivencia' ? Survival.wave : 1;
      const combo = Math.min(State.combo || 1, 12);
      const raw = Config.EMPTY_BOARD_BONUS + chain * 90 + combo * 28 + (State.mode === 'supervivencia' ? wave * 45 : 0);
      const points = GameCore.ready()
        ? GameCore.core.emptyBoardBonusPoints({
          chain, combo, difficulty: State.diff, mode: State.mode, wave,
          feverBoost: this.feverBoost(),
          tempMultiplier: State.tempMult || 1,
          sprintMultiplier: this.sprintMult(),
        })
        : Math.max(250, Math.round(raw * d.scoreMult * m.mult * this.feverBoost() * (State.tempMult || 1) * this.sprintMult()));
      const coins = clamp(Math.round(points / 220), 3, 16);
      const extra = [];
      const center = State.lastActionCell != null
        ? State.lastActionCell
        : (Math.floor(State.size / 2) * State.size + Math.floor(State.size / 2));

      State.score += points;
      State.coinsRun += coins;
      Meta.addCoins(coins);
      Econ.refresh();
      Render.coinsReward(coins, I18n.t('coins'));

      if (State.mode === 'supervivencia') {
        Survival.addSupplyCharge(25);
        Survival.addFrenzy(24);
        Survival._lock(760, 'board-clear-bonus');
        Survival.render();
        extra.push(I18n.t('surv_supply_short'), '+24% ' + I18n.t('surv_frenzy'));
      } else {
        Render.boardEvent('board-clear-bonus', 950);
      }
      if (State.mode === 'zen') {
        State.hintsLeft = Math.min(9, State.hintsLeft + 1);
        extra.push('+1 pista');
        // Jardín zen (GM-23): cada tablero limpio hace crecer una flor (para siempre).
        const fl = Meta.addZenFlower();
        extra.push('🌸 ' + fl);
        // CH-2: un tablero limpio en Zen es un objetivo del pipeline (sin fallo posible,
        // pero limpiar el tablero entero es esfuerzo honesto).
        chestProgressToast(Meta.recordChestProgress('zen'));
        if (fl === 10) { Meta.addChest(1, 'magic', 'zen'); Toasts.show(I18n.t('garden_10'), 'good', 2800, 'chest'); Econ.refresh(); }
        if (fl === 50 && Meta.grantBoard('jardin')) { Toasts.show(I18n.t('garden_50'), 'good', 3400, '🌸'); Sound.record(); FX.confetti(90); }
        Render._hudDirty = true;
      }

      const refilled = Engine.refillAfterEmpty(chain);
      if (refilled.length) {
        Render.syncAll();
        // Cascada radial desde el punto del bonus, arrancando TRAS el aterrizaje del
        // vuelo de convergencia (~305ms): el jugador VE el tablero vacío un instante
        // y el relleno se lee como consecuencia del bonus (antes aparecía en el mismo
        // frame que la última convergencia y era indistinguible de spawns normales).
        const instant = motionOff();
        const cr = center / State.size | 0, cc = center % State.size;
        refilled.forEach((idx) => {
          const dist = Math.abs((idx / State.size | 0) - cr) + Math.abs(idx % State.size - cc);
          Render.refillAnim(idx, instant ? 0 : Math.min(320 + dist * 26, 700));
        });
        State.emptyBonusClaimed = false;
        State.minIcons = Math.min(State.minIcons, State.iconCount);
      }

      const msg = `Tablero limpio · +${points} · +${coins} ${I18n.t('coins')}${extra.length ? ' · ' + extra.join(' · ') : ''}`;
      Toasts.show(msg, 'good', 2400, 'v2:four-pointed-star');
      // El popup del bonus también espera al aterrizaje del vuelo: causalidad legible
      // ("convergió → tablero limpio → bonus"), no tres cosas en el mismo frame.
      if (motionOff()) Render.popup(center, `+${fmtNum(points)} BONUS`, '#ffd84d');
      else setTimeout(() => { if (State.status === 'playing') Render.popup(center, `+${fmtNum(points)} BONUS`, '#ffd84d'); }, 240);
      Render.bump($('#hud-score'));
      if (State.mode === 'zen') Render.bump($('#hud-zen-wrap'));
      Render.flash();
      Sound.boardClear(); Haptics.level();
      if (!State.recordHit && Storage.best > 0 && State.score > Storage.best) {
        State.recordHit = true; Sound.record(); Haptics.record(); Toasts.show(I18n.t('new_record'), 'good', 1600, 'trophy');
      }
      this.saveBest();
      Render.hudSoon();
      announce(`Tablero limpio. Bonus ${points} puntos y ${coins} monedas.`);
      setTimeout(() => FX.boardClear(center, '#ffd84d'), Settings.reducedFx ? 0 : 220);
    },

    resetCombo() {
      State.combo = 0; State.comboMult = 1;
      if (State.fever) {
        State.fever = false;
        Render.feverOut(); // "exhalación" breve al salir de Fiebre (GM-27)
        if (State.mode === 'supervivencia') { Survival._setFrenzyClass(); Survival._syncIntensity(); }
        else { Render.fever(false); if (Settings.music) Music.setIntensity(0.15); }
      }
      Render.combo();
    },

    levelComplete(perfect) {
      State.status = 'levelComplete'; this.clearHintHighlight();
      if (perfect) {
        // Bono plano de tablero perfecto: lo cobran los modos sin bono escalado.
        const bonus = GameCore.ready() ? GameCore.core.PERFECT_BOARD_BONUS : Config.EMPTY_BOARD_BONUS;
        State.perfectEver = true; State.score += bonus;
        Toasts.show(`¡Tablero limpio! +${bonus}`, 'good'); Render.flash();
      }
      this.saveBest(); Render.hud(); Render.fever(false); State.fever = false;
      const m = Config.MODES[State.mode];
      if (m.single) { this.win(perfect ? '¡Tutorial completado con tablero perfecto!' : '¡Tutorial completado!'); return; }
      Sound.level(); Haptics.level(); FX.confetti(perfect ? 90 : 60);
      // CH-2: superar un nivel de Aventura cuenta como objetivo del pipeline
      // (Contrarreloj puntúa al FINAL de la run por score, en recordGame).
      if (State.mode === 'aventura') chestProgressToast(Meta.recordChestProgress('aventura'));
      // Modo Clásico: nivel del mapa. Calcula estrellas, guarda progreso y ofrece
      // "Siguiente nivel" / "Volver al mapa" (el mapa es el hub, no se auto-encadena).
      if (State.mode === 'clasico') { this._classicComplete(); return; }

      const next = State.level + 1;
      // Acento del modal: color del bioma siguiente (Aventura) o del modo.
      const accent = State.mode === 'aventura' ? Adventure.biomeOf(next).accent : (m.accent || '#00d0ff');
      const modal = $('#modal-level'); if (modal) modal.style.setProperty('--modal-accent', accent);
      const emb = $('#level-emblem'); if (emb) emb.innerHTML = perfect ? icon('star') : (State.mode === 'aventura' ? (BIOME_IMG[Adventure.biomeOf(State.level).id] ? iconAny(BIOME_IMG[Adventure.biomeOf(State.level).id]) : Adventure.biomeOf(State.level).glyph) : (MODE_IMG[State.mode] ? iconAny(MODE_IMG[State.mode]) : (m.emoji || '⭐')));

      $('#level-title').textContent = perfect ? I18n.t('perfect_done') : I18n.t('level_done');
      let levelSub = perfect
        ? I18n.t('perfect_sub').replace('{b}', Config.EMPTY_BOARD_BONUS)
        : I18n.t('level_sub').replace('{n}', State.level);
      if (State.mode === 'aventura') levelSub += ' · ' + Adventure.completionReason();
      $('#level-sub').textContent = levelSub;

      // Resumen de la partida hasta ahora (chips premium)
      $('#level-stats').innerHTML = statRow([
        [State.score, I18n.t('st_points'), 'var(--score)'],
        ['×' + State.maxCombo, I18n.t('st_combo'), 'var(--gold)'],
        [State.removedTotal, I18n.t('st_removed'), 'var(--good)'],
      ]);

      // Preview coherente del siguiente nivel (iconos que vienen + deltas + objetivo)
      $('#level-next').innerHTML = this._nextPreview(next, m);
      $('#btn-next-level').textContent = I18n.t('next_to').replace('{n}', next);

      { const mb = $('#btn-level-map'); if (mb) mb.hidden = true; }
      { const nb = $('#btn-next-level'); if (nb) nb.hidden = false; }
      Modal.open('modal-level');
      announce(I18n.t('sr_level').replace('{n}', State.score));
    },

    // Fin de nivel del modo Clásico: estrellas (según errores), recompensa y desbloqueo.
    _classicComplete() {
      const n = State.worldLevel || 1, w = Worlds.get(State.world);
      const stars = this.starsForMistakes(State.mistakes);
      // Un nivel clásico es una partida completa: liquida aquí su progresión
      // porque volver al mapa no pasa por endGame(). Esto hace que el XP booster
      // cubra también el flujo principal sin duplicar la recompensa al navegar.
      this.metaResult = Meta.recordGame({
        score: State.score, level: State.level, maxCombo: State.maxCombo,
        removed: State.removedTotal, elapsed: State.elapsed, mode: State.mode,
        perfect: State.perfectEver, fever: State.feverEver, daily: false,
        awardBaseCoins: false,
        xpMultiplier: State.xpMultiplier,
      });
      const mastery = Meta.recordClassicPerfect(stars >= 3);
      this.classicMastery = mastery;
      const gained = Meta.setLevelStars(State.world, n, stars);
      // Racha de victorias (GM-05): +10% de monedas por nivel de racha desde la 2ª
      // victoria seguida, tope +50% — recompensa el "una más" sin castigar el fallo.
      const winStreak = Meta.recordClassicWin(true);
      // CH-2: cada nivel de Clásico superado alimenta el pipeline de cofres.
      chestProgressToast(Meta.recordChestProgress('clasico'));
      const streakPct = Math.min(5, Math.max(0, winStreak - 1)) * 10;
      const coins = Math.round((20 + stars * 10 + Math.round(State.score / 60)) * (1 + streakPct / 100));
      Meta.addCoins(coins);
      const coinsTotal = coins + (this.metaResult.coinsGained || 0);
      const modal = $('#modal-level'); if (modal) modal.style.setProperty('--modal-accent', w.accent);
      const emb = $('#level-emblem'); if (emb) emb.innerHTML = stars >= 3 ? icon('star') : (WORLD_IMG[w.id] ? iconAny(WORLD_IMG[w.id]) : w.glyph);
      $('#level-title').textContent = I18n.t('level_done');
      $('#level-sub').textContent = I18n.t('classic_lvl_sub').replace('{n}', n).replace('{w}', w.name);
      const e = Config.STAR_ERR;
      // Criterio de cada estrella, resaltando la que el jugador NO logró por errores.
      const crit = [
        { s: 3, txt: I18n.t('star_c3') },
        { s: 2, txt: I18n.t('star_c2').replace('{n}', e[1]) },
        { s: 1, txt: I18n.t('star_c1') },
      ].map((c) => `<span class="sc-row${c.s === stars ? ' got' : ''}${c.s > stars ? ' missed' : ''}"><span class="sc-st">${'★'.repeat(c.s)}</span>${c.txt}</span>`).join('');
      const starsHtml = `<div class="classic-stars" aria-label="${stars}/3">` +
        [1, 2, 3].map(k => `<span class="cs${k <= stars ? ' on' : ''}">${k <= stars ? iconInline('star') : iconInline('star-empty')}</span>`).join('') + '</div>' +
        `<div class="star-criteria">${crit}<span class="sc-mine">${I18n.t('star_mine').replace('{n}', State.mistakes)}</span></div>`;
      $('#level-stats').innerHTML = starsHtml + statRow([
        [State.score, I18n.t('st_points'), 'var(--score)'],
        ['×' + State.maxCombo, I18n.t('st_combo'), 'var(--gold)'],
        [State.removedTotal, I18n.t('st_removed'), 'var(--good)'],
      ]);
      const masteryHtml = mastery.streak > 0
        ? `<div class="classic-mastery">${iconInline('star')} ${esc(I18n.t('classic_streak').replace('{n}', mastery.streak))}<small>${esc(I18n.t('classic_best_streak').replace('{n}', mastery.best))}</small></div>`
        : `<div class="classic-mastery reset">${esc(I18n.t('classic_streak_lost'))}<small>${esc(I18n.t('classic_best_streak').replace('{n}', mastery.best))}</small></div>`;
      const streakHtml = streakPct > 0
        ? `<div class="win-streak-line">${esc(I18n.t('classic_win_streak').replace('{n}', winStreak).replace('{p}', streakPct))}</div>`
        : '';
      const xpReward = `<div class="classic-xp-reward">${iconInline('potion')} +${fmtNum(this.metaResult.xpGained)} XP${this.metaResult.xpMultiplier === XP_BOOST_MULTIPLIER ? `<span>×${XP_BOOST_MULTIPLIER}</span>` : ''}</div>`;
      $('#level-next').innerHTML = `<div class="m-card-h">${iconInline('coin')} +${coinsTotal}${gained > 0 ? ' · ' + iconInline('star') + ' +' + gained : ''}</div>${xpReward}${streakHtml}${masteryHtml}`;
      if (mastery.streak >= 2) Toasts.show(I18n.t('classic_streak').replace('{n}', mastery.streak), 'good', 1700, 'star');
      if (this.metaResult.leveledUp) Toasts.show(`${I18n.t('lvl')} ${Meta.level()}!`, 'good', 2100, 'upgrade');
      if (this.metaResult.weeklyChest) Toasts.show(I18n.t('chest_weekly_won'), 'good', 2600, 'chest');
      Econ.refresh(); updateTopBars();
      const last = n >= Worlds.PER_WORLD;
      { const nb = $('#btn-next-level'); if (nb) { nb.hidden = last; nb.textContent = I18n.t('classic_next'); } }
      { const mb = $('#btn-level-map'); if (mb) mb.hidden = false; }
      Modal.open('modal-level');
      announce(I18n.t('sr_stars').replace('{s}', stars).replace('{n}', State.score));
    },

    // Vuelve al mapa de mundos desde el modal de fin de nivel.
    toWorldsMap() {
      Loop.stop(); Music.stop(); State.status = 'idle'; this.ended = true;
      Modal.close(); ModeSignals.clear(); this.clearHintHighlight();
      Worlds.open();
    },

    // Construye el HTML del preview del siguiente nivel, consciente del modo.
    _nextPreview(next, m) {
      const pool = Engine.poolForLevel(next);
      const curSpawn = Engine.spawnRateForLevel(State.level) / 1000, nxtSpawn = Engine.spawnRateForLevel(next) / 1000;
      const curVar = Engine.poolForLevel(State.level).length, nxtVar = pool.length;
      const packId = Meta.equippedIconPack();
      const icons = pool.map(id => `<span class="ic-chip" title="${esc(IconPacks.iconName(packId, id, Settings.lang))}">${IconPacks.svg(packId, id)}</span>`).join('');
      let head, extra = '';
      if (State.mode === 'aventura') {
        const bi = Adventure.biomeOf(next), ch = Adventure.chapterOf(next), boss = Adventure.isBoss(next);
        const newChapter = ch !== Adventure.chapterOf(State.level);
        head = `${BIOME_IMG[bi.id] ? iconAnyInline(BIOME_IMG[bi.id]) : bi.glyph} ${I18n.t('chapter')} ${ch + 1} · ${Adventure.biomeName(bi)}`;
        extra = `<div class="m-goal${boss ? ' boss' : ''}">${boss ? iconInline('warning') + ' ' : iconInline('target') + ' '}${Adventure.previewObjective(next)}</div>`;
        if (newChapter && bi.mods.length) extra += `<div class="m-mod">${Adventure.biomeModText(bi)}</div>`;
      } else {
        head = `${I18n.t('next')} · ${I18n.t('lvl')} ${next}`;
      }
      // (Contrarreloj ya no progresa por niveles, así que no hay preview de tiempo.)
      const deltas = `<span class="delta">${iconInline('bolt')} ${curSpawn.toFixed(1)}s → <strong>${nxtSpawn.toFixed(1)}s</strong></span>` +
        `<span class="delta">${iconInline('dice')} ${curVar} → <strong>${nxtVar}</strong></span>`;
      return `<div class="m-card-h">${head}</div>` +
        `<div class="ic-label">${I18n.t('new_icons')}</div>` +
        `<div class="ic-row">${icons}</div>` +
        `<div class="deltas">${deltas}</div>${extra}`;
    },

    nextLevel() {
      Toasts.reset();
      // Clásico: avanza al siguiente nivel del mundo (ya desbloqueado) y sigue jugando.
      if (State.mode === 'clasico') {
        State.worldLevel = (State.worldLevel || 1) + 1;
        State.level = State.worldLevel;
        State.xpMultiplier = Meta.xpBoost().multiplier;
        refreshXpBoostIndicators();
        // Estadísticas POR NIVEL: cada nivel se puntúa/valora desde cero (las estrellas
        // dependen solo de los errores de ESE nivel, no de los acumulados del mundo).
        State.score = 0; State.displayScore = 0; State.mistakes = 0; State.elapsed = 0;
        State.combo = 0; State.comboMult = 1; State.comboAt = 0; State.maxCombo = 0; State.removedTotal = 0;
        State.perfectEver = false; State.feverEver = false;
        State.bestPlay = null; State.recordHit = false; // el pico/récord se puntúa por nivel (GM-28)
        State.fever = false; Render.fever(false);
        State.status = 'playing'; Modal.close();
        this.setupLevel(); this.showGoalBanner(); Loop.start();
        Toasts.show(`${I18n.t('lvl')} ${State.worldLevel}`, 'info', 1300);
        return;
      }
      const prevChapter = State.mode === 'aventura' ? Adventure.chapterOf(State.level) : -1;
      State.level++;
      State.status = 'playing';
      Modal.close();
      this.setupLevel(); // tablero fresco con la variedad/velocidad/tiempo del nuevo nivel
      // El bucle se detuvo al mostrarse el modal (status != playing); hay que reiniciarlo.
      Loop.start();
      if (State.mode === 'aventura') {
        Meta.advReach(State.level);
        const ch = Adventure.chapterOf(State.level);
        if (ch !== prevChapter) { const bi = Adventure.biomeOf(State.level); Toasts.show(`${I18n.t('chapter')} ${ch + 1}: ${Adventure.biomeName(bi)}`, 'good', 2200, BIOME_IMG[bi.id] || bi.glyph); }
        else Toasts.show(`${I18n.t('lvl')} ${State.level}`, 'info', 1200);
        // Entrada de capítulo: reliquia por el jefe superado (GM-07) y luego la
        // ruta del capítulo nuevo (GM-06) — recompensa primero, plan después.
        if (Adventure.licOf(State.level) === 0) {
          const chain = () => Adventure.offerRelic(() => Adventure.maybeOfferRoute(State.level));
          if (!Adventure.maybeChapterIntro(State.level, chain)) chain();
        }
      } else {
        Toasts.show(`${I18n.t('lvl')} ${State.level}`, 'info', 1400);
      }
    },

    // Aplica emblema y color de acento al modal de fin de partida.
    _overChrome(iconName, accent, fallbackEmoji) {
      const e = $('#over-emblem'); if (e) { if (iconName) e.innerHTML = iconAny(iconName); else e.textContent = fallbackEmoji || ''; }
      const mo = $('#modal-over'); if (mo) mo.style.setProperty('--modal-accent', this.newRecord || this._survNew || this._survWaveNew ? 'var(--gold)' : accent);
    },

    win(reason) {
      Toasts.reset();
      this.endGame();
      Sound.level(); Haptics.level(); FX.confetti(110);
      $('#over-title').textContent = I18n.t('over_victory').replace(/^[^A-Za-z0-9¿¡]+/, '').trim();
      this._overChrome('trophy', 'var(--gold)');
      $('#over-reason').textContent = reason;
      this.fillStats(); Modal.open('modal-over');
      announce(`¡Victoria! Puntuación ${State.score}.`);
    },

    gameOver(reason) {
      if (this.ended) return;
      // La bitácora se cierra aquí: lo que venga después (resúmenes, cofres) ya
      // no es partida y no puede añadir eventos a una run terminada.
      RunLog.stop();
      // Publicar es un extra opcional y asincrono: nunca se espera a que
      // termine ni se deja que un fallo suyo interrumpa el fin de partida.
      void Ranks.publishRun();
      // Cierra el relato de la jugada anterior antes de encolar resultados de run.
      Toasts.reset();
      // Supervivencia: registra el récord de tiempo sobrevivido.
      this._survNew = false; this._survWaveNew = false; this._survRunResult = null;
      if (State.mode === 'supervivencia') {
        this._survNew = Meta.survRecord(Survival.survSec);
        this._survWaveNew = Survival.newWaveRecord || Meta.survWaveRecord(Survival.wave);
        // Hoja de Servicio (SV-30/32): acumula lo vitalicio + récord semanal ligado
        // al mutador. Y la hazaña 'fenix' (batir récord habiendo revivido).
        const rankRes = Meta.recordSurvivalRun({ wave: Survival.wave, bosses: Survival._bossesSurvived || 0 });
        chestProgressToast(rankRes.pipeline);
        const weekRes = Meta.survWeekRecord(Survival._weekKey(), Survival.wave, Survival.mut.id);
        if (weekRes.distinctMuts >= 3) Survival._feat('semana_completa');
        if (this._survWaveNew && Survival.revives > 0) Survival._feat('fenix');
        this._survRunResult = { rankUp: rankRes.rankUp, rank: rankRes.rank, weekBest: Meta.survWeekBest() };
      }
      // Reto diario: registra la marca y premia el primer intento del día.
      if (State.isDaily) {
        const r = Meta.recordDailyRun(State.score);
        this.dailyRunResult = r;
        if (r.firstToday) Toasts.show(I18n.t('daily_first_reward'), 'good', 2400, '💎');
        else if (r.newBest) Toasts.show(I18n.t('daily_new_best').replace('{n}', r.best), 'good', 2200, '🎯');
        if (r.medal !== 'none') Toasts.show(I18n.t('daily_medal_result').replace('{m}', ModeSignals.dailyMedalLabel(r.medal)), 'good', 2200, 'medal');
        if (r.streakChest) { Toasts.show(I18n.t('daily_streak_chest').replace('{n}', r.streak), 'good', 2800, 'chest'); Sound.record(); FX.confetti(70); }
        chestProgressToast(r.pipeline);
        // Ghost del día (GM-12): si es la mejor marca de hoy, guarda su línea de tiempo.
        if (r.newBest) { State.ghostSamples.push(State.score); Meta.setDailyGhost(State.ghostSamples); }
      } else if (Config.MODES[State.mode].scoreAttack && State.score > Meta.modeBest(State.mode)) {
        // Ghost de Contrarreloj libre (GM-12): línea de tiempo del récord del modo.
        State.ghostSamples.push(State.score);
        Meta.setModeGhost(State.mode, State.ghostSamples);
      }
      if (State.mode === 'clasico') { this.classicMastery = Meta.recordClassicPerfect(false); Meta.recordClassicWin(false); }
      this.endGame();
      Sound.over(); Haptics.error(); Render.boardShake();
      const m = Config.MODES[State.mode];
      // Título coherente por modo: Contrarreloj (score-attack) no es un "fallo",
      // es una marca de puntos/tiempo; Supervivencia es "fin de la supervivencia";
      // solo Clásico/Aventura pueden fallar una misión.
      let overTitleKey = 'over_fail', overIcon = MODE_IMG[State.mode];
      if (State.mode === 'supervivencia') { overTitleKey = 'over_surv'; overIcon = 'shield'; }
      else if (m.scoreAttack) { overTitleKey = 'over_time'; overIcon = MODE_IMG[State.mode] || 'clock'; }
      $('#over-title').textContent = I18n.t(overTitleKey).replace(/^[^A-Za-z0-9¿¡]+/, '').trim();
      this._overChrome(overIcon, m.accent || '#ff5d73', m.emoji || '🏁');
      $('#over-reason').textContent = reason;
      { const mo = $('#modal-over'); if (mo) mo.dataset.mode = State.mode; }
      this.fillStats(); Modal.open('modal-over');
      announce(reason + ' ' + I18n.t('sr_over').replace('{n}', State.score));
    },

    endGame() {
      Picker.dismiss(); // B-06: ninguna elección puede sobrevivir al fin de partida
      { const pl = $('#prelevel'); if (pl) pl.hidden = true; }
      Loop.stop(); Music.stop(); State.status = 'over'; this.ended = true; this.clearHintHighlight();
      Render.fever(false); State.fever = false; Render.danger(0);
      if (State.mode === 'supervivencia') { Survival.cleanup(); document.body.classList.remove('mode-surv'); }
      this.newRecord = State.score > Storage.best && State.score > 0;
      this.saveBest();
      // Progresión persistente (XP, logros, misión diaria, racha)
      this.metaResult = Meta.recordGame({
        score: State.score, level: State.level, maxCombo: State.maxCombo,
        removed: State.removedTotal, elapsed: State.elapsed, mode: State.mode,
        perfect: State.perfectEver, fever: State.feverEver, daily: !!State.isDaily,
        xpMultiplier: State.xpMultiplier,
      });
      // CH-2: feedback inmediato de cofres ganados al cerrar la partida.
      chestProgressToast(this.metaResult.pipeline);
      if (this.metaResult.weeklyChest) Toasts.show(I18n.t('chest_weekly_won'), 'good', 2600, 'chest');
    },

    fillStats() {
      const isSurv = State.mode === 'supervivencia';
      const overModal = $('#modal-over');
      if (overModal) overModal.classList.toggle('is-survival', isSurv);

      const rec = $('#over-record');
      if (rec) {
        // En Supervivencia el récord de OLEADA lo muestra el héroe (SV-22): aquí solo
        // el récord de tiempo/score, para no duplicar el trofeo.
        rec.hidden = !this.newRecord && !this._survNew;
        if (this._survNew) rec.innerHTML = iconInline('shield') + ' ' + I18n.t('surv_time_record');
        else if (this.newRecord) rec.innerHTML = iconInline('trophy') + ' ' + I18n.t('new_record');
      }

      {
        const score = $('#over-score');
        if (score) {
          score.innerHTML = `<span class="over-score-v">${State.score}</span><span class="over-score-k">${esc(I18n.t('st_points'))}</span>`;
          countUp($('#over-score .over-score-v'), State.score, 700);
        }
      }

      // Héroe de Supervivencia (SV-22): la OLEADA como protagonista + contexto de
      // récord. El near-miss de récord es el motor del reintento inmediato ("a 2 de
      // tu marca" convierte la derrota en asunto pendiente).
      {
        const hero = $('#over-hero'), run = $('#over-run'), ledger = $('#over-ledger');
        if (ledger) ledger.hidden = !isSurv;
        if (hero) {
          hero.hidden = !isSurv;
          if (isSurv) {
            const wave = Survival.wave, best = Meta.survBestWave();
            let ctx, ctxCls;
            if (this._survWaveNew) { ctx = I18n.t('surv_over_wave_new'); ctxCls = 'gold'; }
            else if (best > 0 && best - wave > 0 && best - wave <= 3) { ctx = I18n.t('surv_over_wave_near').replace('{k}', best - wave).replace('{best}', best); ctxCls = 'near'; }
            else if (best > 0) { ctx = I18n.t('surv_over_record').replace('{best}', best); ctxCls = ''; }
            else { ctx = ''; ctxCls = ''; }
            hero.innerHTML = `<div class="oh-wave"><span class="oh-label">${esc(I18n.t('over_wave_reached'))}</span><span class="oh-num">${wave}</span></div>`
              + (ctx ? `<div class="oh-ctx ${ctxCls}">${esc(ctx)}</div>` : '');
          }
        }
        // Hoja de la run: cadena de bendiciones + jefes superados.
        if (run) {
          const log = isSurv ? (Survival._boonLog || []) : [];
          const bosses = isSurv ? (Survival._bossesSurvived || 0) : 0;
          run.hidden = !isSurv;
          if (isSurv) {
            const boonIcon = { life: 'heart', charge: 'bolt', slow: 'clock', pack: 'bomb', frenzy: 'fire', magnet: 'magnet', score_boost: 'stats', golden_wave: 'crown' };
            const chips = log.length
              ? log.map((b) => `<span class="or-boon" title="${esc(I18n.t('boon_' + b.id))}">${boonIcon[b.id] ? iconAnyInline(boonIcon[b.id]) : esc(b.icon || '✨')}</span>`).join('')
              : `<span class="or-empty">${esc(I18n.t('over_no_boons'))}</span>`;
            run.innerHTML =
              `<div class="or-build"><div class="or-label">${esc(I18n.t('over_boons'))}</div><div class="or-boons">${chips}</div></div>` +
              `<div class="or-boss-card"><span class="or-label">${esc(I18n.t('over_bosses'))}</span><b>${bosses}</b><small>${esc(I18n.t('over_bosses_cleared'))}</small></div>`;
          }
        }
        // Progreso de rango (SV-30): "+N oleadas de servicio → Rango: total/next".
        const svc = $('#over-service');
        if (svc) {
          const res = this._survRunResult;
          svc.hidden = !(isSurv && res);
          if (isSurv && res) {
            const rk = res.rank;
            const rankName = I18n.t('srank_' + rk.id);
            const nextName = rk.next ? I18n.t('srank_' + rk.next) : I18n.t('surv_rank_max');
            const prog = rk.nextAt ? `${rk.total}/${rk.nextAt}` : '★';
            const span = rk.nextAt ? Math.max(1, rk.nextAt - rk.at) : 1;
            const pct = rk.nextAt ? clamp((rk.total - rk.at) / span * 100, 0, 100) : 100;
            const toward = rk.nextAt ? I18n.t('over_toward_rank').replace('{r}', nextName) : I18n.t('surv_rank_max');
            const reason = I18n.t(rk.nextAt ? 'over_rank_reason' : 'over_rank_reason_max').replace('{w}', Survival.wave);
            svc.innerHTML =
              `<div class="os-top"><div><span class="os-label">${esc(I18n.t('over_service_rank'))}</span><b class="os-rank">${esc(rankName)}</b></div>` +
              (res.rankUp ? `<span class="os-up">${iconInline('upgrade')} ${esc(I18n.t('over_rank_up_short'))}</span>` : '') + `</div>` +
              `<div class="os-grid">` +
              `<span><b>+${Survival.wave}</b><small>${esc(I18n.t('over_this_run_waves'))}</small></span>` +
              `<span><b>${esc(prog)}</b><small>${esc(toward)}</small></span>` +
              `<span><b>1:1</b><small>${esc(I18n.t('over_wave_progress_unit'))}</small></span>` +
              `</div>` +
              `<div class="os-bar"><span style="width:${pct.toFixed(0)}%"></span></div>` +
              `<div class="os-reason">${esc(reason)}</div>`;
            svc.classList.toggle('rankup', !!res.rankUp);
          }
        }
      }
      // Near-miss (GM-01): "te quedaste a {n} figuras" — solo cuando aplica (derrota por
      // tablero lleno en Clásico/Aventura habiendo estado realmente cerca de vaciar).
      {
        const nm = $('#over-near'); if (nm) {
          nm.hidden = this._nearMiss == null;
          if (this._nearMiss != null) nm.textContent = I18n.t('near_miss').replace('{n}', this._nearMiss);
          this._nearMiss = null;
        }
      }
      // Momento destacado (GM-28): la mejor jugada de la partida (regla pico-final).
      {
        const pk = $('#over-peak'); if (pk) {
          const bp = State.bestPlay;
          const show = !!bp && bp.points >= 50;
          pk.hidden = !show;
          if (show) {
            const wherePill = State.mode === 'supervivencia'
              ? `<span class="op-pill">${iconAnyInline('fire')} ${esc(I18n.t('st_wave'))} ${bp.wave}</span>`
              : ((State.mode === 'clasico' || State.mode === 'aventura') ? `<span class="op-pill">${iconAnyInline('pin')} ${esc(I18n.t('lvl'))} ${bp.level}</span>` : '');
            const note = State.mode === 'supervivencia'
              ? I18n.t('over_peak_note_surv').replace('{c}', bp.combo).replace('{w}', bp.wave)
              : I18n.t('over_peak_note_level').replace('{c}', bp.combo);
            pk.innerHTML =
              `<section class="over-peak-card" aria-label="${esc(I18n.t('over_peak_title'))}">` +
              `<div class="op-main"><div class="op-medal">${iconInline('star')}</div><div class="op-copy">` +
              `<div class="op-kicker"><span>${esc(I18n.t('over_peak_title'))}</span><small>${esc(I18n.t('over_peak_sub'))}</small></div>` +
              `<div class="op-score"><b>+${bp.points}</b><span>${esc(I18n.t('over_peak_points'))}</span></div>` +
              `<div class="op-pills"><span class="op-pill strong">${iconAnyInline('bolt')} ${esc(I18n.t('over_peak_combo'))} ×${bp.combo}</span>${wherePill}<span class="op-pill">${iconAnyInline('star')} ${esc(I18n.t('over_peak_chain'))}</span></div>` +
              `</div></div><div class="op-note">${esc(note)}</div></section>`;
          }
        }
      }
      const m = Config.MODES[State.mode];
      // Resumen coherente por modo
      let summary;
      if (State.mode === 'supervivencia') summary = I18n.t('sum_wave').replace('{w}', Survival.wave).replace('{s}', Math.floor(Survival.survSec));
      else if (State.mode === 'aventura') summary = I18n.t('sum_chapter').replace('{c}', Adventure.chapterOf(State.level) + 1).replace('{n}', State.level);
      else if (m.timed) summary = I18n.t('sum_time').replace('{t}', fmtTime(State.elapsed));
      else summary = I18n.t('sum_level').replace('{n}', State.level);
      $('#over-meta').textContent = `${I18n.modeT(State.mode, 'name')} · ${I18n.t('diff_' + State.diff)} · ${summary}`;
      const rows = State.mode === 'supervivencia' ? [
        [Survival.wave, I18n.t('st_wave'), 'var(--level)'],
        [Meta.survBestWave(), I18n.t('surv_best_wave'), 'var(--warn)'],
        ['×' + State.maxCombo, I18n.t('st_combo'), 'var(--gold)'],
        [State.removedTotal, I18n.t('st_removed'), 'var(--good)'],
        [Math.floor(Survival.survSec) + 's', I18n.t('st_surv'), 'var(--time)'],
        [Meta.survBest() + 's', I18n.t('st_best'), 'var(--gold)'],
      ] : [
        [State.level, I18n.t('st_level'), 'var(--level)'],
        ['×' + State.maxCombo, I18n.t('st_combo'), 'var(--gold)'],
        [State.removedTotal, I18n.t('st_removed'), 'var(--good)'],
        [fmtTime(State.elapsed), I18n.t('st_time'), 'var(--time)'],
        [Storage.best, I18n.t('st_record'), 'var(--gold)'],
      ];
      $('#over-stats').innerHTML = statRow(rows);
      // Progresión: XP ganada, barra de perfil, misión y logros nuevos
      const r = this.metaResult || { xpBase: 0, xpMultiplier: 1, xpBoostBonus: 0, xpGained: 0, coinsGained: 0, leveledUp: 0, newAch: [], missionDone: false };
      const lvl = Meta.level(), need = Meta.xpForLevel(lvl), have = Meta.xp();
      const boostedXp = r.xpMultiplier === XP_BOOST_MULTIPLIER;
      const xpBreakdown = boostedXp
        ? `<div class="xp-boost-breakdown">${iconInline('potion')} ${esc(I18n.t('xp_result_breakdown').replace('{base}', fmtNum(r.xpBase)).replace('{mult}', r.xpMultiplier).replace('{bonus}', fmtNum(r.xpBoostBonus)))}</div>`
        : '';
      const survRewards = State.mode === 'supervivencia'
        ? `<div class="mission-done surv-rewards">${iconInline('coin')} ${I18n.t('surv_reward_line').replace('{c}', Survival.runCoins).replace('{g}', Survival.runGems).replace('{ch}', Survival.runChests)}</div>`
        : '';
      const dailyResult = ModeSignals.dailyResultHtml(this.dailyRunResult);
      const modeResult = ModeSignals.resultHtml();
      $('#over-xp').innerHTML =
        `<div class="xp-line${boostedXp ? ' is-boosted' : ''}"><span class="xp-gain">+${r.xpGained} XP</span>${boostedXp ? `<span class="xp-boost-result">XP ×${r.xpMultiplier}</span>` : ''}<span class="xp-coins">${iconInline('coin')} <span class="xp-coins-n">+${r.coinsGained || 0}</span></span><span class="xp-rank">${Meta.rank()} · ${I18n.t('lvl')} ${lvl}</span></div>` +
        `<div class="xpbar"><div class="xpbar-fill" style="width:${Math.min(100, have / need * 100).toFixed(0)}%"></div></div>` +
        xpBreakdown +
        (r.leveledUp ? `<div class="xp-up">${iconInline('upgrade')} ${I18n.t('lvl')} ${lvl}!</div>` : '') +
        (r.missionDone ? `<div class="mission-done">${iconInline('check')} ${I18n.t('daily_done')} · +150 XP</div>` : '') +
        (r.weeklyDone ? `<div class="mission-done">${iconInline('calendar')} ${I18n.t('weekly_done')} · +400 XP</div>` : '') +
        survRewards + dailyResult + modeResult;
      countUp($('#over-xp .xp-gain'), r.xpGained, 700, '+', ' XP');
      countUp($('#over-xp .xp-coins-n'), r.coinsGained || 0, 700, '+', '');
      $('#over-ach').innerHTML = r.newAch.length
        ? '<div class="ach-new">' + iconInline('medal') + ' ' + r.newAch.map(a => a.name).join(' · ') + '</div>' : '';
      // Registro de expedición (GM-09): la run de Aventura como historia contable.
      {
        const ex = $('#over-exped'); if (ex) {
          const html = State.mode === 'aventura' ? Adventure.expeditionHtml() : '';
          ex.hidden = !html; ex.innerHTML = html;
        }
      }
      { const nx = $('#over-next'); if (nx) nx.innerHTML = NextActions.html(r); }
      if (r.leveledUp) { setTimeout(() => { Sound.record(); FX.confetti(60); }, 350); }
      if (r.newAch.length) { setTimeout(() => { Sound.milestone(); Toasts.show(I18n.t('ach_unlocked').replace('{n}', r.newAch[0].name), 'good', 2400); }, 600); }
    },

    saveBest() { if (State.score > Storage.best) Storage.best = State.score; },

    /* Pista manual: 3 por nivel, con enfriamiento */
    hint() {
      if (State.status !== 'playing') return;
      if (State.hintsLeft <= 0) { Toasts.show('Sin pistas en este nivel', 'warn', 1400); return; }
      if (performance.now() < State.hintReadyAt) { Toasts.show('Pista recargando…', 'warn', 1200); return; }
      for (let i = 0; i < State.board.length; i++) {
        if (State.board[i] === null) {
          const conv = Engine.converging(i);
          if (conv.length >= 2) {
            this.clearHintHighlight();
            this.hintCells = conv.concat(i);
            Render.hint(this.hintCells, true);
            State.hintsLeft--; State.hintReadyAt = performance.now() + Config.HINT_COOLDOWN;
            Render.hud();
            this.hintHideTimer = setTimeout(() => this.clearHintHighlight(), Config.HINT_DURATION);
            Sound.tap();
            return;
          }
        }
      }
      Toasts.show('No hay jugadas ahora mismo', 'warn', 1400);
    },
    clearHintHighlight() { clearTimeout(this.hintHideTimer); if (this.hintCells.length) { Render.hint(this.hintCells, false); this.hintCells = []; } },
  };

  /* ===================== Input ===================== */
  const Input = {
    init() {
      const board = $('#board');
      // Los potenciadores apuntables funcionan en Supervivencia y en Clásico (GM-03).
      const armed = () => (State.mode === 'supervivencia' || State.mode === 'clasico') && Survival.armed;
      // Activación rápida por pointerdown (sin retardo)
      board.addEventListener('pointerdown', (e) => {
        const cell = e.target.closest('.cell');
        if (!cell) return;
        e.preventDefault();
        Sound.ensure();
        // Power-up apuntado armado: aplicar en la casilla elegida en vez de jugar.
        if (armed()) { Survival.applyBoosterAt(Survival.armed, +cell.dataset.i); return; }
        Game.activate(+cell.dataset.i);
      });
      // Previsualización del área afectada mientras se apunta (hover ratón / arrastre táctil).
      board.addEventListener('pointermove', (e) => {
        if (!armed()) return;
        const cell = e.target.closest('.cell');
        Survival.previewAt(cell ? +cell.dataset.i : null);
      });
      board.addEventListener('pointerleave', () => { if (armed()) Survival.previewAt(null); });
      // Teclado: roving tabindex + flechas + Enter/Espacio
      board.addEventListener('keydown', (e) => {
        const cell = e.target.closest('.cell'); if (!cell) return;
        let i = +cell.dataset.i; const s = State.size;
        let n = i;
        if (e.key === 'ArrowRight') n = i % s === s - 1 ? i : i + 1;
        else if (e.key === 'ArrowLeft') n = i % s === 0 ? i : i - 1;
        else if (e.key === 'ArrowUp') n = i - s < 0 ? i : i - s;
        else if (e.key === 'ArrowDown') n = i + s >= s * s ? i : i + s;
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Sound.ensure(); if (armed()) { Survival.applyBoosterAt(Survival.armed, i); } else { Game.activate(i); } return; }
        else return;
        e.preventDefault();
        if (n !== i) { Render.cells[i].tabIndex = -1; Render.cells[n].tabIndex = 0; Render.cells[n].focus(); }
      });
    },
  };

  /* ===================== Construcción de menús ===================== */
  /* ===================== Lanzadores de modos =====================
   * Los cinco modos comparten el panel de la referencia de Supervivencia. El
   * chasis, el orden de lectura y el CTA permanecen estables; solo cambia la
   * información real de cada modo. Así se evita volver a una colección de
   * diálogos inconexos y cada tarjeta conserva un único punto de entrada.
   */
  const MODE_LAUNCH_META = {
    clasico: {
      tag: 'ml_classic_tag', cta: 'ml_classic_cta',
      emblem: 'img/ui-generated/mode-launch/mode-classic.png', startIcon: 'img/ui-generated/mode-launch/target.png',
    },
    aventura: {
      tag: 'ml_adv_tag', cta: 'ml_adv_cta',
      emblem: 'img/ui-generated/mode-launch/mode-adventure.png', startIcon: 'img/ui-generated/mode-launch/rocket.png',
    },
    contrarreloj: {
      tag: 'ml_timed_tag', cta: 'ml_timed_cta',
      emblem: 'img/ui-generated/mode-launch/mode-timed.png', startIcon: 'img/ui-generated/mode-launch/clock.png',
    },
    supervivencia: {
      tag: 'ml_surv_tag', cta: 'surv_start',
      emblem: 'img/ui-generated/mode-launch/survival-emblem.png', startIcon: 'img/ui-generated/mode-launch/heart.png',
    },
    zen: {
      tag: 'ml_zen_tag', cta: 'ml_zen_cta',
      emblem: 'img/ui-generated/mode-launch/mode-zen.png', startIcon: 'img/ui-generated/mode-launch/leaf.png',
    },
  };

  // Contrato de sesión visible y común: antes de jugar siempre se entiende cuánto
  // dura, si se puede retomar, cómo termina y qué entrada/recompensa usa el modo.
  const MODE_SESSION_META = {
    clasico: { duration: 'session_classic_duration', save: 'session_save_yes', goal: 'session_classic_goal', entry: 'session_classic_entry' },
    aventura: { duration: 'session_adventure_duration', save: 'session_save_yes', goal: 'session_adventure_goal', entry: 'session_adventure_entry' },
    contrarreloj: { duration: 'session_timed_duration', save: 'session_save_no', goal: 'session_timed_goal', entry: 'session_timed_entry' },
    supervivencia: { duration: 'session_survival_duration', save: 'session_save_no', goal: 'session_survival_goal', entry: 'session_survival_entry' },
    zen: { duration: 'session_zen_duration', save: 'session_save_yes', goal: 'session_zen_goal', entry: 'session_zen_entry' },
  };

  const ModeLaunch = {
    current: 'supervivencia',
    zenDiff: Config.DIFF_ORDER.includes(Storage.zenDiff) ? Storage.zenDiff : 'normal',
    survLoadout: {},
    howOpen: false,

    // Acordeón de "Cómo funciona": arranca plegado y alterna sin salir del panel.
    toggleHow() {
      this.howOpen = !this.howOpen;
      Sound.ui();
      this.renderBody();
      requestAnimationFrame(() => {
        const toggle = document.querySelector('[data-ml-how-toggle]');
        if (toggle) toggle.focus({ preventScroll: true });
      });
    },

    img(src, cls = '') {
      return `<img${cls ? ` class="${cls}"` : ''} src="${src}" alt="">`;
    },

    infoButton(kind = 'progress') {
      const label = kind === 'how' ? I18n.t('mode_launch_how') : I18n.t('mode_launch_details');
      return `<button class="mode-launch-info" type="button" data-mode-detail="${kind}" aria-label="${esc(label)}">${this.img('img/ui-generated/mode-launch/info.png')}</button>`;
    },

    howItem(src, text, special = '') {
      const visual = special === 'ring'
        ? `<span class="mode-launch-how-icon">${this.img('img/ui-generated/mode-launch/frenzy-ring.png')}</span>`
        : `<span class="mode-launch-how-icon">${this.img(src)}</span>`;
      const lines = Array.isArray(text) ? text : [text];
      const copy = lines.map((line) => `<span>${esc(line)}</span>`).join(' ');
      return `<div class="mode-launch-how-item">${visual}<p>${copy}</p></div>`;
    },

    metric(src, value, label) {
      return `<div class="mode-launch-metric"><span>${this.img(src)}</span><b>${esc(value)}</b><small>${esc(label)}</small></div>`;
    },

    sessionHtml(mode) {
      const data = MODE_SESSION_META[mode];
      if (!data) return '';
      const item = (icon, label, value) => `<span class="mode-session-item"><span aria-hidden="true">${this.img(icon)}</span><span><small>${esc(I18n.t(label))}</small><b>${esc(I18n.t(value))}</b></span></span>`;
      return `<section class="mode-launch-card mode-launch-session" aria-label="${esc(I18n.t('session_title'))}">
        ${item('img/ui-generated/mode-launch/clock.png', 'session_duration', data.duration)}
        ${item('img/ui-generated/mode-launch/lock.png', 'session_save', data.save)}
        ${item('img/ui-generated/mode-launch/target.png', 'session_goal', data.goal)}
        ${item('img/ui-generated/mode-launch/coin.png', 'session_entry', data.entry)}
      </section>`;
    },

    closeDetail({ restoreFocus = true } = {}) {
      const panel = $('#mode-launch-detail');
      if (panel) panel.hidden = true;
      const modal = $('#modal-mode-launch');
      if (modal) modal.classList.remove('is-detail-open');
      if (restoreFocus && this.detailTrigger && this.detailTrigger.isConnected) {
        try { this.detailTrigger.focus({ preventScroll: true }); } catch (_) { this.detailTrigger.focus(); }
      }
      this.detailTrigger = null;
    },

    openDetail(kind, trigger) {
      const panel = $('#mode-launch-detail');
      const content = $('#mode-launch-detail-content');
      if (!panel || !content) return;
      const selectors = {
        progress: '.mode-launch-progress-card',
        context: '.mode-launch-context-card',
        how: '.mode-launch-how-card',
      };
      const source = selectors[kind] ? document.querySelector(`#mode-launch-body ${selectors[kind]}`) : null;
      if (!source) return;

      let icon = source.querySelector('img');
      let kicker = I18n.t('mode_launch_details');
      let title = '';
      let summary = '';
      let extra = '';
      if (kind === 'how') {
        title = (source.querySelector('h3') || {}).textContent || I18n.t('mode_launch_how');
        kicker = ($('#mode-launch-title') || {}).textContent || I18n.t('mode_launch_details');
        const items = Array.from(source.querySelectorAll('.mode-launch-how-item')).map((item) => {
          const itemIcon = item.querySelector('img');
          const text = (item.querySelector('p') || {}).textContent || '';
          return `<div class="mode-launch-detail-item">${itemIcon ? this.img(itemIcon.getAttribute('src') || '') : ''}<p>${esc(text.trim())}</p></div>`;
        }).join('');
        summary = I18n.t('mode_launch_details');
        extra = `<div class="mode-launch-detail-list">${items}</div>`;
      } else if (kind === 'context') {
        kicker = (source.querySelector('.mode-launch-context-copy small') || {}).textContent || I18n.t('mode_launch_details');
        title = (source.querySelector('.mode-launch-context-copy b') || {}).textContent || kicker;
        summary = (source.querySelector('.mode-launch-context-copy span') || {}).textContent || '';
      } else {
        kicker = (source.querySelector('h3') || {}).textContent || I18n.t('mode_launch_progress');
        title = (source.querySelector('.mode-launch-rank-line b') || {}).textContent || kicker;
        const value = (source.querySelector('.mode-launch-rank-line strong') || {}).textContent || '';
        const next = (source.querySelector('.mode-launch-rank-copy > small') || {}).textContent || '';
        const feat = (source.querySelector('.mode-launch-feats b') || {}).textContent || '';
        const featLabel = (source.querySelector('.mode-launch-feats small') || {}).textContent || '';
        summary = [value, next, [feat, featLabel].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
      }

      const src = icon ? icon.getAttribute('src') || '' : 'img/ui-generated/mode-launch/info.png';
      content.innerHTML = `<div class="mode-launch-detail-hero"><span>${this.img(src)}</span><div><small>${esc(kicker.trim())}</small><h3 id="mode-launch-detail-title">${esc(title.trim())}</h3><p>${esc(summary.trim())}</p></div></div>${extra}`;
      this.detailTrigger = trigger || null;
      panel.dataset.kind = kind;
      panel.hidden = false;
      const modal = $('#modal-mode-launch');
      if (modal) modal.classList.add('is-detail-open');
      const close = $('#btn-mode-launch-detail-close');
      if (close) {
        close.setAttribute('aria-label', I18n.t('mode_launch_back'));
        requestAnimationFrame(() => close.focus({ preventScroll: true }));
      }
      Sound.ui();
    },

    open(mode) {
      if (!MODE_LAUNCH_META[mode]) return;
      if (Modal._id && Modal._id !== 'modal-mode-launch') Modal.close();
      // Si el lanzador nace en una vista del hub, esa vista permanece detrás del
      // modal: al cerrar recupera foco y Back conserva su origen (incluido Worlds).
      // Desde juego u otra pantalla sí se crea un origen seguro en Inicio.
      const preserveHub = document.body.dataset.screen === 'start';
      if (!preserveHub) {
        HubViews.home({ focus: false });
        Screens.show('start');
        refreshStart();
      }
      this.current = mode;
      this.howOpen = false;
      if (mode === 'supervivencia') {
        survDiff = Config.DIFF_ORDER.includes(Storage.survDiff) ? Storage.survDiff : 'normal';
        // Cada apertura empieza sin gasto preseleccionado. El jugador puede ver el
        // stock y confirmar su decisión sin compras sorpresa heredadas.
        this.survLoadout = {};
      }
      if (mode === 'zen') {
        this.zenDiff = ['facil', 'normal'].includes(Storage.zenDiff) ? Storage.zenDiff : 'normal';
      }
      this.render();
      document.body.classList.add('mode-launch-open');
      Modal.open('modal-mode-launch');
    },

    render() {
      const meta = MODE_LAUNCH_META[this.current];
      const modal = $('#modal-mode-launch');
      if (!meta || !modal) return;
      modal.dataset.mode = this.current;
      const title = $('#mode-launch-title');
      const tagline = $('#mode-launch-tagline');
      const emblem = $('#mode-launch-emblem');
      const startIcon = $('#mode-launch-start-icon');
      const startLabel = $('#mode-launch-start-label');
      if (title) title.textContent = I18n.modeT(this.current, 'name');
      if (tagline) tagline.textContent = I18n.t(meta.tag);
      if (emblem) emblem.src = meta.emblem;
      if (startIcon) startIcon.src = meta.startIcon;
      if (startLabel) startLabel.textContent = I18n.t(meta.cta);
      this.renderBody();
    },

    renderBody() {
      const body = $('#mode-launch-body');
      if (!body) return;
      this.closeDetail({ restoreFocus: false });
      const builders = {
        clasico: () => this.classicHtml(),
        aventura: () => this.adventureHtml(),
        contrarreloj: () => this.timedHtml(),
        supervivencia: () => this.survivalHtml(),
        zen: () => this.zenHtml(),
      };
      body.innerHTML = this.sessionHtml(this.current) + builders[this.current]();
      this.updateStartCta();
    },

    select(value) {
      if (this.current === 'supervivencia' && Config.DIFF_ORDER.includes(value)) {
        survDiff = value;
        Storage.survDiff = value;
      } else if (this.current === 'zen' && ['facil', 'normal'].includes(value)) {
        this.zenDiff = value;
        Storage.zenDiff = value;
      } else return;
      Sound.ui();
      this.renderBody();
      requestAnimationFrame(() => {
        const selected = document.querySelector(`[data-mode-option="${value}"]`);
        if (selected) selected.focus({ preventScroll: true });
      });
    },

    survivalLoadoutIds() {
      return Boosters.order.filter((id) => !!this.survLoadout[id]);
    },

    survivalLoadoutQuote() {
      return Meta.quoteBoosterLoadout(this.survivalLoadoutIds(), Config.SURVIVAL_LOADOUT_MAX);
    },

    toggleSurvivalBooster(id) {
      if (this.current !== 'supervivencia' || !Object.prototype.hasOwnProperty.call(Config.BOOSTER_PRICES, id)) return;
      if (this.survLoadout[id]) delete this.survLoadout[id];
      else {
        if (this.survivalLoadoutIds().length >= Config.SURVIVAL_LOADOUT_MAX) {
          Toasts.show(I18n.t('surv_loadout_max').replace('{n}', Config.SURVIVAL_LOADOUT_MAX), 'warn', 1500);
          Sound.miss(); return;
        }
        this.survLoadout[id] = true;
      }
      Sound.ui();
      this.renderBody();
      requestAnimationFrame(() => {
        const selected = document.querySelector(`[data-surv-booster="${id}"]`);
        if (selected) selected.focus({ preventScroll: true });
      });
    },

    survivalLoadoutHtml() {
      const ids = this.survivalLoadoutIds();
      const items = Boosters.order.map((id) => {
        const selected = !!this.survLoadout[id];
        const stock = Meta.boosterCount(id);
        const label = `${I18n.t('booster_name_' + id)} · ${stock > 0 ? I18n.t('booster_stock').replace('{n}', stock) : I18n.t('surv_loadout_price').replace('{n}', Config.BOOSTER_PRICES[id])}`;
        return `<button type="button" class="surv-loadout-item${selected ? ' is-selected' : ''}${stock > 0 ? ' has-stock' : ''}" data-surv-booster="${id}" aria-pressed="${selected}" aria-label="${esc(label)}">
          <span class="surv-loadout-icon" aria-hidden="true">${BOOSTER_IMG[id] ? iconAnyInline(BOOSTER_IMG[id]) : Boosters.DEFS[id].glyph}</span>
          <small class="surv-loadout-count">×${fmtNum(stock)}</small>
        </button>`;
      }).join('');
      return `<section class="mode-launch-card mode-launch-loadout" aria-labelledby="surv-loadout-title">
        <div class="surv-loadout-head"><h3 id="surv-loadout-title">${esc(I18n.t('surv_loadout_title'))}</h3><b class="surv-loadout-badge">${esc(I18n.t('surv_loadout_count').replace('{n}', ids.length).replace('{max}', Config.SURVIVAL_LOADOUT_MAX))}</b></div>
        <div class="surv-loadout-grid">${items}</div>
      </section>`;
    },

    updateStartCta() {
      const button = $('#btn-mode-launch-start'), label = $('#mode-launch-start-label');
      if (!button || !label) return;
      if (this.current !== 'supervivencia') {
        const meta = MODE_LAUNCH_META[this.current];
        button.disabled = false;
        if (meta) label.textContent = I18n.t(meta.cta);
        return;
      }
      const quote = this.survivalLoadoutQuote();
      const ids = this.survivalLoadoutIds();
      button.disabled = !quote || quote.coinCost > Meta.coins();
      if (!ids.length) label.textContent = I18n.t('surv_start_empty');
      else if (quote.coinCost > 0) label.textContent = I18n.t('surv_start_cost').replace('{n}', quote.coinCost);
      else label.textContent = I18n.t('surv_start_stock').replace('{n}', quote.stock.length);
    },

    commitSurvivalLoadout() {
      const ids = this.survivalLoadoutIds();
      const quote = Meta.commitBoosterLoadout(ids, Config.SURVIVAL_LOADOUT_MAX);
      if (!quote) {
        Toasts.show(I18n.t('pl_no_coins'), 'warn', 1700);
        this.updateStartCta();
        return false;
      }
      Survival.pendingLoadout = {};
      quote.ids.forEach((id) => { Survival.pendingLoadout[id] = 1; });
      if (quote.coinCost > 0 || quote.stock.length) Econ.refresh();
      return true;
    },

    start() {
      const mode = this.current;
      Sound.ensure();
      if (mode === 'supervivencia' && !this.commitSurvivalLoadout()) { Sound.miss(); return; }
      Modal.close();
      if (mode === 'clasico') { openWorldsMap(); return; }
      if (mode === 'aventura') { HubViews.home({ focus: false }); Game.start('aventura', 'normal'); return; }
      if (mode === 'contrarreloj') { Game.start('contrarreloj', 'normal'); return; }
      if (mode === 'supervivencia') { startSurvivalSelected(); return; }
      if (mode === 'zen') { Storage.zenDiff = this.zenDiff; Game.start('zen', this.zenDiff); }
    },

    survivalHtml() {
      const rank = Meta.survRank();
      const target = rank.nextAt || rank.total || 1;
      const span = rank.nextAt ? rank.nextAt - rank.at : 1;
      const done = rank.nextAt ? rank.total - rank.at : 1;
      const pct = rank.nextAt ? clamp(done / span * 100, 0, 100) : 100;
      const feats = Meta.survFeatCount();
      const mut = Survival.weeklyMut();
      const mutId = ['none', 'ice', 'chaos', 'frenzy'].includes(mut.id) ? mut.id : 'none';
      const day = String(new Date().getDate());
      const diffIcon = {
        facil: 'img/ui-generated/mode-launch/difficulty-easy.png',
        normal: 'img/ui-generated/mode-launch/difficulty-normal.png',
        dificil: 'img/ui-generated/mode-launch/difficulty-hard.png',
      };
      const diffs = Config.DIFF_ORDER.map((diff) => {
        const selected = diff === survDiff;
        const record = Meta.survBestWaveFor(diff);
        const recordLabel = record > 0 ? I18n.t('surv_launch_record').replace('{w}', record) : I18n.t('surv_launch_norecord');
        return `<button class="mode-launch-choice mode-launch-choice-${diff}${selected ? ' is-selected' : ''}" type="button" role="radio" aria-checked="${selected}" data-mode-option="${diff}" aria-label="${esc(I18n.t('diff_' + diff) + ' · ' + recordLabel)}">
          <span class="mode-launch-face" aria-hidden="true">${this.img(diffIcon[diff])}</span>
          <b>${esc(I18n.t('diff_' + diff))}</b>
        </button>`;
      }).join('');
      const traits = I18n.t('surv_diff_' + survDiff + '_d').split(' · ');
      const howLines = [I18n.t('surv_sys_charge'), I18n.t('surv_sys_frenzy'), I18n.t('ml_surv_how3')];
      const rankTotal = rank.nextAt ? `${fmtNum(rank.total)}/${fmtNum(target)}` : I18n.t('surv_rank_max');
      const howOpen = !!this.howOpen;
      return `
        <section class="mode-launch-card mode-launch-progress-card">
          <div class="mode-launch-rank-layout">
            <span class="mode-launch-rank-badge">${this.img('img/ui-generated/mode-launch/survival-rank.png')}</span>
            <b class="mode-launch-rank-name">${esc(I18n.t('srank_' + rank.id))}</b>
            <span class="mode-launch-progress-track"><i style="width:${pct.toFixed(1)}%"></i></span>
            <strong class="mode-launch-rank-total">${esc(rankTotal)}</strong>
            <span class="mode-launch-rank-feats">${this.img('img/ui-generated/mode-launch/medal.png')}<b>${feats}/${Survival.FEATS.length}</b></span>
          </div>
        </section>
        <section class="mode-launch-choice-block">
          <h3>${esc(I18n.t('ml_surv_choose'))}</h3>
          <div class="mode-launch-choice-grid" role="radiogroup" aria-label="${esc(I18n.t('ml_surv_choose'))}">${diffs}</div>
        </section>
        <div class="mode-launch-traits">
          ${this.metric('img/ui-generated/mode-launch/heart.png', traits[0] || '', '')}
          ${this.metric('img/ui-generated/mode-launch/bolt.png', traits[1] || '', '')}
          ${this.metric('img/ui-generated/mode-launch/coin.png', traits[2] || '', '')}
        </div>
        ${this.survivalLoadoutHtml()}
        <button class="mode-launch-card mode-launch-context-card" type="button" data-mode-detail="context" aria-label="${esc(`${I18n.t('mode_launch_details')}: ${I18n.t('ml_surv_week_' + mutId + '_title')}`)}">
          <span class="mode-launch-calendar" aria-hidden="true">${this.img('img/ui-generated/mode-launch/calendar.png')}<b>${esc(day)}</b></span>
          <span class="mode-launch-context-copy"><small>${esc(I18n.t('ml_surv_special'))}</small><b>${esc(I18n.t('ml_surv_week_' + mutId + '_title'))}</b><span>${esc(I18n.t('ml_surv_week_' + mutId + '_sub'))}</span></span>
          <span class="mode-launch-chevron" aria-hidden="true"></span>
        </button>
        <section class="mode-launch-card mode-launch-how-card mode-launch-how-collapsible${howOpen ? ' is-open' : ''}">
          <button class="mode-launch-how-toggle" type="button" data-ml-how-toggle aria-expanded="${howOpen}">
            <span class="mode-launch-how-q" aria-hidden="true">?</span>
            <h3>${esc(I18n.t('mode_launch_how'))}</h3>
            <span class="mode-launch-how-caret" aria-hidden="true"></span>
          </button>
          <div class="mode-launch-how-grid">
            ${this.howItem('img/ui-generated/mode-launch/bolt.png', howLines[0])}
            ${this.howItem('', howLines[1], 'ring')}
            ${this.howItem('img/ui-generated/mode-launch/heart.png', howLines[2])}
          </div>
        </section>`;
    },

    classicHtml() {
      const unlocked = Worlds.LIST.filter((world) => Worlds.unlocked(world.id));
      const world = unlocked.find((item) => Meta.worldCleared(item.id) < Worlds.PER_WORLD) || unlocked[unlocked.length - 1] || Worlds.LIST[0];
      const cleared = Meta.worldCleared(world.id);
      const level = Meta.worldMaxLevel(world.id);
      const stars = Meta.worldStars(world.id);
      const pct = clamp(cleared / Worlds.PER_WORLD * 100, 0, 100);
      return this.standardHtml({
        progressTitle: I18n.t('mode_launch_progress'), badge: 'img/ui-generated/mode-launch/trophy.png',
        progressName: I18n.t('world_' + world.id), progressValue: `${cleared}/${Worlds.PER_WORLD}`,
        progressSub: `${I18n.t('mode_launch_level')} ${level}`, progressPct: pct,
        sideIcon: 'img/ui-generated/mode-launch/star.png', sideValue: String(stars), sideLabel: I18n.t('mode_launch_stars'),
        contextKicker: I18n.t('ml_classic_world'), contextTitle: I18n.t('world_' + world.id), contextSub: `${I18n.t('mode_launch_level')} ${level} · ${stars}/150 ${I18n.t('mode_launch_stars').toLowerCase()}`, contextIcon: 'img/ui-generated/mode-launch/planet.png',
        choiceTitle: I18n.t('ml_classic_route'),
        metrics: [
          ['img/ui-generated/mode-launch/planet.png', String(unlocked.length), I18n.t('mode_launch_worlds')],
          ['img/ui-generated/mode-launch/target.png', String(level), I18n.t('mode_launch_level')],
          ['img/ui-generated/mode-launch/star.png', String(stars), I18n.t('mode_launch_stars')],
        ],
        traits: [
          ['img/ui-generated/mode-launch/lock.png', `${cleared}/${Worlds.PER_WORLD}`, I18n.t('mode_launch_progress')],
          ['img/ui-generated/mode-launch/medal.png', String(Meta.modePlays('clasico')), I18n.t('mode_launch_plays')],
          ['img/ui-generated/mode-launch/trophy.png', fmtNum(Meta.modeBest('clasico')), I18n.t('mode_launch_best')],
        ],
        how: [
          ['img/ui-generated/mode-launch/lock.png', I18n.t('ml_classic_how1')],
          ['img/ui-generated/mode-launch/star.png', I18n.t('ml_classic_how2')],
          ['img/ui-generated/mode-launch/planet.png', I18n.t('ml_classic_how3')],
        ],
      });
    },

    adventureHtml() {
      const level = Meta.advMax();
      const chapter = Adventure.chapterOf(level) + 1;
      const chapterStep = Adventure.licOf(level) + 1;
      const biome = Adventure.biomeOf(level);
      return this.standardHtml({
        progressTitle: I18n.t('mode_launch_progress'), badge: 'img/ui-generated/mode-launch/rocket.png',
        progressName: `${I18n.t('mode_launch_chapter')} ${chapter}`, progressValue: `${chapterStep}/${Adventure.perChapter}`,
        progressSub: `${I18n.t('mode_launch_level')} ${level}`, progressPct: chapterStep / Adventure.perChapter * 100,
        sideIcon: 'img/ui-generated/mode-launch/trophy.png', sideValue: fmtNum(Meta.modeBest('aventura')), sideLabel: I18n.t('mode_launch_best'),
        contextKicker: I18n.t('ml_adv_biome'), contextTitle: Adventure.biomeName(biome), contextSub: `${I18n.t('mode_launch_chapter')} ${chapter} · ${I18n.t('mode_launch_next_boss')} ${Adventure.perChapter - chapterStep + 1}`, contextIcon: 'img/ui-generated/mode-launch/planet.png',
        choiceTitle: I18n.t('ml_adv_route'),
        metrics: [
          ['img/ui-generated/mode-launch/rocket.png', String(level), I18n.t('mode_launch_level')],
          ['img/ui-generated/mode-launch/planet.png', String(chapter), I18n.t('mode_launch_chapter')],
          ['img/ui-generated/mode-launch/trophy.png', fmtNum(Meta.modeBest('aventura')), I18n.t('mode_launch_best')],
        ],
        traits: [
          ['img/ui-generated/mode-launch/target.png', `${chapterStep}/${Adventure.perChapter}`, I18n.t('mode_launch_progress')],
          ['img/ui-generated/mode-launch/medal.png', String(Meta.modePlays('aventura')), I18n.t('mode_launch_plays')],
          ['img/ui-generated/mode-launch/skull.png', String(Adventure.perChapter - chapterStep + 1), I18n.t('mode_launch_next_boss')],
        ],
        how: [
          ['img/ui-generated/mode-launch/rocket.png', I18n.t('ml_adv_how1')],
          ['img/ui-generated/mode-launch/planet.png', I18n.t('ml_adv_how2')],
          ['img/ui-generated/mode-launch/skull.png', I18n.t('ml_adv_how3')],
        ],
      });
    },

    timedHtml() {
      const best = Meta.modeBest('contrarreloj');
      const plays = Meta.modePlays('contrarreloj');
      const pct = best > 0 ? clamp(Math.log10(best + 1) / 5 * 100, 8, 100) : 0;
      return this.standardHtml({
        progressTitle: I18n.t('ml_timed_score'), badge: 'img/ui-generated/mode-launch/clock.png',
        progressName: I18n.t('mode_launch_best'), progressValue: fmtNum(best),
        progressSub: `${I18n.t('mode_launch_plays')}: ${plays}`, progressPct: pct,
        sideIcon: 'img/ui-generated/mode-launch/medal.png', sideValue: String(plays), sideLabel: I18n.t('mode_launch_plays'),
        contextKicker: I18n.t('ml_timed_rules'), contextTitle: `${Config.TIMED_START} s`, contextSub: `${I18n.t('mode_launch_start_time')} · ${I18n.t('mode_launch_time_cap')} ${Config.TIMED_CAP} s`, contextIcon: 'img/ui-generated/mode-launch/clock.png',
        choiceTitle: I18n.t('ml_timed_rules'),
        metrics: [
          ['img/ui-generated/mode-launch/clock.png', `${Config.TIMED_START} s`, I18n.t('mode_launch_start_time')],
          ['img/ui-generated/mode-launch/bolt.png', '+3 s', I18n.t('mode_launch_each_match')],
          ['img/ui-generated/mode-launch/trophy.png', `${Config.TIMED_CAP} s`, I18n.t('mode_launch_time_cap')],
        ],
        traits: [
          ['img/ui-generated/mode-launch/trophy.png', fmtNum(best), I18n.t('mode_launch_best')],
          ['img/ui-generated/mode-launch/medal.png', String(plays), I18n.t('mode_launch_plays')],
          ['img/ui-generated/mode-launch/bolt.png', '+3 s', I18n.t('mode_launch_each_match')],
        ],
        how: [
          ['img/ui-generated/mode-launch/clock.png', I18n.t('ml_timed_how1')],
          ['img/ui-generated/mode-launch/bolt.png', I18n.t('ml_timed_how2')],
          ['img/ui-generated/mode-launch/trophy.png', I18n.t('ml_timed_how3')],
        ],
      });
    },

    zenHtml() {
      const flowers = Meta.zenFlowers();
      const goal = flowers < 10 ? 10 : (flowers < 50 ? 50 : Math.ceil((flowers + 1) / 50) * 50);
      const pct = clamp(flowers / goal * 100, 0, 100);
      const options = [
        ['facil', 'img/ui-generated/mode-launch/leaf.png', I18n.t('zen_pace_slow'), I18n.t('zen_pace_slow_d')],
        ['normal', 'img/ui-generated/mode-launch/frenzy-ring.png', I18n.t('zen_pace_normal'), I18n.t('zen_pace_normal_d')],
      ].map(([id, icon, title, desc]) => `<button class="mode-launch-choice mode-launch-choice-zen${this.zenDiff === id ? ' is-selected' : ''}" type="button" role="radio" aria-checked="${this.zenDiff === id}" data-mode-option="${id}"><span class="mode-launch-face" aria-hidden="true">${this.img(icon)}</span><b>${esc(title)}</b><small>${esc(desc)}</small></button>`).join('');
      return `
        <section class="mode-launch-card mode-launch-progress-card">
          <h3>${esc(I18n.t('ml_zen_garden'))}</h3>${this.infoButton()}
          <div class="mode-launch-rank-layout">
            <span class="mode-launch-rank-badge mode-launch-rank-badge-zen">${this.img('img/ui-generated/mode-launch/leaf.png')}</span>
            <div class="mode-launch-rank-copy"><div class="mode-launch-rank-line"><b>${esc(I18n.t('ml_zen_space'))}</b><strong>${flowers}/${goal}</strong></div><span class="mode-launch-progress-track"><i style="width:${pct.toFixed(1)}%"></i></span><small>${esc(I18n.t('mode_launch_goal'))}: ${goal} ${esc(I18n.t('mode_launch_flowers').toLowerCase())}</small></div>
            <div class="mode-launch-feats">${this.img('img/ui-generated/mode-launch/medal.png')}<b>${Meta.modePlays('zen')}</b><small>${esc(I18n.t('mode_launch_plays'))}</small></div>
          </div>
        </section>
        <button class="mode-launch-card mode-launch-context-card" type="button" data-mode-detail="context" aria-label="${esc(`${I18n.t('mode_launch_details')}: ${I18n.t('ml_zen_space')}`)}"><span class="mode-launch-context-icon">${this.img('img/ui-generated/mode-launch/leaf.png')}</span><span class="mode-launch-context-copy"><small>${esc(I18n.t('ml_zen_garden'))}</small><b>${esc(I18n.t('ml_zen_space'))}</b><span>${flowers} ${esc(I18n.t('mode_launch_flowers').toLowerCase())}</span></span><span class="mode-launch-chevron" aria-hidden="true"></span></button>
        <section class="mode-launch-choice-block"><h3>${esc(I18n.t('ml_zen_choose'))}</h3><div class="mode-launch-choice-grid mode-launch-choice-grid-two" role="radiogroup" aria-label="${esc(I18n.t('ml_zen_choose'))}">${options}</div></section>
        <div class="mode-launch-traits">
          ${this.metric('img/ui-generated/mode-launch/leaf.png', I18n.t('zen_pace_' + (this.zenDiff === 'facil' ? 'slow' : 'normal')), I18n.t('mode_launch_pace'))}
          ${this.metric('img/ui-generated/mode-launch/heart.png', '∞', I18n.t('mode_launch_goal'))}
          ${this.metric('img/ui-generated/mode-launch/medal.png', String(flowers), I18n.t('mode_launch_flowers'))}
        </div>
        <section class="mode-launch-card mode-launch-how-card"><h3>${esc(I18n.t('mode_launch_how'))}</h3>${this.infoButton('how')}<div class="mode-launch-how-grid">
          ${this.howItem('img/ui-generated/mode-launch/leaf.png', I18n.t('ml_zen_how1'))}
          ${this.howItem('', I18n.t('ml_zen_how2'), 'ring')}
          ${this.howItem('img/ui-generated/mode-launch/heart.png', I18n.t('ml_zen_how3'))}
        </div></section>`;
    },

    standardHtml(data) {
      const metrics = data.metrics.map(([src, value, label]) => this.metric(src, value, label)).join('');
      const traits = (data.traits || data.metrics).map(([src, value, label]) => this.metric(src, value, label)).join('');
      const how = data.how.map(([src, text]) => this.howItem(src, text)).join('');
      return `
        <section class="mode-launch-card mode-launch-progress-card">
          <h3>${esc(data.progressTitle)}</h3>${this.infoButton()}
          <div class="mode-launch-rank-layout">
            <span class="mode-launch-rank-badge mode-launch-rank-badge-standard">${this.img(data.badge)}</span>
            <div class="mode-launch-rank-copy"><div class="mode-launch-rank-line"><b>${esc(data.progressName)}</b><strong>${esc(data.progressValue)}</strong></div><span class="mode-launch-progress-track"><i style="width:${clamp(data.progressPct, 0, 100).toFixed(1)}%"></i></span><small>${esc(data.progressSub)}</small></div>
            <div class="mode-launch-feats">${this.img(data.sideIcon)}<b>${esc(data.sideValue)}</b><small>${esc(data.sideLabel)}</small></div>
          </div>
        </section>
        <button class="mode-launch-card mode-launch-context-card" type="button" data-mode-detail="context" aria-label="${esc(`${I18n.t('mode_launch_details')}: ${data.contextTitle}`)}"><span class="mode-launch-context-icon">${this.img(data.contextIcon)}</span><span class="mode-launch-context-copy"><small>${esc(data.contextKicker)}</small><b>${esc(data.contextTitle)}</b><span>${esc(data.contextSub)}</span></span><span class="mode-launch-chevron" aria-hidden="true"></span></button>
        <section class="mode-launch-choice-block"><h3>${esc(data.choiceTitle)}</h3><div class="mode-launch-stats-grid">${metrics}</div></section>
        <div class="mode-launch-traits mode-launch-traits-summary">${traits}</div>
        <section class="mode-launch-card mode-launch-how-card"><h3>${esc(I18n.t('mode_launch_how'))}</h3>${this.infoButton('how')}<div class="mode-launch-how-grid">${how}</div></section>`;
    },
  };

  function launchZen() { ModeLaunch.open('zen'); }
  // Catálogo completo del carrusel de Inicio. El Tutorial vive en la Guía y
  // Multijugador se mantiene como anticipo deshabilitado.
  const MODE_CARDS = [
    {
      key: 'clasico', mode: 'clasico', accent: '#18a9ec', cardClass: 'home-mode-card-classic',
      art: 'img/ui-generated/modes/mode-classic.png', i18n: 'card_classic', badge: 'card_classic_badge', desc: 'card_classic_desc',
      features: [
        ['img/ui/lock.png', 'card_feat_locks'],
        ['img/ui-v2/home/target.png', 'card_feat_objects'],
        ['img/ui-v2/home/bolt.png', 'card_feat_events'],
      ],
      action: () => ModeLaunch.open('clasico')
    },
    {
      key: 'aventura', accent: '#8b62ff', cardClass: 'home-mode-card-adventure',
      art: 'img/ui-generated/home/hero-rocket.png', mode: 'aventura', badge: 'card_adv_badge',
      features: [
        ['img/ui/planet.png', 'card_feat_biomes'],
        ['img/ui-v2/home/target.png', 'card_feat_goals'],
        ['img/ui/skull.png', 'card_feat_minibosses'],
      ],
      action: () => ModeLaunch.open('aventura')
    },
    {
      key: 'contrarreloj', accent: '#ff6cb0', cardClass: 'home-mode-card-timed',
      art: 'img/ui-generated/modes/mode-timed.png', mode: 'contrarreloj', badge: 'card_contra_badge',
      features: [
        ['img/ui-v2/home/clock.png', 'card_feat_time'],
        ['img/ui-v2/home/bolt.png', 'card_feat_pressure'],
        ['img/ui-v2/home/trophy.png', 'card_feat_best'],
      ],
      action: () => ModeLaunch.open('contrarreloj')
    },
    {
      key: 'supervivencia', mode: 'supervivencia', accent: '#f05b5d', cardClass: 'home-mode-card-survival',
      art: 'img/ui-generated/modes/mode-survival.png', i18n: 'card_surv', badge: 'card_surv_badge', desc: 'card_surv_desc',
      features: [
        ['img/ui/heart.png', 'card_feat_lives'],
        ['img/ui-v2/home/bolt.png', 'card_feat_waves'],
        ['img/ui/skull.png', 'card_feat_bosses'],
      ],
      action: () => ModeLaunch.open('supervivencia')
    },
    {
      key: 'zen', accent: '#9be15d', cardClass: 'home-mode-card-zen',
      art: 'img/ui-generated/modes/mode-zen.png', mode: 'zen', badge: 'card_zen_badge',
      features: [
        ['img/ui/leaf.png', 'card_feat_no_penalties'],
        ['img/icons-v2/8-ui/rest.svg', 'card_feat_no_limit'],
        ['img/ui/heart.png', 'card_feat_relaxed'],
      ],
      action: () => ModeLaunch.open('zen')
    },
  ];
  const MULTIPLAYER_CARD = {
    key: 'multijugador', accent: '#8a4be5', cardClass: 'home-mode-card-multi',
    art: 'img/ui-generated/modes/mode-multiplayer.png', i18n: 'card_multi', badge: 'card_multi_tag', desc: 'card_multi_desc',
    disabled: true,
    features: [
      ['img/ui-v2/home/trophy.png', 'card_feat_first'],
      ['img/ui-v2/home/medal.png', 'card_feat_best'],
      ['img/icons-v2/9-media/wi-fi.svg', 'card_feat_online'],
    ],
  };
  const HOME_MODE_CARDS = MODE_CARDS.concat(MULTIPLAYER_CARD);
  const modeCardTitle = (c) => c.i18n ? I18n.t(c.i18n) : I18n.modeT(c.mode, 'name');
  const modeCardDesc = (c) => c.desc ? I18n.t(c.desc) : I18n.modeT(c.mode, 'desc');

  const HomeModeCarousel = {
    turn: 0,
    renderedTurn: null,
    key: '',
    bound: false,
    drag: null,
    ignoreClickUntil: 0,
    motionTimer: 0,
    hintTimers: [],
    hintActive: false,
    hintCancel: null,

    normalize(n, length = HOME_MODE_CARDS.length) {
      return ((n % length) + length) % length;
    },

    deltaTo(target, current, length = HOME_MODE_CARDS.length) {
      let delta = target - current;
      if (delta > length / 2) delta -= length;
      if (delta < -length / 2) delta += length;
      return delta;
    },

    initialMode(lastMode = Storage.lastMode) {
      return MODE_CARDS.some((c) => c.key === lastMode) ? lastMode : 'clasico';
    },

    currentIndex() { return this.normalize(this.turn); },

    currentCard() { return HOME_MODE_CARDS[this.currentIndex()] || HOME_MODE_CARDS[0]; },

    build() {
      const cont = $('#mode-cards'); if (!cont) return;
      const preserved = HOME_MODE_CARDS.some((c) => c.key === this.key) ? this.key : this.initialMode();
      const featureHTML = (c) => c.features && c.features.length
        ? `<span class="home-mode-features">${c.features.map(([src, label, className]) => `<span${className ? ` class="${className}"` : ''}>${src ? `<img src="${src}" alt="">` : ''}<small>${esc(I18n.t(label))}</small></span>`).join('')}</span>`
        : '';
      const cardHTML = (c, index) => {
        const title = modeCardTitle(c), desc = modeCardDesc(c);
        const titleId = `home-mode-${c.key}-title`, descId = `home-mode-${c.key}-desc`;
        const statusId = `home-mode-${c.key}-status`;
        const classicProgress = c.key === 'clasico'
          ? `<span class="home-mode-progress"><span id="home-classic-state">${esc(I18n.t('home_classic_sub'))}</span><b id="home-classic-badge">0/150</b></span>`
          : '';
        return `<div class="home-mode-slot" data-mode-slot="${c.key}" style="--card-angle:${index * (360 / HOME_MODE_CARDS.length)}deg;--mode-accent:${c.accent}" aria-hidden="true">
          <button type="button" class="home-mode-card ${c.cardClass}${c.features && c.features.length ? ' has-features' : ''}" data-mode-card="${c.key}" aria-label="${esc(c.disabled ? `${title}. ${I18n.t('coming_soon')}` : I18n.t('home_mode_select').replace('{mode}', title))}" aria-describedby="${descId}"${c.disabled ? ' disabled aria-disabled="true"' : ''}>
            <span class="home-mode-art" aria-hidden="true"><img src="${c.art}" alt=""></span>
            <span class="home-mode-copy">
              <span class="home-mode-title-row"><b id="${titleId}">${esc(title)}</b><span class="home-mode-tag">${esc(I18n.t(c.badge))}</span></span>
              <span class="home-mode-description" id="${descId}">${esc(desc)}</span>
              ${classicProgress}
              ${c.disabled ? `<span class="home-mode-disabled" id="${statusId}">${esc(I18n.t('coming_soon'))}</span>` : ''}
            </span>
            ${featureHTML(c)}
          </button>
        </div>`;
      };
      cont.innerHTML = HOME_MODE_CARDS.map(cardHTML).join('');

      const dots = $('#home-mode-dots');
      if (dots) dots.innerHTML = HOME_MODE_CARDS.map((c) => {
        const title = modeCardTitle(c);
        return `<button type="button" class="home-mode-dot" data-mode-dot="${c.key}" aria-label="${esc(I18n.t('home_mode_select').replace('{mode}', title))}"></button>`;
      }).join('');

      this.ensureSwipeCoach();
      this.turn = Math.max(0, HOME_MODE_CARDS.findIndex((c) => c.key === preserved));
      this.renderedTurn = null;
      this.key = preserved;
      this.bind();
      this.update({ instant: true, announce: false });
    },

    // Coach de gesto (solo la primera vez): una mano que barre lateralmente
    // sobre las cards para comunicar que el carrusel se desliza. Se inyecta una
    // sola vez; en reconstrucciones (p. ej. cambio de idioma) solo re-traduce.
    ensureSwipeCoach() {
      const root = $('#home-mode-carousel'); if (!root) return;
      const existing = root.querySelector('.home-swipe-coach');
      if (existing) {
        const label = existing.querySelector('.home-swipe-coach-label');
        if (label) label.textContent = I18n.t('home_swipe_coach');
        return;
      }
      const coach = document.createElement('div');
      coach.className = 'home-swipe-coach';
      coach.setAttribute('aria-hidden', 'true');
      coach.innerHTML = `<span class="home-swipe-coach-hand" aria-hidden="true"></span><span class="home-swipe-coach-label">${esc(I18n.t('home_swipe_coach'))}</span>`;
      const dots = root.querySelector('#home-mode-dots');
      root.insertBefore(coach, dots || null);
    },

    bind() {
      if (this.bound) return;
      const root = $('#home-mode-carousel'), track = $('#mode-cards');
      const viewport = $('#home-mode-viewport'), dots = $('#home-mode-dots');
      if (!root || !track || !viewport) return;
      this.bound = true;

      track.addEventListener('click', (event) => {
        if (performance.now() < this.ignoreClickUntil) return;
        const button = event.target.closest('[data-mode-card]'); if (!button) return;
        const key = button.dataset.modeCard;
        if (key !== this.key) { Sound.ui(); this.select(key, { focus: true }); return; }
        this.activate(key);
      });
      if (dots) dots.addEventListener('click', (event) => {
        const dot = event.target.closest('[data-mode-dot]'); if (!dot) return;
        Sound.ui(); this.select(dot.dataset.modeDot, { focus: true });
      });

      root.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowLeft') { event.preventDefault(); Sound.ui(); this.move(-1, { focus: true }); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); Sound.ui(); this.move(1, { focus: true }); }
        else if (event.key === 'Home') { event.preventDefault(); Sound.ui(); this.select(MODE_CARDS[0].key, { focus: true }); }
        else if (event.key === 'End') { event.preventDefault(); Sound.ui(); this.select(MODE_CARDS[MODE_CARDS.length - 1].key, { focus: true }); }
      });

      const finishDrag = (event, cancelled) => {
        if (!this.drag || (event.pointerId != null && event.pointerId !== this.drag.id)) return;
        const drag = this.drag; this.drag = null;
        track.classList.remove('is-dragging');
        track.style.setProperty('--carousel-drag', '0deg');
        if (viewport.releasePointerCapture && event.pointerId != null) {
          try { viewport.releasePointerCapture(event.pointerId); } catch (_) { }
        }
        const threshold = Math.min(72, Math.max(32, viewport.clientWidth * .11));
        if (!cancelled && Math.abs(drag.dx) >= threshold) {
          this.ignoreClickUntil = performance.now() + 320;
          Sound.ui(); this.move(drag.dx < 0 ? 1 : -1);
        } else {
          if (drag.moved) this.ignoreClickUntil = performance.now() + 220;
          this.update({ announce: false });
        }
      };
      viewport.addEventListener('pointerdown', (event) => {
        if (event.isPrimary === false || (event.button != null && event.button !== 0)) return;
        this.drag = { id: event.pointerId, x: event.clientX, dx: 0, moved: false };
        track.classList.add('is-dragging');
        if (viewport.setPointerCapture && event.pointerId != null) {
          try { viewport.setPointerCapture(event.pointerId); } catch (_) { }
        }
      });
      viewport.addEventListener('pointermove', (event) => {
        if (!this.drag || event.pointerId !== this.drag.id) return;
        const dx = event.clientX - this.drag.x;
        this.drag.dx = dx; this.drag.moved = this.drag.moved || Math.abs(dx) > 6;
        const degrees = Math.max(-72, Math.min(72, dx / Math.max(1, viewport.clientWidth) * 82));
        track.style.setProperty('--carousel-drag', `${degrees}deg`);
      });
      viewport.addEventListener('pointerup', (event) => finishDrag(event, false));
      viewport.addEventListener('pointercancel', (event) => finishDrag(event, true));
      viewport.addEventListener('lostpointercapture', (event) => finishDrag(event, true));
    },

    animateTurn(root) {
      clearTimeout(this.motionTimer);
      // Si se encadenan gestos, la nueva card seleccionada inicia su propio
      // asentamiento sin insertar un fotograma intermedio de reinicio.
      root.classList.add('is-turning');
      this.motionTimer = setTimeout(() => {
        root.classList.remove('is-turning');
        this.motionTimer = 0;
      }, 880);
    },

    update({ instant = false, focus = false, announce = true } = {}) {
      const track = $('#mode-cards'), root = $('#home-mode-carousel'); if (!track || !root) return;
      const previousTurn = this.renderedTurn;
      const changed = Number.isFinite(previousTurn) && previousTurn !== this.turn;
      this.renderedTurn = this.turn;
      const current = this.currentIndex(), active = HOME_MODE_CARDS[current];
      this.key = active.key;
      if (instant) {
        clearTimeout(this.motionTimer);
        this.motionTimer = 0;
        root.classList.remove('is-turning');
        track.classList.add('is-instant');
      }
      track.style.setProperty('--carousel-rotation', `${this.turn * (-360 / HOME_MODE_CARDS.length)}deg`);
      track.style.setProperty('--carousel-drag', '0deg');
      root.style.setProperty('--active-mode-accent', active.accent);
      root.dataset.mode = active.key;

      track.querySelectorAll('[data-mode-slot]').forEach((slot, index) => {
        const selected = index === current;
        const relative = this.deltaTo(index, current);
        const distance = Math.abs(relative);
        slot.classList.toggle('is-selected', selected);
        slot.classList.toggle('is-near', distance <= 1);
        slot.dataset.distance = String(distance);
        slot.dataset.side = relative < 0 ? 'previous' : (relative > 0 ? 'next' : 'current');
        slot.setAttribute('aria-hidden', String(!selected));
        const button = slot.querySelector('[data-mode-card]');
        if (button) {
          button.tabIndex = selected && !button.disabled ? 0 : -1;
          const title = modeCardTitle(HOME_MODE_CARDS[index]);
          button.setAttribute('aria-label', HOME_MODE_CARDS[index].disabled
            ? `${title}. ${I18n.t('coming_soon')}`
            : I18n.t(selected ? 'home_mode_play' : 'home_mode_select').replace('{mode}', title));
        }
      });
      const dots = $('#home-mode-dots');
      if (dots) dots.querySelectorAll('[data-mode-dot]').forEach((dot, index) => {
        const selected = index === current;
        dot.classList.toggle('is-selected', selected);
        if (selected) dot.setAttribute('aria-current', 'true'); else dot.removeAttribute('aria-current');
      });
      const status = $('#home-mode-status');
      if (status && announce) status.textContent = I18n.t('home_mode_position')
        .replace('{mode}', modeCardTitle(active)).replace('{n}', current + 1).replace('{total}', HOME_MODE_CARDS.length);
      if (changed && !instant) this.animateTurn(root);
      if (focus) {
        const button = track.querySelector(`[data-mode-card="${active.key}"]`);
        if (button && !button.disabled) requestAnimationFrame(() => button.focus({ preventScroll: true }));
      }
      if (instant) requestAnimationFrame(() => track.classList.remove('is-instant'));
    },

    select(key, options = {}) {
      const target = HOME_MODE_CARDS.findIndex((c) => c.key === key); if (target < 0) return false;
      this.turn += this.deltaTo(target, this.currentIndex());
      this.update(options);
      return true;
    },

    move(step, options = {}) {
      this.turn += step < 0 ? -1 : 1;
      this.update(options);
    },

    activate(key = this.key) {
      const card = HOME_MODE_CARDS.find((c) => c.key === key); if (!card) return;
      if (card.disabled || !card.action) { Sound.miss(); Toasts.show(I18n.t('multi_soon'), 'info', 1500); return; }
      Sound.ensure(); Sound.ui(); card.action();
    },

    // Se dispara una sola vez en la vida del usuario, al ver Inicio por primera
    // vez. Marca el flag antes de animar para no repetir aunque se interrumpa.
    maybeHintSwipe() {
      if (Storage.swipeHintSeen || HOME_MODE_CARDS.length < 2) return;
      const root = $('#home-mode-carousel');
      if (!root || root.offsetParent === null) return; // Inicio no visible aún.
      Storage.swipeHintSeen = true;
      this.clearHint();
      this.hintTimers.push(setTimeout(() => this.playSwipeHint(), 620));
    },

    playSwipeHint() {
      const root = $('#home-mode-carousel'), track = $('#mode-cards'), viewport = $('#home-mode-viewport');
      if (!root || !track || root.offsetParent === null) return;
      this.hintActive = true;
      root.classList.add('is-hinting');

      // Si el usuario ya empieza a tocar/arrastrar, el coach sobra: se retira.
      if (viewport) {
        const onGrab = () => this.clearHint();
        viewport.addEventListener('pointerdown', onGrab, { once: true });
        this.hintCancel = () => viewport.removeEventListener('pointerdown', onGrab);
      }

      const settle = () => {
        root.classList.remove('is-hinting');
        track.style.setProperty('--carousel-drag', '0deg');
        this.hintActive = false;
      };

      const reduced = document.body.classList.contains('reduced-fx')
        || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (reduced) {
        // Sin movimiento del cilindro: solo el rótulo estático un instante.
        this.hintTimers.push(setTimeout(settle, 2600));
        return;
      }

      // "Peek" real del cilindro sincronizado con el barrido de la mano: gira un
      // poco hacia el siguiente modo y regresa, dos veces, para evidenciar el
      // gesto. Se conduce por --carousel-drag (misma variable que el arrastre).
      const nudge = (ms, deg) => this.hintTimers.push(setTimeout(() => {
        if (this.hintActive) track.style.setProperty('--carousel-drag', deg);
      }, ms));
      nudge(260, '-15deg');
      nudge(1010, '7deg');
      nudge(1760, '-15deg');
      nudge(2500, '0deg');
      this.hintTimers.push(setTimeout(settle, 3120));
    },

    clearHint() {
      this.hintTimers.forEach(clearTimeout);
      this.hintTimers = [];
      if (this.hintCancel) { this.hintCancel(); this.hintCancel = null; }
      const root = $('#home-mode-carousel'), track = $('#mode-cards');
      if (root) root.classList.remove('is-hinting');
      if (track) track.style.setProperty('--carousel-drag', '0deg');
      this.hintActive = false;
    },
  };

  function buildHomeModeCarousel() {
    HomeModeCarousel.build();
  }

  function showHome(mode, focusMode = false) {
    const key = HOME_MODE_CARDS.some((c) => c.key === mode) ? mode : HomeModeCarousel.initialMode();
    HomeModeCarousel.select(key, { instant: true, announce: false });
    refreshStart();
    HubViews.home({ focus: false });
    Screens.show('start');
    if (focusMode) requestAnimationFrame(() => HomeModeCarousel.update({ focus: true, announce: false }));
    HomeModeCarousel.maybeHintSwipe();
  }

  // Aventura → vista de capítulos; su botón "Continuar" lanza la partida.
  function openAdventure() { buildAdventureMap(); HubViews.open('adventure'); }
  // Estado vacío reutilizable: icono (opcional) + título + subtítulo + CTA (data-act delegado).
  // Evita que cofres/logros/clasificación se vean "rotos" cuando aún no hay datos.
  function emptyState(icon, title, sub, ctaText, ctaAct) {
    const ic = icon ? `<span class="empty-ic" aria-hidden="true">${iconAnyInline(icon)}</span>` : '';
    const cta = ctaText ? `<button class="btn btn-primary btn-sm empty-cta" data-act="${ctaAct}">${esc(ctaText)}</button>` : '';
    return `<div class="empty-state">${ic}<p class="empty-title">${esc(title)}</p><p class="empty-sub">${esc(sub)}</p>${cta}</div>`;
  }
  // Clásico → mapa de mundos (Fase 2 lo sustituye por la pantalla dedicada).
  function openWorldsMap() {
    if (typeof Worlds !== 'undefined' && Worlds.open) { Worlds.open(); return; }
    buildAdventureMap(); HubViews.open('adventure');
  }
  // Multijugador: fuera de V1 (volverá con la capa online, ROADMAP §8). La vista
  // queda latente en el HTML pero ninguna superficie de V1 la abre.
  let survDiff = Config.DIFF_ORDER.indexOf(Storage.survDiff) >= 0 ? Storage.survDiff : 'normal';
  function renderSurvivalDiff() {
    if (ModeLaunch.current === 'supervivencia' && Modal._id === 'modal-mode-launch') ModeLaunch.renderBody();
  }
  function fillSurvivalService() {
    renderSurvivalDiff();
  }
  function openSurvivalDiff() {
    survDiff = Config.DIFF_ORDER.indexOf(Storage.survDiff) >= 0 ? Storage.survDiff : 'normal';
    ModeLaunch.open('supervivencia');
  }
  function startSurvivalSelected() {
    Storage.survDiff = survDiff;
    HubViews.home({ focus: false });
    Game.start('supervivencia', survDiff);
  }
  function buildDailyInfo() {
    const box = $('#daily-info'); if (!box) return;
    const d = new Date().toISOString().slice(0, 10);
    const mut = DailyMut.pick(d);
    const lesson = DailyMut.lesson(mut);
    const dr = Meta.dailyRunInfo();
    const medal = Meta.dailyMedal(dr.best || 0);
    const medals = [
      ['bronze', '🥉', Meta.DAILY_MEDALS[0]],
      ['silver', '🥈', Meta.DAILY_MEDALS[1]],
      ['gold', '🥇', Meta.DAILY_MEDALS[2]],
    ].map(([, icon, n]) => `<span class="di-medal ${(dr.best || 0) >= n ? 'on' : ''}">${icon} ${n}</span>`).join('');
    const best = dr.best > 0
      ? `${ModeSignals.dailyMedalLabel(medal)} · ${dr.best}`
      : I18n.t('daily_info_no_best');
    const streak = Meta.dailyStreak();
    box.innerHTML = `
      <div class="di-hero">
        <b>${esc(d)}</b>
        <span>${esc(I18n.t('daily_info_same'))}</span>
      </div>
      <div class="di-row">
        <span class="di-k">🎲 ${esc(I18n.t('daily_info_mut'))}</span>
        <span class="di-v"><b>${esc(I18n.t('dmut_' + mut + '_n'))}</b><small>${esc(I18n.t('dmut_' + mut))}</small></span>
      </div>
      <div class="di-learning">
        <span><small>${esc(I18n.t('daily_learning_label'))}</small><b>${esc(I18n.t(lesson.skill))}</b><em>${esc(I18n.t('daily_practice_in').replace('{mode}', I18n.modeT(lesson.mode, 'name')))}</em></span>
        <button type="button" class="btn btn-ghost btn-sm" data-act="daily-practice" data-mode="${lesson.mode}">${esc(I18n.t('daily_practice_cta').replace('{mode}', I18n.modeT(lesson.mode, 'name')))}</button>
      </div>
      <div class="di-row">
        <span class="di-k">${esc(I18n.t('daily_info_medals'))}</span>
        <span class="di-medals">${medals}</span>
      </div>
      <div class="di-row">
        <span class="di-k">${esc(I18n.t('daily_info_best'))}</span>
        <span class="di-v"><b>${esc(best)}</b><small>${esc(I18n.t('daily_info_ghost'))}</small></span>
      </div>
      <div class="di-row">
        <span class="di-k">🔥 ${streak}</span>
        <span class="di-v">${esc(I18n.t('daily_info_streak'))}</span>
      </div>
      ${dr.plays > 0 ? '' : `<div class="di-bonus">${esc(I18n.t('daily_info_first'))}</div>`}
    `;
  }
  function openDailyInfo() {
    buildDailyInfo();
    HubViews.open('daily', { nav: 'nav-events' });
  }

  /* ===================== Top bar reutilizable (sistema base) ===================== */
  const TOPBAR_HTML = `
    <div class="hub-header-top">
      <div class="hub-header-wallets" aria-label="Recursos">
        <span class="hub-header-wallet hub-header-wallet-coins"><img class="hub-header-currency" src="img/ui-generated/home/header-coin-star.png?v=2.6.79" alt=""><b data-econ-num="coins">0</b><button class="hub-header-plus" type="button" data-act="buy-coins" data-i18n-al="get_coins" aria-label="Conseguir monedas"><img src="img/ui-generated/home/header-plus.png?v=2.6.79" alt=""></button></span>
        <span class="hub-header-wallet hub-header-wallet-gems"><img class="hub-header-currency" src="img/ui-v2/home/gem.png" alt=""><b data-econ-num="gems">0</b><button class="hub-header-plus" type="button" data-act="buy-gems" data-i18n-al="get_gems" aria-label="Conseguir gemas"><img src="img/ui-generated/home/header-plus.png?v=2.6.79" alt=""></button></span>
        <span class="hub-header-wallet hub-header-wallet-energy"><img class="hub-header-currency" src="img/ui-v2/home/bolt.png" alt=""><b class="hub-header-energy-value" data-energy-value>—</b><button class="hub-header-plus" type="button" data-act="buy-energy" data-i18n-al="get_energy" aria-label="Conseguir energía"><img src="img/ui-generated/home/header-plus.png?v=2.6.79" alt=""></button></span>
      </div>
      <button class="hub-header-settings" type="button" data-act="settings" data-i18n-al="tab_set" aria-label="Ajustes"><img src="img/ui-generated/home/nav-settings.png" alt=""></button>
    </div>
    <div class="hub-header-cards">
      <div class="hub-header-profile">
        <button class="hub-header-profile-button" type="button" data-act="profile" data-i18n-al="profile_action" aria-label="Abrir perfil">
          <span class="hub-header-avatar"><span class="hub-header-avatar-art">${PlayerIcons.html(PlayerIcons.DEFAULT)}</span><img class="hub-header-avatar-frame" src="${PlayerBorders.DEFS[PlayerBorders.DEFAULT].asset}" alt="" aria-hidden="true"><span class="hub-header-level-badge">1</span></span>
          <span class="hub-header-identity">
            <b class="hub-header-name">Jugador</b>
            <span class="hub-header-level-row">
              <span class="hub-header-level-star" aria-hidden="true"><img src="img/ui-v2/home/star.png" alt=""></span><span class="hub-header-level-text">Nivel 1</span>
            </span>
            <span class="hub-header-xp" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="hub-header-xp-fill"></span></span>
          </span>
        </button>
      </div>
      <button class="hub-header-chest" type="button" data-act="open-chests" data-i18n-al="home_chests" aria-label="Cofres">
        <span class="hub-header-chest-art" aria-hidden="true"><img src="img/ui-generated/home/nav-chest.png" alt=""></span>
        <span class="hub-header-chest-copy">
          <b class="hub-header-chest-label" data-i18n="home_chest_cta">Cofre</b>
          <span class="hub-header-chest-state" id="home-chest-shortcut-state" data-i18n="home_none_ready">Ninguno</span>
        </span>
      </button>
    </div>`;
  function mountTopBars() { document.querySelectorAll('[data-topbar]').forEach((el) => { el.innerHTML = TOPBAR_HTML; }); }
  // Rellena los placeholders <span data-art="nombre"> con el SVG de Art (una sola vez).
  function fillArt(root) {
    (root || document).querySelectorAll('[data-art]').forEach((el) => {
      const name = el.dataset.art;
      if (typeof Art[name] === 'function' && el.dataset.arted !== '1') { el.innerHTML = Art[name](); el.dataset.arted = '1'; }
    });
  }
  function updateTopBars() {
    const prof = Storage.profile || { name: 'Jugador', color: '#00d0ff' };
    const lvl = Meta.level(), need = Meta.xpForLevel(lvl), have = Meta.xp();
    document.querySelectorAll('[data-topbar]').forEach((bar) => {
      const n = bar.querySelector('.hub-header-name'); if (n) n.textContent = prof.name;
      const avatar = bar.querySelector('.hub-header-avatar');
      if (avatar) {
        avatar.dataset.playerFrame = Meta.avatarBorder();
      }
      const avatarArt = bar.querySelector('.hub-header-avatar-art');
      if (avatarArt) avatarArt.innerHTML = PlayerIcons.html(Meta.avatarIcon());
      const avatarFrame = bar.querySelector('.hub-header-avatar-frame');
      if (avatarFrame) avatarFrame.src = PlayerBorders.DEFS[Meta.avatarBorder()].asset;
      const l = bar.querySelector('.hub-header-level-text'); if (l) l.textContent = I18n.t('lvl') + ' ' + lvl;
      const progress = Math.min(100, have / need * 100);
      const xf = bar.querySelector('.hub-header-xp-fill'); if (xf) xf.style.width = progress.toFixed(0) + '%';
      const xp = bar.querySelector('.hub-header-xp');
      if (xp) {
        xp.setAttribute('aria-valuenow', progress.toFixed(0));
        xp.setAttribute('aria-label', `${I18n.t('lvl')} ${lvl}: ${have} / ${need}`);
      }
      const bd = bar.querySelector('.hub-header-level-badge'); if (bd) bd.textContent = lvl;
    });
    Econ.refresh();
  }
  function renameProfile() {
    const cur = (Storage.profile && Storage.profile.name) || 'Jugador';
    const name = (window.prompt(I18n.t('edit_name'), cur) || '').trim().slice(0, 16);
    if (name) { const p = Storage.profile || { color: '#00d0ff' }; p.name = name; Storage.profile = p; Storage.user = name; updateTopBars(); refreshStart(); }
  }

  // CH-2: feedback unificado del pipeline de cofres (cofre diario + cofre del ciclo).
  // Acepta null para que los llamadores no tengan que comprobar antes.
  function chestProgressToast(res) {
    if (!res) return;
    if (res.dailyChoice) {
      const key = res.dailyChoice.choice.catchUp ? 'chest_daily_catchup_won' : 'chest_daily_won';
      Toasts.show(I18n.t(key), 'good', 2800, 'chest');
    }
    if (res.chest) {
      Toasts.show(I18n.t('chest_pipeline_won').replace('{c}', I18n.t(CHEST_TYPES[res.chest].nameKey)), 'good', 2800, 'chest');
      Sound.record();
    }
    if (res.dailyChoice || res.chest) { Econ.refresh(); syncHomeChests(); refreshEvents(); }
  }

  // Aviso local best-effort (CH-3). No intenta simular push: solo avisa al
  // reabrir/volver a la app si el usuario dio permiso explícito y evita repetir
  // el mismo UID listo en sesiones posteriores.
  const ChestNotices = {
    pending: new Set(),
    supported() { return typeof window.Notification !== 'undefined'; },
    permission() {
      if (!this.supported()) return 'unsupported';
      try { return window.Notification.permission || 'default'; }
      catch (_) { return 'unsupported'; }
    },
    async enable() {
      if (!this.supported() || typeof window.Notification.requestPermission !== 'function') {
        Toasts.show(I18n.t('chest_notify_unsupported'), 'warn', 2600, 'info'); return false;
      }
      let permission = this.permission();
      try { if (permission !== 'granted') permission = await window.Notification.requestPermission(); }
      catch (_) { permission = 'denied'; }
      if (permission !== 'granted') {
        Toasts.show(I18n.t('chest_notify_denied'), 'warn', 2800, 'warning'); return false;
      }
      Toasts.show(I18n.t('chest_notify_enabled'), 'good', 2000, 'check');
      this.sync(); return true;
    },
    _windowNotification(title, options) {
      try {
        const notice = new window.Notification(title, options);
        notice.onclick = () => {
          try { if (window.focus) window.focus(); } catch (_) { }
          try { notice.close(); } catch (_) { }
        };
        return true;
      } catch (_) { return false; }
    },
    _show(title, options) {
      try {
        const ready = typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.ready;
        if (ready && typeof ready.then === 'function') {
          return Promise.resolve(ready).then((registration) => {
            if (!registration || typeof registration.showNotification !== 'function') throw new Error('showNotification unavailable');
            return registration.showNotification(title, options);
          }).then(() => true, () => this._windowNotification(title, options));
        }
      } catch (_) { /* fallback de ventana debajo */ }
      return Promise.resolve(this._windowNotification(title, options));
    },
    sync(readyUids) {
      const ready = Array.isArray(readyUids) ? readyUids : Meta.chestReadyUids();
      if (this.permission() !== 'granted' || !ready.length) return Promise.resolve(false);
      const notified = new Set(Meta.chestNotifiedReadyUids());
      const unseen = ready.filter((uid) => !notified.has(uid) && !this.pending.has(uid));
      if (!unseen.length) return Promise.resolve(false);
      unseen.forEach((uid) => this.pending.add(uid));
      const count = ready.length;
      const body = count === 1 ? I18n.t('chest_notification_body_one') : I18n.t('chest_notification_body_many').replace('{n}', count);
      const options = { body, icon: './icon-192.png', badge: './icon-maskable.png', tag: 'convergence-chests-ready', renotify: false };
      return this._show(I18n.t('chest_notification_title'), options).then((shown) => {
        unseen.forEach((uid) => this.pending.delete(uid));
        if (shown) Meta.markChestReadyNotified(unseen);
        return shown;
      }, () => {
        unseen.forEach((uid) => this.pending.delete(uid)); return false;
      });
    },
  };

  function syncHomeChests() {
    const chests = Meta.chests();
    // CH-1/CH-3: "¡Listo!" (cofres terminados) pesa más que el contador; un
    // desbloqueo en curso muestra su cuenta atrás. El badge de PWA marca los listos.
    const readyUids = Meta.chestReadyUids();
    const readyCount = readyUids.length;
    const unlock = Meta.chestUnlock();
    let chestState;
    if (readyCount > 0) chestState = I18n.t('chest_slot_ready');
    else if (unlock) chestState = I18n.t('home_chest_opening').replace('{t}', chestDuration(unlock.remainingMs, true));
    else if (chests > 0) chestState = I18n.t(chests === 1 ? 'home_chests_one' : 'home_chests_many').replace('{n}', chests);
    else chestState = I18n.t('home_none_ready');
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.setAppBadge === 'function') {
        const badgeResult = readyCount > 0
          ? navigator.setAppBadge(readyCount)
          : (typeof navigator.clearAppBadge === 'function' ? navigator.clearAppBadge() : null);
        if (badgeResult && typeof badgeResult.catch === 'function') badgeResult.catch(() => { });
      }
    } catch (_) { /* Badging API opcional: sin permiso o sin soporte, silencio. */ }
    ChestNotices.sync(readyUids);
    // El rediseño del Home concentra el detalle en Eventos. Este chip compacto
    // mantiene visible el estado CH-3 sin duplicar otra tarjeta diaria.
    const navState = $('#home-chests-nav-state');
    if (navState) {
      navState.textContent = readyCount > 0 ? I18n.t('chest_slot_ready') : (unlock ? chestDuration(unlock.remainingMs, true) : '');
      navState.hidden = readyCount <= 0 && !unlock;
      navState.classList.toggle('is-ready', readyCount > 0);
      const eventsNav = navState.closest('[data-act="nav-events"]');
      if (eventsNav) eventsNav.setAttribute('aria-label', `${I18n.t('tab_events')}. ${I18n.t('home_chests')}: ${chestState}`);
    }
    // Acceso directo a Cofres en la cabecera de Inicio: contador de cuánto falta
    // para que se abra el cofre en curso (o "¡Listo!" / recuento / "Ninguno").
    const shortcutState = $('#home-chest-shortcut-state');
    if (shortcutState) {
      // La cápsula es estrecha: en apertura mostramos solo el tiempo (la etiqueta
      // "Cofre" ya da contexto), evitando que "Abriendo · {t}" se trunque.
      const shortcutText = (readyCount <= 0 && unlock) ? chestDuration(unlock.remainingMs, true) : chestState;
      shortcutState.textContent = shortcutText;
      shortcutState.removeAttribute('data-i18n');
      const chestShortcut = shortcutState.closest('.hub-header-chest');
      if (chestShortcut) {
        chestShortcut.classList.toggle('is-ready', readyCount > 0);
        chestShortcut.setAttribute('aria-label', `${I18n.t('home_chests')}: ${chestState}`);
      }
    }
    // Tarjeta de cofres en Eventos: es la proyección visible hoy (el chip antiguo
    // de Inicio ya no existe en el DOM); comparte el mismo texto de estado.
    const chestStatus = $('#events-chests-status');
    if (chestStatus) chestStatus.textContent = chestState;
    const chestCard = $('#events-chests-card');
    if (chestCard) {
      chestCard.classList.toggle('is-ready', chests > 0);
      chestCard.classList.toggle('is-opening', !!(unlock && !unlock.ready));
    }
  }

  let dailyRewardPopTimer = 0;
  let dailyRewardPopBanner = null;
  let dailyRewardPopEnd = null;

  function clearDailyRewardPopWatch() {
    if (dailyRewardPopTimer) clearTimeout(dailyRewardPopTimer);
    if (dailyRewardPopBanner && dailyRewardPopEnd) dailyRewardPopBanner.removeEventListener('animationend', dailyRewardPopEnd);
    dailyRewardPopTimer = 0;
    dailyRewardPopBanner = null;
    dailyRewardPopEnd = null;
  }

  function finishDailyRewardPop(banner) {
    clearDailyRewardPopWatch();
    if (!banner) return;

    // No ocultamos un ancestro que todavía conserva el foco. La tarjeta de modo
    // seleccionada es el siguiente destino lógico.
    const active = document.activeElement;
    const modeButton = document.querySelector('#mode-cards .home-mode-slot.is-selected [data-mode-card]');
    const focusStillOwnedByClaim = !active || active === document.body || banner.contains(active);
    if (focusStillOwnedByClaim) {
      if (modeButton && !modeButton.disabled && !modeButton.closest('[hidden]')) {
        try { modeButton.focus({ preventScroll: true }); }
        catch (_) { modeButton.focus(); }
      } else if (active && banner.contains(active) && typeof active.blur === 'function') active.blur();
    }

    banner.classList.remove('claimed', 'is-popping');
    banner.removeAttribute('aria-busy');
    if (Meta.rewardReady()) {
      // Salvaguarda para un cambio de día mientras terminaba el FX.
      banner.classList.remove('is-claimed');
      banner.removeAttribute('aria-hidden');
      refreshStart();
      return;
    }
    banner.classList.add('is-claimed');
    banner.setAttribute('aria-hidden', 'true');
  }

  function missionRecommendedMode(mission) {
    if (!mission) return 'clasico';
    if (mission.kind === 'combo' || mission.kind === 'score') return 'contrarreloj';
    if (mission.kind === 'games') return 'home';
    return 'clasico';
  }

  function missionText(mission) {
    const key = mission && ('mission_' + mission.id);
    const translated = key ? I18n.t(key) : '';
    return translated && translated !== key ? translated : ((mission && mission.text) || '');
  }

  function missionRowHtml(mission, cadence) {
    const target = Math.max(1, mission.target || 1);
    const current = mission.done ? target : Math.min(Math.max(0, mission.progress || 0), target);
    const pct = clamp(current / target * 100, 0, 100);
    const weekly = cadence === 'weekly';
    const mode = missionRecommendedMode(mission);
    const cta = mode === 'home' ? I18n.t('mission_cta_modes') : I18n.t('mission_cta_mode').replace('{mode}', I18n.modeT(mode, 'name'));
    const reward = weekly ? I18n.t('mission_reward_weekly') : I18n.t('mission_reward_daily');
    return `<article class="mission-card${mission.done ? ' is-complete' : ''}">
      <header class="mission-card-head"><span class="mission-card-icon" aria-hidden="true">${iconAnyInline(weekly ? 'calendar' : 'target')}</span><span><small>${esc(I18n.t(weekly ? 'mission_weekly_label' : 'mission_daily_label'))}</small><b>${esc(missionText(mission))}</b></span><strong>${mission.done ? esc(I18n.t('mission_complete')) : `${fmtNum(current)}/${fmtNum(target)}`}</strong></header>
      <div class="mission-progress" role="progressbar" aria-label="${esc(missionText(mission))}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${current}"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="mission-card-foot"><span class="mission-reward"><small>${esc(I18n.t('mission_reward_label'))}</small><b>${esc(reward)}</b>${mission.done ? `<em>${esc(I18n.t('mission_credited'))}</em>` : ''}</span><button type="button" class="btn btn-primary btn-sm" data-act="mission-play" data-mode="${mode}">${esc(cta)}</button></div>
    </article>`;
  }

  function buildMissions() {
    const box = $('#start-missions'); if (!box) return;
    const daily = Meta.dailyMission(), weekly = Meta.weeklyChallenge();
    const canReroll = !daily.done && Meta.tickets() > 0;
    const reroll = daily.done ? '' : `<div class="mission-reroll-wrap"><button type="button" class="btn btn-ghost mission-reroll" data-act="reroll-mission" aria-describedby="mission-reroll-note"${canReroll ? '' : ' disabled'}>${esc(I18n.t('reroll_mission'))}</button><small id="mission-reroll-note">${esc(I18n.t(canReroll ? 'mission_reroll_hint' : 'mission_reroll_missing'))}</small></div>`;
    box.setAttribute('tabindex', '-1');
    box.innerHTML = `<p class="missions-intro">${esc(I18n.t('missions_intro'))}</p>${missionRowHtml(daily, 'daily')}${reroll}${missionRowHtml(weekly, 'weekly')}`;
  }

  function refreshStart() {
    updateTopBars();
    const text = (id, value) => { const el = $('#' + id); if (el) el.textContent = value; return el; };
    const setReady = (id, ready) => { const el = $('#' + id); if (el) { el.classList.toggle('is-ready', !!ready); el.classList.toggle('is-done', !!ready); } return el; };
    const worldName = (world) => I18n.t('world_' + world.id);
    // Recompensa diaria: muestra el día de la cadena y se compacta al reclamar.
    {
      const ready = Meta.rewardReady();
      const day = ready ? Meta.rewardNextDay() : Math.max(1, Meta.rewardDay());
      const bn = $('#btn-reward');
      if (bn) {
        const rewardText = I18n.t(ready ? 'home_reward_day' : 'home_reward_claimed').replace('{n}', day);
        const popping = !ready && bn.classList.contains('is-popping');
        // El estado final conserva la caja del banner (CSS solo lo hace invisible),
        // mientras que el estado intermedio debe seguir visible hasta animationend.
        bn.classList.remove('claimed');
        if (ready) {
          clearDailyRewardPopWatch();
          bn.classList.remove('is-popping', 'is-claimed');
          bn.removeAttribute('aria-busy');
          bn.removeAttribute('aria-hidden');
        } else if (popping) {
          bn.classList.remove('is-claimed');
          bn.setAttribute('aria-busy', 'true');
          bn.removeAttribute('aria-hidden');
        } else {
          bn.classList.remove('is-popping');
          bn.classList.add('is-claimed');
          bn.removeAttribute('aria-busy');
          bn.setAttribute('aria-hidden', 'true');
        }
        const claim = bn.querySelector('.db-claim');
        if (claim) {
          claim.disabled = !ready || popping;
          claim.setAttribute('aria-label', ready ? `${I18n.t('claim')}. ${rewardText}` : rewardText);
        }
        const badge = bn.querySelector('.db-badge'); if (badge) badge.hidden = !ready;
      }
      // La copia visible permanece estable como en el mockup; el día y el
      // estado real siguen disponibles en el botón y su nombre accesible.
      const sub = text('home-reward-sub', I18n.t('daily_banner_sub'));
      if (sub) sub.setAttribute('data-i18n', 'daily_banner_sub');
    }

    // Contexto: Inicio reserva un único CTA y prioriza reanudar, Daily, misión
    // cercana y siguiente nivel de Clásico, en ese orden.
    {
      const snapshot = RunSave.load();
      const resume = $('#btn-resume-run');
      const playNow = $('#home-play-now');
      const context = (resume && resume.closest('.home-context')) || (playNow && playNow.closest('.home-context'));
      if (resume) {
        resume.hidden = !snapshot;
      }
      if (snapshot && resume) {
        if (playNow) playNow.hidden = true;
        if (context) context.hidden = false;
        let summary;
        if (snapshot.mode === 'clasico') {
          const world = Worlds.LIST.find((w) => w.id === snapshot.world) || Worlds.LIST[0];
          summary = I18n.t('home_saved_classic').replace('{world}', worldName(world)).replace('{n}', snapshot.worldLevel || snapshot.level || 1);
        } else {
          summary = I18n.t('home_saved_mode').replace('{mode}', I18n.modeT(snapshot.mode, 'name')).replace('{n}', snapshot.level || 1);
        }
        text('home-resume-state', summary);
        resume.setAttribute('aria-label', I18n.t('home_saved_run') + '. ' + summary + '. ' + I18n.t('continue_word'));
      } else if (playNow) {
        const dailyRun = Meta.dailyRunInfo();
        const daily = Meta.dailyMission();
        const ratio = (daily.progress || 0) / Math.max(1, daily.target || 1);
        let route = 'clasico', mode = 'clasico', label, sub, icon = 'img/ui-generated/mode-launch/planet.png';
        if ((dailyRun.plays || 0) === 0) {
          route = 'daily'; mode = 'contrarreloj'; icon = 'img/ui-generated/home/nav-daily.png';
          label = I18n.t('home_play_daily');
          const mut = DailyMut.pick(new Date().toISOString().slice(0, 10));
          sub = I18n.t('home_play_daily_sub').replace('{mut}', I18n.t('dmut_' + mut + '_n'));
        } else if (!daily.done && ratio >= .5) {
          route = 'mission'; mode = missionRecommendedMode(daily); icon = 'img/ui-generated/home/nav-missions.png';
          label = I18n.t('home_play_mission'); sub = missionText(daily);
        } else {
          const unlocked = Worlds.LIST.filter((world) => Worlds.unlocked(world.id));
          const world = unlocked.find((item) => Meta.worldCleared(item.id) < Worlds.PER_WORLD) || unlocked[unlocked.length - 1] || Worlds.LIST[0];
          const level = Meta.worldMaxLevel(world.id);
          label = I18n.t('home_play_classic');
          sub = I18n.t('home_play_classic_sub').replace('{world}', worldName(world)).replace('{n}', level);
        }
        playNow.hidden = false; playNow.dataset.route = route; playNow.dataset.mode = mode;
        if (context) context.hidden = false;
        text('home-play-now-kicker', I18n.t('home_play_recommended'));
        text('home-play-now-label', label); text('home-play-now-sub', sub);
        const iconEl = $('#home-play-now-icon'); if (iconEl) iconEl.src = icon;
        playNow.setAttribute('aria-label', `${I18n.t('home_play_recommended')}. ${label}. ${sub}`);
      }
    }

    // Reto del día: mutador + resultado/medalla en una sola lectura accesible.
    {
      const card = $('#home-daily-card'), state = $('#home-daily-state'), badge = $('#home-daily-badge');
      if (card && state && badge) {
        const run = Meta.dailyRunInfo();
        const played = (run.plays || 0) > 0;
        const medal = Meta.dailyMedal(run.best || 0);
        const mut = DailyMut.pick(new Date().toISOString().slice(0, 10));
        const mutName = I18n.t('dmut_' + mut + '_n');
        const medalName = medal === 'none' ? I18n.t('home_status_done') : ModeSignals.dailyMedalLabel(medal);
        const stateText = played ? `${medalName} · ${fmtNum(run.best || 0)}` : `${mutName} · ${I18n.t('home_status_pending')}`;
        const badgeText = played ? medalName : I18n.t('home_status_pending');
        state.textContent = stateText; state.removeAttribute('data-i18n');
        badge.textContent = badgeText; badge.removeAttribute('data-i18n');
        card.classList.toggle('done', played);
        card.classList.remove('medal-bronze', 'medal-silver', 'medal-gold');
        if (played && medal !== 'none') card.classList.add('medal-' + medal);
        card.setAttribute('aria-label', `${I18n.t('daily_challenge')}. ${stateText}. ${badgeText}`);
      }
    }

    // Clásico: primer mundo desbloqueado aún incompleto, nivel actual y estrellas.
    {
      const unlocked = Worlds.LIST.filter((w) => Worlds.unlocked(w.id));
      const world = unlocked.find((w) => Meta.worldCleared(w.id) < Worlds.PER_WORLD) || unlocked[unlocked.length - 1] || Worlds.LIST[0];
      const level = Meta.worldMaxLevel(world.id), stars = Meta.worldStars(world.id);
      const stateText = I18n.t('home_classic_state').replace('{world}', worldName(world)).replace('{n}', level);
      const badgeText = I18n.t('home_classic_stars').replace('{n}', stars);
      text('home-classic-state', stateText)?.removeAttribute('data-i18n');
      text('home-classic-badge', badgeText);
      const card = document.querySelector('[data-mode-card="clasico"]');
      if (card && HomeModeCarousel.key === 'clasico') card.setAttribute('aria-label', `${I18n.t('home_mode_play').replace('{mode}', I18n.t('home_classic_title'))}. ${stateText}. ${badgeText}`);
    }

    // Dock contextual: misión, Reto diario, cofres y racha.
    {
      const dm = Meta.dailyMission();
      const value = (m) => m.done ? I18n.t('home_complete') : `${Math.min(m.progress || 0, m.target || 1)} / ${m.target || 1}`;
      const dailyValue = value(dm);
      text('home-daily-progress', dailyValue);
      const dailyItem = setReady('home-today-daily', dm.done); if (dailyItem) dailyItem.setAttribute('aria-label', `${I18n.t('home_daily_mission')}. ${dailyValue}`);

      syncHomeChests();

      const streak = Number(Meta.streak()) || 0;
      document.querySelectorAll('[data-home-streak]').forEach((el) => { el.textContent = streak; });
    }

    refreshEvents();
    buildMissions();
    buildCollections();
    Econ.refresh();
  }

  function refreshEvents() {
    const rewardReady = Meta.rewardReady();
    const rewardCard = $('#events-reward-card');
    const rewardState = $('#events-reward-state');
    const rewardClaim = $('#events-reward-claim');
    if (rewardCard) rewardCard.classList.toggle('is-complete', !rewardReady);
    if (rewardState) rewardState.textContent = I18n.t(rewardReady ? 'events_reward_ready' : 'events_reward_claimed');
    if (rewardClaim) {
      rewardClaim.disabled = !rewardReady;
      rewardClaim.textContent = I18n.t(rewardReady ? 'claim' : 'events_reward_claimed');
    }

    const mission = Meta.dailyMission();
    const missionValue = mission.done
      ? I18n.t('home_complete')
      : `${Math.min(mission.progress || 0, mission.target || 1)} / ${mission.target || 1}`;
    const missionProgress = $('#events-mission-progress');
    if (missionProgress) missionProgress.textContent = missionValue;

    const run = Meta.dailyRunInfo();
    const played = (run.plays || 0) > 0;
    const medal = Meta.dailyMedal(run.best || 0);
    const mutator = DailyMut.pick(new Date().toISOString().slice(0, 10));
    const medalName = medal === 'none' ? I18n.t('home_status_done') : ModeSignals.dailyMedalLabel(medal);
    const dailyValue = played
      ? `${medalName} · ${fmtNum(run.best || 0)}`
      : `${I18n.t('dmut_' + mutator + '_n')} · ${I18n.t('home_status_pending')}`;
    const dailyStatus = $('#events-daily-status');
    if (dailyStatus) dailyStatus.textContent = dailyValue;

    // CH-5: la recompensa diaria de elección es distinta del banner diario de
    // monedas. Permanece visible hasta elegir, incluso tras recargar la app.
    const choices = Meta.dailyChoiceChests();
    const choice = choices.find((entry) => entry.state === 'ready')
      || choices.find((entry) => entry.state === 'running') || choices[0] || null;
    const choiceCard = $('#events-choice-card'), choiceStatus = $('#events-choice-status'), choiceOpen = $('#events-choice-open');
    if (choiceCard) {
      choiceCard.hidden = !choice;
      choiceCard.classList.toggle('is-ready', !!choice && choice.state === 'ready');
      choiceCard.classList.toggle('is-opening', !!choice && choice.state === 'running');
    }
    if (choice && choiceStatus) {
      const running = choice.state === 'running' ? Meta.chestUnlock() : null;
      const stateText = choice.state === 'ready' ? I18n.t('daily_choice_ready')
        : (choice.state === 'running' && running && running.uid === choice.uid
          ? I18n.t('daily_choice_opening').replace('{t}', chestDuration(running.remainingMs, true))
          : I18n.t('daily_choice_waiting'));
      const tier = I18n.t(chestDef(choice.type).nameKey);
      choiceStatus.textContent = `${tier} · ${stateText}`;
    }
    if (choiceOpen) {
      choiceOpen.disabled = !choice;
      choiceOpen.textContent = I18n.t(choice && choice.state === 'ready' ? 'daily_choice_open' : 'daily_choice_view');
    }

    // CH-1: el estado de cofres (contador, cuenta atrás o "¡Listo!") se calcula
    // en un único sitio para no divergir.
    syncHomeChests();
  }

  /* ===================== Colecciones (rareza) =====================
   * Hub de 6 categorías (tableros, temas, iconos de tablero, avatares, bordes,
   * logros) + pantalla de detalle reutilizable con rejilla por
   * rareza (Común/Raro/Épico/Legendario), filtros, orden y equipar. Cada
   * categoría se describe en COLLECTION_CATS y provee sus ítems vía collItems().
   */
  const COLLECTION_CATS = {
    boards: {
      accent: '#3f74f2', emblem: 'img/ui-generated/home/classic-board.png',
      nameKey: 'col_cat_boards', descKey: 'col_cat_boards_desc', subKey: 'col_boards_sub', progressKey: 'col_progress_boards',
      showNames: true, equippable: true,
      banner: { icon: 'img/ui-v2/home/rocket.png', titleKey: 'col_banner_boards_title', descKey: 'col_banner_boards_desc', ctaKey: 'col_banner_boards_cta', act: 'open-style-shop' },
    },
    themes: {
      accent: '#9a5bff', emblem: 'img/ui-v2/home/star.png',
      nameKey: 'col_cat_themes', descKey: 'col_cat_themes_desc', subKey: 'col_themes_sub', progressKey: 'col_progress_themes',
      showNames: true, equippable: true,
      banner: { icon: 'img/ui-v2/home/gem.png', titleKey: 'col_banner_themes_title', descKey: 'col_banner_themes_desc', ctaKey: 'col_banner_themes_cta', act: 'open-style-shop' },
    },
    iconpacks: {
      accent: '#ff5b9e', emblemHtml: () => IconPacks.previewHtml(IconPacks.DEFAULT, 4),
      nameKey: 'col_cat_icons', descKey: 'col_cat_icons_desc', subKey: 'col_icons_sub', progressKey: 'col_progress_icons',
      showNames: true, equippable: true, packModal: true,
      banner: { icon: 'img/ui-v2/home/rocket.png', titleKey: 'col_banner_icons_title', descKey: 'col_banner_icons_desc', ctaKey: 'col_banner_icons_cta', act: 'open-style-shop' },
    },
    avatars: {
      accent: '#22c3d6', emblem: 'img/ui-v2/home/robot.png',
      nameKey: 'col_cat_avatars', descKey: 'col_cat_avatars_desc', subKey: 'col_avatars_sub', progressKey: 'col_progress_avatars',
      showNames: false, equippable: true,
      banner: { icon: 'img/ui-v2/home/shield.png', titleKey: 'col_banner_avatars_title', descKey: 'col_banner_avatars_desc', ctaKey: 'col_banner_avatars_cta', act: 'nav-events' },
    },
    borders: {
      accent: '#4bb63c', emblem: 'img/player-borders/royal.png',
      nameKey: 'col_cat_borders', descKey: 'col_cat_borders_desc', subKey: 'col_borders_sub', progressKey: 'col_progress_borders',
      showNames: true, equippable: true,
      banner: { icon: 'img/ui-v2/home/star.png', titleKey: 'col_banner_borders_title', descKey: 'col_banner_borders_desc', ctaKey: 'col_banner_borders_cta', act: 'open-style-shop' },
    },
    achievements: {
      accent: '#d08a1e', emblem: 'img/ui-v2/home/trophy.png',
      nameKey: 'col_cat_achievements', descKey: 'col_cat_achievements_desc', subKey: 'col_achievements_sub', progressKey: 'col_progress_achievements',
      showNames: true, equippable: false,
      banner: { icon: 'img/ui-v2/home/trophy.png', titleKey: 'col_banner_achievements_title', descKey: 'col_banner_achievements_desc', ctaKey: 'col_banner_achievements_cta', act: 'go-play' },
    },
  };
  const COLLECTION_CAT_ORDER = ['boards', 'themes', 'iconpacks', 'avatars', 'borders', 'achievements'];
  let collectionDetailCat = 'boards';
  let collectionFilter = 'all';
  let collectionSort = 'recent';
  let _rfSeq = 0;

  // Ítems de una categoría, normalizados a {id, name, rarity, owned, equipped, index, art}.
  function collItems(catId) {
    if (catId === 'avatars') {
      const eq = Meta.avatarIcon();
      return PlayerIcons.order.map((id, i) => { const d = PlayerIcons.DEFS[id]; return { id, name: d.name, rarity: Rarity.of(d), owned: Meta.ownsAvatarIcon(id), equipped: eq === id, index: i, art: PlayerIcons.html(id, 'col-art-img') }; });
    }
    if (catId === 'iconpacks') {
      const eq = Meta.equippedIconPack();
      return IconPacks.order.map((id, i) => { const d = IconPacks.DEFS[id]; return { id, name: IconPacks.packName(id), rarity: Rarity.of(d), owned: Meta.ownsIconPack(id), equipped: eq === id, index: i, art: IconPacks.previewHtml(id, 4) }; });
    }
    if (catId === 'borders') {
      const eq = Meta.avatarBorder();
      return PlayerBorders.order.map((id, i) => { const d = PlayerBorders.DEFS[id]; return { id, name: d.name, rarity: Rarity.of(d), owned: Meta.ownsAvatarBorder(id), equipped: eq === id, index: i, art: `<span class="col-art-frame">${PlayerBorders.html(id, 'col-art-frame-img')}</span>` }; });
    }
    if (catId === 'boards') {
      const eq = Meta.equippedBoard();
      return Boards.order.map((id, i) => { const d = Boards.DEFS[id]; return { id, name: d.name, rarity: Rarity.of(d), owned: Meta.ownsBoard(id), equipped: eq === id, index: i, art: `<span class="col-art-board board-thumb" data-board="${id}" aria-hidden="true"></span>` }; });
    }
    if (catId === 'themes') {
      const eq = Meta.cosmetics().theme;
      return Themes.order.map((id, i) => { const d = Themes.DEFS[id]; return { id, name: d.name, rarity: Rarity.of(d), owned: Meta.owns(id), equipped: eq === id, index: i, art: `<span class="col-art-theme" style="background:${Themes.swatch(id)}" aria-hidden="true"></span>` }; });
    }
    if (catId === 'achievements') {
      return Meta.achievements().map((a, i) => ({ id: a.id, name: a.name, rarity: Rarity.of(a), owned: a.unlocked, equipped: false, index: i, art: `<img class="col-art-img col-art-trophy" src="img/ui-v2/home/trophy.png" alt="" aria-hidden="true">` }));
    }
    return [];
  }
  function collEquip(catId, id) {
    if (catId === 'avatars') return Meta.equipAvatarIcon(id);
    if (catId === 'iconpacks') return Meta.equipIconPack(id);
    if (catId === 'borders') return Meta.equipAvatarBorder(id);
    if (catId === 'boards') { const ok = Meta.equipBoard(id); if (ok) Boards.apply(); return ok; }
    if (catId === 'themes') { const ok = Meta.equip('theme', id); if (ok) Cosmetics.apply(); return ok; }
    return false;
  }
  function collCount(catId) {
    const items = collItems(catId);
    return { owned: items.filter((it) => it.owned).length, total: items.length };
  }

  // Hexágono con cara robot coloreado por rareza (mini-tarjetas de progreso).
  function rarityFaceSvg(r) {
    const d = Rarity.DEFS[r] || Rarity.DEFS.common;
    const gid = 'rf' + (++_rfSeq);
    return `<svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d.accent}"/><stop offset="1" stop-color="${d.accent2}"/></linearGradient></defs>
      <path d="M20 2.6 34.6 11v18L20 37.4 5.4 29V11z" fill="url(#${gid})" stroke="rgba(255,255,255,.55)" stroke-width="1.3"/>
      <rect x="14.4" y="15" width="3.4" height="9.2" rx="1.7" fill="#eef8ff"/>
      <rect x="22.2" y="15" width="3.4" height="9.2" rx="1.7" fill="#eef8ff"/>
      <path d="M15.3 27.2q4.7 3 9.4 0" fill="none" stroke="#eef8ff" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`;
  }

  // Emblema de una categoría: HTML inline (emblemHtml) o imagen (emblem).
  function catEmblemHtml(c) {
    return typeof c.emblemHtml === 'function' ? c.emblemHtml() : `<img src="${c.emblem}" alt="" aria-hidden="true">`;
  }

  // Hub: 6 píldoras resumen + 6 tarjetas grandes de categoría.
  function buildCollections() {
    const pills = $('#collections-pills');
    const cards = $('#collections-cards');
    if (!cards) return;
    const counts = {};
    COLLECTION_CAT_ORDER.forEach((id) => { counts[id] = collCount(id); });
    if (pills) pills.innerHTML = COLLECTION_CAT_ORDER.map((id) => {
      const c = COLLECTION_CATS[id], n = counts[id];
      return `<span class="col-pill col-pill-${id}" style="--cat:${c.accent}">
        <span class="col-pill-ic">${catEmblemHtml(c)}</span>
        <span class="col-pill-tx"><small>${esc(I18n.t(c.nameKey))}</small><b>${n.owned} / ${n.total}</b></span>
      </span>`;
    }).join('');
    cards.innerHTML = COLLECTION_CAT_ORDER.map((id) => {
      const c = COLLECTION_CATS[id], n = counts[id];
      return `<button type="button" class="col-card col-card-${id}" data-col-open="${id}" style="--cat:${c.accent}">
        <span class="col-card-emblem">${catEmblemHtml(c)}</span>
        <span class="col-card-copy"><b>${esc(I18n.t(c.nameKey))}</b><small>${esc(I18n.t(c.descKey))}</small></span>
        <span class="col-card-badge">${n.owned} / ${n.total}</span>
        <span class="col-card-chev icv2" style="--icv2-url:url('img/icons-v2/8-ui/arrow-right.svg')" aria-hidden="true"></span>
      </button>`;
    }).join('');
    cards.querySelectorAll('[data-col-open]').forEach((btn) => btn.addEventListener('click', () => { Sound.ui(); openCollectionDetail(btn.dataset.colOpen); }));
  }

  function sortCollItems(items) {
    const arr = items.slice();
    // El equipado siempre encabeza su sección (coincide con la maqueta).
    const eq = (a, b) => (b.equipped ? 1 : 0) - (a.equipped ? 1 : 0);
    if (collectionSort === 'name') arr.sort((a, b) => eq(a, b) || a.name.localeCompare(b.name));
    else if (collectionSort === 'owned') arr.sort((a, b) => eq(a, b) || (b.owned - a.owned) || (a.index - b.index));
    else if (collectionSort === 'recent') arr.sort((a, b) => eq(a, b) || (b.owned - a.owned) || (b.index - a.index));
    else arr.sort((a, b) => eq(a, b) || (a.index - b.index)); // 'rarity': orden de catálogo.
    return arr;
  }

  function collTileHtml(cat, it, showName) {
    const cls = ['col-tile', 'is-' + it.rarity, it.owned ? 'is-owned' : 'is-locked'];
    if (it.equipped) cls.push('is-equipped');
    // Packs (packModal): tocar SIEMPRE abre el modal de contenido (ver iconos +
    // equipar), esté o no equipado, propio o no. El resto de categorías equipan
    // al tocar los ítems propios no equipados.
    const clickable = cat.packModal ? true : (cat.equippable && it.owned && !it.equipped);
    const tag = clickable ? 'button' : 'span';
    const dataAttr = cat.packModal ? `data-col-pack="${esc(it.id)}"` : `data-col-equip="${esc(it.id)}"`;
    const attrs = clickable ? ` type="button" ${dataAttr}` : (cat.equippable && it.owned ? ' aria-disabled="true"' : '');
    const rarLabel = Rarity.label(it.rarity);
    const aria = cat.packModal
      ? `${esc(it.name)} · ${esc(rarLabel)} · ${esc(I18n.t('iconpack_view'))}`
      : (it.owned
        ? `${esc(it.name)} · ${esc(rarLabel)}${it.equipped ? ' · ' + esc(I18n.t('equipped')) : (cat.equippable ? ' · ' + esc(I18n.t('equip')) : '')}`
        : `${esc(it.name)} · ${esc(rarLabel)} · ${esc(I18n.t('col_locked_slot'))}`);
    const badge = it.equipped ? '<span class="col-tile-check" aria-hidden="true">✓</span>'
      : (!it.owned ? '<span class="col-tile-lock" aria-hidden="true"><span class="icv2" style="--icv2-url:url(\'img/icons-v2/8-ui/lock.svg\')"></span></span>' : '');
    const nameHtml = showName ? `<span class="col-tile-name">${esc(it.name)}</span>` : '';
    const stateHtml = it.equipped ? `<span class="col-tile-state">${esc(I18n.t('equipped'))}</span>` : '';
    return `<${tag} class="${cls.join(' ')}"${attrs} style="--rar:${Rarity.accent(it.rarity)}" aria-label="${aria}">
      <span class="col-tile-frame"><span class="col-tile-art">${it.art}</span>${badge}</span>
      ${nameHtml}${stateHtml}
    </${tag}>`;
  }
  function collPlaceholderHtml(r) {
    return `<span class="col-tile col-tile-placeholder is-${r}" style="--rar:${Rarity.accent(r)}" aria-hidden="true">
      <span class="col-tile-frame"><span class="col-tile-art"></span><span class="col-tile-lock"><span class="icv2" style="--icv2-url:url('img/icons-v2/8-ui/lock.svg')"></span></span></span>
    </span>`;
  }

  function buildCollectionDetail() {
    const cat = COLLECTION_CATS[collectionDetailCat]; if (!cat) return;
    const items = collItems(collectionDetailCat);
    const owned = items.filter((it) => it.owned).length, total = items.length;
    const tally = Rarity.tally(items);

    const emblem = $('#col-detail-emblem'); if (emblem) emblem.innerHTML = catEmblemHtml(cat);
    const title = $('#col-detail-title'); if (title) title.textContent = I18n.t(cat.nameKey);
    const sub = $('#col-detail-sub'); if (sub) sub.textContent = I18n.t(cat.subKey);
    const detailView = $('#view-collection-detail');
    if (detailView) detailView.style.setProperty('--cat', cat.accent);

    // Panel de progreso: barra + 4 mini-tarjetas de rareza.
    const pct = total ? (owned / total * 100) : 0;
    const rarCards = Rarity.ORDER.map((r) => `<div class="col-rar-card is-${r}" style="--rar:${Rarity.accent(r)}">
      <span class="col-rar-ic">${rarityFaceSvg(r)}</span>
      <span class="col-rar-tx"><small>${esc(Rarity.label(r))}</small><b>${tally[r].owned} / ${tally[r].total}</b></span>
    </div>`).join('');
    const progress = $('#col-detail-progress');
    if (progress) progress.innerHTML = `<div class="col-progress-main">
        <span class="col-progress-title">${esc(I18n.t(cat.progressKey))}</span>
        <div class="col-progress-bar"><span class="col-progress-fill" style="width:${pct.toFixed(1)}%"></span><b>${owned} / ${total}</b></div>
      </div>
      <div class="col-progress-rarities">${rarCards}</div>`;

    // Barra de filtros + orden.
    const filters = [['all', I18n.t('col_filter_all')]].concat(Rarity.ORDER.map((r) => [r, Rarity.plural(r)]));
    const sortOpts = [['recent', 'col_sort_recent'], ['rarity', 'col_sort_rarity'], ['name', 'col_sort_name'], ['owned', 'col_sort_owned']];
    const sortLabel = I18n.t((sortOpts.find((s) => s[0] === collectionSort) || sortOpts[0])[1]);
    const toolbar = $('#col-detail-toolbar');
    if (toolbar) toolbar.innerHTML = `<div class="col-filters" role="tablist">
        ${filters.map(([k, label]) => `<button type="button" class="col-filter${collectionFilter === k ? ' is-active' : ''}" data-col-filter="${k}" role="tab" aria-selected="${collectionFilter === k}">${esc(label)}</button>`).join('')}
      </div>
      <div class="col-sort">
        <button type="button" class="col-sort-btn" data-col-sort-toggle aria-haspopup="true" aria-expanded="false"><span>${esc(sortLabel)}</span><span class="col-sort-chev icv2" style="--icv2-url:url('img/icons-v2/8-ui/arrow-down.svg')" aria-hidden="true"></span></button>
        <div class="col-sort-menu" hidden>${sortOpts.map(([k, key]) => `<button type="button" class="col-sort-opt${collectionSort === k ? ' is-active' : ''}" data-col-sort="${k}">${esc(I18n.t(key))}</button>`).join('')}</div>
      </div>`;

    // Secciones agrupadas por rareza.
    const shownRarities = (collectionFilter === 'all' ? Rarity.ORDER : [collectionFilter]).filter((r) => tally[r].total > 0 || collectionFilter === r);
    const sections = $('#col-detail-sections');
    if (sections) {
      if (!shownRarities.length) {
        sections.innerHTML = `<p class="col-empty">${esc(I18n.t('col_empty_rarity'))}</p>`;
      } else {
        sections.innerHTML = shownRarities.map((r) => {
          const group = sortCollItems(items.filter((it) => it.rarity === r));
          if (!group.length) return `<section class="col-section" data-rarity="${r}"><h3 class="col-section-head" style="--rar:${Rarity.accent(r)}">${esc(Rarity.plural(r))}</h3><p class="col-empty">${esc(I18n.t('col_empty_rarity'))}</p></section>`;
          const tiles = group.map((it) => collTileHtml(cat, it, cat.showNames)).join('');
          return `<section class="col-section" data-rarity="${r}">
            <h3 class="col-section-head" style="--rar:${Rarity.accent(r)}">${esc(Rarity.plural(r))}</h3>
            <div class="col-row">${tiles}${collPlaceholderHtml(r)}</div>
            <div class="col-dots" aria-hidden="true"></div>
          </section>`;
        }).join('');
      }
      // Equipar (categorías normales).
      sections.querySelectorAll('[data-col-equip]').forEach((btn) => btn.addEventListener('click', () => {
        if (collEquip(collectionDetailCat, btn.dataset.colEquip)) { Sound.success(); updateTopBars(); buildCollectionDetail(); }
        else Sound.ui();
      }));
      // Packs: abrir el modal de contenido (ver iconos + equipar).
      sections.querySelectorAll('[data-col-pack]').forEach((btn) => btn.addEventListener('click', () => {
        Sound.ui(); openIconPackModal(btn.dataset.colPack, { onChange: buildCollectionDetail });
      }));
    }

    // Banner inferior con CTA.
    const banner = $('#col-detail-banner');
    if (banner && cat.banner) {
      const b = cat.banner;
      banner.innerHTML = `<span class="col-banner-ic"><img src="${b.icon}" alt="" aria-hidden="true"></span>
        <span class="col-banner-copy"><b>${esc(I18n.t(b.titleKey))}</b><small>${esc(I18n.t(b.descKey))}</small></span>
        <button type="button" class="btn btn-primary col-banner-cta" data-act="${b.act}">${esc(I18n.t(b.ctaKey))}</button>`;
    }

    // Filtros + orden (wiring).
    if (toolbar) {
      toolbar.querySelectorAll('[data-col-filter]').forEach((btn) => btn.addEventListener('click', () => { collectionFilter = btn.dataset.colFilter; Sound.ui(); buildCollectionDetail(); }));
      const sortBtn = toolbar.querySelector('[data-col-sort-toggle]');
      const sortMenu = toolbar.querySelector('.col-sort-menu');
      if (sortBtn && sortMenu) {
        sortBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = sortMenu.hidden; sortMenu.hidden = !open; sortBtn.setAttribute('aria-expanded', String(open)); });
        sortMenu.querySelectorAll('[data-col-sort]').forEach((opt) => opt.addEventListener('click', () => { collectionSort = opt.dataset.colSort; Sound.ui(); buildCollectionDetail(); }));
        if (!buildCollectionDetail._sortDocWired) {
          buildCollectionDetail._sortDocWired = true;
          document.addEventListener('click', (e) => {
            const menu = document.querySelector('#col-detail-toolbar .col-sort-menu');
            if (menu && !menu.hidden && !e.target.closest('.col-sort')) { menu.hidden = true; const b = document.querySelector('[data-col-sort-toggle]'); if (b) b.setAttribute('aria-expanded', 'false'); }
          });
        }
      }
    }
    requestAnimationFrame(refreshColDots);
    if (!buildCollectionDetail._resizeWired) {
      buildCollectionDetail._resizeWired = true;
      let raf = 0;
      window.addEventListener('resize', () => {
        if (raf || !document.querySelector('#col-detail-sections .col-section')) return;
        raf = requestAnimationFrame(() => { raf = 0; refreshColDots(); });
      }, { passive: true });
    }
  }

  // Puntos de paginación por sección (reflejan el scroll horizontal de cada fila).
  function refreshColDots() {
    document.querySelectorAll('#col-detail-sections .col-section').forEach((section) => {
      const row = section.querySelector('.col-row'), dots = section.querySelector('.col-dots');
      if (!row || !dots) return;
      const pages = Math.max(1, Math.round(row.scrollWidth / Math.max(1, row.clientWidth)));
      if (pages <= 1) { dots.innerHTML = ''; return; }
      const active = Math.round(row.scrollLeft / Math.max(1, row.clientWidth));
      dots.innerHTML = Array.from({ length: pages }, (_, i) => `<span class="col-dot${i === active ? ' is-active' : ''}" style="--rar:${Rarity.accent(section.dataset.rarity)}"></span>`).join('');
      if (!row.dataset.dotsWired) {
        row.dataset.dotsWired = '1';
        let raf = 0;
        row.addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; refreshColDots(); }); }, { passive: true });
      }
    });
  }

  function applyReducedFx() {
    document.body.classList.toggle('reduced-fx', Settings.reducedFx);
  }
  function maybeNoticeSystemReducedFx() {
    if (!Settings.reducedFx || Settings.reducedFxExplicit || !Settings.systemReducedMotion) return;
    try {
      if (localStorage.getItem('cv_rfx_notice') === '1') return;
      localStorage.setItem('cv_rfx_notice', '1');
    } catch (_) { }
    setTimeout(() => Toasts.show(I18n.t('rfx_system_notice'), 'info', 4200, 'aura'), 700);
  }
  function applyLargeText() {
    document.documentElement.style.fontSize = Settings.largeText ? '18.5px' : '';
    document.body.classList.toggle('large-text', Settings.largeText);
  }
  // Aplica el idioma: re-traduce el HTML estático y reconstruye lo dinámico.
  function applyLanguage() {
    I18n.apply();
    buildHomeModeCarousel(); refreshStart(); buildSettings();
    if (HubViews.current === 'resource-shop') buildResourceShop();
    else if (HubViews.current === 'shop') buildShop();
    renderSurvivalDiff();
    if (State.status === 'playing' || State.status === 'paused') Game.showGoalBanner();
  }

  // Panel de ajustes (toggles persistentes)
  function buildSettings() {
    const rows = [
      { k: 'sfx', label: I18n.t('set_sfx'), icon: Settings.sfx ? 'sound-on' : 'sound-off' },
      { k: 'music', label: I18n.t('set_music'), icon: Settings.music ? 'music-on' : 'music-off' },
      { k: 'haptics', label: I18n.t('set_haptics'), show: Haptics.ok, icon: 'v2:mobile-phone' },
      { k: 'reducedFx', label: I18n.t('set_reduced'), icon: 'aura' },
      { k: 'largeText', label: I18n.t('set_large'), icon: 'v2:font' },
    ];
    const list = $('#settings-list'); if (!list) return;
    let html = rows.filter(r => r.show !== false).map(r =>
      `<div class="set-row"><span class="set-row-l"><span class="set-badge">${r.icon ? iconAny(r.icon) : (r.emoji || '')}</span><span class="set-name">${r.label}</span></span><button class="switch" role="switch" data-set="${r.k}" aria-checked="${Settings[r.k]}" aria-label="${r.label}"><span class="switch-dot"></span></button></div>`
    ).join('');
    html += `<div class="set-row set-row-lang"><span class="set-row-l"><span class="set-badge">${icon('planet')}</span><span class="set-name">${I18n.t('set_lang')}</span></span><div class="lang-pick">` +
      `<button class="lang-btn${Settings.lang !== 'en' ? ' on' : ''}" data-lang="es">ES</button>` +
      `<button class="lang-btn${Settings.lang === 'en' ? ' on' : ''}" data-lang="en">EN</button></div></div>`;
    list.innerHTML = html;
    list.querySelectorAll('[data-set]').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.set; Settings[k] = !Settings[k]; btn.setAttribute('aria-checked', String(Settings[k]));
      // Reconciliar la sesión de audio: al desactivar sonido Y música se suspende el contexto
      // (libera la sesión del dispositivo); al activar alguno se reactiva dentro de este gesto.
      if (k === 'sfx' || k === 'music') Sound.applyEnabled();
      if (k === 'sfx' && Settings.sfx) Sound.ui();
      if (k === 'music') { (Settings.music && State.status === 'playing') ? Music.start() : Music.stop(); }
      if (k === 'reducedFx') applyReducedFx();
      if (k === 'largeText') applyLargeText();
      if (k === 'sfx' || k === 'music') { const si = btn.closest('.set-row').querySelector('.set-badge'); if (si) si.innerHTML = icon(k === 'sfx' ? (Settings.sfx ? 'sound-on' : 'sound-off') : (Settings.music ? 'music-on' : 'music-off')); }
      const sw = $('#btn-sound'); if (sw) sw.setAttribute('aria-checked', String(Settings.sfx));
    }));
    list.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', () => {
      if (Settings.lang === btn.dataset.lang) return; Settings.lang = btn.dataset.lang; Sound.ui(); applyLanguage();
    }));
  }
  function openSettings() { buildSettings(); HubViews.open('settings'); }

  // Acceso directo a Ajustes desde la pausa: abre Ajustes conservando la partida
  // pausada y, al cerrar (X o "Volver"), reabre el modal de pausa sobre el juego.
  let pauseSettingsReturn = false;
  function openSettingsFromPause() {
    if (State.status !== 'paused') return;
    pauseSettingsReturn = true;
    Sound.ui();
    Modal.close();
    openSettings();
  }
  function returnFromPauseSettings() {
    pauseSettingsReturn = false;
    HubViews.home({ focus: false });
    Screens.show('game');
    State.status = 'paused';
    renderPauseSummary();
    Modal.open('modal-pause');
  }

  function openEvents() {
    refreshStart();
    HubViews.open('events', { nav: 'nav-events' });
  }

  function openCollections() {
    buildCollections();
    HubViews.open('collections', { nav: 'nav-collections' });
  }

  function openCollectionDetail(catId) {
    if (!COLLECTION_CATS[catId]) return;
    collectionDetailCat = catId;
    collectionFilter = 'all';
    collectionSort = 'recent';
    buildCollectionDetail();
    HubViews.open('collection-detail', { nav: 'nav-collections' });
    requestAnimationFrame(refreshColDots);
  }

  /* ---- Modal de contenido de un pack de iconos (reutilizable: tienda + colección).
   * Muestra TODOS los iconos del pack + acción equipar/comprar. `onChange` refresca
   * la vista que lo abrió. */
  let _iconPackOnChange = null;
  function fillIconPackModal(packId) {
    const pack = IconPacks.DEFS[packId]; if (!pack) return;
    const rarity = Rarity.of(pack), accent = Rarity.accent(rarity);
    const owned = Meta.ownsIconPack(packId), equipped = Meta.equippedIconPack() === packId;
    const emblem = $('#icon-pack-emblem'); if (emblem) emblem.innerHTML = IconPacks.previewHtml(packId, 4);
    const title = $('#icon-pack-title'); if (title) title.textContent = IconPacks.packName(packId);
    const chip = $('#icon-pack-rarity'); if (chip) { chip.textContent = Rarity.label(rarity); chip.style.setProperty('--rar', accent); }
    const desc = $('#icon-pack-desc'); if (desc) desc.textContent = pack.descKey ? I18n.t(pack.descKey) : '';
    const grid = $('#icon-pack-grid');
    if (grid) grid.innerHTML = IconPacks.iconsOf(packId).map((ic) => `<span class="icon-pack-cell">${IconPacks.svg(packId, ic)}</span>`).join('');
    const note = $('#icon-pack-note'); if (note) { note.hidden = !equipped; note.textContent = equipped ? I18n.t('iconpack_equipped_note') : ''; }
    const action = $('#icon-pack-action');
    if (action) {
      action.classList.remove('confirming'); delete action.dataset.armed;
      if (equipped) { action.disabled = true; action.innerHTML = esc(I18n.t('equipped')); }
      else if (owned) { action.disabled = false; action.innerHTML = esc(I18n.t('equip')); }
      else { action.disabled = false; action.innerHTML = pack.cost > 0 ? `${iconInline('coin')} ${pack.cost}` : esc(I18n.t('free')); }
    }
  }
  function openIconPackModal(packId, opts = {}) {
    if (!IconPacks.DEFS[packId]) return;
    _iconPackOnChange = typeof opts.onChange === 'function' ? opts.onChange : null;
    const action = $('#icon-pack-action');
    if (action && !action.dataset.wired) {
      action.dataset.wired = '1';
      action.addEventListener('click', () => {
        const id = action.dataset.pack;
        const pack = IconPacks.DEFS[id]; if (!pack) return;
        if (Meta.ownsIconPack(id)) {
          if (Meta.equipIconPack(id)) Sound.success();
        } else if (pack.cost > 0 && !action.dataset.armed) {
          // Confirmación de compra en dos toques para packs de pago (futuros).
          action.dataset.armed = '1'; action.classList.add('confirming');
          const prev = action.innerHTML; action.innerHTML = `${esc(I18n.t('confirm_buy'))} ${prev}`;
          setTimeout(() => { if (action.isConnected && action.dataset.armed) { delete action.dataset.armed; action.classList.remove('confirming'); fillIconPackModal(id); } }, 3000);
          Sound.ui(); return;
        } else if (Meta.buyIconPack(id)) { Meta.equipIconPack(id); Sound.success(); }
        else { Sound.miss(); Toasts.show(I18n.t('no_coins'), 'warn', 1600); return; }
        updateTopBars();
        fillIconPackModal(id);
        if (_iconPackOnChange) _iconPackOnChange();
      });
    }
    if (action) action.dataset.pack = packId;
    fillIconPackModal(packId);
    Modal.open('modal-icon-pack');
  }

  function playerCardHtml(extraClass = '') {
    const name = (Storage.profile && Storage.profile.name) || Storage.user || (Settings.lang === 'es' ? 'Jugador' : 'Player');
    const level = Meta.level(), need = Math.max(1, Meta.xpForLevel(level)), xp = Meta.xp();
    const progress = clamp(xp / need * 100, 0, 100);
    const isPauseCard = extraClass.split(/\s+/).includes('player-card-pause');
    const owned = Meta.avatarIconOwnedCount() + Meta.avatarBorderOwnedCount();
    const total = PlayerIcons.order.length + PlayerBorders.order.length;
    const rankBadge = isPauseCard ? '<span class="player-card-rank-badge" aria-hidden="true"><img src="img/ui-generated/mode-launch/survival-rank.png" alt=""></span>' : '';
    const collection = isPauseCard
      ? `<span class="player-card-collection">${owned} / ${total}<img src="img/icon-packs/prismatic-jewels/golden-star.png" alt="" aria-hidden="true"></span>`
      : `<span class="player-card-collection">${owned} / ${total}</span>`;
    return `<article class="player-card ${extraClass}">
      <div class="player-card-avatar">${playerAvatarHtml(Meta.avatarIcon(), Meta.avatarBorder(), 'player-avatar-lg')}</div>
      <div class="player-card-copy"><small>${esc(I18n.t('profile_card_title'))}</small><h3>${esc(name)}</h3><p class="player-card-rank">${rankBadge}<span>${esc(Meta.rank())} · Lv. ${level}</span></p>
        <div class="player-card-xp" role="progressbar" aria-valuemin="0" aria-valuemax="${need}" aria-valuenow="${xp}"><span style="width:${progress.toFixed(1)}%"></span></div>
        <div class="player-card-meta"><span>${fmtNum(xp)} / ${fmtNum(need)} XP</span>${collection}</div>
      </div>
    </article>`;
  }

  function profileCosmeticTile(kind, id) {
    const iconKind = kind === 'icon', defs = iconKind ? PlayerIcons.DEFS : PlayerBorders.DEFS;
    const owned = iconKind ? Meta.ownsAvatarIcon(id) : Meta.ownsAvatarBorder(id);
    const equipped = iconKind ? Meta.avatarIcon() === id : Meta.avatarBorder() === id;
    const previewIcon = iconKind ? id : Meta.avatarIcon();
    const previewBorder = iconKind ? Meta.avatarBorder() : id;
    const action = iconKind ? 'data-profile-icon-eq' : 'data-profile-border-eq';
    return `<button type="button" class="profile-cosmetic-tile${equipped ? ' is-equipped' : ''}${owned ? '' : ' is-locked'}" ${action}="${id}"${owned ? '' : ' disabled'} aria-label="${esc(defs[id].name)}">
      ${playerAvatarHtml(previewIcon, previewBorder, 'player-avatar-md')}<span>${esc(defs[id].name)}</span><small>${equipped ? esc(I18n.t('equipped')) : (owned ? esc(I18n.t('equip')) : iconInline('lock'))}</small>
    </button>`;
  }

  function buildPlayerProfile() {
    const card = $('#profile-player-card'); if (card) card.innerHTML = playerCardHtml('player-card-profile');
    const icons = $('#profile-icon-grid'); if (icons) icons.innerHTML = PlayerIcons.order.map((id) => profileCosmeticTile('icon', id)).join('');
    const borders = $('#profile-border-grid'); if (borders) borders.innerHTML = PlayerBorders.order.map((id) => profileCosmeticTile('border', id)).join('');
    const iconCount = $('#profile-icons-count'); if (iconCount) iconCount.textContent = I18n.t('profile_owned').replace('{n}', Meta.avatarIconOwnedCount()).replace('{total}', PlayerIcons.order.length);
    const borderCount = $('#profile-borders-count'); if (borderCount) borderCount.textContent = I18n.t('profile_owned').replace('{n}', Meta.avatarBorderOwnedCount()).replace('{total}', PlayerBorders.order.length);
    if (icons) icons.querySelectorAll('[data-profile-icon-eq]').forEach((button) => button.addEventListener('click', () => { if (!Meta.equipAvatarIcon(button.dataset.profileIconEq)) return; Sound.ui(); updateTopBars(); buildPlayerProfile(); }));
    if (borders) borders.querySelectorAll('[data-profile-border-eq]').forEach((button) => button.addEventListener('click', () => { if (!Meta.equipAvatarBorder(button.dataset.profileBorderEq)) return; Sound.ui(); updateTopBars(); buildPlayerProfile(); }));
  }

  // Etiqueta corta del modo para la tarjeta "Partida en curso" de la pausa.
  function pauseModeTag(mode) {
    const m = Config.MODES[mode] || {};
    if (mode === 'supervivencia') return I18n.t('pause_tag_endless');
    if (mode === 'aventura') return I18n.t('ml_adv_tag');
    if (m.timed) return I18n.t('pause_tag_timed');
    const goal = I18n.modeT(mode, 'goal');
    if (goal) return goal;
    return m.endless ? I18n.t('pause_tag_endless') : '';
  }

  function renderPauseSummary() {
    const card = $('#pause-player-card'); if (card) card.innerHTML = playerCardHtml('player-card-pause');
    const summary = $('#pause-run-summary'); if (!summary) return;
    const hasMode = !!Config.MODES[State.mode];
    const modeName = hasMode ? I18n.modeT(State.mode, 'name') : I18n.t('pause_run_title');
    const modeIcon = hasMode && MODE_IMG[State.mode] ? iconAny(MODE_IMG[State.mode]) : '';
    const tag = hasMode ? pauseModeTag(State.mode) : '';
    const isSurv = State.mode === 'supervivencia';
    const progLabel = I18n.t(isSurv ? 'st_wave' : 'st_level');
    const progVal = fmtNum(isSurv ? (Survival.wave || 1) : (State.level || 1));
    const modeArt = isSurv
      ? '<span class="pause-run-art pause-run-art-survival" aria-hidden="true"><img src="img/ui-generated/modes/mode-survival.png" alt=""></span>'
      : `<span class="pause-run-art pause-run-art-generic" aria-hidden="true">${modeIcon}</span>`;
    summary.innerHTML = `<div class="pause-run-hero">
        ${modeArt}
        <div class="pause-run-copy"><small>${esc(I18n.t('pause_run_title'))}</small><b>${esc(modeName)}</b>${tag ? `<span class="pause-run-tag">${esc(tag)}</span>` : ''}</div>
      </div>
      <div class="pause-run-stats">
        <div class="pause-run-stat is-score"><span>${esc(I18n.t('pause_score_label'))}</span><strong><img src="img/icon-packs/prismatic-jewels/golden-star.png" alt="" aria-hidden="true">${fmtNum(State.score || 0)}</strong></div>
        <div class="pause-run-stat is-combo"><span>${esc(I18n.t('pause_combo_label'))}</span><strong>×${fmtNum(State.maxCombo || State.combo || 0)}</strong></div>
        <div class="pause-run-stat is-progress"><span>${esc(progLabel)}</span><strong>${progVal}</strong></div>
      </div>`;
  }

  function openMedals(view = 'profile') {
    const achievementsOnly = view === 'achievements';
    const viewRoot = $('#view-medals');
    if (viewRoot) viewRoot.classList.toggle('achievements-only', achievementsOnly);
    const title = $('#medals-title');
    if (title) {
      const key = achievementsOnly ? 'achievements_title' : 'profile_title';
      title.textContent = I18n.t(key);
      title.setAttribute('data-i18n', key);
    }
    const emblem = viewRoot && viewRoot.querySelector('.m-emblem img');
    if (emblem) emblem.src = achievementsOnly ? 'img/ui-generated/home/nav-achievements.png' : 'img/ui/player.png';
    // Estadísticas de por vida
    const st = Meta.stats();
    const sEl = $('#profile-stats');
    if (sEl) sEl.innerHTML = statRow([
      [st.games, I18n.t('st_games'), 'var(--accent-2)'],
      ['×' + st.bestCombo, I18n.t('st_bestcombo'), 'var(--gold)'],
      [st.totalRemoved, I18n.t('st_removed'), 'var(--good)'],
      [fmtTime(st.totalTime), I18n.t('st_totaltime'), 'var(--time)'],
    ]);
    // Leaderboard local por modo (mejor marca). Estado vacío si nunca se ha jugado.
    const lbEl = $('#profile-lb');
    if (lbEl) {
      const modes = Config.MODE_ORDER.filter(k => k !== 'tutorial');
      const totalPlays = modes.reduce((s, k) => s + Meta.modePlays(k), 0);
      if (totalPlays === 0) {
        lbEl.innerHTML = emptyState('trophy', I18n.t('empty_lb_title'), I18n.t('empty_lb_sub'), I18n.t('empty_cta_play'), 'go-play');
      } else {
        lbEl.innerHTML = modes.map(k => {
          const mo = Config.MODES[k];
          const best = k === 'supervivencia' ? (Meta.survBest() + 's · ' + I18n.t('st_wave') + ' ' + Meta.survBestWave()) : Meta.modeBest(k);
          const plays = Meta.modePlays(k);
          return `<div class="lb-row"><span class="lb-mode">${MODE_IMG[k] ? iconAnyInline(MODE_IMG[k]) : mo.emoji} ${I18n.modeT(k, 'name')}</span><span class="lb-best">${best}</span><span class="lb-plays">${plays}</span></div>`;
        }).join('');
      }
    }
    // Logros: lista completa (bloqueados incluidos); si no hay ninguno desbloqueado,
    // una guía en la cabecera en vez de una parrilla de candados sin contexto.
    const list = $('#medals-list');
    if (list) {
      const achs = Meta.achievements();
      const noneUnlocked = !achs.some(a => a.unlocked);
      const hint = noneUnlocked ? emptyState('medal', I18n.t('empty_medals_title'), I18n.t('empty_medals_sub'), I18n.t('empty_cta_play'), 'go-play') : '';
      const unlocked = achs.filter((a) => a.unlocked).length;
      const summary = $('#trophy-summary');
      if (summary) summary.innerHTML = `<span>${iconInline('trophy')}</span><div><strong>${esc(I18n.t('trophies_progress').replace('{n}', unlocked).replace('{total}', achs.length))}</strong><div class="trophy-progress"><span style="width:${achs.length ? (unlocked / achs.length * 100).toFixed(1) : 0}%"></span></div></div>`;
      list.innerHTML = hint + achs.map(a =>
        `<div class="medal ${a.unlocked ? 'on' : ''}"><span class="medal-ic">${a.unlocked ? iconInline('medal') : iconInline('lock')}</span><span class="medal-tx"><strong>${a.name}</strong><small>${a.desc}</small></span></div>`
      ).join('');
    }
    buildPlayerProfile();
    HubViews.open('medals', { nav: achievementsOnly ? 'nav-collections' : null });
  }

  // Tienda de recursos (checkout ficticio automático + XP booster temporal).
  function euroPrice(value) {
    const out = Number(value).toFixed(2);
    return (Settings.lang === 'es' ? out.replace('.', ',') : out) + ' €';
  }

  function resourceOfferCard(offer) {
    const compare = offer.compareAt
      ? `<span class="resource-offer-compare">${fmtNum(offer.compareAt)}</span>` : '';
    return `<article class="resource-offer resource-offer-${offer.kind}${offer.best ? ' is-best' : ''}" data-offer-card="${offer.id}">
      ${offer.best ? `<span class="resource-best">${esc(I18n.t('best_value'))}</span>` : ''}
      <div class="resource-offer-amount"><strong>${fmtCompact(offer.amount)}</strong>${compare}</div>
      <div class="resource-offer-art"><img src="${offer.asset}" alt="" aria-hidden="true"></div>
      <button class="resource-buy" type="button" data-currency-offer="${offer.id}" aria-label="${esc(I18n.t(offer.kind))}: ${fmtNum(offer.amount)} · ${euroPrice(offer.priceEur)}">
        <strong>${euroPrice(offer.priceEur)}</strong><small>${esc(I18n.t('mock_payment_badge'))}</small>
      </button>
    </article>`;
  }

  function xpOfferCard(offer) {
    const poor = Meta.gems() < offer.gemCost;
    return `<article class="resource-offer resource-offer-xp${offer.best ? ' is-best' : ''}${poor ? ' is-poor' : ''}" data-offer-card="${offer.id}">
      ${offer.best ? `<span class="resource-best">${esc(I18n.t('best_value'))}</span>` : ''}
      <div class="resource-offer-amount"><strong>${esc(I18n.t(offer.labelKey))}</strong><span class="resource-xp-mult">XP ×${offer.multiplier}</span></div>
      <div class="resource-offer-art"><img src="${offer.asset}" alt="" aria-hidden="true"></div>
      <button class="resource-buy resource-buy-gems" type="button" data-xp-offer="${offer.id}" aria-label="${esc(I18n.t('xp_boost_buy'))}: ${esc(I18n.t(offer.labelKey))}, ${offer.gemCost} ${esc(I18n.t('gems'))}">
        ${iconInline('gem')} <strong>${offer.gemCost}</strong><small>${esc(I18n.t('xp_boost_extend').replace('{t}', I18n.t(offer.labelKey)))}</small>
      </button>
    </article>`;
  }

  function chestOfferCard(offer) {
    const defn = CHEST_TYPES[offer.id] || CHEST_TYPES.wood;
    const name = I18n.t(defn.nameKey), tier = I18n.t(defn.rarityKey);
    const poor = Meta.gems() < offer.gemCost;
    const owned = Meta.chestInventory().filter((entry) => entry.type === offer.id).length;
    const ownedLabel = owned > 0 ? I18n.t('chest_shop_owned').replace('{n}', owned) : I18n.t('chest_shop_owned_none');
    return `<article class="resource-offer resource-offer-chest${offer.best ? ' is-best' : ''}${poor ? ' is-poor' : ''}${owned > 0 ? ' has-owned' : ''}" data-offer-card="chest-${offer.id}" style="--offer-a:${defn.accent};--chest-accent:${defn.accent}">
      ${offer.best ? `<span class="resource-best">${esc(I18n.t('best_value'))}</span>` : ''}
      <div class="resource-offer-amount"><strong>${esc(name)}</strong><span class="resource-chest-tier">${esc(tier)}</span></div>
      <div class="resource-offer-art">
        <span class="resource-chest-owned" data-chest-owned="${offer.id}" title="${esc(ownedLabel)}" aria-hidden="true">${iconInline('chest')}<b>${owned}</b></span>
        ${chestSprite(defn.id, 'closed', 'resource-chest-sprite')}
      </div>
      <button class="resource-buy resource-buy-gems" type="button" data-chest-offer="${offer.id}" aria-label="${esc(I18n.t('chest_shop_buy'))}: ${esc(name)}, ${offer.gemCost} ${esc(I18n.t('gems'))}. ${esc(ownedLabel)}">
        ${iconInline('gem')} <strong>${offer.gemCost}</strong><small>${esc(I18n.t('chest_shop_add'))}</small>
      </button>
    </article>`;
  }

  /* ============ Celebraciones de la tienda (gastar dinero = dopamina) ============
   * Capa propia a pantalla completa; NO reutiliza el pool #fx del tablero. Dos
   * lenguajes distintos: "recompensa" al comprar cofres (rayos + destellos) y
   * "cobro" al comprar monedas/gemas (el recurso vuela al contador + count-up).
   * Todo con Web Animations API y respetando movimiento reducido (motionOff). */
  const ShopFX = {
    layer: null,
    // Pool fijo de partículas reutilizables (AP-1/AP-4, ver docs/ANIMATION_PERF_PLAN.md):
    // mismo patrón que el FX del tablero. CERO createElement por tap; al saturar el tope se
    // DESCARTA la partícula (nunca se cancela una viva) -> nº de capas del compositor acotado
    // por muy rápido que se pulse. Antes cada compra creaba ~33 nodos nuevos (16 monedas con
    // <img>, 14 estrellas, rayos, anillo) que se apilaban al repetir y saturaban el hilo.
    pool: [], idx: 0, active: 0, POOL: 96, CAP: 90,
    // Rótulos "+cantidad" (estructura img+b): pool pequeño aparte, reutilizado round-robin.
    chips: [], chipIdx: 0, CHIP_POOL: 4,
    // Coalescing de compras seguidas (AP-2) + count-up cancelable por divisa.
    _fly: { coins: null, gems: null }, _countRaf: { coins: 0, gems: 0 }, COALESCE_MS: 320,
    ensureLayer() {
      if (this.layer && this.layer.isConnected) return this.layer;
      let el = document.getElementById('shop-fx');
      if (!el) {
        el = document.createElement('div');
        el.id = 'shop-fx'; el.className = 'shop-fx'; el.setAttribute('aria-hidden', 'true');
        (document.body || document.documentElement).appendChild(el);
      }
      this.layer = el; this._buildPool(); return el;
    },
    _buildPool() {
      if (this.pool.length || !this.layer) return;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < this.POOL; i++) {
        const s = document.createElement('span');
        s.className = 'shopfx-p'; s.style.opacity = '0';
        this.pool.push({ el: s, anim: null, busy: false });
        frag.appendChild(s);
      }
      for (let i = 0; i < this.CHIP_POOL; i++) {
        const c = document.createElement('span');
        c.className = 'shopfx-amount'; c.style.opacity = '0';
        const img = document.createElement('img'); img.alt = ''; img.decoding = 'async';
        const b = document.createElement('b');
        c.appendChild(img); c.appendChild(b);
        this.chips.push({ el: c, img, b, anim: null });
        frag.appendChild(c);
      }
      this.layer.appendChild(frag);
    },
    centerOf(el) {
      if (!el || !el.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    },
    // Ranura LIBRE del pool (round-robin). Respeta el tope de concurrencia: si todo está
    // ocupado o se alcanzó el cap, devuelve null y quien llama simplemente no emite esa
    // partícula (mejor descartar un destello que crear un nodo y romper el frame).
    _slot() {
      if (this.active >= this.CAP) return null;
      const N = this.pool.length;
      for (let k = 0; k < N; k++) {
        const p = this.pool[this.idx]; this.idx = (this.idx + 1) % N;
        if (!p.busy) return p;
      }
      return null;
    },
    // Prepara una partícula del pool: fija forma (clase), posición y limpia estilos que
    // otra forma pudiera haber dejado (evita contaminación entre reutilizaciones).
    _particle(cls, cx, cy) {
      const p = this._slot(); if (!p) return null;
      const el = p.el;
      el.className = 'shopfx-p ' + cls;
      el.style.left = cx + 'px'; el.style.top = cy + 'px';
      el.style.width = ''; el.style.height = ''; el.style.background = '';
      el.style.backgroundImage = ''; el.style.boxShadow = ''; el.style.removeProperty('--fx-a');
      el.style.opacity = '1';
      p.busy = true; this.active++;
      return p;
    },
    // Anima una ranura del pool y la LIBERA al terminar (nunca deja el nodo colgado ni la
    // ranura ocupada). Al liberar vuelve a la clase base para soltar estilos de pintado.
    _run(p, frames, opts) {
      if (!p) return null;
      const el = p.el;
      let anim;
      try { anim = el.animate(frames, opts); }
      catch (_) { el.style.opacity = '0'; if (p.busy) { p.busy = false; this.active = Math.max(0, this.active - 1); } return null; }
      p.anim = anim;
      const done = () => {
        if (p.anim !== anim) return;
        p.anim = null; el.style.opacity = '0'; el.className = 'shopfx-p';
        if (p.busy) { p.busy = false; this.active = Math.max(0, this.active - 1); }
        try { anim.onfinish = null; anim.oncancel = null; anim.cancel(); } catch (_) { }
      };
      anim.onfinish = done; anim.oncancel = done; return anim;
    },
    // Toma un rótulo "+N" del pool de chips (cancela el uso previo de esa ranura).
    _chip(cx, cy) {
      const c = this.chips[this.chipIdx = (this.chipIdx + 1) % this.chips.length];
      if (c.anim) { try { c.anim.cancel(); } catch (_) { } c.anim = null; }
      c.el.style.left = cx + 'px'; c.el.style.top = cy + 'px'; c.el.style.opacity = '1';
      return c;
    },
    _runChip(chip, frames, opts) {
      let anim;
      try { anim = chip.el.animate(frames, opts); } catch (_) { chip.el.style.opacity = '0'; return; }
      chip.anim = anim;
      const done = () => { if (chip.anim !== anim) return; chip.anim = null; chip.el.style.opacity = '0'; try { anim.cancel(); } catch (_) { } };
      anim.onfinish = done; anim.oncancel = done;
    },
    // "Wow" de recompensa: rayos giratorios + anillo + estallido de destellos,
    // centrados en el elemento (o rect) ancla. Se usa tal cual para cofres y como
    // puff de color para monedas/gemas.
    rewardWow(anchor, opts) {
      this.ensureLayer();
      if (motionOff()) return;
      const accent = (opts && opts.accent) || '#ffc44d';
      const scale = (opts && opts.scale) || 1;
      const c = this.centerOf(anchor); if (!c) return;
      const raySize = Math.max(210, Math.min(c.w, c.h) * 3.2) * scale;
      const rays = this._particle('shopfx-rays', c.x, c.y);
      if (rays) {
        rays.el.style.setProperty('--fx-a', accent);
        rays.el.style.width = rays.el.style.height = raySize + 'px';
        this._run(rays, [
          { transform: 'translate(-50%,-50%) rotate(-22deg) scale(.2)', opacity: 0 },
          { transform: 'translate(-50%,-50%) rotate(4deg) scale(1)', opacity: .82, offset: .38 },
          { transform: 'translate(-50%,-50%) rotate(24deg) scale(1.16)', opacity: 0 },
        ], { duration: 880, easing: 'cubic-bezier(.2,.7,.3,1)' });
      }
      const ring = this._particle('shopfx-ring', c.x, c.y);
      if (ring) {
        ring.el.style.setProperty('--fx-a', accent);
        ring.el.style.width = ring.el.style.height = (raySize * .5) + 'px';
        this._run(ring, [
          { transform: 'translate(-50%,-50%) scale(.25)', opacity: .9 },
          { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 },
        ], { duration: 600, easing: 'cubic-bezier(.2,.8,.3,1)' });
      }
      const N = 14;
      for (let i = 0; i < N; i++) {
        const a = (Math.PI * 2 * i) / N + (Math.random() - .5) * .55;
        const dist = raySize * (.26 + Math.random() * .2);
        const star = this._particle('shopfx-star', c.x, c.y);
        if (!star) break; // pool saturado por una ráfaga: se dejan de emitir destellos extra
        const col = i % 3 === 0 ? '#fff' : accent;
        star.el.style.background = col; star.el.style.setProperty('--fx-a', col);
        const s = (6 + Math.random() * 8) * scale;
        star.el.style.width = star.el.style.height = s + 'px';
        const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist;
        this._run(star, [
          { transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1)`, opacity: 1, offset: .7 },
          { transform: `translate(calc(-50% + ${(dx * 1.15).toFixed(1)}px), calc(-50% + ${(dy * 1.15).toFixed(1)}px)) scale(.2)`, opacity: 0 },
        ], { duration: 680 + Math.random() * 240, delay: Math.random() * 90, easing: 'cubic-bezier(.15,.7,.3,1)' });
      }
    },
    // Monedas/gemas reales volando de la card al contador de la cabecera, con
    // rótulo "+cantidad", count-up del total y rebote del contador al llegar.
    flyCurrency(kind, amount, fromEl) {
      this.ensureLayer();
      const target = document.querySelector(`#screen-start .hub-header-wallet-${kind} .hub-header-currency`)
        || document.querySelector(`#screen-start [data-econ-num="${kind}"]`);
      const from = this.centerOf(fromEl), to = this.centerOf(target);
      const newTotal = kind === 'gems' ? Meta.gems() : Meta.coins();
      const oldTotal = Math.max(0, newTotal - amount);
      // Count-up SIEMPRE (barato) y cancelable por divisa: los taps seguidos no apilan rAF.
      this.countUp(kind, oldTotal, newTotal, 760, 260);
      if (motionOff() || !from || !to) { this.bumpCounter(kind); return; }
      const asset = kind === 'gems' ? 'img/ui-v2/home/gem.png' : 'img/ui-generated/home/header-coin-star.png';
      const accent = kind === 'gems' ? '#57e0ff' : '#ffca3a';
      // AP-2 · Coalescing: si repites la MISMA divisa dentro de la ventana y el rótulo sigue
      // vivo, acumula "+N" en él y NO relances el enjambre completo. El feedback sube (el
      // número crece con cada tap, el contador rebota) pero el coste de nodos queda acotado.
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const prev = this._fly[kind];
      if (prev && prev.chip && prev.chip.anim && now - prev.at < this.COALESCE_MS) {
        prev.total += amount; prev.at = now;
        prev.chip.b.textContent = '+' + fmtCompact(prev.total);
        this.bumpCounter(kind);
        return;
      }
      // Puff de color en la card.
      this.rewardWow(fromEl, { accent, scale: .82 });
      // Rótulo "+cantidad" que asciende desde la card (nodo del pool de chips).
      const chip = this._chip(from.x, from.y - from.h * .22);
      chip.el.style.setProperty('--fx-a', accent);
      chip.img.src = asset; chip.b.textContent = '+' + fmtCompact(amount);
      this._runChip(chip, [
        { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
        { transform: 'translate(-50%,-135%) scale(1)', opacity: 1, offset: .3 },
        { transform: 'translate(-50%,-205%) scale(1)', opacity: 1, offset: .78 },
        { transform: 'translate(-50%,-255%) scale(.7)', opacity: 0 },
      ], { duration: 1050, easing: 'ease-out' });
      this._fly[kind] = { at: now, total: amount, chip };
      // Enjambre de monedas/gemas en arco hacia el contador. Cada moneda es una partícula
      // del pool que pinta el recurso vía background-image (AP-5): sin <img> hijo ni
      // filter:drop-shadow -> capa pura transform/opacity, ×0 coste de pintado repetido.
      const N = 16;
      const ctrlX = (from.x + to.x) / 2 + (Math.random() - .5) * 70;
      const ctrlY = Math.min(from.y, to.y) - 100;
      for (let i = 0; i < N; i++) {
        const coin = this._particle('shopfx-coin', 0, 0);
        if (!coin) break; // pool saturado: se dejan de emitir monedas extra
        coin.el.style.backgroundImage = `url('${asset}')`;
        const sx = from.x + (Math.random() - .5) * from.w * .7;
        const sy = from.y + (Math.random() - .5) * from.h * .5;
        const M = 6, frames = [];
        for (let k = 0; k <= M; k++) {
          const t = k / M, mt = 1 - t;
          const px = mt * mt * sx + 2 * mt * t * ctrlX + t * t * to.x;
          const py = mt * mt * sy + 2 * mt * t * ctrlY + t * t * to.y;
          frames.push({ transform: `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%,-50%) scale(${(1 - t * .5).toFixed(2)})`, opacity: k === M ? 0 : 1, offset: t });
        }
        this._run(coin, frames, { duration: 540 + Math.random() * 160, delay: 90 + i * 40 + Math.random() * 40, easing: 'cubic-bezier(.35,.1,.5,1)' });
      }
      // El grueso de monedas aterriza ~700 ms; sincroniza rebote y fin del count-up.
      setTimeout(() => this.bumpCounter(kind), 700);
    },
    bumpCounter(kind) {
      if (motionOff()) return;
      const wallet = document.querySelector(`#screen-start .hub-header-wallet-${kind}`);
      if (!wallet) return;
      try {
        wallet.animate([
          { transform: 'scale(1)' },
          { transform: 'scale(1.24)', offset: .38 },
          { transform: 'scale(.96)', offset: .66 },
          { transform: 'scale(1)' },
        ], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1.2)' });
      } catch (_) { }
    },
    countUp(kind, from, to, ms, delay) {
      const els = Array.from(document.querySelectorAll(`#screen-start [data-econ-num="${kind}"]`));
      if (!els.length || typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') return;
      // Cancela un count-up en curso de la misma divisa: los taps seguidos no apilan bucles
      // rAF que compiten por el mismo contador (antes cada compra abría uno nuevo).
      if (this._countRaf[kind]) { try { cancelAnimationFrame(this._countRaf[kind]); } catch (_) { } this._countRaf[kind] = 0; }
      const set = (v) => els.forEach((el) => { el.textContent = fmtCompact(v); });
      if (from === to) { set(to); return; }
      const start = performance.now() + (delay || 0);
      set(from);
      const step = (now) => {
        const t = Math.max(0, Math.min(1, (now - start) / ms));
        const eased = 1 - Math.pow(1 - t, 3);
        set(Math.round(from + (to - from) * eased));
        if (t < 1) this._countRaf[kind] = requestAnimationFrame(step); else { this._countRaf[kind] = 0; set(to); }
      };
      this._countRaf[kind] = requestAnimationFrame(step);
    },
  };

  // AP-3 · Anti-rebote de taps: ignora pulsaciones de un mismo botón dentro de `ms`.
  // Frena el doble-disparo accidental sin bloquear compras intencionadas (un tap cada
  // ~180 ms sigue permitiendo ~5/seg). Clave por elemento; se limpia solo con el GC.
  const _tapAt = new WeakMap();
  function tapThrottle(el, ms) {
    if (!el) return true;
    const now = Date.now(), last = _tapAt.get(el) || 0;
    if (now - last < ms) return false;
    _tapAt.set(el, now); return true;
  }

  // AP-3 · Actualización QUIRÚRGICA de la tienda de recursos: refresca solo los estados
  // que cambian tras una compra (is-poor por gemas, contador "tienes N" de cofres) SIN
  // reescribir el innerHTML ni re-attachar listeners. Sustituye a llamar buildResourceShop()
  // por tap, que reparseaba HTML + re-decodificaba imágenes y era la carga que se apilaba.
  function refreshResourceShopState() {
    const gems = Meta.gems();
    Storefront.XP_BOOST_OFFERS.forEach((offer) => {
      const card = document.querySelector(`[data-offer-card="${offer.id}"]`);
      if (card) card.classList.toggle('is-poor', gems < offer.gemCost);
    });
    Storefront.CHEST_OFFERS.forEach((offer) => {
      const card = document.querySelector(`[data-offer-card="chest-${offer.id}"]`);
      if (!card) return;
      card.classList.toggle('is-poor', gems < offer.gemCost);
      const owned = Meta.chestInventory().filter((entry) => entry.type === offer.id).length;
      card.classList.toggle('has-owned', owned > 0);
      const badge = card.querySelector(`[data-chest-owned="${offer.id}"]`);
      if (badge) {
        const b = badge.querySelector('b'); if (b) b.textContent = owned;
        badge.title = owned > 0 ? I18n.t('chest_shop_owned').replace('{n}', owned) : I18n.t('chest_shop_owned_none');
      }
    });
  }

  function buildResourceShop() {
    const gems = $('#gem-offers'), coins = $('#coin-offers'), xp = $('#xp-boost-offers');
    if (!gems || !coins || !xp) return;
    gems.innerHTML = Storefront.CURRENCY_OFFERS.filter((offer) => offer.kind === 'gems').map(resourceOfferCard).join('');
    coins.innerHTML = Storefront.CURRENCY_OFFERS.filter((offer) => offer.kind === 'coins').map(resourceOfferCard).join('');
    xp.innerHTML = Storefront.XP_BOOST_OFFERS.map(xpOfferCard).join('');
    const chestOffers = $('#chest-offers');
    if (chestOffers) chestOffers.innerHTML = Storefront.CHEST_OFFERS.map(chestOfferCard).join('');

    document.querySelectorAll('[data-currency-offer]').forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled) return;
      const activeCard = button.closest('.resource-offer');
      button.disabled = true; if (activeCard) activeCard.classList.add('is-processing');
      try {
        const tx = await Storefront.checkoutCurrency(button.dataset.currencyOffer);
        if (!tx || tx.status !== 'paid') throw new Error('checkout-declined');
        Sound.success(); Haptics.level(); Econ.refresh(); updateTopBars(); refreshStart();
        refreshResourceShopState();
        const label = I18n.t(tx.kind);
        Toasts.show(I18n.t('mock_purchase_done').replace('{n}', fmtNum(tx.amount)).replace('{r}', label), 'good', 2200, tx.kind === 'gems' ? 'gem' : 'coin');
        const card = document.querySelector(`[data-offer-card="${tx.offerId}"]`);
        if (card) { card.classList.add('is-purchased'); setTimeout(() => card.classList.remove('is-purchased'), 850); }
        // Animación "wow" de cobro: el recurso comprado vuela al contador total.
        ShopFX.flyCurrency(tx.kind, tx.amount, card || activeCard);
      } catch (_) {
        Sound.miss(); Toasts.show(I18n.t('resource_purchase_failed'), 'warn', 2400, 'cart');
      } finally {
        if (activeCard) activeCard.classList.remove('is-processing');
        if (button.isConnected) button.disabled = false;
      }
    }));

    document.querySelectorAll('[data-xp-offer]').forEach((button) => button.addEventListener('click', () => {
      if (!tapThrottle(button, 200)) { Sound.ui(); return; }
      const id = button.dataset.xpOffer;
      const result = Storefront.buyXpBoost(id);
      if (!result || result.status !== 'paid') {
        Sound.miss(); Toasts.show(I18n.t('xp_boost_no_gems'), 'warn', 2200, 'gem'); return;
      }
      const offer = Storefront.XP_BOOST_OFFERS.find((item) => item.id === id);
      Sound.success(); Haptics.level(); FX.confetti(34); Econ.refresh(); updateTopBars(); refreshResourceShopState();
      Toasts.show(I18n.t('xp_boost_added').replace('{t}', I18n.t(offer.labelKey)), 'good', 2400, 'potion');
    }));

    document.querySelectorAll('[data-chest-offer]').forEach((button) => button.addEventListener('click', () => {
      if (!tapThrottle(button, 200)) { Sound.ui(); return; }
      const id = button.dataset.chestOffer;
      const result = Storefront.buyChest(id);
      if (!result || result.status !== 'paid') {
        Sound.miss(); Toasts.show(I18n.t('no_gems'), 'warn', 2400, 'gem'); return;
      }
      const defn = CHEST_TYPES[id] || CHEST_TYPES.wood;
      Sound.success(); Haptics.level(); FX.confetti(34); Econ.refresh(); updateTopBars(); syncHomeChests();
      refreshResourceShopState(); // actualiza "tienes N" y is-poor sin reconstruir la tienda
      // Celebración "wow" de recompensa sobre la misma card (ya no se repinta el nodo).
      const card = document.querySelector(`[data-offer-card="chest-${id}"]`);
      if (card) {
        card.classList.add('is-rewarded');
        setTimeout(() => card.classList.remove('is-rewarded'), 760);
        const badge = card.querySelector('.resource-chest-owned');
        if (badge) { badge.classList.add('is-pop'); setTimeout(() => badge.classList.remove('is-pop'), 640); }
        ShopFX.rewardWow(card, { accent: defn.accent });
      }
      Toasts.show(I18n.t('chest_shop_bought').replace('{c}', I18n.t(defn.nameKey)), 'good', 2400, 'chest');
    }));
    Econ.refresh();
  }

  function openResourceShop(focusKind) {
    if (document.body.dataset.screen === 'game' && ['playing', 'paused', 'levelComplete'].includes(State.status)) {
      Sound.miss(); Toasts.show(I18n.t('store_game_blocked'), 'info', 2600, 'cart'); return false;
    }
    buildResourceShop();
    const opened = HubViews.open('resource-shop', { nav: 'nav-shop' });
    if (opened && focusKind) requestAnimationFrame(() => {
      const focusId = focusKind === 'coins' ? '#resource-coins-title'
        : focusKind === 'xp' ? '#resource-xp-title'
          : focusKind === 'chests' ? '#resource-chests-title'
            : '#resource-gems-title';
      const target = $(focusId);
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: motionOff() ? 'auto' : 'smooth' });
    });
    return opened;
  }

  // Tienda de temas (compra/equipa con monedas; previsualización en vivo)
  function buildShop() {
    const list = $('#shop-list'); if (!list) return;
    Econ.refresh();
    { const co = $('#shop-coins'); if (co) co.textContent = Meta.coins(); }
    const iconCards = PlayerIcons.order.map((id) => {
      const item = PlayerIcons.DEFS[id], owned = Meta.ownsAvatarIcon(id), equipped = Meta.avatarIcon() === id;
      const button = equipped ? `<button class="btn btn-ghost btn-sm" disabled>${esc(I18n.t('equipped'))}</button>`
        : owned ? `<button class="btn btn-primary btn-sm" data-picon-eq="${id}">${esc(I18n.t('equip'))}</button>`
          : `<button class="btn btn-primary btn-sm" data-picon-buy="${id}">${iconInline('coin')} ${item.cost}</button>`;
      return `<article class="player-shop-item${equipped ? ' is-equipped' : ''}">${playerAvatarHtml(id, Meta.avatarBorder(), 'player-avatar-md')}<b>${esc(item.name)}</b>${button}</article>`;
    }).join('');
    const borderCards = PlayerBorders.order.map((id) => {
      const item = PlayerBorders.DEFS[id], owned = Meta.ownsAvatarBorder(id), equipped = Meta.avatarBorder() === id;
      const button = equipped ? `<button class="btn btn-ghost btn-sm" disabled>${esc(I18n.t('equipped'))}</button>`
        : owned ? `<button class="btn btn-primary btn-sm" data-pborder-eq="${id}">${esc(I18n.t('equip'))}</button>`
          : `<button class="btn btn-primary btn-sm" data-pborder-buy="${id}">${iconInline('coin')} ${item.cost}</button>`;
      return `<article class="player-shop-item${equipped ? ' is-equipped' : ''}">${playerAvatarHtml(Meta.avatarIcon(), id, 'player-avatar-md')}<b>${esc(item.name)}</b>${button}</article>`;
    }).join('');
    const eqB = Meta.equippedBoard();
    const boardsHTML = Boards.order.map((id) => {
      const b = Boards.DEFS[id], owned = Meta.ownsBoard(id), eq = eqB === id;
      const btn = eq ? `<button class="btn btn-ghost btn-sm" disabled>${esc(I18n.t('equipped'))}</button>`
        : owned ? `<button class="btn btn-primary btn-sm" data-beq="${id}">${esc(I18n.t('equip'))}</button>`
          : b.exclusive ? `<button class="btn btn-ghost btn-sm" disabled>${esc(I18n.t('board_excl'))}</button>`
            : (b.cost === 0 ? `<button class="btn btn-primary btn-sm" data-beq="${id}">${esc(I18n.t('free'))}</button>`
              : `<button class="btn btn-primary btn-sm" data-bbuy="${id}">${iconInline('coin')} ${b.cost}</button>`);
      return `<div class="board-card${eq ? ' on' : ''}" data-board="${id}"><span class="board-thumb" data-board="${id}" aria-hidden="true"><img src="img/board-themes/v2/${id}/preview.jpg" alt=""></span><span class="board-name">${esc(b.name)}</span><span class="board-chars">${b.chars.map((c) => `<span class="board-char">✦ ${esc(c)}</span>`).join('')}</span>${btn}</div>`;
    }).join('');
    const curT = Meta.cosmetics().theme;
    const themesHTML = Themes.order.map((id) => {
      const t = Themes.DEFS[id], owned = Meta.owns(id), eq = curT === id;
      const btn = eq ? `<button class="btn btn-ghost btn-sm" disabled>${esc(I18n.t('equipped'))}</button>`
        : owned ? `<button class="btn btn-primary btn-sm" data-equip="${id}">${esc(I18n.t('equip'))}</button>`
          : `<button class="btn btn-primary btn-sm" data-buy="${id}">${iconInline('coin')} ${t.cost}</button>`;
      return `<div class="shop-item${eq ? ' on' : ''}" data-theme="${id}"><button class="shop-sw" type="button" data-theme-preview="${id}" style="background:${Themes.swatch(id)}" aria-label="${esc(I18n.t('preview_theme').replace('{name}', t.name))}"></button><span class="shop-name">${esc(t.name)}</span>${btn}</div>`;
    }).join('');
    const eqPack = Meta.equippedIconPack();
    const iconPacksHTML = IconPacks.order.map((id) => {
      const p = IconPacks.DEFS[id], owned = Meta.ownsIconPack(id), eq = eqPack === id, rarity = Rarity.of(p);
      const btn = eq ? `<button class="btn btn-ghost btn-sm" disabled>${esc(I18n.t('equipped'))}</button>`
        : owned ? `<button class="btn btn-primary btn-sm" data-ipack-eq="${id}">${esc(I18n.t('equip'))}</button>`
          : `<button class="btn btn-primary btn-sm" data-ipack-buy="${id}">${p.cost === 0 ? esc(I18n.t('free')) : iconInline('coin') + ' ' + p.cost}</button>`;
      return `<div class="iconpack-card${eq ? ' on' : ''}" data-pack="${id}">
        <button class="iconpack-preview" type="button" data-ipack-view="${id}" aria-label="${esc(I18n.t('iconpack_view'))}">${IconPacks.previewHtml(id, 4)}</button>
        <span class="iconpack-name">${esc(IconPacks.packName(id))}</span>
        <span class="rarity-chip" style="--rar:${Rarity.accent(rarity)}">${esc(Rarity.label(rarity))}</span>
        <div class="iconpack-actions"><button class="btn btn-ghost btn-sm" type="button" data-ipack-view="${id}">${esc(I18n.t('iconpack_view'))}</button>${btn}</div>
      </div>`;
    }).join('');
    list.innerHTML = `<section class="player-shop-hero">${playerCardHtml('player-card-shop')}</section>
      <h3 class="group-title">${esc(I18n.t('shop_player_icons'))}</h3><div class="player-shop-grid">${iconCards}</div>
      <h3 class="group-title">${esc(I18n.t('shop_player_borders'))}</h3><div class="player-shop-grid">${borderCards}</div>
      <h3 class="group-title">${esc(I18n.t('shop_boards'))}</h3><div class="board-grid">${boardsHTML}</div>
      <h3 class="group-title">${esc(I18n.t('shop_iconpacks'))}</h3><div class="iconpack-grid">${iconPacksHTML}</div>
      <h3 class="group-title">${esc(I18n.t('shop_themes'))}</h3><div class="themes-grid">${themesHTML}</div>`;
    const armBuy = (button) => {
      if (button.dataset.armed) return true;
      button.dataset.armed = '1'; button.classList.add('confirming');
      const previous = button.innerHTML; button.innerHTML = `${esc(I18n.t('confirm_buy'))} ${previous}`;
      setTimeout(() => { if (button.isConnected && button.dataset.armed) { delete button.dataset.armed; button.classList.remove('confirming'); button.innerHTML = previous; } }, 3000);
      return false;
    };
    const refreshPlayerShop = () => { updateTopBars(); buildPlayerProfile(); buildShop(); };
    list.querySelectorAll('[data-picon-buy]').forEach((button) => button.addEventListener('click', () => { if (!armBuy(button)) { Sound.ui(); return; } if (Meta.buyAvatarIcon(button.dataset.piconBuy)) { Meta.equipAvatarIcon(button.dataset.piconBuy); Sound.success(); refreshPlayerShop(); Toasts.show(I18n.t('equipped'), 'good', 1600, 'player'); } else { Sound.miss(); Toasts.show(I18n.t('no_coins'), 'warn', 1600); } }));
    list.querySelectorAll('[data-pborder-buy]').forEach((button) => button.addEventListener('click', () => { if (!armBuy(button)) { Sound.ui(); return; } if (Meta.buyAvatarBorder(button.dataset.pborderBuy)) { Meta.equipAvatarBorder(button.dataset.pborderBuy); Sound.success(); refreshPlayerShop(); Toasts.show(I18n.t('equipped'), 'good', 1600, 'player'); } else { Sound.miss(); Toasts.show(I18n.t('no_coins'), 'warn', 1600); } }));
    list.querySelectorAll('[data-picon-eq]').forEach((button) => button.addEventListener('click', () => { Meta.equipAvatarIcon(button.dataset.piconEq); Sound.ui(); refreshPlayerShop(); }));
    list.querySelectorAll('[data-pborder-eq]').forEach((button) => button.addEventListener('click', () => { Meta.equipAvatarBorder(button.dataset.pborderEq); Sound.ui(); refreshPlayerShop(); }));
    list.querySelectorAll('[data-bbuy]').forEach((button) => button.addEventListener('click', () => { if (!armBuy(button)) { Sound.ui(); return; } const id = button.dataset.bbuy; if (Meta.buyBoard(id, Boards.DEFS[id].cost)) { Sound.success(); Meta.equipBoard(id); Boards.apply(); buildShop(); Toasts.show(I18n.t('board_unlocked'), 'good', 1600); } else { Sound.miss(); Toasts.show(I18n.t('no_coins'), 'warn', 1600); } }));
    list.querySelectorAll('[data-beq]').forEach((button) => button.addEventListener('click', () => { Meta.equipBoard(button.dataset.beq); Boards.apply(); Sound.ui(); buildShop(); }));
    list.querySelectorAll('[data-ipack-view]').forEach((button) => button.addEventListener('click', () => { Sound.ui(); openIconPackModal(button.dataset.ipackView, { onChange: () => { updateTopBars(); buildShop(); } }); }));
    list.querySelectorAll('[data-ipack-eq]').forEach((button) => button.addEventListener('click', () => { Meta.equipIconPack(button.dataset.ipackEq); Sound.ui(); buildShop(); }));
    list.querySelectorAll('[data-ipack-buy]').forEach((button) => button.addEventListener('click', () => { if (!armBuy(button)) { Sound.ui(); return; } const id = button.dataset.ipackBuy; if (Meta.buyIconPack(id)) { Sound.success(); Meta.equipIconPack(id); buildShop(); Toasts.show(I18n.t('equipped'), 'good', 1600); } else { Sound.miss(); Toasts.show(I18n.t('no_coins'), 'warn', 1600); } }));
    list.querySelectorAll('[data-theme-preview]').forEach((button) => button.addEventListener('click', () => { Cosmetics.previewTheme(button.dataset.themePreview); Sound.ui(); }));
    list.querySelectorAll('[data-buy]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); if (!armBuy(button)) { Sound.ui(); return; } const id = button.dataset.buy; if (Meta.buy(id, Themes.DEFS[id].cost)) { Sound.success(); Meta.equip('theme', id); Cosmetics.apply(); refreshStart(); buildShop(); Toasts.show('¡Tema desbloqueado!', 'good', 1600); } else { Sound.miss(); Toasts.show(I18n.t('no_coins'), 'warn', 1600); } }));
    list.querySelectorAll('[data-equip]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); Meta.equip('theme', button.dataset.equip); Cosmetics.apply(); Sound.ui(); refreshStart(); buildShop(); }));
  }
  function openShop() { buildShop(); HubViews.open('shop', { nav: 'nav-shop' }); }

  // --- Cofres: inventario tipado, ranuras, temporizador y apertura por atlas ---
  let selectedChestUid = '';
  let chestTimerHandle = 0;
  let chestSlotArmUntil = 0;
  let chestRunningUid = ''; // CH-3: detecta el cambio de cofre en curso para reconstruir
  let chestCeremonyRun = 0;
  let chestCeremonyReturnFocus = null;
  let chestCatalogReturnFocus = null;
  const chestCeremonyCleanups = new Set();
  const chestAtlasDecode = new Map();
  const LEGACY_CHEST_OPEN_ASSET = 'img/ui-generated/chests/chest-open.png';
  function chestDef(type) { return CHEST_TYPES[type] || CHEST_TYPES.wood; }
  function prepareChestAtlas(type) {
    const defn = chestDef(type);
    if (chestAtlasDecode.has(defn.id)) return chestAtlasDecode.get(defn.id);
    if (typeof Image === 'undefined') return Promise.resolve();
    const ready = new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      image.onload = finish; image.onerror = finish; image.src = defn.asset;
      if (image.decode) image.decode().then(finish, finish);
      setTimeout(finish, 900);
    });
    chestAtlasDecode.set(defn.id, ready);
    return ready;
  }
  function chestDuration(ms, countdown) {
    ms = Math.max(0, Number(ms) || 0);
    const total = Math.ceil(ms / 1000), h = Math.floor(total / 3600), min = Math.floor((total % 3600) / 60), sec = total % 60;
    if (!countdown && h > 0 && min === 0) return h + 'h';
    if (h > 0) return h + 'h ' + String(min).padStart(2, '0') + 'm';
    if (min > 0) return min + 'm ' + String(sec).padStart(2, '0') + 's';
    return sec + 's';
  }
  function chestSprite(type, frame, extra) {
    const defn = chestDef(type);
    return `<span class="chest-sprite chest-frame-${frame || 'closed'} ${extra || ''}" style="--chest-atlas:url('${defn.asset}');--chest-accent:${defn.accent}" aria-hidden="true"></span>`;
  }
  function currentSelectedChest() {
    const inventory = Meta.chestInventory();
    const unlock = Meta.chestUnlock();
    let chest = inventory.find((entry) => entry.uid === selectedChestUid);
    // CH-3: sin selección previa, el cofre LISTO manda (recoger es la acción natural);
    // después el que está en curso, y por último el primero del inventario.
    if (!chest) {
      const ready = Meta.chestReadyUids();
      chest = inventory.find((entry) => ready.includes(entry.uid))
        || (unlock && inventory.find((entry) => entry.uid === unlock.uid))
        || inventory[0] || null;
    }
    selectedChestUid = chest ? chest.uid : '';
    return chest;
  }
  function clearChestCeremonyAsync() {
    chestCeremonyRun++;
    chestCeremonyCleanups.forEach((cleanup) => cleanup());
    chestCeremonyCleanups.clear();
  }
  function setChestCeremonyOpen(open) {
    const view = $('#view-chests'), preview = $('#chest-preview'), ceremony = $('#chest-ceremony');
    if (!preview || !ceremony) return;
    preview.hidden = !!open;
    preview.toggleAttribute('inert', !!open);
    ceremony.hidden = !open;
    ceremony.toggleAttribute('inert', !open);
    if (view) view.classList.toggle('is-ceremony-open', !!open);
    if (open) {
      const scroller = ceremony.closest('.chests-scroll');
      if (scroller && scroller.scrollTo) scroller.scrollTo({ top: 0, behavior: 'auto' });
    }
  }
  function resetChestCeremony() {
    clearChestCeremonyAsync();
    const body = $('#chests-body');
    if (body) { body.removeAttribute('aria-busy'); body.innerHTML = ''; }
    setChestCeremonyOpen(false);
  }
  function focusChestNode(node) {
    if (!node || !node.focus) return;
    requestAnimationFrame(() => {
      if (!node.isConnected || node.hidden || node.disabled || (node.closest && node.closest('[hidden]'))) return;
      try { node.focus({ preventScroll: true }); } catch (_) { node.focus(); }
    });
  }
  function focusChestSelection(uid) {
    if (!uid) return;
    const target = document.querySelector(`[data-chest-slot="${uid}"], [data-chest-reserve-slot="${uid}"]`);
    focusChestNode(target);
  }
  function finishChestCeremony() {
    const previous = chestCeremonyReturnFocus;
    chestCeremonyReturnFocus = null;
    buildChests();
    const fallback = $('#btn-open-premium') || $('#btn-open-chest') || $('#btn-chest-catalog');
    focusChestNode(previous && previous.isConnected && !previous.disabled ? previous : fallback);
  }
  function afterChestAnimation(node, animationName, timeoutMs, run, onDone) {
    let settled = false, timeout = 0;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      timeout = 0;
      if (node) node.removeEventListener('animationend', onAnimationEnd);
      chestCeremonyCleanups.delete(cleanup);
    };
    const finish = () => {
      if (settled) return;
      settled = true; cleanup();
      if (run === chestCeremonyRun) onDone();
    };
    const onAnimationEnd = (event) => {
      if (!animationName || event.animationName === animationName) finish();
    };
    if (node) node.addEventListener('animationend', onAnimationEnd);
    timeout = setTimeout(finish, timeoutMs);
    chestCeremonyCleanups.add(cleanup);
    return finish;
  }
  function setChestButtonsBusy(on) {
    ['#btn-open-chest', '#btn-open-premium'].forEach((sel) => {
      const b = $(sel); if (!b) return;
      b.disabled = !!on;
      b.classList.toggle('is-busy', !!on);
    });
    const view = $('#view-chests'); if (view) view.classList.toggle('chest-busy', !!on);
  }
  function syncChestButtons() {
    const chest = currentSelectedChest();
    const timed = $('#btn-open-chest'), instant = $('#btn-open-premium');
    const timedLabel = $('#chest-timer-label'), timedValue = $('#chest-timer-value');
    const instantLabel = $('#chest-instant-label'), instantCost = $('#premium-chest-cost');
    if (!timed || !instant) return;
    const actions = instant.parentElement;
    timed.hidden = instant.hidden = false;
    if (actions) actions.classList.remove('is-single-action');
    timed.classList.remove('is-poor'); instant.classList.remove('is-poor');
    if (!chest) {
      timed.disabled = instant.disabled = true;
      if (timedValue) timedValue.textContent = '—';
      if (instantCost) instantCost.textContent = '—';
      return;
    }
    // CH-3: estados por cofre — ready (recoger gratis), running (en curso) o
    // waiting; un waiting con otro en curso se puede abrir al instante igualmente.
    const unlock = Meta.chestUnlock(), durationMs = Meta.chestDurationMs(chest.uid);
    const state = Meta.chestTimerState(chest.uid);
    const isChoice = !!chest.choice;
    // Un cofre listo, Choice o normal, tiene una sola acción real. Las dos rutas
    // históricas harían exactamente lo mismo; un único CTA evita una decisión falsa.
    if (state === 'ready') {
      timed.hidden = true;
      if (actions) actions.classList.add('is-single-action');
    }
    const blocked = state === 'waiting' && !!unlock;
    const cost = Meta.chestInstantCost(chest.uid);
    if (instantLabel) instantLabel.textContent = state === 'ready' ? I18n.t(isChoice ? 'daily_choice_open' : 'chest_collect') : I18n.t('chest_open_now_action');
    if (instantCost) instantCost.textContent = cost > 0 ? String(cost) : '✓';
    instant.disabled = false;
    instant.classList.toggle('is-poor', cost > Meta.gems());
    const instantAction = state === 'ready' ? I18n.t(isChoice ? 'daily_choice_open' : 'chest_collect') : I18n.t('chest_open_now_action');
    instant.setAttribute('aria-label', cost > 0
      ? I18n.t('chest_open_now_cost').replace('{n}', cost) : instantAction);
    if (state === 'ready') {
      if (timedLabel) timedLabel.textContent = I18n.t(isChoice ? 'daily_choice_open' : 'chest_collect');
      if (timedValue) timedValue.textContent = '✓';
      timed.disabled = false;
    } else if (state === 'running') {
      if (timedLabel) timedLabel.textContent = I18n.t('chest_unlocking_action');
      if (timedValue) timedValue.textContent = chestDuration(unlock ? unlock.remainingMs : 0, true);
      timed.disabled = true;
    } else if (blocked) {
      if (timedLabel) timedLabel.textContent = I18n.t('chest_slot_blocked');
      if (timedValue) timedValue.textContent = chestDuration(durationMs);
      timed.disabled = true;
    } else {
      if (timedLabel) timedLabel.textContent = I18n.t('chest_start_unlock');
      if (timedValue) timedValue.textContent = chestDuration(durationMs);
      timed.disabled = false;
    }
  }
  function chestRewardInfo(r) {
    if (!r) return null;
    if (r.kind === 'coins') return { icon: '🪙', asset: 'img/ui/coin.png', rarity: r.rarity || 'common', label: I18n.t('chest_reward_coins').replace('{n}', r.amount) };
    if (r.kind === 'gems') return { icon: '💎', asset: 'img/ui/gem.png', rarity: r.rarity || 'common', label: I18n.t('chest_reward_gems').replace('{n}', r.amount) };
    if (r.kind === 'ticket') return { icon: '🎟️', asset: 'img/ui/ticket.png', rarity: r.rarity || 'common', label: I18n.t('chest_reward_ticket').replace('{n}', r.amount) };
    if (r.kind === 'booster') {
      const assets = { bomb: 'img/ui/bomb.png', freeze: 'img/icons-v2/4-nature/snowflake.svg', clearLine: 'img/ui/bolt.png', wild: 'img/icons-v2/10-editing/brush.svg', x2: 'img/icons-v2/1-game/double.svg' };
      const name = I18n.t('booster_name_' + r.boosterId);
      return { icon: '⚡', asset: assets[r.boosterId] || 'img/ui/bolt.png', rarity: r.rarity || 'rare', label: I18n.t('chest_reward_booster').replace('{n}', r.amount || 1).replace('{b}', name) };
    }
    if (r.cosmeticKind === 'avatarIcon') return { icon: 'player', art: PlayerIcons.html(r.id, 'reward-icon-preview'), rarity: 'cosmetic', label: I18n.t('chest_reward_avatar_icon').replace('{n}', r.name || PlayerIcons.DEFS[r.id].name) };
    if (r.cosmeticKind === 'avatarBorder') return { icon: 'player', art: PlayerBorders.html(r.id, 'reward-border-preview'), rarity: 'cosmetic', label: I18n.t('chest_reward_avatar_border').replace('{n}', r.name || PlayerBorders.DEFS[r.id].name) };
    const key = r.cosmeticKind === 'theme' ? 'chest_reward_theme' : 'chest_reward_board';
    return { icon: '✨', asset: 'img/ui/gift.png', rarity: 'cosmetic', label: I18n.t(key).replace('{n}', r.name || r.id) };
  }
  function showChestReward(r, openedType) {
    const el = $('#chests-body'); if (!el) return;
    el.setAttribute('aria-busy', 'true');
    // CH-4: las monedas garantizadas son el único premio inicialmente visible;
    // principal y extras se revelan en orden. Todo ya está APLICADO en Meta, así
    // que abandonar la ceremonia no pierde premios. Reduced-motion: lista completa.
    const items = Array.isArray(r.items) && r.items.length ? r.items : [r];
    const info = chestRewardInfo(r), firstInfo = chestRewardInfo(items[0]), cosmetic = r.kind === 'cosmetic';
    const reduceMotion = Settings.reducedFx || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const allVisible = reduceMotion || items.length === 1;
    const initialInfo = allVisible ? info : firstInfo;
    const initialTitle = allVisible && cosmetic ? I18n.t('chest_cosmetic_title') : I18n.t('chest_reveal_title');
    const initialRarity = I18n.t('chest_rarity_' + initialInfo.rarity);
    const upgrade = r.upgradeRoll && r.upgradeRoll.upgraded ? r.upgradeRoll : null;
    const upgradeNote = upgrade
      ? I18n.t('chest_tier_reward_note')
        .replace('{f}', I18n.t(chestDef(upgrade.from).nameKey))
        .replaceAll('{t}', I18n.t(chestDef(upgrade.to).nameKey)) : '';
    const equip = cosmetic
      ? `<button class="btn btn-primary btn-sm" data-chest-equip${allVisible ? '' : ' hidden disabled'}>${esc(I18n.t('chest_equip'))}</button>` : '';
    const cards = items.map((item, i) => {
      const it = chestRewardInfo(item);
      const hidden = !reduceMotion && i > 0;
      const next = hidden && i === 1;
      const kind = item.guaranteed ? I18n.t('chest_guaranteed_coins') : (i === 1 ? I18n.t('chest_primary_roll') : I18n.t('chest_bonus_rolls').replace('{n}', 1));
      return `<button type="button" class="cr-item rarity-${hidden ? 'hidden' : it.rarity}${hidden ? ' is-hidden' : ''}${next ? ' is-next' : ''}" data-cr-item="${i}"${hidden && !next || !hidden ? ' disabled' : ''} aria-label="${esc(hidden ? I18n.t('chest_tap_reveal') : it.label)}">
        <span class="cr-item-face">${it.art || `<img src="${it.asset}" alt="" aria-hidden="true">`}<b>${esc(it.label)}</b></span>
        <span class="cr-item-back" aria-hidden="true"><b>?</b><small>${esc(kind)}</small></span>
      </button>`;
    }).join('');
    el.innerHTML = `<div class="chest-reward-stage rarity-${initialInfo.rarity}">
      ${chestSprite(r.chestType || openedType || 'wood', 'open', 'chest-reward-open')}
      <div class="chest-reveal rarity-${initialInfo.rarity}">
        <span class="cr-rarity">${esc(initialRarity)}</span>
        <b class="cr-title">${esc(initialTitle)}</b>
        ${upgradeNote ? `<p class="cr-upgrade-note">${esc(upgradeNote)}</p>` : ''}
        <div class="cr-items">${cards}</div>
        <div class="cr-actions">${equip}<button class="btn btn-ghost btn-sm" data-chest-next${allVisible ? '' : ' disabled'}>${esc(I18n.t('chest_continue'))}</button></div>
      </div>
    </div>`;
    el.removeAttribute('aria-busy');
    const rarityClasses = ['common', 'rare', 'epic', 'legendary', 'mythic', 'special', 'jackpot', 'cosmetic', 'hidden'];
    const showRevealedStyle = (revealed, index) => {
      const stage = el.querySelector('.chest-reward-stage'), reveal = el.querySelector('.chest-reveal');
      rarityClasses.forEach((token) => { if (stage) stage.classList.remove('rarity-' + token); if (reveal) reveal.classList.remove('rarity-' + token); });
      if (stage) stage.classList.add('rarity-' + revealed.rarity);
      if (reveal) reveal.classList.add('rarity-' + revealed.rarity);
      const badge = el.querySelector('.cr-rarity'); if (badge) badge.textContent = I18n.t('chest_rarity_' + revealed.rarity);
      const title = el.querySelector('.cr-title');
      if (title) title.textContent = index === 1 && cosmetic ? I18n.t('chest_cosmetic_title') : I18n.t('chest_reveal_title');
      if (index === 1 && cosmetic) { const button = el.querySelector('[data-chest-equip]'); if (button) button.hidden = false; }
    };
    const unlockNextAction = (moveFocus) => {
      const pending = el.querySelector('.cr-item.is-hidden');
      if (pending) {
        pending.classList.add('is-next'); pending.disabled = false;
        if (moveFocus && pending.focus) pending.focus();
        return;
      }
      const nextButton = el.querySelector('[data-chest-next]'); if (nextButton) nextButton.disabled = false;
      const equipButton = el.querySelector('[data-chest-equip]'); if (equipButton) equipButton.disabled = false;
      if (moveFocus && nextButton && nextButton.focus) nextButton.focus();
    };
    el.querySelectorAll('.cr-item.is-hidden').forEach((card) => card.addEventListener('click', () => {
      if (!card.classList.contains('is-next')) return;
      const index = Number(card.dataset.crItem), revealed = chestRewardInfo(items[index]);
      card.classList.remove('is-hidden', 'is-next');
      card.classList.remove('rarity-hidden'); card.classList.add('rarity-' + revealed.rarity, 'is-revealed');
      card.disabled = true;
      const label = card.querySelector('.cr-item-face b').textContent;
      card.setAttribute('aria-label', label);
      showRevealedStyle(revealed, index);
      if (revealed.rarity === 'common') Sound.ui();
      else {
        Sound.record();
        if (!reduceMotion) FX.confetti(revealed.rarity === 'cosmetic' ? 32 : 20);
      }
      announce(label);
      unlockNextAction(true);
    }, { once: true }));
    const next = el.querySelector('[data-chest-next]');
    if (next) next.addEventListener('click', () => { Sound.ui(); el.removeAttribute('aria-busy'); setChestButtonsBusy(false); finishChestCeremony(); });
    const eq = el.querySelector('[data-chest-equip]');
    if (eq) eq.addEventListener('click', () => {
      if (r.cosmeticKind === 'board') { Meta.equipBoard(r.id); Boards.apply(); }
      else if (r.cosmeticKind === 'theme') { Meta.equip('theme', r.id); Cosmetics.apply(); }
      else if (r.cosmeticKind === 'avatarIcon') Meta.equipAvatarIcon(r.id);
      else if (r.cosmeticKind === 'avatarBorder') Meta.equipAvatarBorder(r.id);
      Sound.success(); Econ.refresh(); updateTopBars(); refreshStart(); buildShop(); buildPlayerProfile(); setChestButtonsBusy(false); finishChestCeremony();
      Toasts.show(I18n.t('equipped'), 'good', 1500, info.icon);
    });
    if (!el.querySelector('.cr-item.is-hidden')) unlockNextAction(false);
    const firstAction = el.querySelector('.cr-item.is-next') || el.querySelector('[data-chest-next]');
    if (firstAction && firstAction.focus) firstAction.focus();
    const announced = allVisible
      ? items.map((item) => chestRewardInfo(item).label).join(' · ')
      : `${chestRewardInfo(items[0]).label}. ${I18n.t('chest_tap_reveal')}`;
    announce(`${upgradeNote ? upgradeNote + '. ' : ''}${I18n.t('chest_reward').replace('{r}', announced)}`);
  }
  function showChestTierRoll(r, onDone, run) {
    const el = $('#chests-body'), roll = r && r.upgradeRoll;
    // El 90% sin ascenso no interrumpe la apertura. Solo celebramos el suceso
    // excepcional; la probabilidad y su efecto ya se explican en la preview.
    if (!el || !roll || !roll.upgraded) { onDone(); return; }
    const from = chestDef(roll.from), to = chestDef(roll.to);
    const fromName = I18n.t(from.nameKey), toName = I18n.t(to.nameKey);
    const outcome = I18n.t('chest_tierup').replace('{c}', toName);
    const detail = I18n.t('chest_tier_success_detail').replace('{f}', fromName).replaceAll('{t}', toName);
    el.setAttribute('aria-busy', 'true');
    el.innerHTML = `<div class="chest-tier-roll is-upgraded" style="--tier-from:${from.accent};--tier-to:${to.accent}" role="status">
      <small>${esc(I18n.t('chest_tier_roll'))}</small>
      <div class="chest-tier-reel" aria-hidden="true">${chestSprite(roll.from, 'closed', 'chest-tier-source')}<span>→</span>${chestSprite(roll.to, 'closed', 'chest-tier-target')}</div>
      <b>${esc(outcome)}</b>
      <p>${esc(detail)}</p>
    </div>`;
    announce(`${outcome}. ${detail}`);
    if (motionOff()) {
      Promise.resolve().then(() => { if (run === chestCeremonyRun) onDone(); });
      return;
    }
    Promise.all([prepareChestAtlas(roll.from), prepareChestAtlas(roll.to)]).then(() => {
      if (run !== chestCeremonyRun) return;
      Sound.record(); FX.confetti(24);
      const target = el.querySelector('.chest-tier-target');
      if (target) target.classList.add('is-playing');
      afterChestAnimation(target, 'chestTierTarget', 900, run, onDone);
    });
  }
  function revealChestReward(r, premium, openedType) {
    const el = $('#chests-body'); if (!el) return;
    const reduceMotion = motionOff();
    const openingType = r.baseChestType || openedType || r.chestType || 'wood';
    const openingDef = chestDef(openingType);
    const active = document.activeElement;
    chestCeremonyReturnFocus = active && active !== document.body && active.isConnected
      ? active : ($('#btn-open-premium') || $('#btn-open-chest'));
    if (chestTimerHandle) { clearInterval(chestTimerHandle); chestTimerHandle = 0; }
    clearChestCeremonyAsync();
    const run = chestCeremonyRun;
    setChestButtonsBusy(true);
    setChestCeremonyOpen(true);
    el.setAttribute('aria-busy', 'true');
    el.innerHTML = `<div class="chest-opening-stage" style="--chest-accent:${openingDef.accent}" role="status" tabindex="-1">
      <span class="chest-opening-glow" aria-hidden="true"></span>
      <span class="chest-opening-motion" aria-hidden="true">${chestSprite(openingType, 'closed', 'chest-opening-sprite')}</span>
      <strong>${esc(I18n.t('chest_opening_named').replace('{c}', I18n.t(openingDef.nameKey)))}</strong>
      <small>${esc(I18n.t('chest_opening_hint'))}</small>
    </div>`;
    const stage = el.querySelector('.chest-opening-stage');
    const motion = el.querySelector('.chest-opening-motion');
    focusChestNode(stage);
    announce(I18n.t('chest_opening_named').replace('{c}', I18n.t(openingDef.nameKey)));
    const finish = () => {
      if (run !== chestCeremonyRun) return;
      const reveal = () => {
        if (run !== chestCeremonyRun) return;
        showChestReward(r, r.chestType || openedType);
        const first = chestRewardInfo(Array.isArray(r.items) && r.items.length ? r.items[0] : r);
        Toasts.show(I18n.t('chest_reward').replace('{r}', first.label), 'good', 2200, first.icon);
        Econ.refresh(); syncHomeChests(); setChestButtonsBusy(true);
      };
      if (!premium && r.upgradeRoll && r.upgradeRoll.upgraded) showChestTierRoll(r, reveal, run);
      else reveal();
    };
    if (reduceMotion) {
      if (stage) stage.classList.add('is-playing');
      Promise.resolve().then(finish);
    } else {
      prepareChestAtlas(openingType).then(() => {
        if (run !== chestCeremonyRun) return;
        afterChestAnimation(motion, 'chestOpenMotion', 900, run, finish);
        requestAnimationFrame(() => { if (run === chestCeremonyRun && stage) stage.classList.add('is-playing'); });
      });
    }
  }
  function openDailyChoicePicker(uid) {
    const info = Meta.chestChoiceInfo(uid);
    if (!info || info.state !== 'ready') return false;
    const options = info.choice.options.map((option) => {
      const reward = chestRewardInfo(option);
      return {
        id: option.id, rarity: reward.rarity,
        icon: `<img class="ic" src="${reward.asset}" alt="" aria-hidden="true">`,
        name: reward.label,
        desc: I18n.t('daily_choice_ready'),
      };
    });
    setChestButtonsBusy(true);
    Picker.open({
      title: I18n.t('daily_choice_title'),
      sub: I18n.t(info.choice.catchUp ? 'daily_choice_catchup_sub' : 'daily_choice_sub'),
      accent: chestDef(info.type).accent,
      options, cancelLabel: I18n.t('daily_choice_cancel'), safeDelayMs: 450,
      onPick: (optionId) => {
        const reward = Meta.claimChestChoice(uid, optionId);
        if (!reward) { Sound.miss(); setChestButtonsBusy(false); buildChests(); return; }
        Sound.success();
        revealChestReward(reward, false, info.type);
        refreshEvents();
      },
      onCancel: () => { setChestButtonsBusy(false); buildChests(); refreshEvents(); },
    });
    return true;
  }
  function openDailyChoiceFromEvents() {
    const choices = Meta.dailyChoiceChests();
    const chest = choices.find((entry) => entry.state === 'ready')
      || choices.find((entry) => entry.state === 'running') || choices[0];
    if (!chest) { Sound.miss(); refreshEvents(); return; }
    selectedChestUid = chest.uid;
    openChests();
    if (chest.state === 'ready') openDailyChoicePicker(chest.uid);
  }
  function renderChestSlots(inventory, selected, unlock) {
    const wrap = $('#chest-slots'); if (!wrap) return;
    const limit = Meta.chestSlotLimit(), visible = inventory.slice(0, limit);
    let html = '';
    for (let i = 0; i < limit; i++) {
      const chest = visible[i];
      if (!chest) {
        html += `<div class="chest-slot chest-slot-empty"><span class="chest-slot-state">${esc(I18n.t('chest_slot_empty'))}</span><span class="chest-slot-plus">+</span><small>${i + 1}</small></div>`;
        continue;
      }
      const defn = chestDef(chest.type);
      // CH-3: estado real por cofre; los "listos" conviven con un temporizador en curso.
      const timer = Meta.chestTimerState(chest.uid);
      const state = timer === 'ready' ? 'ready' : (timer === 'running' ? 'opening' : 'waiting');
      const stateLabel = timer === 'ready' ? I18n.t('chest_slot_ready') : (timer === 'running' ? I18n.t('chest_slot_opening') : I18n.t('chest_slot_waiting'));
      const time = timer === 'ready' ? I18n.t('chest_collect') : (timer === 'running' && unlock ? chestDuration(unlock.remainingMs, true) : chestDuration(Meta.chestDurationMs(chest.uid)));
      html += `<button class="chest-slot chest-slot-${state}${selected && selected.uid === chest.uid ? ' is-selected' : ''}" type="button" data-chest-slot="${chest.uid}" aria-pressed="${selected && selected.uid === chest.uid ? 'true' : 'false'}" style="--slot-accent:${defn.accent}">
        <span class="chest-slot-state">${esc(stateLabel)}</span>
        ${chestSprite(chest.type, 'closed', 'chest-slot-art')}
        <b>${esc(I18n.t(defn.nameKey))}</b>
        <span class="chest-slot-time"><img src="img/ui/clock.png" alt="" aria-hidden="true"><span data-chest-countdown="${chest.uid}">${esc(time)}</span></span>
      </button>`;
    }
    if (limit < 4) {
      html += `<button class="chest-slot chest-slot-locked" type="button" data-chest-unlock-slot>
        <span class="chest-slot-state">${esc(I18n.t('chest_slot_blocked'))}</span><span class="chest-slot-lock">＋</span>
        <b>${esc(I18n.t('chest_unlock_slot'))}</b><small><img src="img/ui/gem.png" alt="" aria-hidden="true"> ${Meta.CHEST_SLOT_GEMS}</small>
      </button>`;
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll('[data-chest-slot]').forEach((button) => button.addEventListener('click', () => {
      selectedChestUid = button.dataset.chestSlot; Sound.ui(); buildChests();
      focusChestSelection(selectedChestUid);
      const selectedChest = Meta.chestInventory().find((entry) => entry.uid === selectedChestUid);
      if (selectedChest) announce(I18n.t('chest_selected_announcement').replace('{c}', I18n.t(chestDef(selectedChest.type).nameKey)));
    }));
    const unlockButton = wrap.querySelector('[data-chest-unlock-slot]');
    if (unlockButton) unlockButton.addEventListener('click', () => {
      const now = Date.now();
      if (now > chestSlotArmUntil) {
        chestSlotArmUntil = now + 3000; unlockButton.classList.add('is-armed');
        const note = unlockButton.querySelector('b');
        if (note) note.textContent = I18n.t('chest_unlock_slot_cost').replace('{n}', Meta.CHEST_SLOT_GEMS);
        Sound.ui(); return;
      }
      chestSlotArmUntil = 0;
      if (!Meta.unlockChestSlot()) { Sound.miss(); Toasts.show(I18n.t('no_gems'), 'warn', 2400, 'gem'); return; }
      Sound.success(); Toasts.show(I18n.t('chest_slot_unlocked'), 'good', 1800, 'chest'); buildChests();
    });
    const reserve = $('#chest-reserve'), extra = Math.max(0, inventory.length - limit);
    if (reserve) {
      // CH-3: cola real y seleccionable. La prioridad coincide con el motor
      // (duración de instancia, earnedAt e índice como desempates).
      const parts = [];
      if (extra > 0) parts.push(I18n.t('chest_more_waiting').replace('{n}', extra));
      parts.push(I18n.t('chest_auto_note'));
      const autoQueue = Meta.chestAutoQueue();
      const queueRank = new Map(autoQueue.map((entry, index) => [entry.uid, index]));
      const overflow = inventory.slice(limit).map((entry, index) => {
        const timer = Meta.chestTimerState(entry.uid);
        const stateRank = timer === 'ready' ? 0 : (timer === 'running' ? 1 : 2);
        return { entry, index, timer, stateRank, queueRank: queueRank.has(entry.uid) ? queueRank.get(entry.uid) : Number.MAX_SAFE_INTEGER };
      }).sort((a, b) => a.stateRank - b.stateRank || a.queueRank - b.queueRank || a.index - b.index);
      const queueHtml = overflow.map(({ entry, timer, queueRank: rank }) => {
        const defn = chestDef(entry.type);
        const stateLabel = timer === 'ready' ? I18n.t('chest_slot_ready')
          : (timer === 'running' ? I18n.t('chest_slot_opening') : I18n.t('chest_queue_next').replace('{n}', rank + 1));
        const time = timer === 'ready' ? I18n.t('chest_collect')
          : (timer === 'running' && unlock ? chestDuration(unlock.remainingMs, true) : chestDuration(Meta.chestDurationMs(entry.uid)));
        return `<button type="button" class="chest-reserve-item chest-reserve-${timer}${selected && selected.uid === entry.uid ? ' is-selected' : ''}" data-chest-reserve-slot="${entry.uid}" aria-pressed="${selected && selected.uid === entry.uid ? 'true' : 'false'}" style="--slot-accent:${defn.accent}">
          ${chestSprite(entry.type, 'closed', 'chest-reserve-art')}
          <span><small>${esc(stateLabel)}</small><b>${esc(I18n.t(defn.nameKey))}</b><em>${esc(time)}</em></span>
        </button>`;
      }).join('');
      const permission = ChestNotices.permission();
      const noticeLabel = permission === 'granted' ? I18n.t('chest_notify_enabled')
        : (permission === 'denied' ? I18n.t('chest_notify_denied') : I18n.t('chest_notify_enable'));
      const noticeButton = permission === 'unsupported' ? ''
        : `<button type="button" class="chest-notice-action" data-chest-notice${permission === 'granted' || permission === 'denied' ? ' disabled' : ''}>${esc(noticeLabel)}</button>`;
      reserve.hidden = false;
      reserve.innerHTML = `<div class="chest-reserve-head"><span><b>${esc(I18n.t('chest_queue_title'))}</b><small>${esc(parts.join(' · '))}</small></span>${noticeButton}</div>
        ${queueHtml ? `<div class="chest-reserve-queue" aria-label="${esc(I18n.t('chest_queue_title'))}">${queueHtml}</div>` : ''}`;
      reserve.querySelectorAll('[data-chest-reserve-slot]').forEach((button) => button.addEventListener('click', () => {
        selectedChestUid = button.dataset.chestReserveSlot; Sound.ui(); buildChests();
        focusChestSelection(selectedChestUid);
        const selectedChest = Meta.chestInventory().find((entry) => entry.uid === selectedChestUid);
        if (selectedChest) announce(I18n.t('chest_selected_announcement').replace('{c}', I18n.t(chestDef(selectedChest.type).nameKey)));
      }));
      const notice = reserve.querySelector('[data-chest-notice]');
      if (notice) notice.addEventListener('click', () => { Sound.ui(); ChestNotices.enable().then(() => buildChests()); });
    }
  }
  function chestBonusOddsLabel(odds) {
    return I18n.t('chest_bonus_odds')
      .replace('{c}', odds.bonus.coinsPct).replace('{cmin}', odds.bonus.coins.min).replace('{cmax}', odds.bonus.coins.max)
      .replace('{g}', odds.bonus.gemsPct).replace('{gmin}', odds.bonus.gems.min).replace('{gmax}', odds.bonus.gems.max)
      .replace('{t}', odds.bonus.ticketsPct).replace('{b}', odds.bonus.boosterPct);
  }
  function chestUpgradeOddsLabel(odds) {
    if (!odds.upgrade.to) return I18n.t('chest_tier_max');
    return I18n.t('chest_upgrade_detail')
      .replace('{c}', I18n.t(chestDef(odds.upgrade.to).nameKey))
      .replace('{p}', odds.upgrade.pct).replace('{n}', chestRollCount(odds.upgrade.to));
  }
  function buildChestCatalog() {
    const grid = $('#chest-catalog-grid'); if (!grid) return;
    const inventory = Meta.chestInventory();
    grid.innerHTML = CHEST_TYPE_ORDER.map((id) => {
      const defn = chestDef(id), owned = inventory.filter((entry) => entry.type === id);
      const odds = chestOdds(id, Meta.level());
      const guaranteed = odds.guaranteedCoins.min === odds.guaranteedCoins.max
        ? String(odds.guaranteedCoins.min) : `${odds.guaranteedCoins.min}–${odds.guaranteedCoins.max}`;
      const upgrade = chestUpgradeOddsLabel(odds);
      const featured = id === 'event' ? Meta.currentChestEvent('catalog').featuredBooster : null;
      const bonus = featured
        ? I18n.t('chest_event_bonus').replace('{b}', I18n.t('booster_name_' + featured))
        : chestBonusOddsLabel(odds);
      return `<article class="chest-catalog-card" style="--catalog-accent:${defn.accent}"${owned.length ? ` data-catalog-owned="${owned.length}"` : ''}>
        <div class="chest-catalog-name">${esc(I18n.t(defn.nameKey))}</div>
        ${chestSprite(id, 'closed', 'chest-catalog-art')}
        <dl aria-label="${esc(I18n.t('chest_odds_title'))}"><div><dt>${esc(I18n.t('chest_size_label'))}</dt><dd>${esc(I18n.t(defn.sizeKey))} · ${chestRollCount(id)}×</dd></div><div><dt>${esc(I18n.t('chest_type_label'))}</dt><dd>${esc(I18n.t(defn.rarityKey))}</dd></div>
          <div><dt>${esc(I18n.t('chest_guaranteed_coins'))}</dt><dd>${guaranteed}</dd></div>
          <div><dt>${esc(I18n.t('chest_contents_coins'))}</dt><dd>${odds.coins.min}–${odds.coins.max} · ${odds.coins.pct}%</dd></div>
          <div><dt>${esc(I18n.t('chest_contents_gems'))}</dt><dd>${odds.gems.min}–${odds.gems.max} · ${odds.gems.pct}%</dd></div>
          <div><dt>${esc(I18n.t('chest_contents_tickets'))}</dt><dd>${odds.tickets.min}–${odds.tickets.max} · ${odds.tickets.pct}%</dd></div>
          <div><dt>${esc(I18n.t('chest_odds_cosmetic'))}</dt><dd>${odds.cosmetic.pct}%</dd></div>
          ${odds.bonus.count ? `<div><dt>${esc(I18n.t('chest_bonus_rolls').replace('{n}', odds.bonus.count))}</dt><dd>${esc(bonus)}</dd></div>` : ''}
          <div><dt>${esc(I18n.t('chest_upgrade_label'))}</dt><dd>${esc(upgrade)}</dd></div></dl>
        <p>${esc(I18n.t(defn.descKey))}</p>
        ${owned.length ? `<button type="button" data-chest-catalog-select="${owned[0].uid}">${esc(I18n.t('chests_available'))} · ${owned.length}</button>` : ''}
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-chest-catalog-select]').forEach((button) => button.addEventListener('click', () => {
      selectedChestUid = button.dataset.chestCatalogSelect;
      chestCatalogReturnFocus = null;
      toggleChestCatalog(false); Sound.ui(); buildChests();
      focusChestSelection(selectedChestUid);
    }));
  }
  function toggleChestCatalog(show) {
    const catalog = $('#chest-catalog'); if (!catalog) return;
    if (show) chestCatalogReturnFocus = document.activeElement;
    catalog.hidden = !show;
    const view = $('#view-chests'); if (view) view.classList.toggle('is-catalog-open', !!show);
    if (show) {
      buildChestCatalog();
      const scroller = catalog.closest('.chests-scroll');
      if (scroller && scroller.scrollTo) scroller.scrollTo({ top: 0, behavior: motionOff() ? 'auto' : 'smooth' });
      const title = $('#chest-catalog-title');
      if (title) { title.setAttribute('tabindex', '-1'); focusChestNode(title); }
    } else if (chestCatalogReturnFocus) {
      const previous = chestCatalogReturnFocus;
      chestCatalogReturnFocus = null;
      focusChestNode(previous);
    }
  }
  function refreshChestCountdowns() {
    // CH-3: chestUnlock() ya auto-encadena; si el cofre en curso cambió (terminó y
    // arrancó el siguiente) o ya no hay ninguno, se reconstruye la vista entera.
    const unlock = Meta.chestUnlock();
    if (!unlock || unlock.uid !== chestRunningUid) {
      if (chestTimerHandle) clearInterval(chestTimerHandle);
      chestTimerHandle = 0;
      buildChests();
      return;
    }
    document.querySelectorAll(`[data-chest-countdown="${unlock.uid}"]`).forEach((node) => { node.textContent = chestDuration(unlock.remainingMs, true); });
    if (selectedChestUid === unlock.uid) { const node = $('#chest-timer-value'); if (node) node.textContent = chestDuration(unlock.remainingMs, true); }
  }
  function startChestTicker() {
    if (chestTimerHandle) clearInterval(chestTimerHandle);
    const unlock = Meta.chestUnlock();
    chestRunningUid = unlock ? unlock.uid : '';
    if (unlock) chestTimerHandle = setInterval(refreshChestCountdowns, 1000);
  }
  function buildChests() {
    const el = $('#chest-preview-body'); if (!el) return;
    resetChestCeremony(); setChestButtonsBusy(false); Econ.refresh();
    const inventory = Meta.chestInventory(), n = Meta.chests(), unlock = Meta.chestUnlock();
    const chestView = $('#view-chests'), emptyActions = $('#chest-empty-actions');
    if (chestView) chestView.classList.toggle('is-empty', n === 0);
    if (emptyActions) emptyActions.hidden = n > 0;
    const selected = currentSelectedChest(), defn = chestDef(selected ? selected.type : 'wood');
    syncHomeChests();
    // CH-2: la tarjeta de progreso refleja el pipeline universal (objetivos → ciclo)
    // con pity visible; la línea de Supervivencia queda como bonus secundario.
    const pipe = Meta.chestPipelineInfo();
    const track = $('#chest-progress-track'), fill = $('#chest-progress-fill'), value = $('#chest-progress-value'), next = $('#chest-next-wave');
    if (track) { track.setAttribute('aria-valuemax', String(pipe.target)); track.setAttribute('aria-valuenow', String(pipe.wins)); }
    if (fill) fill.style.width = Math.round(pipe.wins / pipe.target * 100) + '%';
    if (value) value.textContent = pipe.wins + ' / ' + pipe.target;
    const rule = $('#view-chests [data-i18n="chests_progress_rule"], #view-chests .chest-progress-copy p');
    if (rule) { rule.removeAttribute('data-i18n'); rule.textContent = I18n.t('chests_progress_rule').replace('{t}', pipe.target); }
    const pity = $('#chest-pity');
    if (pity) pity.textContent = I18n.t('chest_next_in_cycle').replace('{c}', I18n.t(chestDef(pipe.nextType).nameKey))
      + ' · ' + I18n.t('chest_pity').replace('{n}', pipe.chestsToMythic);
    const bestWave = Math.max(0, Meta.survBestWave() | 0), wavesLeft = 10 - (bestWave % 10);
    if (next) next.textContent = I18n.t('chests_next_wave').replace('{n}', wavesLeft);
    const info = $('#chest-selected-card');
    if (info) {
      const notes = [];
      if (selected && selected.choice) notes.push(I18n.t('chest_choice_label'));
      if (selected && selected.event) notes.push(I18n.t('chest_event_featured')
        .replace('{w}', selected.event.week).replace('{b}', I18n.t('booster_name_' + selected.event.featuredBooster)));
      info.style.setProperty('--chest-accent', defn.accent); info.innerHTML = `<div class="chest-mini-heading"><span>${esc(I18n.t('chest_type_panel'))}</span><img src="img/ui/info.png" alt="" aria-hidden="true"></div>
      <div class="chest-selected-name">${chestSprite(defn.id, 'closed', 'chest-selected-thumb')}<strong>${esc(I18n.t(defn.nameKey))}</strong></div>
      <span class="chest-tier-pill">${esc(I18n.t(defn.rarityKey))}</span>
      <dl><div><dt>${esc(I18n.t('chest_size_label'))}</dt><dd>${selected && selected.choice ? esc(I18n.t('chest_choice_label')) : `${esc(I18n.t(defn.sizeKey))} · ${chestRollCount(defn.id)}×`}</dd></div><div><dt>${esc(I18n.t('chest_duration'))}</dt><dd>${chestDuration(selected ? Meta.chestDurationMs(selected.uid) : defn.durationMs)}</dd></div></dl>
      <p>${esc(notes.length ? notes.join(' · ') : I18n.t(defn.descKey))}</p>`;
    }
    // CH-1: la ficha "Contiene" deja de ser genérica — rangos y % REALES del tipo
    // seleccionado, directos de CHEST_TYPES (en móvil colapsa a iconos, como antes).
    const contents = $('#chest-contents-list');
    if (contents) {
      if (selected && selected.choice) {
        // U5: el cofre diario no usa la tabla aleatoria. Sus tres opciones ya
        // están fijadas y se muestran literalmente; solo una será reclamada.
        contents.innerHTML = selected.choice.options.map((option) => {
          const reward = chestRewardInfo(option);
          return `<li><img src="${reward.asset}" alt="" aria-hidden="true"><span>${esc(reward.label)}</span></li>`;
        }).join('');
      } else {
        const odds = chestOdds(defn.id, Meta.level());
        const range = (o) => o.min === o.max ? String(o.min) : `${o.min}–${o.max}`;
        const bonus = selected && selected.event
          ? I18n.t('chest_event_bonus').replace('{b}', I18n.t('booster_name_' + selected.event.featuredBooster))
          : chestBonusOddsLabel(odds);
        const upgrade = chestUpgradeOddsLabel(odds);
        const upgradeAsset = odds.upgrade.to ? chestDef(odds.upgrade.to).asset : 'img/ui/gift.png';
        contents.innerHTML = `
          <li><img src="img/ui/coin.png" alt="" aria-hidden="true"><span>${esc(I18n.t('chest_guaranteed_coins'))} ${range(odds.guaranteedCoins)}</span></li>
          <li><img src="img/ui/coin.png" alt="" aria-hidden="true"><span>${esc(I18n.t('chest_primary_roll'))}: ${esc(I18n.t('chest_contents_coins'))} ${range(odds.coins)} · ${odds.coins.pct}%</span></li>
          <li><img src="img/ui/gem.png" alt="" aria-hidden="true"><span>${esc(I18n.t('chest_primary_roll'))}: ${esc(I18n.t('chest_contents_gems'))} ${range(odds.gems)} · ${odds.gems.pct}%</span></li>
          <li><img src="img/ui/ticket.png" alt="" aria-hidden="true"><span>${esc(I18n.t('chest_contents_tickets'))} x${range(odds.tickets)} · ${odds.tickets.pct}% · ${esc(I18n.t('chest_odds_cosmetic'))} ${odds.cosmetic.pct}%</span></li>
          ${odds.bonus.count ? `<li><img src="img/ui/bolt.png" alt="" aria-hidden="true"><span>${esc(I18n.t('chest_bonus_rolls').replace('{n}', odds.bonus.count))} · ${esc(bonus)}</span></li>` : ''}
          <li><img src="${upgradeAsset}" alt="" aria-hidden="true"><span>${esc(I18n.t('chest_upgrade_label'))}: ${esc(upgrade)}</span></li>`;
      }
    }
    el.innerHTML = `<div class="chest-hero${n > 0 ? ' ready' : ' empty'}" style="--chest-accent:${defn.accent}">
      <div class="chest-stage" aria-hidden="true"><span class="chest-stage-ring"></span><span class="chest-spark chest-spark-one"></span><span class="chest-spark chest-spark-two"></span><span class="chest-spark chest-spark-three"></span>${chestSprite(defn.id, 'closed', 'chest-hero-sprite')}</div>
      <p class="chest-count">${esc(I18n.t('chests_have').replace('{n}', n))}</p><p class="chest-hint">${esc(n > 0 ? I18n.t('chests_hint') : I18n.t('empty_chests_sub'))}</p>
    </div>`;
    renderChestSlots(inventory, selected, unlock); syncChestButtons(); startChestTicker();
  }
  function openSelectedChest(chest, paidInstant) {
    if (!chest) { Sound.miss(); Toasts.show(I18n.t('chests_none'), 'warn', 2400, 'chest'); return; }
    if (chest.choice) {
      let info = Meta.chestChoiceInfo(chest.uid);
      if (!info) { Sound.miss(); buildChests(); return; }
      if (paidInstant && info.state !== 'ready') {
        const choiceCost = Meta.chestInstantCost(chest.uid);
        if (choiceCost > 0 && !Meta.spendGems(choiceCost)) { Sound.miss(); Toasts.show(I18n.t('no_gems'), 'warn', 2800, 'gem'); syncChestButtons(); return; }
        info = Meta.makeChestChoiceReady(chest.uid);
      }
      if (!info || info.state !== 'ready') { Sound.miss(); buildChests(); return; }
      syncHomeChests(); Econ.refresh(); openDailyChoicePicker(chest.uid); return;
    }
    const cost = paidInstant ? Meta.chestInstantCost(chest.uid) : 0;
    if (cost > 0 && !Meta.spendGems(cost)) { Sound.miss(); Toasts.show(I18n.t('no_gems'), 'warn', 2800, 'gem'); syncChestButtons(); return; }
    const r = Meta.openChest(chest.uid);
    if (!r) { Sound.miss(); buildChests(); return; }
    syncHomeChests(); Sound.success();
    revealChestReward(r, false, chest.type);
  }
  function doChestTimerAction() {
    const chest = currentSelectedChest();
    if (!chest) { Sound.miss(); Toasts.show(I18n.t('chests_none'), 'warn', 2400, 'chest'); return; }
    const state = Meta.chestTimerState(chest.uid);
    if (state === 'ready') { openSelectedChest(chest, false); return; }
    if (state === 'running') return;
    if (Meta.chestUnlock()) { Sound.miss(); Toasts.show(I18n.t('chest_only_one'), 'warn', 2400, 'clock'); return; }
    Meta.startChestUnlock(chest.uid); Sound.success(); Toasts.show(I18n.t('chest_timer_started'), 'good', 1800, 'clock'); buildChests();
  }
  function doChestInstantAction() { openSelectedChest(currentSelectedChest(), true); }
  function doOpenPremiumChest() {
    const r = Meta.openPremiumChest();
    if (!r) { Sound.miss(); Toasts.show(I18n.t('no_gems'), 'warn', 2800, 'gem'); buildChests(); return; }
    Sound.success();
    revealChestReward(r, true, 'magic');
  }
  function openChests() { buildChests(); HubViews.open('chests', { nav: 'nav-events' }); }
  // Compatibilidad con llamadas históricas: abre el primer cofre sin pasar por
  // la UI de ranuras. La interfaz nueva usa doChestTimerAction/InstantAction.
  function doOpenChest() {
    const r = Meta.openChest();
    if (!r) { Sound.miss(); Toasts.show(I18n.t('chests_none'), 'warn', 2800, 'chest'); buildChests(); return; }
    syncHomeChests(); Sound.success();
    revealChestReward(r, false, r.baseChestType || r.chestType);
  }

  // Mapa de capítulos de Aventura (nodos hasta el capítulo alcanzado + el siguiente)
  function buildAdventureMap() {
    const wrap = $('#adventure-map'); if (!wrap) return;
    const max = Meta.advMax(), curCh = Adventure.chapterOf(max);
    let html = '';
    for (let ch = 0; ch <= curCh + 1; ch++) {
      const bi = Adventure.BIOMES[ch % Adventure.BIOMES.length];
      const cls = ch < curCh ? 'done' : (ch === curCh ? 'cur' : 'next');
      if (ch > 0) html += '<span class="adv-link"></span>';
      html += `<div class="adv-node ${cls}"><span class="adv-glyph">${BIOME_IMG[bi.id] ? iconAnyInline(BIOME_IMG[bi.id]) : bi.glyph}</span><span class="adv-name">Cap. ${ch + 1}<small>${bi.name}</small></span></div>`;
    }
    wrap.innerHTML = html;
    const btn = $('#adventure-continue');
    if (btn) btn.textContent = max > 1 ? `Continuar · Nivel ${max}` : 'Empezar la aventura';
  }
  function claimDailyReward() {
    const banner = $('#btn-reward');
    const claim = banner && banner.querySelector('.db-claim');
    // La persistencia también protege la economía, pero el bloqueo inmediato evita
    // dobles clics y dos coreografías compitiendo por el mismo banner.
    if (!Meta.rewardReady() || (banner && banner.classList.contains('is-popping')) || (claim && claim.disabled)) return;

    clearDailyRewardPopWatch();
    if (claim) claim.disabled = true;
    if (banner) {
      banner.classList.remove('claimed', 'is-claimed');
      banner.removeAttribute('aria-hidden');
      banner.setAttribute('aria-busy', 'true');

      const onPopEnd = (event) => {
        // Los pseudo-elementos también emiten animationend sobre el banner. Solo
        // la animación principal puede cerrar la transición; el timeout es el seguro
        // para CSS ausente, animación cancelada o navegadores con eventos incompletos.
        if (event.target === banner && event.animationName === 'dailyRewardBubblePop') finishDailyRewardPop(banner);
      };
      dailyRewardPopBanner = banner;
      dailyRewardPopEnd = onPopEnd;
      banner.addEventListener('animationend', onPopEnd);
      banner.classList.add('is-popping');
    }

    const amt = Meta.claimReward();
    if (!amt) {
      clearDailyRewardPopWatch();
      if (banner) {
        banner.classList.remove('is-popping');
        banner.removeAttribute('aria-busy');
      }
      refreshStart();
      return;
    }
    Sound.success(); FX.confetti(28);
    Toasts.show(`🎁 +${amt} monedas · día ${Meta.rewardDay()}`, 'good', 2600);
    // refreshStart actualiza economía/etiquetas, pero respeta is-popping y no
    // adelanta el estado invisible antes de que concluya la animación.
    refreshStart();
    if (!banner) return;
    if (motionOff()) finishDailyRewardPop(banner);
    else dailyRewardPopTimer = setTimeout(() => finishDailyRewardPop(banner), 900);
  }

  /* ===================== Preloader / pantalla de carga =====================
   * Precarga REAL de los assets de la PRIMERA pantalla (fuente de producto +
   * imágenes del shell de Inicio/Login) y refleja el progreso en la barra del
   * boot loader. Revela la app solo cuando esos assets están cargados y son
   * MOSTRABLES (decode()), así Inicio no aparece "a medio pintar". El resto de
   * imágenes del DOM se calientan después en segundo plano (no bloquean la
   * entrada); los packs grandes ya los precachea el Service Worker. */
  // setTimeout que NUNCA mantiene vivo el event loop de Node (los tests cargan
  // game.js en Node sobre el dom-stub): en navegador no existe unref y se ignora.
  function bootTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    if (t && typeof t.unref === 'function') t.unref();
    return t;
  }
  function bootLoaderHide(boot) {
    boot = boot || $('#boot-loader');
    if (!boot || boot.hidden) return;
    boot.classList.add('boot-done');
    const drop = () => { boot.hidden = true; };
    boot.addEventListener('transitionend', drop, { once: true });
    bootTimeout(drop, 700); // respaldo si no llega transitionend (reduced-motion, etc.)
  }

  // Calentado en segundo plano tras revelar la app: descarga + decode del 100%
  // de los iconos y del arte de menús/modales, para que NO parpadeen la primera
  // vez que el usuario abre una pantalla o un modal (esas vistas se construyen
  // bajo demanda, así que sus assets no están aún en el DOM). No bloquea nada.
  function warmSecondaryAssets() {
    if (typeof Image === 'undefined') return; // entorno de tests (Node)
    const seen = new Set();
    const queue = [];
    const add = (u) => { if (u && !seen.has(u)) { seen.add(u); queue.push(u); } };
    // 1) Prioridad: universo completo de iconos (PNG de UI + máscaras v2) y arte
    //    de menús, tomado de las estructuras de datos (independiente del DOM).
    try { Preload.allUrls().forEach(add); } catch (_) { /* seguimos con el DOM */ }
    // 2) Además, lo que YA esté en el DOM: <img src> y máscaras --icv2-url (que
    //    el barrido anterior no cubría y por eso parpadeaban).
    try {
      document.querySelectorAll('img[src]').forEach((im) => add(im.getAttribute('src')));
      document.querySelectorAll('[style*="--icv2-url"]').forEach((el) => {
        const m = (el.style.getPropertyValue('--icv2-url') || '').match(/url\((['"]?)(.*?)\1\)/);
        if (m && m[2]) add(m[2]);
      });
    } catch (_) { /* DOM inesperado: seguimos con lo reunido */ }
    let i = 0;
    const pump = () => {
      if (i >= queue.length) return;
      const url = queue[i++];
      const img = new Image();
      let done = false;
      const next = () => { if (done) return; done = true; img.onload = img.onerror = null; pump(); };
      img.onload = next; img.onerror = next;
      img.src = url;
      // decode() deja el bitmap listo para pintar sin "pop" al abrir la vista.
      if (img.decode) img.decode().then(next).catch(next);
    };
    for (let k = 0; k < 6; k++) pump(); // concurrencia acotada
  }

  function runBootPreloader() {
    const boot = $('#boot-loader');
    if (!boot) return; // sin loader (p. ej. entorno de tests): nada que hacer
    const fill = $('#boot-fill'), pctEl = $('#boot-percent'), bar = $('#boot-progress');

    // 1) Manifiesto crítico: imágenes del shell visible de Login + Inicio.
    //    Se excluye #hub-views del barrido genérico (las vistas ocultas se
    //    añaden abajo de forma explícita, no de golpe).
    const urls = new Set();
    const push = (u) => { if (u) urls.add(u); };
    const collect = (root) => {
      if (!root) return;
      root.querySelectorAll('img[src]').forEach((im) => push(im.currentSrc || im.src));
      root.querySelectorAll('[style*="--icv2-url"]').forEach((el) => {
        const m = (el.style.getPropertyValue('--icv2-url') || '').match(/url\((['"]?)(.*?)\1\)/);
        if (m && m[2]) push(m[2]);
      });
    };
    collect($('#screen-login'));
    const start = $('#screen-start');
    if (start) Array.from(start.children).forEach((c) => { if (c.id !== 'hub-views') collect(c); });

    // 2) Universo COMPLETO de iconos (PNG de UI + máscaras v2) + arte de menús y
    //    modales (perfil, cofres, tiendas, tableros, lanzamiento de modo). Todo
    //    esto se construye al abrir la vista —no está aún en el DOM—, así que se
    //    toma de las estructuras de datos (Preload) para no divergir de la
    //    fuente. Precargar el 100% aquí es lo que elimina el "parpadeo" la
    //    primera vez que se abre cada pantalla/modal. Los iconos son diminutos;
    //    el arte pesado ya se precargaba aquí. Envuelto en try: nunca debe
    //    romper el arranque.
    try {
      Preload.iconUrls().forEach(push);
      Preload.menuArtUrls().forEach(push);
    } catch (_) { /* estructura inesperada: seguimos con lo ya reunido */ }
    // Imágenes estáticas de las propias vistas de tienda/cofres (cabeceras,
    // fichas de recompensa…). Siguen en el DOM aunque estén ocultas.
    ['view-resource-shop', 'view-shop', 'view-chests'].forEach((id) => collect(document.getElementById(id)));

    const assets = Array.from(urls).filter(Boolean);

    // La fuente variable cuenta como una unidad más de progreso.
    const fontJob = (document.fonts && document.fonts.load)
      ? document.fonts.load('600 1em "Nunito Sans Game"').catch(() => { })
      : Promise.resolve();

    const total = assets.length + 1;
    let done = 0;
    let armStall = () => { };
    const bump = () => {
      done++;
      const p = Math.min(100, Math.round((done / total) * 100));
      if (fill) fill.style.width = p + '%';
      if (pctEl) pctEl.textContent = String(p);
      if (bar) bar.setAttribute('aria-valuenow', String(p));
      armStall(); // hay progreso: reinicia el tope por inactividad
    };
    const loadImg = (url) => new Promise((res) => {
      const img = new Image();
      const finish = () => { img.onload = img.onerror = null; res(); };
      img.onload = finish; img.onerror = finish;
      img.src = url;
      // decode() garantiza que el bitmap está listo para pintar sin "pop" al revelar.
      if (img.decode) img.decode().then(finish).catch(() => { });
    });

    const jobs = assets.map((u) => loadImg(u).then(bump));
    jobs.push(fontJob.then(bump));

    let revealed = false;
    const reveal = () => {
      if (revealed) return; revealed = true;
      if (fill) fill.style.width = '100%';
      if (pctEl) pctEl.textContent = '100';
      if (bar) bar.setAttribute('aria-valuenow', '100');
      bootLoaderHide(boot);
      warmSecondaryAssets();
    };

    // Topes de seguridad para un manifiesto grande (tiendas/cofres/iconos):
    //  - Por INACTIVIDAD: si no llega ningún asset en 8 s, se asume estancado y
    //    se revela. En conexiones lentas, mientras haya progreso, sigue esperando.
    //  - DURO: máximo absoluto por si el navegador nunca resuelve nada.
    let stallTimer = 0;
    armStall = () => { clearTimeout(stallTimer); stallTimer = bootTimeout(reveal, 8000); };
    armStall();
    bootTimeout(reveal, 30000);
    // Tiempo mínimo visible: evita un parpadeo brusco cuando el caché está caliente.
    const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    Promise.all(jobs).then(() => {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      bootTimeout(() => { clearTimeout(stallTimer); reveal(); }, Math.max(0, 450 - (now - startedAt)));
    });
  }

  /* ===================== init / wiring ===================== */
  function init() {
    // Puerta de compatibilidad: la app usa color-mix() sin fallback (ver DESIGN_SYSTEM §9).
    // En navegadores sin soporte (Safari <16.2) los acentos se romperían: mejor avisar y
    // no arrancar que mostrar una UI a medias.
    if (!(window.CSS && window.CSS.supports && window.CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'))) {
      bootLoaderHide(); // sin esto, el loader taparía el aviso de navegador antiguo
      showBrowserWarn();
      return;
    }
    // Fixture explícita de QA visual. Solo se activa en localhost con
    // ?dev&qaChests=1, usa las APIs públicas y restaura el perfil al abandonar
    // la página para no contaminar la sesión de desarrollo.
    const qaParams = new URLSearchParams(location.search);
    const qaHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]';
    if (qaHost && qaParams.has('dev') && qaParams.get('qaChests') === '1') {
      const qaMetaSnapshot = localStorage.getItem('cv_meta');
      window.addEventListener('pagehide', () => {
        try {
          if (qaMetaSnapshot === null) localStorage.removeItem('cv_meta');
          else localStorage.setItem('cv_meta', qaMetaSnapshot);
        } catch (_) { }
      }, { once: true });
      // Fixture de volumen: fuerza reserva larga y permite encadenar aperturas
      // instantáneas sin usar atajos fuera de las APIs públicas.
      const qaTypes = ['wood', 'bronze', 'silver', 'gold', 'magic', 'royal', 'supreme', 'champion', 'divine', 'event'];
      let qaCount = Meta.chestInventory().length, qaIndex = 0;
      while (qaCount < 24 && qaIndex < 40) {
        Meta.addChest(1, qaTypes[qaIndex % qaTypes.length], 'qa-volume');
        qaCount++; qaIndex++;
      }
      if (Meta.gems() < 100000) Meta.addGems(100000 - Meta.gems());
    }
    // Inmersión: bloquear zoom por gestos (iOS Safari ignora user-scalable=no a veces).
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
    // Altura real del viewport visible (--app-h): unifica el alto del contenedor en
    // TODOS los navegadores/dispositivos. El clásico `100vh` en móvil vale el viewport
    // GRANDE (barra de direcciones oculta), por lo que la parte inferior (booster-bar)
    // quedaba recortada bajo la barra en unos navegadores y bien en otros. Aquí medimos
    // el alto realmente visible (`visualViewport`) y lo publicamos como var CSS. OJO: el
    // TABLERO no usa esta var (usa `svh` estable), así que el contenedor se ajusta al
    // cromo del navegador pero el tablero NO se redimensiona (queda fijo, como pide el diseño).
    const setAppH = () => {
      const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      if (h) document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
    };
    setAppH();
    window.addEventListener('resize', setAppH, { passive: true });
    window.addEventListener('orientationchange', setAppH, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setAppH, { passive: true });
    Render.buildBoard();
    FX.init();
    applyReducedFx();
    Perf.init();
    applyLargeText();
    HubViews.init();
    Ranks.initEvents();
    // CH-1: la cuenta atrás del chip de cofres en Inicio se refresca sola; 30 s
    // basta (el detalle por segundo vive en la vista de cofres con su ticker).
    setInterval(() => {
      if (HubViews.current === 'events') refreshEvents(); else syncHomeChests();
      refreshXpBoostIndicators();
    }, 30000);
    mountTopBars();
    fillArt();
    I18n.apply();
    Cosmetics.apply();
    Boards.apply();
    // A: calienta en segundo plano los PNG del pack de iconos equipado para que
    // el tablero tenga su arte listo antes de la primera partida (no bloquea).
    IconPacks.preload(Meta.equippedIconPack());
    Input.init();
    buildHomeModeCarousel();
    PWA.init();
    RunSave.startCheckpointing();
    maybeNoticeSystemReducedFx();
    const vEl = $('#app-version'); if (vEl) vEl.textContent = VERSION;

    // Audio iOS: red de seguridad. Desbloquea/reanuda el contexto con el primer
    // gesto en cualquier parte y al volver a primer plano (iOS suspende el audio).
    const unlockAudio = () => { Sound.ensure(); };
    ['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, { passive: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (HubViews.current === 'events') refreshEvents(); else syncHomeChests();
      Econ.refresh();
      // Al volver a primer plano: reanudar el audio SOLO si el usuario lo quiere (sonido o música
      // activados); si están en off, mantener el contexto suspendido para no retomar la sesión.
      if (Sound.ctx) {
        if (Sound.wanted() && Sound.ctx.state !== 'running') { const r = Sound.ctx.resume(); if (r && r.catch) r.catch(() => { }); }
        else if (!Sound.wanted() && Sound.ctx.state === 'running') Sound.suspend();
      }
    });

    // Bienvenida sin fricción: nombre opcional + color de avatar + invitado.
    const AV_COLORS = ['#00d0ff', '#ff5b6e', '#3ad07f', '#ffd23f', '#a06bff', '#ff9838'];
    (function buildAvatars() {
      const wrap = $('#avatar-pick'); if (!wrap) return;
      const cur = (Storage.profile && Storage.profile.color) || AV_COLORS[0];
      wrap.innerHTML = AV_COLORS.map((c, i) =>
        `<button type="button" class="avatar-dot${c === cur ? ' sel' : ''}" role="radio" aria-checked="${c === cur}" data-color="${c}" style="--av:${c}" aria-label="Color ${i + 1}"></button>`).join('');
      wrap.querySelectorAll('.avatar-dot').forEach(d => d.addEventListener('click', () => {
        wrap.querySelectorAll('.avatar-dot').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-checked', 'false'); });
        d.classList.add('sel'); d.setAttribute('aria-checked', 'true');
      }));
    })();
    function enterApp(name) {
      const wrap = $('#avatar-pick'); const sel = wrap && wrap.querySelector('.avatar-dot.sel');
      const color = sel ? sel.dataset.color : AV_COLORS[0];
      Storage.profile = { name: name || 'Jugador', color };
      Storage.user = name || 'Jugador';
      Sound.ensure();
      if (!Storage.tutorialDone) { refreshStart(); Coach.start(); }
      else showHome();
    }
    if (Storage.user) showHome();
    else { Screens.show('login'); refreshStart(); }
    { const ni = $('#player-name'), pr = Storage.profile; if (ni && pr && pr.name && pr.name !== 'Invitado') ni.value = pr.name; }
    { const lf = $('#login-form'); if (lf) lf.addEventListener('submit', (e) => { e.preventDefault(); const ni = $('#player-name'); enterApp(ni ? ni.value.trim() : ''); }); }
    { const g = $('#btn-guest'); if (g) g.addEventListener('click', () => enterApp('Invitado')); }
    { const bt = $('#btn-tutorial'); if (bt) bt.addEventListener('click', () => { HubViews.home({ focus: false }); Coach.start(); }); }
    { const cs = $('#coach-skip'); if (cs) cs.addEventListener('click', () => Coach.skip()); }
    { const cp = $('#coach-play'); if (cp) cp.addEventListener('click', () => { Sound.ensure(); Coach.play1(); }); }
    // "Novedades" al actualizar de versión (no en el primer arranque).
    if (Storage.user && Storage.lastVersion && Storage.lastVersion !== VERSION) {
      setTimeout(() => Toasts.show('✨ Actualizado a v' + VERSION, 'info', 3000), 900);
    }
    Storage.lastVersion = VERSION;

    // Acciones del sistema base (top bar reutilizable + atajos): delegación por data-act.
    document.addEventListener('click', (e) => {
      const detail = e.target.closest('[data-mode-detail]');
      if (detail) { ModeLaunch.openDetail(detail.dataset.modeDetail, detail); return; }
      const survBooster = e.target.closest('[data-surv-booster]');
      if (survBooster) { ModeLaunch.toggleSurvivalBooster(survBooster.dataset.survBooster); return; }
      if (e.target.closest('[data-ml-how-toggle]')) { ModeLaunch.toggleHow(); return; }
      const option = e.target.closest('[data-mode-option]');
      if (option) { ModeLaunch.select(option.dataset.modeOption); return; }
      const el = e.target.closest('[data-act]'); if (!el) return;
      const a = el.dataset.act;
      if (a === 'settings') { Sound.ensure(); openSettings(); }
      else if (a === 'profile') { Sound.ensure(); openMedals(); }
      else if (a === 'edit-name') { e.preventDefault(); e.stopPropagation(); Sound.ui(); renameProfile(); }
      else if (a === 'buy-coins') { Sound.ensure(); openResourceShop('coins'); }
      else if (a === 'buy-gems') { Sound.ensure(); openResourceShop('gems'); }
      else if (a === 'buy-energy') { Sound.ensure(); openResourceShop('xp'); }
      else if (a === 'bell') { Sound.ui(); Toasts.show(I18n.t('coming_soon'), 'info', 1400); }
      else if (a === 'legacy-import-confirm') { Sound.ui(); confirmLegacyImport(); }
      else if (a === 'legacy-import-cancel') {
        // Solo cierra: la reclamación sigue pendiente y caduca por expiresAt.
        Sound.ui(); Modal.close(); Toasts.show(I18n.t('legacy_import_kept_local'), 'info', 2000);
      }
      else if (a === 'review-sync') {
        Sound.ui();
        if (lastSyncState && lastSyncState.preview) showLegacyImportModal(lastSyncState.preview);
      }
      else if (a === 'home-play-now') {
        Sound.ensure();
        if (el.dataset.route === 'daily') openDailyInfo();
        else if (el.dataset.mode === 'home') showHome(undefined, true);
        else ModeLaunch.open(el.dataset.mode || 'clasico');
      }
      else if (a === 'home-daily') { Sound.ensure(); openDailyInfo(); }
      else if (a === 'daily-practice') { Sound.ensure(); Modal.close(); ModeLaunch.open(el.dataset.mode || 'clasico'); }
      else if (a === 'open-guide') { Sound.ui(); HubViews.open('how', { nav: 'open-guide' }); }
      else if (a === 'go-surv') { Sound.ensure(); Modal.close(); openSurvivalDiff(); }
      else if (a === 'go-play') { Sound.ensure(); Modal.close(); showHome(State.mode, true); }
      else if (a === 'go-daily') { Sound.ensure(); Modal.close(); openDailyInfo(); }
      else if (a === 'go-classic') { Sound.ensure(); Modal.close(); ModeLaunch.open('clasico'); }
      else if (a === 'go-adventure') { Sound.ensure(); Modal.close(); ModeLaunch.open('aventura'); }
      else if (a === 'open-chests') { Sound.ensure(); Modal.close(); openChests(); }
      else if (a === 'open-chest-shop') { Sound.ensure(); Modal.close(); openResourceShop('chests'); }
      else if (a === 'chest-play') { Sound.ensure(); Modal.close(); HubViews.home({ clearHistory: true }); refreshStart(); }
      else if (a === 'open-daily-choice') { Sound.ensure(); Modal.close(); openDailyChoiceFromEvents(); }
      else if (a === 'open-shop') { Sound.ensure(); Modal.close(); openShop(); }
      else if (a === 'open-resource-shop') { Sound.ensure(); Modal.close(); openResourceShop(); }
      else if (a === 'open-style-shop') { Sound.ensure(); Modal.close(); openShop(); }
      else if (a === 'open-missions') { Sound.ui(); refreshStart(); buildMissions(); Modal.close(); HubViews.open('missions', { nav: 'nav-events' }); }
      else if (a === 'reroll-mission') {
        const next = Meta.rerollDaily();
        if (!next) { Sound.miss(); Toasts.show(I18n.t('mission_reroll_missing'), 'warn', 1700); return; }
        Sound.success(); Toasts.show(I18n.t('mission_rerolled'), 'good', 1500, 'ticket');
        refreshStart();
        const missions = $('#start-missions');
        if (missions && missions.focus) requestAnimationFrame(() => missions.focus({ preventScroll: true }));
      }
      else if (a === 'mission-play') {
        const mode = el.dataset.mode;
        Sound.ensure();
        if (mode === 'home') { HubViews.home({ clearHistory: true }); refreshStart(); }
        else if (MODE_LAUNCH_META[mode]) ModeLaunch.open(mode);
      }
      else if (a === 'claim-daily') claimDailyReward();
      else if (a === 'nav-achievements') { Sound.ensure(); openMedals('achievements'); }
      else if (a === 'nav-events') { Sound.ensure(); openEvents(); }
      else if (a === 'nav-shop') { Sound.ensure(); openResourceShop(); }
      else if (a === 'nav-missions') { Sound.ui(); buildMissions(); HubViews.open('missions', { nav: 'nav-events' }); }
      else if (a === 'nav-collections') { Sound.ensure(); openCollections(); }
      else if (a === 'nav-ranks') { Sound.ensure(); Ranks.open(); }
      else if (a === 'nav-home') { Sound.ui(); HubViews.home({ clearHistory: true }); refreshStart(); }
    });

    // Inicio (el grueso del cableado vive en el handler delegado data-act de arriba).
    const on = (id, ev, fn, opts) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn, opts); };
    { const rr = $('#btn-resume-run'); if (rr) rr.addEventListener('click', () => { Sound.ensure(); if (!Game.resumeSaved()) { rr.hidden = true; Sound.miss(); } }); }
    { const bi = $('#btn-install'); if (bi) bi.addEventListener('click', () => PWA.promptInstall()); }
    // Al cerrar la tienda, revertir cualquier previsualización al tema equipado.
    { const sc = $('#shop-close'); if (sc) sc.addEventListener('click', () => Cosmetics.apply()); }

    // Lanzadores de modos que necesitan una configuración intermedia.
    { const ac = $('#adventure-continue'); if (ac) ac.addEventListener('click', () => { HubViews.home({ focus: false }); Game.start('aventura', 'normal'); }); }
    { const ml = $('#btn-mode-launch-start'); if (ml) ml.addEventListener('click', () => ModeLaunch.start()); }
    { const detailClose = $('#btn-mode-launch-detail-close'); if (detailClose) detailClose.addEventListener('click', () => ModeLaunch.closeDetail()); }

    // Modo Clásico (mapa de mundos)
    { const wb = $('#worlds-back'); if (wb) wb.addEventListener('click', () => showHome('clasico', true)); }
    { const ws = $('#worlds-settings'); if (ws) ws.addEventListener('click', () => { Sound.ui(); openSettings(); }); }
    { const wr = $('#world-rewards'); if (wr) wr.addEventListener('click', () => Worlds.claimReward()); }
    { const b = $('#wt-shop'); if (b) b.addEventListener('click', () => { Sound.ui(); openShop(); }); }
    { const b = $('#wt-missions'); if (b) b.addEventListener('click', () => { Sound.ui(); buildMissions(); HubViews.open('missions'); }); }
    { const b = $('#wt-play'); if (b) b.addEventListener('click', () => Sound.ui()); }
    { const b = $('#wt-chests'); if (b) b.addEventListener('click', () => { Sound.ui(); openChests(); }); }
    { const oc = $('#btn-open-chest'); if (oc) oc.addEventListener('click', doChestTimerAction); }
    { const op = $('#btn-open-premium'); if (op) op.addEventListener('click', doChestInstantAction); }
    { const all = $('#btn-chest-catalog'); if (all) all.addEventListener('click', () => { Sound.ui(); toggleChestCatalog(true); }); }
    { const close = $('#btn-chest-catalog-close'); if (close) close.addEventListener('click', () => { Sound.ui(); toggleChestCatalog(false); }); }
    document.querySelectorAll('[data-premium-open]').forEach((button) => button.addEventListener('click', doOpenPremiumChest));
    { const b = $('#wt-rank'); if (b) b.addEventListener('click', () => { Sound.ui(); openMedals(); }); }
    { const lm = $('#btn-level-map'); if (lm) lm.addEventListener('click', () => Game.toWorldsMap()); }
    { const mn = $('#btn-multi-notify'); if (mn) mn.addEventListener('click', () => { Sound.success(); Toasts.show(I18n.t('notify_ok'), 'good', 1800); HubViews.home(); }); }

    // Juego
    on('btn-hint', 'click', () => Game.hint());
    on('btn-hint-tool', 'click', () => Game.hint());
    on('btn-pause', 'click', () => Game.pause());
    // HUD-S4: tocar el marcador desglosa el multiplicador (combo/fiebre/frenesí/…).
    { const gs = document.querySelector('.gscore'); if (gs) gs.addEventListener('click', () => Render.toggleMultBreakdown()); }
    { const br = $('#btn-restart'); if (br) br.addEventListener('click', () => Game.restart()); }
    { // Salir en plena partida: doble toque para evitar abandonos accidentales.
      let quitArm = 0;
      const bq = $('#btn-quit');
      if (bq) bq.addEventListener('click', () => {
        if (State.status !== 'playing' && State.status !== 'paused') return Game.quit();
        const now = performance.now();
        if (now - quitArm < 2500) { quitArm = 0; Game.quit(); }
        else { quitArm = now; Toasts.show(I18n.t('quit_confirm'), 'warn', 2200); Sound.ui(); }
      });
    }

    // Modales
    on('btn-resume', 'click', () => Game.resume());
    on('btn-pause-settings', 'click', () => openSettingsFromPause());
    on('btn-pause-restart', 'click', () => Game.restart());
    on('btn-pause-quit', 'click', () => Game.quit());
    on('btn-next-level', 'click', () => Game.nextLevel());
    on('btn-retry', 'click', () => Game.restart());
    { const bsh = $('#btn-share'); if (bsh) bsh.addEventListener('click', () => Share.go()); }
    on('btn-over-quit', 'click', () => Game.quit());
    { const rv = $('#btn-revive'); if (rv) rv.addEventListener('click', () => Survival.revive()); }
    { const gu = $('#btn-giveup'); if (gu) gu.addEventListener('click', () => Survival.giveUp()); }
    { const ds = $('#btn-daily-start'); if (ds) ds.addEventListener('click', () => { Sound.ensure(); HubViews.home({ focus: false }); Game.startDaily(); }); }
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => Modal.close()));
    document.querySelectorAll('[data-view-back]').forEach(b => b.addEventListener('click', () => HubViews.back()));

    // Escape y back nativo comparten una sola jerarquía. En la raíz Android
    // exige una segunda pulsación para salir; nunca se cierra durante una run.
    let nativeBackArm = 0;
    function handleBackNavigation(nativeEvent) {
      if (Picker.pending) { Picker.cancel(); return true; }
      if (Modal._id === 'modal-mode-launch' && !$('#mode-launch-detail').hidden) { ModeLaunch.closeDetail(); return true; }
      if (Modal._id === 'modal-mode-launch' || Modal._id === 'modal-icon-pack') { Modal.close(); return true; }
      if (Modal._id && State.status === 'paused') { Game.resume(); return true; }
      if (Modal._id) { Modal.close(); return true; }
      if (document.body.dataset.screen === 'start' && HubViews.current === 'chests'
        && $('#view-chests') && $('#view-chests').classList.contains('is-catalog-open')) {
        toggleChestCatalog(false); return true;
      }
      if (document.body.dataset.screen === 'start' && HubViews.current !== 'home') { HubViews.back(); return true; }
      if (document.body.dataset.screen === 'worlds') { HubViews.back(); return true; }
      if (State.status === 'playing') { Game.pause(); return true; }
      if (State.status === 'paused') { Game.resume(); return true; }
      if (nativeEvent && Platform.isNative) {
        const now = Date.now();
        if (now - nativeBackArm < 2500) { nativeBackArm = 0; Platform.exitApp(); }
        else { nativeBackArm = now; Toasts.show(I18n.t('quit_confirm'), 'warn', 2200); }
        return true;
      }
      return false;
    }

    // Teclas globales
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (Picker.pending) { e.preventDefault(); Picker.cancel(); }
        else if (Modal._id === 'modal-mode-launch' && !$('#mode-launch-detail').hidden) ModeLaunch.closeDetail();
        else if (Modal._id === 'modal-mode-launch') Modal.close();
        else if (Modal._id === 'modal-icon-pack') Modal.close();
        else if (document.body.dataset.screen === 'start' && HubViews.current === 'chests'
          && $('#view-chests') && $('#view-chests').classList.contains('is-catalog-open')) toggleChestCatalog(false);
        else if (document.body.dataset.screen === 'start' && HubViews.current !== 'home') HubViews.back();
        else if (State.status === 'playing') Game.pause();
        else if (State.status === 'paused') Game.resume();
      } else if (Picker.pending) return;
      else if (e.key.toLowerCase() === 'p' && (State.status === 'playing' || State.status === 'paused')) {
        State.status === 'playing' ? Game.pause() : Game.resume();
      } else if (e.key.toLowerCase() === 'h' && State.status === 'playing') {
        Game.hint();
      }
    });

    window.addEventListener('convergence:back', () => handleBackNavigation(true));

    /* ===================== Importación de progreso legacy =====================
     * Carril paralelo: el coordinador TS (dist-profile-emulator) publica
     * ProfileSyncPublicState por evento y game.js solo pinta y confirma. El
     * detail.preview es un resumen presentacional -sin economía- porque la
     * autoridad sobre monedas y cofres es siempre del backend.
     */
    let lastSyncState = null;

    function syncStatusKey(status) {
      if (status === 'awaiting-confirmation') return 'sync_status_awaiting';
      return 'sync_status_' + String(status).replace(/-/g, '_');
    }

    function showLegacyImportModal(preview) {
      if (!preview || !$('#modal-legacy-import')) return;
      const num = (value, fallback) => (typeof value === 'number' && isFinite(value) ? value : fallback);
      const lvlEl = $('#import-stat-level'); if (lvlEl) lvlEl.textContent = num(preview.level, 1);
      const xpEl = $('#import-stat-xp'); if (xpEl) xpEl.textContent = num(preview.xp, 0);
      const advEl = $('#import-stat-adventure'); if (advEl) advEl.textContent = num(preview.adventureMaxLevel, 1);
      const trophyEl = $('#import-stat-trophies'); if (trophyEl) trophyEl.textContent = num(preview.achievements, 0);
      const banner = $('#legacy-import-warning-banner');
      if (banner) banner.hidden = preview.economyQuarantined === false;
      Modal.open('modal-legacy-import');
    }

    function handleProfileSyncState(event) {
      const state = (event && event.detail) || event;
      if (!state || !state.status) return;
      lastSyncState = state;
      const syncBar = $('#profile-sync-bar');
      const syncBadge = $('#profile-sync-badge');
      const syncBtn = $('#btn-profile-sync-review');
      if (syncBar && syncBadge) {
        syncBar.hidden = false;
        syncBadge.setAttribute('data-status', state.status);
        syncBadge.textContent = I18n.t(syncStatusKey(state.status));
        if (syncBtn) syncBtn.hidden = !state.canConfirm;
      }
      if (state.canConfirm && state.preview) showLegacyImportModal(state.preview);
    }

    // Puente hacia el coordinador: si el carril no está montado (PWA normal),
    // la UI se cierra sin prometer una importación que nadie va a ejecutar.
    function confirmLegacyImport() {
      const migration = window.ConvergenceProfileMigration;
      Modal.close();
      if (!migration || typeof migration.confirm !== 'function') {
        Toasts.show(I18n.t('legacy_import_unavailable'), 'warn', 2200);
        return;
      }
      window.dispatchEvent(new CustomEvent('convergence:legacy-import-confirm'));
      Toasts.show(I18n.t('legacy_import_done'), 'good', 1800);
    }

    window.addEventListener('convergence:profile-emulator-state', handleProfileSyncState);
    window.addEventListener('convergence:profile-sync-state', handleProfileSyncState);


    // Lifecycle Capacitor explícito. Background pausa, guarda y libera audio;
    // foreground refresca metajuego pero no reanuda nunca la partida solo.
    window.addEventListener('convergence:app-state', (event) => {
      const active = !!(event && event.detail && event.detail.active);
      if (!active) {
        if (State.status === 'playing') Game.pause();
        RunSave.save();
        Sound.suspend();
        return;
      }
      if (HubViews.current === 'events') refreshEvents(); else syncHomeChests();
      Econ.refresh();
    });

    // Pausar al ocultar la pestaña + snapshot de la partida (reanudable al volver)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      if (State.status === 'playing') Game.pause();
      RunSave.save();
      // Al ir a segundo plano, soltar la sesión de audio del dispositivo (que la música/podcast
      // de otras apps se reanude): suspender el contexto en vez de dejarlo "running".
      Sound.suspend();
    });
    window.addEventListener('pagehide', () => RunSave.save());

    // Enlace de duelo (?challenge=SEED): arranca Contrarreloj con el MISMO tablero
    // que el retador (misma semilla → mismos spawns). Solo si ya hay perfil creado.
    {
      const ch = new URLSearchParams(location.search).get('challenge');
      if (ch && Storage.user) {
        Toasts.show(I18n.t('challenge_start'), 'info', 2200, '🎯');
        Game.start('contrarreloj', 'normal', undefined, ch);
      }
    }

    // La app ya está construida DETRÁS del loader (tablero, top bars, carrusel,
    // pantalla correcta mostrada). Precargamos los assets de la primera pantalla
    // y, cuando son mostrables, revelamos: sin sensación de "sigue cargando".
    runBootPreloader();
  }

  // Salvavidas de último recurso: pase lo que pase (p. ej. init lanza una
  // excepción antes de llegar al preloader), no dejar el loader tapando la app
  // para siempre. Se programa ANTES de llamar a init, así queda armado aunque
  // init falle de forma síncrona.
  try { bootTimeout(() => bootLoaderHide(), 20000); } catch (_) { }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Hook opcional para pruebas/QA (solo con ?dev en la URL). No afecta al juego normal.
  if (location.search.indexOf('dev') !== -1) window.__cv = { State, Engine, Game, Render, Config, Storage, FX, Meta, IconPacks, PlayerIcons, PlayerBorders, playerAvatarHtml, Storefront, XP_BOOST_MULTIPLIER, CHEST_TYPES, CHEST_TYPE_ORDER, CHEST_SKIP_GEMS_PER_HOUR, chestOdds, chestRollCount, ChestNotices, Econ, ShopFX, Settings, Music, Loop, Sound, Tiles, Boosters, Modifiers, Rules, Themes, Cosmetics, Boards, Worlds, Classic, Coach, BossCoach, Adventure, Survival, Bosses, Share, I18n, Toasts, Feedback, RNG, RunSave, Picker, PreLevel, DailyMut, Modal, HubViews, Perf, ModeSignals, ModeLaunch, HomeModeCarousel, buildHomeModeCarousel, buildMissions, showHome, refreshStart, applyLanguage, Haptics, Platform, RunLog, Ranks };
})();
