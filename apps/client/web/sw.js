/* Convergencia — Service Worker (offline-first, dos cachés).
 *
 * CACHE (shell, VERSIONADO): HTML/CSS/JS/manifest/fuente/iconos de app. Se
 *   invalida en cada release —lo sube `tools/bump-version.sh`—; `activate`
 *   borra los shells viejos.
 * ASSET_CACHE (imágenes, PERSISTENTE): todos los packs de imágenes. NO está
 *   atado a la versión de la app y NO se borra en cada release, así las
 *   imágenes ya descargadas sobreviven a las actualizaciones (antes se
 *   re-descargaba todo en cada bump). Súbelo a mano (v1 → v2 …) SOLO si cambias
 *   arte reutilizando la misma ruta de archivo. Ver docs/ASSET_CACHING_PLAN.md. */
const CACHE = 'cv-cache-v2.37.3';
const ASSET_CACHE = 'cv-assets-v1';
const ASSETS = [
  './', './index.html', './styles.css?v=2.37.3', './native-bridge.js?v=0.1.0', './game-core.js?v=2.37.3', './game.js?v=2.37.3', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable.png', './apple-touch-icon.png',
  './fonts/NunitoSans-Variable.ttf',
];
// Iconos de UI (pack en img/ui). Se precachean en best-effort: si alguno falla,
// no rompe la instalación (de todos modos el fetch los cachea en runtime).
const UI_ICONS = ['aura','bolt','bomb','book','calendar','cart','check','chest','clock','close','coin','crown','crystal','dice','fire','friend','gem','gift','heart','house','info','leaf','lock','luckyblock','magnet','medal','minus','music-off','music-on','pencil','pin','planet','planet-hell','player','players','plus','potion','question','rocket','search','settings','shield','skull','sound-off','sound-on','star','star-empty','stats','target','teleporter','ticket','trophy','upgrade','verify','warning'].map((n) => './img/ui/' + n + '.png');
// Subconjunto casual V2 usado por la home. Son derivados compactos para UI;
// preservan el arte y reducen el coste offline.
const HOME_V2_ICONS = ['bolt','calendar','cart','chest','clock','coin','fire','gem','gift','heart','house','medal','pencil','player','plus','robot','rocket','settings','shield','star','target','trophy','upgrade'].map((n) => './img/ui-v2/home/' + n + '.png');
const HOME_GENERATED_ART = [
  'avatar-robot','classic-board','daily-gift','header-coin-star','header-plus','hero-rocket','multiplayer-versus','tournament-trophy',
  'nav-achievements','nav-chest','nav-collections','nav-daily','nav-events','nav-friends','nav-guide','nav-home','nav-home-redesign','nav-league','nav-missions','nav-settings','nav-shop',
].map((n) => './img/ui-generated/home/' + n + '.png');
const GUIDE_GENERATED_ART = [
  'guide-mentor','rule-1-tap','rule-2-scan','rule-3-converge','rule-4-combo',
].map((n) => './img/ui-generated/guide/' + n + '.png');
const BOSS_COACH_ART = ['./img/ui-generated/boss-coach/boss-portrait.webp'];
const MODE_GENERATED_ART = [
  'mode-classic','mode-multiplayer','mode-survival','mode-timed','mode-zen',
].map((n) => './img/ui-generated/modes/' + n + '.png');
const MODE_LAUNCH_ART = [
  'bolt','calendar','clock','coin','difficulty-easy','difficulty-hard','difficulty-normal',
  'frenzy-ring','heart','info','leaf','lock','medal','mode-adventure','mode-classic',
  'mode-timed','mode-zen','planet','rocket','skull','star','survival-emblem','survival-rank',
  'target','trophy',
].map((n) => './img/ui-generated/mode-launch/' + n + '.png');
const SHOP_GENERATED_ART = [
  'gems-spark','gems-cache','gems-vault',
  'coins-pouch','coins-crate','coins-vault',
  'xp-6h','xp-3d','xp-7d',
].map((n) => './img/ui-generated/shop/' + n + '.png');
const BOARD_THEME_PREVIEWS = [
  'classic','jardin','madera','hielo','lava','cristal','magico','futurista','dorado','bosque','cosmico',
].map((n) => './img/board-themes/v2/' + n + '/preview.jpg');
const CHEST_ATLASES = [
  'wood','bronze','silver','gold','magic','royal','supreme','champion','divine','event',
].map((n) => './img/ui-generated/chests/atlas/' + n + '.png');
const PLAYER_ICON_ASSETS = [
  'nova','comet','prism','sentinel','nebula','orbit','flare','crystal','void','pulse',
].map((n) => './img/player-icons/' + n + '.png');
const PLAYER_BORDER_ASSETS = [
  'starlight','plasma','royal','aurora','comet','crystal','eclipse','circuit','bloom','mythic',
].map((n) => './img/player-borders/' + n + '.png');
const PRISMATIC_PACK_ASSETS = [
  'violet-diamond','amber-hex','aqua-drop','pink-heart','violet-spiral',
  'cyan-moon','golden-sun','emerald-clover','ruby-drop','golden-star','thumbnail',
].map((n) => './img/icon-packs/prismatic-jewels/' + n + '.png');
const NATURE_BASIC_PACK_ASSETS = [
  'green-leaf','water-drop','pink-flower','clover','acorn','sunflower',
  'red-mushroom','mossy-rock','thumbnail',
].map((n) => './img/icon-packs/nature-basic/' + n + '.png');
const NATURE_ADVANCED_PACK_ASSETS = [
  'hibiscus','bamboo','pine-cone','vine-spiral','emerald-crystal','tree-stump',
  'blueberries','flowering-cactus','maple-leaf','holly-leaf','thumbnail',
].map((n) => './img/icon-packs/nature-advanced/' + n + '.png');
const NEON_PACK_ASSETS = [
  'neon-square','neon-triangle','neon-star','neon-circle',
  'neon-diamond','neon-hexagon','neon-heart','neon-drop','thumbnail',
].map((n) => './img/icon-packs/neon/' + n + '.png');
const GEM_PATTERN_PACK_ASSETS = [
  'violet-diamond-1','violet-diamond-2','violet-diamond-3','violet-diamond-4','violet-diamond-5',
  'orange-gem-1','orange-gem-2','orange-gem-3','orange-gem-4','orange-gem-5',
  'blue-drop-1','blue-drop-2','blue-drop-3','blue-drop-4','blue-drop-5',
  'pink-heart-1','pink-heart-2','pink-heart-3','pink-heart-4','pink-heart-5','thumbnail',
].map((n) => './img/icon-packs/gem-pattern/' + n + '.png');
const BASIC_REDESIGNED_PACK_ASSETS = [
  'red-circle','blue-square','green-triangle','yellow-star','purple-heart',
  'cyan-diamond','orange-hexagon','pink-plus','lime-drop','white-ring',
  'teal-pentagon','purple-crescent','red-sunburst','blue-flower','green-clover',
  'yellow-circle','gold-square','silver-square-outline','cyan-triangle-outline','yellow-hexagon-outline','thumbnail',
].map((n) => './img/icon-packs/basic-redesigned/' + n + '.png');
const ELEMENTAL_PACK_ASSETS = [
  'fire','water','earth','wind','lightning','ice','storm','lava','light','darkness','shield','meteor','thumbnail',
].map((n) => './img/icon-packs/elemental/' + n + '.png');
const MARINE_PACK_ASSETS = [
  'starfish','pink-shell','yellow-fish','seahorse','red-coral','purple-octopus','blue-jellyfish','pearl','thumbnail',
].map((n) => './img/icon-packs/marine/' + n + '.png');
const MAGIC_PACK_ASSETS = [
  'magic-crystal','blue-potion','enchanted-book','star-wand','energy-orb','sacred-rune','mystic-incense','enchanted-amulet','thumbnail',
].map((n) => './img/icon-packs/magic/' + n + '.png');
const ICON_PACK_ASSETS = PRISMATIC_PACK_ASSETS.concat(
  NATURE_BASIC_PACK_ASSETS, NATURE_ADVANCED_PACK_ASSETS, NEON_PACK_ASSETS,
  GEM_PATTERN_PACK_ASSETS, BASIC_REDESIGNED_PACK_ASSETS, ELEMENTAL_PACK_ASSETS,
  MARINE_PACK_ASSETS, MAGIC_PACK_ASSETS,
);
const CORE_ART = ['./img/ui-generated/chests/chest-open.png'];
const V2_ICONS = [
  './img/icons-v2/1-game/double.svg',
  './img/icons-v2/2-items/map.svg',
  './img/icons-v2/3-gear/shield.svg',
  './img/icons-v2/4-nature/cactus.svg',
  './img/icons-v2/4-nature/drought.svg',
  './img/icons-v2/4-nature/meteor.svg',
  './img/icons-v2/4-nature/mountain.svg',
  './img/icons-v2/4-nature/snowflake.svg',
  './img/icons-v2/6-buildings/flag.svg',
  './img/icons-v2/6-buildings/town.svg',
  './img/icons-v2/8-ui/arrow-left.svg',
  './img/icons-v2/8-ui/arrow-left-02.svg',
  './img/icons-v2/8-ui/arrow-right-03.svg',
  './img/icons-v2/8-ui/circle-ring.svg',
  './img/icons-v2/8-ui/cross.svg',
  './img/icons-v2/8-ui/grid.svg',
  './img/icons-v2/8-ui/prohibited.svg',
  './img/icons-v2/8-ui/refresh.svg',
  './img/icons-v2/8-ui/rest.svg',
  './img/icons-v2/8-ui/user.svg',
  './img/icons-v2/8-ui/user-group.svg',
  './img/icons-v2/9-media/connection.svg',
  './img/icons-v2/9-media/download.svg',
  './img/icons-v2/9-media/link.svg',
  './img/icons-v2/9-media/mobile-phone.svg',
  './img/icons-v2/9-media/notification.svg',
  './img/icons-v2/9-media/pause.svg',
  './img/icons-v2/9-media/play.svg',
  './img/icons-v2/9-media/share.svg',
  './img/icons-v2/9-media/wi-fi.svg',
  './img/icons-v2/10-editing/brush.svg',
  './img/icons-v2/10-editing/font.svg',
  './img/icons-v2/12-misc/four-pointed-star.svg',
  './img/icons-v2/12-misc/radiation.svg',
];
// Todas las imágenes de packs viven en ASSET_CACHE. Se precachean POR ÍTEM
// (allSettled): un asset roto/404 ya no arrastra al lote entero ni se traga en
// silencio (antes `addAll(...).catch()` perdía las N imágenes del lote si una
// fallaba). El shell crítico (ASSETS) sí es estricto: si falla, la instalación
// falla, que es lo correcto.
const IMAGE_MANIFEST = [].concat(
  CORE_ART, UI_ICONS, HOME_V2_ICONS, HOME_GENERATED_ART, GUIDE_GENERATED_ART, BOSS_COACH_ART, MODE_GENERATED_ART,
  MODE_LAUNCH_ART, SHOP_GENERATED_ART, BOARD_THEME_PREVIEWS, CHEST_ATLASES,
  PLAYER_ICON_ASSETS, PLAYER_BORDER_ASSETS, ICON_PACK_ASSETS, V2_ICONS,
);
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(CACHE);
    await shell.addAll(ASSETS);
    const assets = await caches.open(ASSET_CACHE);
    await Promise.allSettled(IMAGE_MANIFEST.map((u) => assets.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Preserva el shell actual Y la caché de assets persistente: solo se
      // purgan shells de versiones anteriores. Las imágenes sobreviven al bump.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// CH-3: una notificación local solo se crea al volver a ejecutar la app; este
// handler hace que tocarla reutilice la ventana instalada/abierta cuando exista.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const current = windows.find((client) => 'focus' in client);
      return current ? current.focus() : self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navegación: red primero (para ver versiones nuevas), cae a caché sin conexión.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; })
        .catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
    );
    return;
  }

  // Imágenes: caché-primero contra ASSET_CACHE (persistente). Sirve al instante
  // desde caché —arregla el tablero roto y la carga inicial— y rellena de red en
  // el fallo. Offline: sirve lo cacheado. La frescura del arte se gestiona con el
  // bump manual de ASSET_CACHE (los PNG son inmutables por ruta en la práctica).
  if (/\.(png|jpe?g|webp|avif|gif|svg)$/i.test(url.pathname)) {
    e.respondWith(
      caches.open(ASSET_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => {
        if (r && r.ok) c.put(req, r.clone());
        return r;
      }).catch(() => hit)))
    );
    return;
  }

  // Resto de recursos (shell versionado): caché primero (offline instantáneo),
  // con relleno de red.
  e.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((r) => {
      const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r;
    }).catch(() => m))
  );
});
