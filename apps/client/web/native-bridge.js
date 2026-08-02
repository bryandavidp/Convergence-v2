/* Bridge mínimo entre el runtime legacy y Capacitor.
 *
 * En web solo identifica la plataforma y carga game.js. En Android/iOS hidrata
 * primero los dos documentos persistentes críticos para que el legacy pueda
 * continuar usando su API síncrona de localStorage durante la migración.
 */
(() => {
  'use strict';

  // Respaldos: la versión real la manda el <meta> de index.html, que es el sitio
  // que documenta el bump. Antes se leía solo esta constante, así que quedó en
  // 2.37.1 mientras el resto del proyecto ya iba por 2.37.2 y los usuarios
  // seguían cargando el game.js viejo desde caché.
  const LEGACY_SCRIPT = 'game.js?v=2.37.6';
  const CORE_SCRIPT = 'game-core.js?v=2.37.6';
  const PERSISTED_KEYS = ['cv_meta', 'cv_run'];
  const LEGACY_STORAGE_EVENT = 'convergence:legacy-storage-changed';
  const capacitor = window.Capacitor;
  const isNative = !!(capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform());
  const plugins = (capacitor && capacitor.Plugins) || {};
  const Preferences = plugins.Preferences;
  const App = plugins.App;
  const NativeHaptics = plugins.Haptics;
  const NativeShare = plugins.Share;
  const Network = plugins.Network;

  function report(kind, error) {
    try { console.warn(`[ConvergencePlatform:${kind}]`, error); } catch (_) { }
  }

  /* Háptica nativa.
   *
   * El plugin dispara formas de onda ya diseñadas —`impact` (LIGHT/MEDIUM/HEAVY)
   * y `notification` (SUCCESS/WARNING/ERROR)— con duración *y* amplitud. Eso es
   * lo que de verdad se siente en el motor de un móvil: `vibrate` a pelo con las
   * duraciones del patrón web (8, 12, 14 ms) queda por debajo del umbral de un
   * LRA moderno y no se nota. Antes el bridge mandaba siempre `impact LIGHT`, así
   * que los catorce patrones del juego se sentían iguales, y si el plugin no
   * estaba disponible `haptic()` salía en silencio sin avisar a game.js, que ya
   * había descartado `navigator.vibrate`: la partida se quedaba sin vibración de
   * ningún tipo. Ahora se devuelve si la llamada salió o no, para que el runtime
   * legacy pueda caer a la API del WebView.
   */
  const HAPTIC_IMPACT = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' };
  const HAPTIC_NOTIFY = { success: 'SUCCESS', warning: 'WARNING', error: 'ERROR' };
  const hapticsPlugin = isNative && NativeHaptics ? NativeHaptics : null;
  const canImpact = !!hapticsPlugin && typeof hapticsPlugin.impact === 'function';
  const canNotify = !!hapticsPlugin && typeof hapticsPlugin.notification === 'function';
  const canVibrate = !!hapticsPlugin && typeof hapticsPlugin.vibrate === 'function';
  // Un rechazo del puente (plugin sin sincronizar en el APK, dispositivo sin
  // motor de vibración) desarma la vía nativa para el resto de la sesión: a
  // partir de ahí `haptic()` devuelve false y el juego usa navigator.vibrate.
  let hapticsBroken = false;

  function nativeHaptic(kind, durationMs) {
    if (hapticsBroken) return null;
    if (canNotify && HAPTIC_NOTIFY[kind]) return hapticsPlugin.notification({ type: HAPTIC_NOTIFY[kind] });
    if (canImpact && HAPTIC_IMPACT[kind]) return hapticsPlugin.impact({ style: HAPTIC_IMPACT[kind] });
    // `notification` sin `impact` (o al revés) sigue siendo mejor que nada: se
    // degrada al primitivo que exista antes de recurrir a la duración cruda.
    if (canImpact) return hapticsPlugin.impact({ style: HAPTIC_NOTIFY[kind] ? 'HEAVY' : 'MEDIUM' });
    if (canNotify) return hapticsPlugin.notification({ type: 'SUCCESS' });
    if (canVibrate) return hapticsPlugin.vibrate({ duration: Math.min(400, Math.max(20, Math.round(durationMs) || 30)) });
    return null;
  }

  function dispatch(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (error) { report('event', error); }
  }

  function validJson(value) {
    if (typeof value !== 'string') return false;
    try { JSON.parse(value); return true; } catch (_) { return false; }
  }

  // Preferences es asíncrono. Serializar sus mutaciones evita que una escritura
  // antigua que termina tarde pise un checkpoint más reciente. La cola siempre
  // resuelve para que un fallo puntual no bloquee las escrituras posteriores.
  let storageTail = Promise.resolve();
  function enqueueStorage(kind, operation) {
    storageTail = storageTail.then(operation).catch((error) => report(kind, error));
    return storageTail;
  }

  function checkpointPersistedStorage() {
    if (!isNative || !Preferences) return storageTail;

    PERSISTED_KEYS.forEach((key) => {
      let value;
      try {
        value = localStorage.getItem(key);
      } catch (error) {
        report('storage-checkpoint-read', error);
        return;
      }

      if (value == null) {
        if (typeof Preferences.remove === 'function') {
          enqueueStorage('storage-checkpoint-remove', () => Preferences.remove({ key }));
        }
        return;
      }

      // Nunca sustituir una copia nativa válida por un localStorage corrupto.
      if (!validJson(value)) {
        report('storage-checkpoint-json', new Error(`Invalid JSON for ${key}`));
        return;
      }
      if (typeof Preferences.set === 'function') {
        enqueueStorage('storage-checkpoint-set', () => Preferences.set({ key, value }));
      }
    });

    return storageTail;
  }

  async function hydrateKey(key) {
    if (!Preferences || typeof Preferences.get !== 'function') return;
    const localValue = localStorage.getItem(key);
    const nativeValue = (await Preferences.get({ key })).value;

    if (nativeValue == null) {
      if (localValue != null && validJson(localValue)) await Preferences.set({ key, value: localValue });
      return;
    }

    if (validJson(nativeValue)) {
      localStorage.setItem(key, nativeValue);
      return;
    }

    // Nunca inyectar JSON corrupto en el juego. Se conserva una copia local
    // para diagnóstico y se recupera el último valor WebView válido, si existe.
    if (typeof Preferences.set === 'function') {
      await Preferences.set({ key: `${key}.corrupt`, value: nativeValue });
    }
    if (typeof Preferences.remove === 'function') await Preferences.remove({ key });
    if (localValue != null && validJson(localValue)) {
      await Preferences.set({ key, value: localValue });
    } else {
      localStorage.removeItem(key);
    }
  }

  async function cleanupPwaState() {
    if ('serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistrations === 'function') {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window && typeof window.caches.keys === 'function') {
      const keys = await window.caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('cv-')).map((key) => window.caches.delete(key)));
    }
  }

  async function registerNativeEvents() {
    if (App && typeof App.addListener === 'function') {
      await App.addListener('appStateChange', async (state) => {
        const active = !!(state && state.isActive);
        // dispatchEvent es síncrono: game.js pausa y ejecuta RunSave.save()
        // antes de que capturemos localStorage y drenemos la cola nativa.
        dispatch('convergence:app-state', { active });
        if (!active) await checkpointPersistedStorage();
      });
      await App.addListener('backButton', (event) => {
        dispatch('convergence:back', { canGoBack: !!(event && event.canGoBack) });
      });
    }

    // Red de seguridad para cierres del WebView que no entreguen appStateChange.
    // El microtask corre después de los listeners legacy registrados en game.js,
    // de modo que RunSave.save() ya ha actualizado localStorage.
    const checkpointAfterLegacy = () => {
      void Promise.resolve().then(() => checkpointPersistedStorage());
    };
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) checkpointAfterLegacy();
      });
      document.addEventListener('freeze', checkpointAfterLegacy);
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', checkpointAfterLegacy);
    }

    if (Network && typeof Network.getStatus === 'function') {
      const publish = (status) => {
        const state = {
          connected: !!(status && status.connected),
          connectionType: (status && status.connectionType) || 'unknown',
        };
        document.documentElement.dataset.network = state.connected ? 'online' : 'offline';
        dispatch('convergence:network', state);
      };
      publish(await Network.getStatus());
      if (typeof Network.addListener === 'function') await Network.addListener('networkStatusChange', publish);
    }
  }

  const platform = {
    runtime: isNative ? 'native' : 'web',
    isNative,
    ready: Promise.resolve(),
    mirrorStorage(key, value) {
      if (!PERSISTED_KEYS.includes(key)) return storageTail;
      if (!validJson(value)) {
        report('storage-set-json', new Error(`Invalid JSON for ${key}`));
        return storageTail;
      }
      // Solo publica la clave: el snapshot, el UID y cualquier token permanecen
      // en sus almacenes. El vertical modular puede observar guardados tanto en
      // web como en nativo sin interceptar localStorage ni tocar game.js.
      dispatch(LEGACY_STORAGE_EVENT, { key });
      if (!isNative || !Preferences || typeof Preferences.set !== 'function') return storageTail;
      return enqueueStorage('storage-set', () => Preferences.set({ key, value }));
    },
    removeStorage(key) {
      if (!PERSISTED_KEYS.includes(key)) return storageTail;
      dispatch(LEGACY_STORAGE_EVENT, { key });
      if (!isNative || !Preferences || typeof Preferences.remove !== 'function') return storageTail;
      return enqueueStorage('storage-remove', () => Preferences.remove({ key }));
    },
    checkpointStorage() {
      return checkpointPersistedStorage();
    },
    flushStorage() {
      return storageTail;
    },
    // ¿Puede vibrar el dispositivo por la vía nativa? Lo consulta el ajuste de
    // vibración, que en nativo no puede fiarse de `navigator.vibrate`.
    get hapticsAvailable() { return (canImpact || canNotify || canVibrate) && !hapticsBroken; },
    // `kind`: light | medium | heavy | success | warning | error.
    // Devuelve true si la vibración quedó en manos del plugin nativo.
    haptic(kind, durationMs) {
      const call = nativeHaptic(kind, durationMs);
      if (!call) return false;
      if (typeof call.catch === 'function') {
        call.catch((error) => { hapticsBroken = true; report('haptic', error); });
      }
      return true;
    },
    async share(data) {
      if (!isNative || !NativeShare || typeof NativeShare.share !== 'function') return false;
      try {
        await NativeShare.share(data);
        return true;
      } catch (error) {
        // Cancelar la hoja nativa no debe mostrar un error ni disparar el fallback.
        if (error && (error.name === 'AbortError' || /cancel/i.test(String(error.message)))) return true;
        report('share', error);
        return false;
      }
    },
    exitApp() {
      if (isNative && App && typeof App.exitApp === 'function') {
        return checkpointPersistedStorage()
          .then(() => App.exitApp())
          .catch((error) => report('exit', error));
      }
      return storageTail;
    },
  };

  window.ConvergencePlatform = platform;
  document.documentElement.dataset.runtime = platform.runtime;

  if (isNative) {
    // No registrar checkpoints hasta terminar la hidratación: un pagehide muy
    // temprano no debe borrar Preferences antes de copiarlo a localStorage.
    const hydration = Promise.all(PERSISTED_KEYS.map((key) => (
      hydrateKey(key).catch((error) => report(`hydrate-${key}`, error))
    )));
    const cleanup = cleanupPwaState().catch((error) => report('pwa-cleanup', error));
    platform.ready = Promise.all([hydration, cleanup])
      .then(() => registerNativeEvents())
      .catch((error) => report('bootstrap', error));
  }

  function scriptSrcFromMeta(name, fallback) {
    const meta = document.querySelector(`meta[name="${name}"]`);
    const content = meta && meta.getAttribute('content');
    return content && content.trim() ? content.trim() : fallback;
  }

  function appendScript(src, marker) {
    const script = document.createElement('script');
    script.src = src;
    script.dataset[marker] = 'true';
    // async=false conserva el orden de ejecución entre scripts insertados
    // dinámicamente: el núcleo de reglas debe evaluarse antes que game.js.
    script.async = false;
    script.onerror = () => dispatch('convergence:bootstrap-error', { source: src });
    document.body.appendChild(script);
  }

  function loadLegacyRuntime() {
    if (document.querySelector('script[data-convergence-legacy]')) return;
    appendScript(scriptSrcFromMeta('convergence-core-script', CORE_SCRIPT), 'convergenceCore');
    appendScript(scriptSrcFromMeta('convergence-legacy-script', LEGACY_SCRIPT), 'convergenceLegacy');
  }

  platform.ready.finally(loadLegacyRuntime);
})();
