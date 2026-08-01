# ADR-0003 — Firestore + Realtime Database + Functions

Estado: aceptada para prototipo; revisión tras métricas
Fecha: 2026-07-31

## Decisión

- Firestore para perfiles, auditoría, resultados y rankings durables.
- Realtime Database para presencia, lobby y snapshots/comandos calientes.
- Cloud Functions para validación, idempotencia y escrituras autoritativas.
- game-core compartido para replays/checkpoints.

## Límites

Los clientes no escriben economía, score verificado ni ranking. App Check
complementa, pero no sustituye, Auth, reglas y validación.

## Punto de revisión

Medir p50/p95 de latencia, coste y frecuencia durante el primer modo
multijugador. Si un árbitro de baja latencia necesita conexión persistente, se
mueve a Cloud Run/WebSocket manteniendo contratos y cliente.
