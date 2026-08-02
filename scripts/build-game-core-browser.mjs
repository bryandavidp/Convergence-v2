import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

import { repositoryRoot } from './emulator-temp.mjs';

/**
 * El cliente es vanilla y sin bundler a propósito, así que el núcleo no puede
 * llegar como módulo ES. Este script transpila el módulo de reglas a un script
 * clásico que publica `window.ConvergenceGameCore`, para que `game.js` puntúe
 * con las mismas funciones que ejecuta el backend en vez de con una copia.
 *
 * Solo admite módulos sin imports: si alguien añade una dependencia al módulo
 * de reglas, este script falla en vez de emitir un `require` que el navegador
 * no sabe resolver.
 */
const SOURCE = resolve(repositoryRoot, 'packages/game-core/src/modes/time-attack.ts');
const OUTPUT = resolve(repositoryRoot, 'apps/client/web/game-core.js');

const source = await readFile(SOURCE, 'utf8');
if (/^\s*import\s/m.test(source)) {
  throw new Error(
    'time-attack.ts declara imports: el núcleo de navegador debe ser autocontenido.',
  );
}

const { outputText } = ts.transpileModule(source, {
  fileName: SOURCE,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    removeComments: false,
  },
});

if (/\brequire\(/.test(outputText)) {
  throw new Error('La transpilación emitió require(): el módulo no es autocontenido.');
}

const banner = `/* GENERADO por scripts/build-game-core-browser.mjs — no editar a mano.
 * Fuente: packages/game-core/src/modes/time-attack.ts
 * Regenerar con: npm run build:core:browser
 */`;

await writeFile(
  OUTPUT,
  `${banner}\n(function () {\n  'use strict';\n  var exports = {};\n${outputText}\n  window.ConvergenceGameCore = Object.freeze(exports);\n})();\n`,
  'utf8',
);

console.log(`Núcleo de navegador generado: ${OUTPUT}`);
