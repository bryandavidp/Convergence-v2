/* Empaqueta el punto de entrada de Functions para que sea desplegable.
 *
 * Firebase sube SOLO el directorio `source` de firebase.json (aquí
 * `apps/functions`), sin node_modules, y ejecuta `npm install` en la nube contra
 * el registro público. `@convergence/contracts` y `@convergence/game-core` son
 * paquetes del workspace: no están publicados, así que ese install falla y el
 * despliegue se cae antes de arrancar.
 *
 * La solución es inlinearlos en el propio bundle. Solo quedan como externos las
 * dependencias que sí existen en el registro y que el runtime de Functions
 * espera resolver por su cuenta (firebase-admin y firebase-functions).
 *
 * Se parte de `src/index.ts` porque `npm run build` (tsc) ya ha comprobado los
 * tipos; esbuild solo transpila y concatena. El resto de `lib/` lo sigue
 * generando tsc y es lo que consumen los tests de handlers.
 */
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const functionsRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entryPoint = resolve(functionsRoot, 'src/index.ts');
const outfile = resolve(functionsRoot, 'lib/index.js');

// El runtime de Functions provee estos paquetes vía npm install en la nube.
// Inlinearlos rompería firebase-admin (usa require dinámico y estado global).
const external = [
  'firebase-admin',
  'firebase-admin/*',
  'firebase-functions',
  'firebase-functions/*',
];

const result = await build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
});

// Red de seguridad: si algún día se cuela un import del workspace sin resolver,
// el despliegue debe fallar aquí y no a mitad de `npm install` en Cloud Build.
const unresolved = Object.keys(result.metafile.outputs[
  Object.keys(result.metafile.outputs)[0]
].inputs ?? {}).length === 0;
if (unresolved) {
  throw new Error('El bundle de Functions salió vacío.');
}

const { readFile } = await import('node:fs/promises');
const bundled = await readFile(outfile, 'utf8');
if (/from\s+['"]@convergence\//.test(bundled)) {
  throw new Error(
    'El bundle conserva imports de @convergence/*: no se instalarían en la nube.',
  );
}

console.log(`Bundle de Functions listo: ${outfile}`);
