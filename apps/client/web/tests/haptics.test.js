/* Regresión de vibración en el tablero.
 *
 * El bug: en Android no había feedback háptico de ningún tipo. Tres causas que
 * se sumaban y que aquí quedan fijadas:
 *   1. En nativo `fire()` delegaba en el puente y salía SIEMPRE, aunque el puente
 *      no hubiera vibrado (plugin ausente o roto). Nunca se probaba
 *      `navigator.vibrate`, que es lo que sí funciona en el WebView.
 *   2. Los patrones web pulsaban 8-14 ms, por debajo del umbral de un motor LRA.
 *   3. El ajuste de vibración solo se mostraba si existía `navigator.vibrate`,
 *      así que en el APK desaparecía del panel.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const { Haptics, Settings, Feedback } = globalThis.window.__cv;

// Patrones que el juego dispara durante una partida, con la primitiva nativa
// que les corresponde. `tap` es el más frecuente: sale en cada convergencia.
const PATTERNS = [
  ['tap', 'light'], ['combo', 'medium'], ['milestone', 'success'], ['error', 'error'],
  ['level', 'success'], ['record', 'success'], ['fever', 'warning'], ['ice', 'light'],
  ['quake', 'heavy'], ['life', 'success'], ['roll', 'medium'], ['impacts', 'heavy'],
  ['clank', 'heavy'], ['reward', 'success'],
];

// Sustituye la plataforma vista por Haptics y la API del WebView, y devuelve lo
// que llegó a cada vía. `Platform` se capturó por referencia en el IIFE, así que
// se muta el objeto en vez de reasignarlo.
function capture({ isNative = false, nativeHandles = true, webVibrate = true } = {}) {
  const { Platform } = globalThis.window.__cv;
  const native = [];
  const web = [];
  const prev = {
    isNative: Platform.isNative,
    haptic: Platform.haptic,
    available: Platform.hapticsAvailable,
    vibrate: navigator.vibrate,
    haptics: Settings.haptics,
  };

  Platform.isNative = isNative;
  Platform.hapticsAvailable = isNative && nativeHandles;
  Platform.haptic = (kind, ms) => { native.push([kind, ms]); return nativeHandles; };
  navigator.vibrate = webVibrate ? (p) => { web.push(p); return true; } : undefined;

  return {
    native,
    web,
    restore() {
      Platform.isNative = prev.isNative;
      Platform.haptic = prev.haptic;
      Platform.hapticsAvailable = prev.available;
      navigator.vibrate = prev.vibrate;
      Settings.haptics = prev.haptics;
    },
  };
}

test('cada patrón del tablero pide una primitiva háptica nativa distinguible', () => {
  const cap = capture({ isNative: true });
  try {
    Settings.haptics = true;
    for (const [name] of PATTERNS) Haptics[name]();
    assert.deepEqual(cap.native.map(([kind]) => kind), PATTERNS.map(([, kind]) => kind));
    // El puente se hizo cargo: no debe vibrar además por la vía web.
    assert.deepEqual(cap.web, []);
  } finally {
    cap.restore();
  }
});

test('si el puente nativo no vibra, el patrón cae a navigator.vibrate', () => {
  const cap = capture({ isNative: true, nativeHandles: false });
  try {
    Settings.haptics = true;
    Haptics.tap();
    Haptics.record();
    assert.equal(cap.native.length, 2, 'se intenta primero la vía nativa');
    assert.deepEqual(cap.web, [22, [24, 28, 24, 28, 48]]);
  } finally {
    cap.restore();
  }
});

test('ningún pulso baja del umbral perceptible de un motor LRA', () => {
  const cap = capture({ isNative: false });
  try {
    Settings.haptics = true;
    for (const [name] of PATTERNS) Haptics[name]();
    const pulses = cap.web.flatMap((p) => (Array.isArray(p) ? p.filter((_, i) => i % 2 === 0) : [p]));
    assert.equal(pulses.length > 0, true);
    for (const ms of pulses) {
      assert.ok(ms >= 20, `un pulso de ${ms} ms no se siente en un móvil moderno`);
    }
  } finally {
    cap.restore();
  }
});

test('el ajuste de vibración se ofrece también cuando solo hay háptica nativa', () => {
  const cap = capture({ isNative: true, webVibrate: false });
  try {
    // En el WebView del APK `navigator.vibrate` puede no existir; el ajuste no
    // puede depender solo de eso o el jugador se queda sin control (y sin pista
    // de que el juego vibra).
    assert.equal(Haptics.webOk, false);
    assert.equal(Haptics.ok, true);
  } finally {
    cap.restore();
  }

  const off = capture({ isNative: false, webVibrate: false });
  try {
    assert.equal(Haptics.ok, false, 'sin ninguna vía el ajuste sigue oculto');
  } finally {
    off.restore();
  }
});

test('el interruptor de ajustes silencia ambas vías', () => {
  const cap = capture({ isNative: true });
  try {
    Settings.haptics = false;
    Haptics.tap();
    assert.deepEqual(cap.native, []);
    assert.deepEqual(cap.web, []);
  } finally {
    cap.restore();
  }
});

test('los avisos con háptica nombran patrones reales', () => {
  const cap = capture({ isNative: true });
  try {
    Settings.haptics = true;
    // `hap` indexa Haptics por nombre: un nombre que no sea un patrón (el aviso
    // de jefe apuntaba a 'fire', el método de bajo nivel) llamaba a fire() sin
    // argumentos, que en web es navigator.vibrate(0) — cancelar, no vibrar.
    for (const [name, spec] of Object.entries(Feedback.SIG)) {
      if (!spec.hap) continue;
      assert.ok(PATTERNS.some(([p]) => p === spec.hap),
        `el aviso '${name}' declara hap: '${spec.hap}', que no es un patrón de Haptics`);
    }
  } finally {
    cap.restore();
  }
});
