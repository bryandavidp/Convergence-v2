'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'mockups');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const BASE = 'http://127.0.0.1:8080/index.html?dev';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (_) { /* Chrome is still starting. */ }
    await sleep(100);
  }
  throw new Error(`Chrome DevTools no respondió en ${url}`);
}

class Cdp {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.ws = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const handler = this.pending.get(message.id);
        if (!handler) return;
        this.pending.delete(message.id);
        if (message.error) handler.reject(new Error(message.error.message));
        else handler.resolve(message.result);
        return;
      }
      const listeners = this.events.get(message.method) || [];
      listeners.splice(0).forEach((resolve) => resolve(message.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout esperando ${method}`)), timeout);
      const listeners = this.events.get(method) || [];
      listeners.push((value) => { clearTimeout(timer); resolve(value); });
      this.events.set(method, listeners);
    });
  }
  close() { this.ws.close(); }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate falló');
  return result.result.value;
}

async function ready(cdp) {
  for (let i = 0; i < 80; i += 1) {
    const state = await evaluate(cdp, `({ready:document.readyState,home:!document.querySelector('#screen-start')?.hidden})`);
    if (state.ready === 'complete' && state.home) return;
    await sleep(100);
  }
  throw new Error('Inicio no llegó a estar visible');
}

async function seed(cdp) {
  await evaluate(cdp, `(() => {
    localStorage.setItem('cv_user', 'Jugador');
    localStorage.setItem('cv_tut', '1');
    localStorage.setItem('cv_best', '3571');
    localStorage.setItem('cv_profile', JSON.stringify({name:'Jugador', color:'#00d0ff'}));
    // Estado válido de nivel 1: conserva el 35 % visual de la referencia sin
    // fabricar un XP mayor que el umbral real del juego (300).
    localStorage.setItem('cv_meta', JSON.stringify({xp:105, level:1, coins:1000, gems:30, chests:2, streak:{count:0,date:''}}));
    return true;
  })()`);
}

async function navigateHome(cdp) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: BASE });
  await loaded;
  await seed(cdp);
  const reloaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.reload', { ignoreCache: true });
  await reloaded;
  await ready(cdp);
  await evaluate(cdp, `Promise.all([...document.images].map((img) => {
    if (img.complete) return typeof img.decode === 'function' ? img.decode().catch(() => {}) : true;
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, {once:true});
      img.addEventListener('error', resolve, {once:true});
    });
  })).then(() => true)`);
  // Chrome puede tardar varios frames en componer las capas PNG/glow aun con
  // decode() resuelto; evitamos capturas parciales negras en el artefacto QA.
  await sleep(900);
}

async function viewport(cdp, width, height, scale = 1) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: true,
    screenWidth: width, screenHeight: height,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(180);
}

async function screenshot(cdp, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const target = path.join(OUT, name);
  fs.writeFileSync(target, Buffer.from(shot.data, 'base64'));
  return target;
}

async function audit(cdp) {
  return evaluate(cdp, `(() => {
    const ids = ['#screen-start','.appbar','.appbar-profile','.avatar','.appbar-edit','.appbar-econ','.econ-coins','.econ-gems','.econ-fire','.econ-plus','.daily-banner','.home-play-zone','#btn-play','.home-context','.record-chip','.home-cards','.home-today','.bottom-nav','.bnav-center','.bnav-center .bn-ic'];
    const rect = (el) => { const r=el.getBoundingClientRect(); return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),bottom:+r.bottom.toFixed(1)}; };
    const boxes = Object.fromEntries(ids.map((selector) => [selector, rect(document.querySelector(selector))]));
    const textStyle = (selector) => {
      const el=document.querySelector(selector), s=getComputedStyle(el);
      return {family:s.fontFamily,size:+parseFloat(s.fontSize).toFixed(1),weight:+s.fontWeight||0,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing};
    };
    const typography={
      player:textStyle('.appbar-name'), rewardTitle:textStyle('.db-tx b'), rewardBody:textStyle('.db-tx small'),
      play:textStyle('.btn-hero-copy b'), cardTitle:textStyle('.ac-tx b'), nav:textStyle('.bnav small')
    };
    const circular = (el) => {
      const r=el.getBoundingClientRect(), radius=getComputedStyle(el).borderTopLeftRadius;
      return Math.abs(r.width-r.height)<=1.1 && (radius.includes('%') || parseFloat(radius)>=Math.min(r.width,r.height)*.45);
    };
    const avatar=document.querySelector('.avatar'), homeIcon=document.querySelector('.bnav-center .bn-ic');
    const plusButtons=[...document.querySelectorAll('#screen-start .econ-plus')];
    const econPills=[...document.querySelectorAll('#screen-start .appbar-econ .econ-pill')];
    const playButton=document.querySelector('#btn-play'), playStyle=getComputedStyle(playButton);
    const primaryFamilies=new Set(Object.values(typography).map((value)=>value.family));
    const design={
      avatarCircular:circular(avatar),
      homeCircular:circular(homeIcon),
      economyStyled:econPills.length===3 && econPills.every((el)=>getComputedStyle(el).backgroundImage!=='none' && parseFloat(getComputedStyle(el).borderWidth)>=1),
      plusCircular:plusButtons.length===2 && plusButtons.every((el)=>circular(el) && (getComputedStyle(el).backgroundImage!=='none' || getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)')),
      ctaStyled:playStyle.backgroundImage!=='none' && playStyle.boxShadow!=='none' && parseFloat(playStyle.borderWidth)>=4,
      typographyAligned:primaryFamilies.size===1 && typography.play.weight>=900 && typography.play.size>typography.rewardTitle.size && typography.rewardTitle.size>typography.rewardBody.size && typography.cardTitle.weight>=800
    };
    const visible = [...document.querySelectorAll('#screen-start button')].filter((el) => {
      const r=el.getBoundingClientRect(), s=getComputedStyle(el);
      return !el.hidden && s.display!=='none' && r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight;
    });
    // El eje vertical de .home-scroll es desplazable en pantallas bajas. Un
    // control fuera del viewport actual no es un recorte si se alcanza al
    // desplazar; aquí auditamos el defecto real: desbordamiento horizontal.
    const clipped = visible.filter((el) => { const r=el.getBoundingClientRect(); return r.left < -0.5 || r.right > innerWidth + .5; }).map((el) => ({id:el.id,act:el.dataset.act,box:rect(el)}));
    const overlaps = [];
    for (let i=0;i<visible.length;i++) for (let j=i+1;j<visible.length;j++) {
      const first=visible[i], second=visible[j];
      const actions=[first.dataset.act,second.dataset.act];
      // El lápiz está deliberadamente superpuesto al bloque de perfil. En
      // scroll corto el contenido pasa por debajo de cabecera/nav fijas.
      const intentionalProfile=actions.includes('profile') && actions.includes('edit-name');
      const scrollAgainstChrome=(first.closest('.home-scroll') && (second.closest('.appbar') || second.closest('.bottom-nav')))
        || (second.closest('.home-scroll') && (first.closest('.appbar') || first.closest('.bottom-nav')));
      if (intentionalProfile || scrollAgainstChrome) continue;
      const a=visible[i].getBoundingClientRect(), b=visible[j].getBoundingClientRect();
      const area=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      if (area > 80 && !visible[i].contains(visible[j]) && !visible[j].contains(visible[i])) overlaps.push([visible[i].id||visible[i].dataset.act,visible[j].id||visible[j].dataset.act,Math.round(area)]);
    }
    const profileRect=document.querySelector('.appbar-profile').getBoundingClientRect();
    const econRect=document.querySelector('.appbar-econ').getBoundingClientRect();
    const intersection=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))
      *Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    // Los wrappers de Perfil y Economía pueden cruzar sus cajas vacías sin que
    // ningún píxel interactivo se solape. Auditamos las piezas visuales reales.
    const profilePieces=['.avatar','.appbar-name','.appbar-edit','.appbar-lvl-star','.appbar-lvl-txt','.appbar-xp','.appbar-xp-num']
      .map((selector)=>document.querySelector(selector)?.getBoundingClientRect()).filter(Boolean);
    const econPieces=[...document.querySelectorAll('#screen-start .appbar-econ .econ-pill')].map((el)=>el.getBoundingClientRect());
    const headerOverlap=Math.max(0,...profilePieces.flatMap((a)=>econPieces.map((b)=>intersection(a,b))));
    const recordText=document.querySelector('.record-chip')?.textContent || '';
    return {
      viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},
      document:{scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},
      homeScroll:{clientHeight:document.querySelector('.home-scroll').clientHeight,scrollHeight:document.querySelector('.home-scroll').scrollHeight},
      boxes, clipped, overlaps,
      header:{overlap:+headerOverlap.toFixed(1),within:profileRect.left>=-.5 && econRect.right<=innerWidth+.5},
      typography, design,
      semantics:{scoreOnly:!/(Nivel|Level)/i.test(recordText),settingsCount:document.querySelectorAll('#screen-start [data-act=settings]').length},
      disabled:{multiplayer:document.querySelector('#home-multi-card')?.disabled===true,league:document.querySelector('#home-today-league')?.disabled===true,friends:document.querySelector('#home-today-friends')?.disabled===true},
      text:{name:document.querySelector('.appbar-name')?.textContent,coins:document.querySelector('[data-econ-num=coins]')?.textContent,gems:document.querySelector('[data-econ-num=gems]')?.textContent,best:document.querySelector('#start-best')?.textContent},
      errors:window.__qaErrors || []
    };
  })()`);
}

async function interactionAudit(cdp) {
  return evaluate(cdp, `(async () => {
    const result={};
    const click=(selector)=>document.querySelector(selector)?.click();
    const wait=(ms=60)=>new Promise(r=>setTimeout(r,ms));
    const modalOpen=(selector)=>!document.querySelector(selector)?.hidden;
    const close=(selector)=>document.querySelector(selector+' [data-close]')?.click();

    result.singleSettings=document.querySelectorAll('#screen-start [data-act=settings]').length===1
      && document.querySelector('#screen-start [data-act=settings]')?.closest('.bottom-nav')!==null;
    result.scoreOnly=!/(Nivel|Level)/i.test(document.querySelector('.record-chip')?.textContent||'');
    result.multiplayerDisabled=document.querySelector('#home-multi-card')?.disabled===true;
    result.leagueDisabled=document.querySelector('#home-today-league')?.disabled===true;
    result.friendsDisabled=document.querySelector('#home-today-friends')?.disabled===true;

    click('#btn-play'); await new Promise(r=>setTimeout(r,80));
    result.play=!document.querySelector('#screen-modes').hidden;
    document.querySelector('#modes-back')?.click(); await new Promise(r=>setTimeout(r,50));
    click('#home-classic-card'); await new Promise(r=>setTimeout(r,80));
    result.classic=!document.querySelector('#screen-worlds').hidden;
    if (window.__cv) window.__cv.refreshStart();
    document.querySelectorAll('.screen').forEach(s=>s.hidden=s.id!=='screen-start');
    click('#home-daily-card'); await new Promise(r=>setTimeout(r,80));
    result.tournament=!document.querySelector('#modal-daily').hidden;
    document.querySelector('#modal-daily [data-close]')?.click();
    click('[data-act=open-guide]'); await new Promise(r=>setTimeout(r,80));
    result.guide=!document.querySelector('#modal-how').hidden;
    document.querySelector('#modal-how [data-close]')?.click();
    click('[data-act=settings]'); await new Promise(r=>setTimeout(r,80));
    result.settings=!document.querySelector('#modal-settings').hidden;
    close('#modal-settings'); await wait();

    click('[data-act=profile]'); await wait();
    result.profile=modalOpen('#modal-medals')
      && !document.querySelector('#modal-medals')?.classList.contains('achievements-only')
      && getComputedStyle(document.querySelector('#modal-medals .profile-only')).display!=='none';
    close('#modal-medals'); await wait();

    const nativePrompt=window.prompt;
    window.prompt=()=> 'Jugador QA';
    click('[data-act=edit-name]'); await wait();
    result.rename=document.querySelector('#screen-start .appbar-name')?.textContent==='Jugador QA';
    window.prompt=nativePrompt;

    click('[data-act=buy-coins]'); await wait();
    result.coinsShop=modalOpen('#modal-shop');
    close('#modal-shop'); await wait();
    click('[data-act=buy-gems]'); await wait();
    result.gemsShop=modalOpen('#modal-shop');
    close('#modal-shop'); await wait();

    click('#home-today-daily'); await wait();
    result.missions=modalOpen('#modal-missions');
    close('#modal-missions'); await wait();

    const reward=document.querySelector('#btn-reward');
    const geometry=(el)=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
    const sameGeometry=(a,b,tolerance=1)=>Object.keys(a).every((key)=>Math.abs(a[key]-b[key])<=tolerance);
    const rewardBefore=geometry(reward), playBefore=geometry(document.querySelector('.home-play-zone')), cardsBefore=geometry(document.querySelector('.home-cards'));
    const beforeCoins=Number((document.querySelector('#screen-start [data-econ-num=coins]')?.textContent||'0').replace(/\D/g,''));
    click('[data-act=claim-daily]'); await wait(30);
    const enteredPop=reward.classList.contains('is-popping') && !reward.classList.contains('is-claimed');
    await wait(1020);
    const afterCoins=Number((document.querySelector('#screen-start [data-econ-num=coins]')?.textContent||'0').replace(/\D/g,''));
    const rewardAfter=geometry(reward), playAfter=geometry(document.querySelector('.home-play-zone')), cardsAfter=geometry(document.querySelector('.home-cards'));
    const rewardStyle=getComputedStyle(reward);
    result.dailyReward=afterCoins>beforeCoins && enteredPop && reward.classList.contains('is-claimed')
      && !reward.classList.contains('is-popping') && document.querySelector('[data-act=claim-daily]')?.disabled
      && (rewardStyle.visibility==='hidden' || Number(rewardStyle.opacity)===0);
    result.dailyRewardStable=sameGeometry(rewardBefore,rewardAfter) && sameGeometry(playBefore,playAfter) && sameGeometry(cardsBefore,cardsAfter);

    click('[data-act=home-daily]'); await wait();
    result.daily=modalOpen('#modal-daily');
    close('#modal-daily'); await wait();
    click('[data-act=open-chests]'); await wait();
    result.chests=modalOpen('#modal-chests');
    const initialChestBadge=document.querySelector('#home-chests-badge');
    const initialChestState=document.querySelector('#home-chests-state');
    const startedAtTwo=initialChestBadge?.hidden===false && initialChestBadge?.textContent==='2' && /2/.test(initialChestState?.textContent||'');
    click('#btn-open-chest'); await wait(30);
    const firstLive=initialChestBadge?.hidden===false && initialChestBadge?.textContent==='1' && /1/.test(initialChestState?.textContent||'');
    await wait(620);
    click('#btn-open-chest'); await wait(30);
    const secondLive=initialChestBadge?.hidden===true
      && !document.querySelector('#home-today-chests')?.classList.contains('is-ready')
      && !/1|2/.test(initialChestState?.textContent||'');
    result.chestsLive=startedAtTwo && firstLive && secondLive;
    await wait(620);
    close('#modal-chests'); await wait();
    click('[data-act=nav-achievements]'); await wait();
    result.achievements=modalOpen('#modal-medals')
      && document.querySelector('#modal-medals')?.classList.contains('achievements-only')
      && /Logros|Achievements/i.test(document.querySelector('#medals-title')?.textContent||'')
      && getComputedStyle(document.querySelector('#modal-medals .profile-only')).display==='none';
    close('#modal-medals'); await wait();
    click('[data-act=nav-shop]'); await wait();
    result.shop=modalOpen('#modal-shop');
    close('#modal-shop'); await wait();

    click('[data-act=nav-home]'); await wait();
    result.home=!document.querySelector('#screen-start').hidden;
    return result;
  })()`);
}

function continuityAudit(results) {
  const pairs = [
    ['719x1024', '720x1024'],
    ['819x1180', '820x1180'],
    ['900x1280', '901x1280'],
    ['853x1280', '854x1280'],
    ['1023x1536', '1024x1536'],
  ];
  const selectors = ['.avatar', '.appbar-econ', '#btn-play', '.bnav-center .bn-ic'];
  const report = {};
  for (const [beforeKey, afterKey] of pairs) {
    const before = results[beforeKey], after = results[afterKey];
    report[`${beforeKey}->${afterKey}`] = Object.fromEntries(selectors.map((selector) => {
      const a = before.boxes[selector], b = after.boxes[selector];
      const delta = {
        x: +Math.abs(a.x - b.x).toFixed(1), y: +Math.abs(a.y - b.y).toFixed(1),
        w: +Math.abs(a.w - b.w).toFixed(1), h: +Math.abs(a.h - b.h).toFixed(1),
      };
      const largest = Math.max(a.w, a.h, b.w, b.h);
      const sizeLimit = Math.max(4, largest * .12);
      return [selector, { ...delta, pass: delta.w <= sizeLimit && delta.h <= sizeLimit }];
    }));
  }
  return report;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(os.tmpdir(), `cv-home-qa-${Date.now()}`);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
    const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE)}`, { method: 'PUT' }).then((r) => r.json());
    const cdp = new Cdp(tab.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__qaErrors=[];addEventListener('error',e=>__qaErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>__qaErrors.push(String(e.reason)));` });

    const results = {};
    for (const spec of [
      { width: 853, height: 1280, scale: 1 },
      { width: 854, height: 1280, scale: 1, name: 'home-actual-854x1280.png' },
      { width: 1023, height: 1536, scale: 1 },
      { width: 1024, height: 1536, scale: 1, name: 'home-actual-1024x1536.png' },
      { width: 601, height: 900, scale: 1 },
      { width: 719, height: 1024, scale: 1 },
      { width: 720, height: 1024, scale: 1 },
      { width: 768, height: 1024, scale: 1 },
      { width: 819, height: 1180, scale: 1 },
      { width: 820, height: 1180, scale: 1 },
      { width: 900, height: 1280, scale: 1 },
      { width: 901, height: 1280, scale: 1 },
      { width: 390, height: 844, scale: 1, name: 'home-actual-390x844.png' },
      { width: 360, height: 640, scale: 1, name: 'home-actual-360x640.png' },
    ]) {
      await viewport(cdp, spec.width, spec.height, spec.scale);
      await navigateHome(cdp);
      results[`${spec.width}x${spec.height}`] = await audit(cdp);
      if (spec.name) await screenshot(cdp, spec.name);
      if (spec.width === 360) {
        await evaluate(cdp, `(() => { const el=document.querySelector('.home-scroll'); el.scrollTop=el.scrollHeight; return {top:el.scrollTop,max:el.scrollHeight-el.clientHeight}; })()`);
        await sleep(120);
        results['360x640-bottom'] = await audit(cdp);
        await screenshot(cdp, 'home-actual-360x640-bottom.png');
      }
    }
    results.continuity = continuityAudit(results);
    await viewport(cdp, 390, 844, 1);
    await navigateHome(cdp);
    results.interactions = await interactionAudit(cdp);
    results.interactionErrors = await evaluate(cdp, `window.__qaErrors || []`);

    await viewport(cdp, 720, 1024, 1);
    await evaluate(cdp, `(() => {
      localStorage.setItem('cv_profile', JSON.stringify({name:'WWWWWWWWWWWWWWWW', color:'#00d0ff'}));
      const meta=JSON.parse(localStorage.getItem('cv_meta')||'{}');
      meta.coins=99999999; meta.gems=99999999;
      localStorage.setItem('cv_meta', JSON.stringify(meta));
      return true;
    })()`);
    const stressReloaded=cdp.once('Page.loadEventFired');
    await cdp.send('Page.reload', { ignoreCache: true });
    await stressReloaded;
    await ready(cdp);
    await sleep(250);
    results.headerStress = await audit(cdp);

    const viewportAudits=Object.entries(results).filter(([,value])=>value?.viewport);
    const designViewports=['390x844','720x1024','854x1280','1024x1536'].map((key)=>results[key]);
    const continuityChecks=Object.values(results.continuity).flatMap((pair)=>Object.values(pair));
    results.verdict={
      interactions:Object.values(results.interactions).every(Boolean),
      layouts:viewportAudits.every(([,value])=>value.document.scrollWidth<=value.viewport.w && value.clipped.length===0 && value.overlaps.length===0 && value.header.overlap===0 && value.header.within),
      design:designViewports.every((value)=>Object.values(value.design).every(Boolean)),
      continuity:continuityChecks.every((value)=>value.pass),
      disabled:viewportAudits.every(([,value])=>Object.values(value.disabled).every(Boolean)),
      semantics:viewportAudits.every(([,value])=>value.semantics.scoreOnly && value.semantics.settingsCount===1),
      runtime:viewportAudits.every(([,value])=>value.errors.length===0) && results.interactionErrors.length===0,
    };
    fs.writeFileSync(path.join(OUT, 'home-visual-qa-report.json'), JSON.stringify(results, null, 2) + '\n');
    cdp.close();
    process.stdout.write(JSON.stringify(results, null, 2));
  } finally {
    chrome.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
