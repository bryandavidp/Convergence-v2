import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Identidad permanente compartida por Android e iOS.
  appId: 'com.deploy21.convergence',
  appName: 'Convergence',
  // Desde la vertical de rankings (2026-08-02) el APK empaqueta el artefacto con
  // nube, no el offline: `dist` lleva una CSP `connect-src 'self'` y no puede
  // hablar con Firebase, asi que una app nativa construida sobre el no tendria
  // clasificacion que mostrar. El juego sigue siendo jugable sin red; lo unico
  // que aporta este artefacto es el carril de nube.
  webDir: 'dist-cloud-dev',
  backgroundColor: '#070b1c',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      // DARK = iconos/texto claros sobre el fondo oscuro de Convergence.
      style: 'DARK',
      hidden: false,
    },
  },
};

export default config;
