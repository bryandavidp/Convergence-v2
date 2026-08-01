const [major, minor, patch] = process.versions.node.split('.').map(Number);
const expected = { major: 22, minor: 23, patch: 2 };

const compatible =
  major === expected.major &&
  (minor > expected.minor ||
    (minor === expected.minor && patch >= expected.patch));

if (!compatible) {
  console.error(
    [
      `Node ${process.versions.node} no es el runtime homologado.`,
      `Instala Node ${expected.major}.${expected.minor}.${expected.patch} (LTS) y vuelve a ejecutar npm run validate.`,
      'El Node 23 actual es una rama impar sin soporte del toolchain de pruebas previsto.',
    ].join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log(`Node ${process.versions.node}: entorno compatible.`);
}
