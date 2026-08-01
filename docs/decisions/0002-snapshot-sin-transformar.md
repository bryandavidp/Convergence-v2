# ADR-0002 — Snapshot web sin transformar

Estado: aceptada
Fecha: 2026-07-31

## Decisión

Mantener `apps/client/web` como snapshot literal 2.37.1 y construir por copia de
allowlist. No introducir bundler, minificación ni imports TypeScript en el HTML
durante el baseline.

## Motivo

Separa dos preguntas: “¿el clon conserva todo?” y “¿la arquitectura nueva
funciona?”. Si aparecen regresiones, el origen queda acotado.

## Revisión

Cuando plataforma/storage y un primer vertical de game-core tengan fixtures de
paridad, se conectarán mediante un bridge con feature flag. El bundling podrá
evaluarse después con métricas de tamaño, arranque y caché.
