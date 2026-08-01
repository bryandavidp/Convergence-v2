# ADR-0001 — Capacitor y migración incremental

Estado: aceptada
Fecha: 2026-07-31

## Contexto

El cliente HTML/CSS/JS contiene años de funcionalidad, 343 pruebas y un design
system detallado. Una reescritura en Flutter/React Native duplicaría UI, lógica
y regresiones antes de aportar valor nativo.

## Decisión

Usar Capacitor 8 sobre el artefacto web existente. Extraer dependencias del
navegador detrás de adaptadores y reglas a game-core en pasos pequeños.

## Consecuencias

- Android/PWA pueden avanzar en Windows; iOS necesita macOS.
- Se conserva casi toda la UI y comportamiento.
- Los plugins nativos cubren storage, lifecycle, haptics, share, notificaciones
  y push.
- El legacy seguirá temporalmente monolítico; cada extracción exige pruebas de
  paridad.
