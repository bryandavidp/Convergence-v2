# Checklist de playtest por modo (GM-31)

> **Cuándo usarlo:** en cada release que toque gameplay, feedback o balance, ejecutar el guion del/los modo(s) afectado(s) — ~10 minutos por modo, en un móvil real si es posible. No sustituye a los tests automáticos ni a la simulación (`GAME_MODES_MASTER_PLAN.md` §10): valida lo que ellos no ven — percepción, legibilidad y emoción.
>
> Formato: cada ítem es una pregunta observable con respuesta sí/no. Un "no" en ⭐ es bloqueante para la release; un "no" normal se anota como issue.

## Preparación (2 min)

- [ ] Servir estático (`python3 -m http.server 8080`) y abrir con `?dev`.
- [ ] Probar con un perfil NUEVO (localStorage limpio) al menos una pasada al mes.
- [ ] Verificar en consola que no hay errores al cargar ni al empezar partida.
- [ ] Pasada rápida con `Ajustes → Reducir efectos` activado: nada debe parpadear, girar ni pulsar.

## Transversal (aplica a todos los modos de acción)

- [ ] ⭐ ¿Consigues tu **primera convergencia antes de 10s** y tu **primer combo (×1.5) antes de 30s**?
- [ ] ⭐ ¿El **chip de multiplicador** junto al score se enciende al subir el combo y se apaga en gris al romperse? ¿Coincide con el `×` de los popups?
- [ ] ¿Entrar en **Fiebre** se NOTA sin mirar el HUD (zoom+color del tablero, aro en llamas, popups más grandes)? ¿La salida se percibe como "exhalación" y no como un corte seco?
- [ ] ¿El aro de combo en estado **urgente** (ventana a punto de expirar) se distingue de la llama de Fiebre?
- [ ] Al perder/ganar: ¿el modal muestra el **momento destacado** ("Tu mejor momento…") y el dato es creíble con lo que acabas de jugar?
- [ ] ¿Toast + sonido + háptica llegan juntos en la misma jugada (sin desfase perceptible)?
- [ ] Cambiar idioma ES↔EN en Ajustes: ¿todas las strings nuevas cambian (banner, chips, modal de fin)?

## Clásico (10 min: niveles 1–3 del Bosque + 1 nivel del último mundo desbloqueado)

- [ ] ¿El objetivo (vaciar) y las estrellas en vivo se entienden sin leer ayuda?
- [ ] Comete 1 error a propósito: ¿ves el aviso de estrella perdida Y entiendes el coste (+figuras, más ritmo)?
- [ ] ⭐ Piérdete a propósito cerca del final (deja llenar el tablero tras haber bajado de ~10 figuras, >45s): ¿aparece "**Te quedaste a {n} figuras**"? ¿Te dan ganas de reintentar?
- [ ] ¿La racha perfecta aparece al encadenar niveles sin errores y se pierde (con mensaje) al fallar?

## Aventura (10 min: continuar desde tu máximo, cruzar un cambio de capítulo)

- [ ] ¿La intro de capítulo (bioma, modificadores, objetivo) aparece 1 sola vez y congela el juego hasta tocar?
- [ ] ¿El banner deja claro el objetivo actual (score/survive/boss/clear) DURANTE la partida?
- [ ] En nivel jefe: ¿sabes cuántos cristales faltan sin contar a mano?
- [ ] ¿La derrota por tablero lleno muestra el near-miss cuando estuviste cerca?

## Contrarreloj (10 min: 3 partidas seguidas)

- [ ] ⭐ ¿Los últimos 20s/10s se sienten distintos (presión visual/sonora) sin volverse ilegibles?
- [ ] ¿El bono de tiempo (+Ns) se ve en el momento del toque y el tope ("⏱ tope") se entiende?
- [ ] ¿La partida termina "porque el juego te superó" y no "porque me aburrí" (aceleración perceptible)?
- [ ] ¿Dan ganas inmediatas de una partida más? (si no: anotar POR QUÉ — es la métrica del modo)

## Reto del día (5 min: 2 intentos)

- [ ] ¿La tarjeta del home muestra el estado real (pendiente/medalla/mejor marca)?
- [ ] ¿"Reintentar" reproduce EXACTAMENTE el mismo tablero inicial?
- [ ] ¿El resultado muestra la medalla y cuánto falta para la siguiente?
- [ ] Primer intento del día: ¿llegan las +5 gemas con su toast?

## Supervivencia (15 min: 1 run en normal hasta morir, 1 run corta en difícil)

- [ ] ⭐ ¿Distingues sin pensar los dos anillos (interior = monedas de suministro para la próxima preparación, exterior = frenesí)? ¿El 🔥 se enciende solo en frenesí?
- [ ] ⭐ Abre y cierra el lanzador con 0/1/3 boosters: ¿la cotización usa stock antes que monedas, solo cobra al confirmar y empezar sin boosters mantiene el inventario de run vacío?
- [ ] ⭐ Oleada previa a jefe: ¿ves la bandera «⚠ Jefe» en la barra Y llega el aviso específico (~3s antes) del tipo correcto (el evento que cae coincide con el aviso)?
- [ ] ⭐ Entrada de jefe: ¿puedes decir quién es el jefe y leer su nivel antes de que empiece el primer aviso de ataque?
- [ ] ⭐ Durante el jefe: ¿la píldora del banner deja claro qué ataque viene y cuántos segundos faltan?
- [ ] ⭐ Fase 2: ¿notas que el jefe cambia de patrón sin que el siguiente ataque te caiga encima inmediatamente?
- [ ] ⭐ Resolución: ¿distingues si el jefe fue derrotado o se retiró antes de que aparezca la bendición?
- [ ] ⭐ Recompensa de jefe: ¿entiendes qué botín/beneficio recibiste por matarlo antes de elegir bendición?
- [ ] ¿El aviso de oleada entrante (78%) te hace mirar el tablero?
- [ ] Usa cada booster equipado una vez: ¿el modo apuntar (previsualización) deja claro qué celdas afecta y el arsenal persistente permanece inaccesible durante la run?
- [ ] Pierde una vida: ¿el alivio (despeje) se lee como "segunda oportunidad" y no como bug?
- [ ] Muere del todo: ¿el modal de revivir muestra el precio y rechazar es igual de fácil que aceptar?
- [ ] ¿El resumen final (oleada, mejor oleada, botín de la run, momento destacado) cuenta la historia de la run?

## Zen (5 min)

- [ ] ¿Se puede jugar 5 minutos sin ver un solo mensaje de castigo o urgencia?
- [ ] Llena el tablero a propósito: ¿el despeje parcial ocurre sin drama (sin shake/rojo)?
- [ ] ¿El ritmo se siente pausado comparado con Clásico (spawn más lento)?

## Registro

| Fecha | Versión | Modos probados | Resultado (issues) | Quién |
|---|---|---|---|---|
| — | — | — | — | — |
