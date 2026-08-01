/* Sonda de rendimiento (QP-2 §3 y RS-14/RS-9, ver docs/QA_PERF_PLAN.md y docs/RENDER_STABILITY_PLAN.md).
 * Uso: servir la app (python3 -m http.server 8080) y `node tools/perf-probe.js [flags]`.
 * Requiere `playwright` disponible para Node (tooling de desarrollo; el repo sigue sin
 * package.json a propósito). Si `require('playwright')` falla, instálalo global o en un dir aparte.
 *
 * Mide FPS reales del rAF durante juego activo de Supervivencia bajo CPU emulada (throttling ×6
 * vía CDP). Escena de estrés = el caso REPORTADO: tablero cargado + eventos concurrentes
 * (marea/escarcha/meteoro/frenesí) + confeti. Cuenta además animaciones CSS/WAAPI vivas y FX.cap.
 *
 * Flags:
 *   --assert N : guardarraíl. Sale con código 1 si la escena de estrés baja de N FPS.
 *   --android  : emula tablet Android hi-dpi (deviceScaleFactor 3) en vez de iOS gama media.
 *                Reproduce el presupuesto de capas ajustado de la Mi Pad 7 (RS-9).
 *   --canvas   : mide además el backend EXPERIMENTAL de partículas en canvas único (RS-14/C1)
 *                para comparar el ahorro de capas contra el pool DOM en la misma escena. */
const fs = require('fs');
const { chromium } = require('playwright');

// Chromium multiplataforma: usa PW_CHROMIUM o la ruta de Linux del CI si existen,
// si no deja que Playwright use su binario incluido (Windows/macOS/local).
function chromiumPath() {
  for (const p of [process.env.PW_CHROMIUM, '/opt/pw-browsers/chromium']) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  return undefined;
}
// --assert N (umbral de FPS de la escena de estrés)
const assertIdx = process.argv.indexOf('--assert');
const ASSERT_FPS = assertIdx !== -1 ? +process.argv[assertIdx + 1] : null;
const ANDROID = process.argv.indexOf('--android') !== -1;
const CANVAS = process.argv.indexOf('--canvas') !== -1;
// Perfil de dispositivo. El deviceScaleFactor (dpr) es lo que dispara el coste de paint: en
// Android hi-dpi cada capa a pantalla completa pesa decenas de MB y agota el presupuesto de GPU.
const PROFILE = ANDROID
  ? { label: 'Android hi-dpi', viewport: { width: 900, height: 1300 }, dsf: 3 }
  : { label: 'iOS medio', viewport: { width: 390, height: 844 }, dsf: 1 };

