# Referencias históricas

Estos documentos se copiaron para conservar contexto del proyecto original.
Pueden contener versiones, schemas, líneas de código, estados o planes
desactualizados.

No son contrato de Convergence v2. Ante una contradicción se usa:

1. código y tests ejecutables;
2. `docs/design-system`;
3. `ROADMAP.md`, `docs/ARCHITECTURE.md` y decisiones v2;
4. esta carpeta únicamente como referencia.

Discrepancias confirmadas del material antiguo:

- el runtime real es 2.37.1, no 1.7.1/2.7;
- `cv_meta` usa schema 10, no 9;
- existen 343 tests;
- gameplay usa Mulberry32 seedeado, aunque economía/FX mantienen aleatoriedad
  separada;
- RunSave v1 existe, pero no conserva la posición del RNG;
- multiplayer y rankings online aún no existían.
