# ADR 0006 — Build Auth Emulator aislado

Fecha: 2026-08-01
Estado: aceptado para desarrollo local

## Contexto

El runtime 2.37.1 es un conjunto estático autocontenido. `web/index.html` aplica
una CSP cerrada, `native-bridge.js` controla el orden de hidratación y `dist/` es
la fuente tanto de Hosting como de Capacitor. Introducir el SDK Firebase en ese
flujo antes de tener perfil, rollback y paridad supondría alterar los tres
canales a la vez.

Auth sí necesita una prueba de integración real antes de diseñar sincronización
y salas. Import maps/CDN añadirían dependencia de red, excepciones CSP y una
compatibilidad peor con WKWebView antiguo; copiar todo Firebase o usar la factory
completa también incorporaría Firestore, RTDB y Functions sin necesitarlos.

## Decisión

Se mantienen dos artefactos explícitos:

- `apps/client/dist`: build productivo estático, byte por byte ajeno a Auth;
- `apps/client/dist-emulator`: copia regenerable e ignorada que añade un único
  bundle ESM Auth-only generado por esbuild.

La variante local:

- fija `demo-convergence-v2`, `127.0.0.1:9099` y modo `emulator`;
- valida esos valores antes de inicializar Firebase;
- usa un nombre de app Firebase separado e `inMemoryPersistence`;
- conecta Auth Emulator antes de iniciar sesión;
- publica `convergence:auth-emulator-state` con estado estrecho, sin exponer el
  SDK ni escribir claves legacy;
- captura fallos para no bloquear `native-bridge.js` o `game.js`;
- inyecta un bundle `auth-emulator-[hash].js`, sin sourcemap ni CDN;
- amplía únicamente la CSP copiada con el origen exacto del emulador.

`firebase.json` continúa apuntando a `apps/client/dist`, y `cap sync` continúa
consumiendo ese mismo directorio.

## Gates

- El build normal no contiene módulo Auth ni endpoint de loopback.
- Construir la variante no cambia `dist/index.html` ni `dist/sw.js`.
- Existe exactamente un bundle hasheado y un script module en la variante.
- El bundle no contiene imports bare, CDN ni SDK de Database/Firestore/Functions.
- Auth anónima se prueba contra Emulator Suite con un ID `demo-*`.
- Un error del emulador no impide que cargue el juego legacy.

## Consecuencias

El equipo puede probar identidad y CSP en navegador sin promover Firebase al
runtime estable. La identidad de esta build es efímera tras recarga por diseño;
no representa todavía la persistencia final de una cuenta.

Android Emulator necesitará `10.0.2.2` y una política de red debug-only; iOS
Simulator necesitará su propia configuración de desarrollo. No se relaja
cleartext, ATS, el esquema HTTPS de Capacitor ni la CSP productiva hasta crear
artefactos nativos debug separados y probarlos de forma específica.