async function measure(page, label, secs = 6) {
  const r = await page.evaluate(async ({ label, secs }) => {
    const cv = window.__cv;
    // bot-lite: una convergencia válida cada ~350ms para generar carga real de FX
    const bot = setInterval(() => {
      if (cv.State.status !== 'playing') return;
      for (let i = 0; i < 64; i++) {
        if (cv.State.board[i] === null && !cv.State.tiles[i] && cv.Engine.converging(i).length >= 2) { cv.Game.activate(i); return; }
      }
    }, 350);
    // Escena de estrés = el caso REPORTADO: tablero cargado + eventos concurrentes. Cada ~1.2s
    // rellenamos huecos (tablero lleno) y forzamos un evento de Supervivencia (marea/escarcha/
    // meteoro/frenesí), que es justo lo que en móvil hace perder frames.
    const S = cv.Survival;
    const events = ['tideSurge', 'frostSurge', 'meteorRain', 'activateFrenzy'];
    let ei = 0;
    const evTimer = setInterval(() => {
      if (cv.State.status !== 'playing' || !S) return;
      for (let i = 0; i < 64 && cv.State.iconCount < 56; i++) {
        if (cv.State.board[i] === null && !cv.State.tiles[i] && cv.Engine.spawnOne) cv.Engine.spawnOne();
      }
      if (cv.Render.syncAll) cv.Render.syncAll();
      const f = events[ei++ % events.length];
      try { if (typeof S[f] === 'function') S[f](false); } catch (_) { /* dev tool: nunca abortar */ }
    }, 1200);
    // forzar picos: fiebre + confeti periódico
    cv.State.combo = 12; cv.State.comboAt = performance.now();
    cv.Render.fever(true); cv.FX.confetti(80);
    const conf = setInterval(() => cv.FX.confetti(60), 1500);
    let frames = 0; let long = 0; let last = performance.now();
    const t0 = performance.now();
    await new Promise((res) => {
      function tick(t) {
        frames++;
        if (t - last > 34) long++; // frame >2× presupuesto de 60Hz
        last = t;
        if (t - t0 < secs * 1000) requestAnimationFrame(tick); else res();
      }
      requestAnimationFrame(tick);
    });
    clearInterval(bot); clearInterval(conf); clearInterval(evTimer);
    const fps = (frames / secs).toFixed(1);
    const anims = document.getAnimations().length;
    return { label, fps: +fps, longFrames: long, liveAnimations: anims, fxCap: cv.FX.cap, canvasParticles: (cv.FX.cps ? cv.FX.cps.length : 0) };
  }, { label, secs });
  return r;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
  const page = await browser.newPage({ viewport: PROFILE.viewport, deviceScaleFactor: PROFILE.dsf });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 }); // gama media móvil aprox.
  await page.goto('http://localhost:8080/index.html?dev', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  const results = [];
  // 1) Escena de estrés en configuración normal (pool DOM) -> es la del guardarraíl.
  await page.evaluate(() => window.__cv.Game.start('supervivencia', 'normal'));
  await page.waitForTimeout(400);
  const stress = await measure(page, 'estrés normal (' + PROFILE.label + ', CPU ×6)');
  stress.stress = true; results.push(stress);

  // 2) Backend EXPERIMENTAL de canvas único (RS-14/C1), solo con --canvas. Misma escena.
  if (CANVAS) {
    await page.evaluate(() => window.__cv.FX.enableCanvas(true));
    await page.evaluate(() => window.__cv.Game.start('supervivencia', 'normal'));
    await page.waitForTimeout(400);
    results.push(await measure(page, 'estrés canvas único (' + PROFILE.label + ', CPU ×6)'));
    await page.evaluate(() => window.__cv.FX.enableCanvas(false));
  }

  // 3) reduced-fx activo (referencia del "modo ligero")
  await page.evaluate(() => { document.body.classList.add('reduced-fx'); window.__cv.Settings.reducedFx = true; });
  await page.evaluate(() => window.__cv.Game.start('supervivencia', 'normal'));
  await page.waitForTimeout(400);
  results.push(await measure(page, 'reduced-fx (' + PROFILE.label + ', CPU ×6)'));

  // 4) referencia sin throttling (PC)
  await page.evaluate(() => { document.body.classList.remove('reduced-fx'); window.__cv.Settings.reducedFx = false; });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.evaluate(() => window.__cv.Game.start('supervivencia', 'normal'));
  await page.waitForTimeout(400);
  results.push(await measure(page, 'estrés normal (CPU ×1, referencia PC)'));

  console.log(JSON.stringify(results, null, 2));
  await browser.close();

  // Guardarraíl (--assert N): la escena de estrés no debe bajar de N FPS con CPU ×6.
  if (ASSERT_FPS != null) {
    const s = results.find((r) => r.stress) || results[0];
    if (!s) { console.error('PERF ASSERT: no se encontró la escena de estrés'); process.exit(2); }
    if (s.fps < ASSERT_FPS) {
      console.error(`PERF ASSERT FALLÓ: ${s.fps} FPS < ${ASSERT_FPS} FPS (escena de estrés, ${PROFILE.label}, CPU ×6)`);
      process.exit(1);
    }
    console.log(`PERF ASSERT OK: ${s.fps} FPS ≥ ${ASSERT_FPS} FPS (${PROFILE.label})`);
  }
})().catch((e) => { console.error('PERF FAILED:', e); process.exit(2); });
