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

if (webDir !== 'dist') {
  errors.push(`webDir debe ser "dist"; valor actual: ${webDir}.`);
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
