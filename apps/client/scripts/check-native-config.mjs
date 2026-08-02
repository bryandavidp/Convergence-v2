import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '@capacitor/cli/dist/config.js';

const config = await loadConfig();
const { appId, appName, webDir } = config.app;

console.log(
  JSON.stringify(
    {
      appId,
      appName,
      webDir,
    },
    null,
    2,
  ),
);

const errors = [];

if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(appId)) {
  errors.push('appId debe usar reverse-DNS en minúsculas, por ejemplo com.empresa.convergence.');
}

if (appId === 'com.example.convergencev2') {
  errors.push('appId sigue siendo el placeholder y no puede usarse para generar plataformas.');
}

if (!appName.trim()) {
  errors.push('appName no puede estar vacío.');
}

// El APK empaqueta el artefacto con nube desde la vertical de rankings: `dist`
// lleva `connect-src 'self'` y no puede alcanzar Firebase, asi que una app
// nativa construida sobre el no tendria clasificacion. Se sigue exigiendo un
// valor concreto —no cualquiera— para que un webDir accidental no llegue al APK.
if (webDir !== 'dist-cloud-dev') {
  errors.push(`webDir debe ser "dist-cloud-dev"; valor actual: ${webDir}.`);
}

try {
  await access(resolve(process.cwd(), webDir, 'index.html'));
} catch {
  errors.push(`${webDir}/index.html no existe; ejecuta primero el build web.`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Gate nativo OK: identidad y artefacto web listos para cap add.');
}
