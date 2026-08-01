import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import type { PlatformServices } from './contract.js';

export function createCapacitorPlatform(): PlatformServices {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('El adaptador Capacitor solo puede usarse en Android o iOS.');
  }

  return {
    runtime: 'native',
    storage: {
      async get(key) {
        return (await Preferences.get({ key })).value;
      },
      async set(key, value) {
        await Preferences.set({ key, value });
      },
      async remove(key) {
        await Preferences.remove({ key });
      },
    },
    haptics: {
      async selection() {
        await Haptics.selectionChanged();
      },
      async impact() {
        await Haptics.impact({ style: ImpactStyle.Light });
      },
    },
    share: {
      async canShare() {
        return (await Share.canShare()).value;
      },
      async share(data) {
        await Share.share(data);
      },
    },
    network: {
      async current() {
        const status = await Network.getStatus();
        return {
          connected: status.connected,
          connectionType: status.connectionType,
        };
      },
      async subscribe(listener) {
        const handle = await Network.addListener('networkStatusChange', (status) => {
          listener({
            connected: status.connected,
            connectionType: status.connectionType,
          });
        });
        return async () => {
          await handle.remove();
        };
      },
    },
  };
}
