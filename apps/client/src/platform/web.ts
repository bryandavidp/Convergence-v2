import type { PlatformServices } from './contract.js';

export function createWebPlatform(): PlatformServices {
  return {
    runtime: 'web',
    storage: {
      async get(key) {
        return window.localStorage.getItem(key);
      },
      async set(key, value) {
        window.localStorage.setItem(key, value);
      },
      async remove(key) {
        window.localStorage.removeItem(key);
      },
    },
    haptics: {
      // Un pulso por debajo de ~20 ms no llega a mover un motor LRA moderno: los
      // 8/18 ms originales no se notaban en ningún Android.
      async selection() {
        navigator.vibrate?.(20);
      },
      async impact() {
        navigator.vibrate?.(35);
      },
    },
    share: {
      async canShare() {
        return typeof navigator.share === 'function';
      },
      async share(data) {
        if (typeof navigator.share !== 'function') {
          throw new Error('Web Share API no disponible.');
        }
        await navigator.share(data);
      },
    },
    network: {
      async current() {
        return {
          connected: navigator.onLine,
          connectionType: navigator.onLine ? 'unknown' : 'none',
        };
      },
      async subscribe(listener) {
        const update = () =>
          listener({
            connected: navigator.onLine,
            connectionType: navigator.onLine ? 'unknown' : 'none',
          });
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return async () => {
          window.removeEventListener('online', update);
          window.removeEventListener('offline', update);
        };
      },
    },
  };
}
