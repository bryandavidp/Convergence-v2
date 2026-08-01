# Matriz de paridad nativa

Estado: gates automatizados Android verdes; paridad funcional/visual manual pendiente.

Esta matriz controla que empaquetar Convergence 2.37.1 con Capacitor no elimine
funcionalidad de la PWA ni altere el diseño canónico. Una casilla solo se marca
con evidencia; generar el proyecto no equivale a validar paridad.

## Identidad y baseline

| Campo | Valor |
|---|---|
| Nombre | Convergence |
| Application ID | `com.deploy21.convergence` |
| Orientación | portrait |
| Android | min API 24; compile/target API 36 |
| Runtime web | Convergence 2.37.1 |
| Persistencia legacy | `cv_meta` schema 10; `cv_run` v1 |
| Tests legacy | 343 |
| Goldens | 127 capturas de 390×844 |

## Gates automatizados

Antes de abrir Android Studio:

```powershell
npm run validate
npm run native:gate
npm run native:sync
npm run native:doctor
```

Con JDK 21 y SDK 36:

```powershell
Set-Location "apps/client/android"
./gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

Con emulador o dispositivo conectado:

```powershell
./gradlew.bat :app:connectedDebugAndroidTest
```

El APK debug queda bajo
`apps/client/android/app/build/outputs/apk/debug/` y no se versiona.

## Matriz de dispositivos

| Entorno | Objetivo | Estado |
|---|---|---|
| Chrome/PWA 390×844 | referencia funcional y visual | pendiente de nueva captura |
| Android Emulator teléfono API 36 | camino principal | smoke automatizado verde; matriz manual pendiente |
| Android físico API 24–28 | mínimo y WebView antiguo actualizado | pendiente |
| Android físico API 34–36 | lifecycle, audio y rendimiento reales | pendiente |
| Tablet/foldable API 36 | portrait, safe areas y multi-window | pendiente |
| iOS Simulator | shell y layout | bloqueado hasta macOS |
| iPhone físico iOS 15+ | lifecycle, audio y firma | bloqueado hasta macOS |

## P0 del bridge nativo

El snapshot se ejecuta tras un bridge pequeño y reversible. Antes de una beta
con progreso real:

- [x] Detectar el runtime Capacitor antes de inicializar PWA.
- [x] En nativo, no registrar Service Worker ni mostrar instalación/actualización
      PWA; limpiar de forma idempotente registros/caches heredados.
- [x] Conectar `App.appStateChange`, pause y resume: background guarda y pausa;
      foreground nunca reanuda gameplay automáticamente.
- [x] Conectar `App.backButton` a una acción compartida que cierre modal/vista,
      pause partida y solo salga desde la raíz.
- [x] Migrar `cv_meta` y `cv_run` a Preferences con lectura dual, schema,
      rollback y tolerancia a JSON corrupto.
- [x] Hacer checkpoints seguros ante process death, no depender únicamente de
      `pagehide`.
- [x] Unificar safe areas entre `env(safe-area-inset-*)` y las variables
      `--safe-area-inset-*` inyectadas por SystemBars.
- [x] Configurar SystemBars con insets CSS, barras visibles e iconos claros
      sobre el fondo oscuro.
- [x] Conectar Share, Haptics y Network mediante el bridge con fallback web.
- [ ] Integrar notificaciones locales de cofres solo tras consentimiento.

`cv_run` conserva deliberadamente el comportamiento legacy: no guarda
Supervivencia, Tutorial ni Contrarreloj/Reto.

## Checklist funcional

### Instalación y arranque

- [x] Instalación debug limpia y actividad principal estable.
- [ ] Splash transiciona una sola vez y no tapa la UI.
- [x] App abre en portrait.
- [x] Arranque en modo avión carga runtime y pantalla inicial desde el APK.
- [ ] Recorrer los cinco modos offline y confirmar sus assets diferidos.
- [ ] Cero recursos 404 y cero errores JavaScript fatales.
- [x] No aparece botón “Instalar” ni banner de actualización PWA dentro del APK.
- [ ] Upgrade del APK conserva perfil, economía y ajustes.

### Onboarding y navegación

- [ ] Login/onboarding local y tutorial completo.
- [ ] Home y navegación inferior.
- [ ] Back físico/gesto recorre la jerarquía sin cerrar o perder una partida.
- [ ] Ajustes, guía, perfil, colecciones, cofres, eventos y misiones.
- [ ] ES/EN y textos largos sin recortes.
- [ ] Teclado/focus no tapa CTA ni deja el layout desplazado.

### Modos

- [ ] Clásico: iniciar, pausar, reanudar, guardar y terminar.
- [ ] Aventura: mapa, nivel, jefe y recompensa.
- [ ] Contrarreloj/reto diario: temporizador correcto tras background.
- [ ] Supervivencia: oleadas, jefes, bendiciones y game over.
- [ ] Zen: variantes y salida.
- [ ] Placeholder multiplayer conserva exactamente su estado actual.
- [ ] Boosters, cofres, economía mock y progresión no cambian.

### Persistencia y lifecycle

- [ ] Fresh install crea datos válidos.
- [x] Relaunch y force-stop conservan `cv_meta`/`cv_run` desde Preferences.
- [ ] Validar background/foreground real durante cada modo y con audio activo.
- [ ] Process kill no deja datos parciales o duplica premios.
- [ ] `cv_meta` schema 10 sobrevive a una actualización debug.
- [ ] Fixtures avanzado y JSON corrupto migran o fallan de forma controlada.
- [ ] Borrar datos produce un inicio limpio.

### Audio y plataforma

- [ ] Primer gesto desbloquea WebAudio.
- [ ] Música/SFX respetan ajustes y se suspenden en background.
- [ ] Bloqueo de pantalla/interrupción no deja audio activo.
- [ ] Diez minutos de juego sin crackle ni crecimiento de osciladores.
- [ ] Vibración/háptica no duplica eventos.
- [ ] Compartir tiene fallback.
- [ ] Offline/online no pierde progreso.
- [ ] No se pide permiso de notificaciones al primer arranque sin contexto.

## Paridad visual

Fuentes canónicas:

- [Design system](./design-system/DESIGN_SYSTEM.md)
- [Índice de capturas](./design-system/SCREENSHOT_INDEX.md)
- [Auditoría de controles](./design-system/CONTROL_AUDIT.md)

Primera pasada con sentinelas:

`01, 06, 12, 16, 17, 39, 58, 69, 74, 80, 85, 99, 101, 111, 127`.

- [ ] Capturar la superficie WebView normalizada a 390×844, sin comparar
      píxel a píxel las barras del sistema.
- [ ] Safe areas no pisan headers, bottom nav, FAB, overlays ni modales.
- [ ] Nunito Sans, iconos, tableros y fondos cargan sin escalado borroso.
- [ ] Sin cambios de geometría, z-index, scroll o clipping.
- [ ] Reduced motion/reduced FX mantienen comportamiento.
- [ ] Clasificar cada diferencia como PASS, esperada y documentada, o FAIL.
- [ ] Ejecutar después los 127 estados del índice antes de beta.

Son bloqueantes: recurso ausente, clipping/solape, control fuera de pantalla,
texto ilegible o cambio de jerarquía/medidas. Solo se toleran diferencias
documentadas de rasterizado/antialiasing.

## Rendimiento

- [x] Cold start API 36 medido por ADB: 2,4–3,2 s en el AVD de referencia.
- [ ] Gameplay estable en dispositivo de gama baja.
- [ ] Sin crecimiento continuado de memoria tras cinco partidas.
- [ ] Sin jank sostenido en tableros, cofres, tienda y jefes.
- [x] APK debug registrado: 97,04 MB; AAB release pendiente.
- [ ] Batería y red medidas antes de activar realtime.

## Seguridad y packaging

- [x] Application ID, namespace, package Java y labels coinciden.
- [x] Activity launcher única y FileProvider no exportado.
- [x] Portrait y categoría game configurados.
- [x] Tests plantilla alineados con el ID permanente.
- [x] Credenciales, keystores y properties de firma ignorados.
- [x] Backup de WebView/Preferences desactivado hasta disponer de reconciliación cloud.
- [x] FileProvider limitado a `cache/share/`; no expone almacenamiento externo.
- [ ] Definir `versionCode`, `versionName` y minificación release.
- [ ] Revisar permisos del manifest fusionado y Data Safety.
- [ ] Firmar únicamente con keystore local o CI protegido.

## Criterio de salida Android

1. Build, unit tests, lint e instrumented smoke pasan.
2. Los cinco modos completan su flujo principal en dispositivo.
3. Persistencia y lifecycle superan cierre, background, kill y actualización.
4. No quedan regresiones críticas frente a los goldens.
5. Cada riesgo tiene corrección o decisión documentada.

Cada ejecución se anota en `docs/PROGRESS.md` con dispositivo, API, versión de
WebView, commit y resultado.
