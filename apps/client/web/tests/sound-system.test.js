/* Regresión del sistema de sonido: (1) con sonido Y música desactivados NO se retiene la
 * sesión de audio del dispositivo (no interferir con audio de fondo de otras apps), y
 * (2) no se programa audio sobre un contexto que no está 'running' (evita fugas de nodos
 * y glitches durante la partida). */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { Sound, Settings } = cv;

function withSettings(sfx, music, fn) {
  const s = Settings.sfx, m = Settings.music, c = Sound.ctx, o = Sound._osc;
  Settings.sfx = sfx; Settings.music = music;
  try { fn(); } finally { Settings.sfx = s; Settings.music = m; Sound.ctx = c; Sound._osc = o; }
}
// Contexto de audio simulado (el stub de DOM no trae WebAudio).
function fakeCtx(state) {
  return {
    state, currentTime: 0, suspended: 0, resumed: 0,
    createOscillator() { this._osc = (this._osc || 0) + 1; return {}; },
    createGain() { return {}; },
    suspend() { this.suspended++; this.state = 'suspended'; return { catch() { } }; },
    resume() { this.resumed++; this.state = 'running'; return { catch() { } }; },
  };
}

test('wanted() refleja los ajustes de sonido y música', () => {
  withSettings(false, false, () => assert.equal(Sound.wanted(), false, 'ambos off -> no se quiere audio'));
  withSettings(true, false, () => assert.equal(Sound.wanted(), true, 'solo sfx'));
  withSettings(false, true, () => assert.equal(Sound.wanted(), true, 'solo música'));
  withSettings(true, true, () => assert.equal(Sound.wanted(), true));
});

test('con sonido y música OFF, applyEnabled suspende el contexto (libera la sesión)', () => {
  withSettings(false, false, () => {
    const ctx = fakeCtx('running');
    Sound.ctx = ctx; Sound._osc = 7;
    Sound.applyEnabled();
    assert.equal(ctx.suspended, 1, 'se suspende el contexto de audio');
    assert.equal(ctx.resumed, 0, 'no se reanuda');
    assert.equal(Sound._osc, 0, 'se resetea el contador de osciladores');
  });
});

test('con sonido y música OFF, ensure() NO reanuda ni agarra la sesión', () => {
  withSettings(false, false, () => {
    const ctx = fakeCtx('running');
    Sound.ctx = ctx;
    Sound.ensure();
    assert.equal(ctx.resumed, 0, 'ensure no reanuda cuando no se quiere audio');
    assert.equal(ctx.suspended, 1, 'y suspende el que hubiera para soltar la sesión');
  });
});

test('suspend() es idempotente y seguro sin contexto', () => {
  withSettings(false, false, () => {
    Sound.ctx = null; Sound._osc = 3;
    assert.doesNotThrow(() => Sound.suspend());
    assert.equal(Sound._osc, 0);
  });
});

test('tone() no programa nada sobre un contexto que no está running (sin fugas/glitches)', () => {
  withSettings(true, false, () => {
    const ctx = fakeCtx('suspended');
    Sound.ctx = ctx; Sound._osc = 0;
    Sound.tone(440, 0.1);
    assert.equal(ctx._osc || 0, 0, 'no crea osciladores sobre un contexto suspendido');
    assert.equal(Sound._osc, 0, 'no incrementa el contador (no habría onended que lo baje)');
  });
});
