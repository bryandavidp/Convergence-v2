import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Identidad permanente compartida por Android e iOS.
  appId: 'com.deploy21.convergence',
  appName: 'Convergence',
  webDir: 'dist',
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
