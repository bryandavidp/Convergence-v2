import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

import { repositoryRoot } from './emulator-temp.mjs';

/**
 * El cliente es vanilla y sin bundler a propósito, así que el núcleo no puede
 * llegar como módulo ES. Este script transpila los módulos de reglas a un script
 * clásico que publica `window.ConvergenceGameCore`, para que `game.js` puntúe
 * con las mismas funciones que ejecuta el backend en vez de con una copia.
 *
 * Todos los módulos comparten un único objeto `exports`, así que las importaciones
 * relativas entre ellos se resuelven a ese mismo espacio. El orden de la lista es
 * el de dependencia: un módulo solo puede usar lo que ya se declaró antes.
 */
const MODULES = [
  'packages/game-core/src/scoring.ts',
  'packages/game-core/src/modes/adventure.ts',
  'packages/game-core/src/modes/classic.ts',
  'packages/game-core/src/modes/survival.ts',
  'packages/game-core/src/modes/time-attack.ts',
  'packages/game-core/src/modes/tutorial.ts',
  'packages/game-core/src/modes/zen.ts',
];

const OUTPUT = resolve(repositoryRoot, 'apps/client/web/game-core.js');

const chunks = [];
for (const relativePath of MODULES) {
  const source = await readFile(resolve(repositoryRoot, relativePath), 'utf8');

  // Solo se admiten importaciones relativas entre módulos del propio núcleo:
  // cualquier dependencia externa no tendría cómo resolverse en el navegador.
  for (const match of source.matchAll(/^\s*import[^;]*?from\s+'([^']+)'/gm)) {
    if (!match[1].startsWith('.')) {
      throw new Error(`${relativePath} importa '${match[1]}': el núcleo de navegador debe ser autocontenido.`);
    }
  }

  const { outputText } = ts.transpileModule(source, {
    fileName: resolve(repositoryRoot, relativePath),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      removeComments: false,
    },
  });
  chunks.push(`// --- ${relativePath} ---\n${outputText}`);
}

const banner = `/* GENERADO por scripts/build-game-core-browser.mjs — no editar a mano.
 * Fuente: ${MODULES.join(', ')}
 * Regenerar con: npm run build:core:browser
 */`;

await writeFile(
  OUTPUT,
  `${banner}
(function () {
  'use strict';
  var exports = {};
  // Los módulos del núcleo comparten espacio de exportación, así que una
  // importación relativa entre ellos devuelve ese mismo objeto.
  function require() { return exports; }
${chunks.join('\n')}
  window.ConvergenceGameCore = Object.freeze(exports);
})();
`,
  'utf8',
);

console.log(`Núcleo de navegador generado (${MODULES.length} módulos): ${OUTPUT}`);
