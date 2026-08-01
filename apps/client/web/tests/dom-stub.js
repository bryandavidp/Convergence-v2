/* Stub mínimo de DOM/navegador para cargar game.js en Node (node --test).
 * No simula render real: solo lo justo para que el IIFE arranque (init()) y
 * exponga los módulos internos en window.__cv (hook ?dev).
 * Filosofía: elementos falsos tolerantes; los tests ejercitan la lógica pura
 * (Engine, Config, Meta...) — nunca el DOM. */
'use strict';

/* ---------- Elemento falso ---------- */
function makeClassList() {
  const set = new Set();
  return {
    add: (...cs) => cs.forEach((c) => set.add(c)),
    remove: (...cs) => cs.forEach((c) => set.delete(c)),
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    contains: (c) => set.has(c),
    _set: set,
  };
}

function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    childNodes: [],
    parentNode: null,
    dataset: {},
    hidden: false,
    disabled: false,
    value: '',
    id: '',
    innerHTML: '',
    textContent: '',
    isConnected: true,
    scrollTop: 0,
    offsetWidth: 100, offsetHeight: 100, clientWidth: 100, clientHeight: 100,
    attributes: {},
    style: {
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; },
      getPropertyValue(k) { return this[k] || ''; },
    },
    appendChild(c) { el.children.push(c); el.childNodes.push(c); if (c && typeof c === 'object') c.parentNode = el; return c; },
    append(...cs) { cs.forEach((c) => el.appendChild(c)); },
    prepend(...cs) { cs.forEach((c) => { el.children.unshift(c); el.childNodes.unshift(c); }); },
    insertBefore(c) { el.children.unshift(c); el.childNodes.unshift(c); return c; },
    removeChild(c) {
      const i = el.children.indexOf(c);
      if (i >= 0) { el.children.splice(i, 1); el.childNodes.splice(i, 1); }
      return c;
    },
    replaceChildren(...cs) { el.children = [...cs]; el.childNodes = [...cs]; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); el.isConnected = false; },
    cloneNode() { return makeEl(tag); },
    contains: () => false,
    closest: () => null,
    matches: () => false,
    focus(opts) { if (globalThis.document) globalThis.document.activeElement = el; el._lastFocusOptions = opts || null; },
    blur() { if (globalThis.document && globalThis.document.activeElement === el) globalThis.document.activeElement = null; },
    click() {},
    setAttribute(k, v) { el.attributes[k] = String(v); if (k === 'id') el.id = String(v); },
    getAttribute(k) { return k in el.attributes ? el.attributes[k] : null; },
    removeAttribute(k) { delete el.attributes[k]; },
    hasAttribute(k) { return k in el.attributes; },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return true; },
    querySelector: (s) => getMemoEl('q:' + s),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 }),
    animate: () => ({ cancel() {}, finished: Promise.resolve(), onfinish: null, addEventListener() {} }),
    getAnimations: () => [],
    getContext: () => null,
    get firstChild() { return el.childNodes[0] || null; },
    get lastChild() { return el.childNodes[el.childNodes.length - 1] || null; },
    get firstElementChild() { return el.children[0] || null; },
    get lastElementChild() { return el.children[el.children.length - 1] || null; },
    nextSibling: null,
  };
  el.classList = makeClassList(el);
  return el;
}

/* Memoiza por selector/id para que listeners y estado persistan entre llamadas. */
const memo = new Map();
function getMemoEl(key) {
  if (!memo.has(key)) memo.set(key, makeEl());
  return memo.get(key);
}

/* ---------- document / window / navegador ---------- */
const documentStub = {
  readyState: 'complete',
  hidden: false,
  title: 'test',
  activeElement: null,
  body: makeEl('body'),
  documentElement: makeEl('html'),
  head: makeEl('head'),
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  createDocumentFragment: () => makeEl('fragment'),
  getElementById: (id) => getMemoEl('#' + id),
  querySelector: (s) => getMemoEl('q:' + s),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
};
documentStub.body.dataset = {};
documentStub.documentElement.lang = 'es';

const storageBack = new Map();
const localStorageStub = {
  getItem: (k) => (storageBack.has(k) ? storageBack.get(k) : null),
  setItem: (k, v) => storageBack.set(k, String(v)),
  removeItem: (k) => storageBack.delete(k),
  clear: () => storageBack.clear(),
};

const matchMediaStub = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const g = globalThis;
g.document = documentStub;
g.localStorage = localStorageStub;
g.location = { search: '?dev', href: 'http://localhost/index.html', origin: 'http://localhost', hostname: 'localhost', protocol: 'http:' };
g.matchMedia = matchMediaStub;
// Node ≥21 define `navigator` como getter global de solo lectura: hay que sombrearlo.
Object.defineProperty(g, 'navigator', {
  value: {
    language: 'es-ES', userAgent: 'node-test', platform: 'linux', maxTouchPoints: 0,
    vibrate: () => true, standalone: false,
  },
  configurable: true, writable: true,
});
g.window = g;                    // el IIFE usa window.* y globals sueltos indistintamente
g.window.matchMedia = matchMediaStub;
g.window.addEventListener = () => {};
g.window.removeEventListener = () => {};
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};
g.alert = () => {};
g.confirm = () => true;

module.exports = { makeEl, getMemoEl, storageBack };
