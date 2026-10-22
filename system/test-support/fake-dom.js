// A minimal DOM for running a generated behavior script under node:test
// without a browser dependency: elements with classes, attributes, text,
// bubbling events and focus; a manual clock; a controllable
// IntersectionObserver, matchMedia and clipboard. It implements only what the
// behavior scripts call; anything else throws, so a script that starts using a
// new API fails the test loudly instead of passing against a stub.
const vm = require('node:vm');

class FakeEvent {
  constructor(type, init = {}) {
    Object.assign(this, init);
    this.type = type;
    this.bubbles = init.bubbles !== false;
    this.defaultPrevented = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

class FakeClassList {
  constructor() { this.names = []; }
  add(...names) { for (const name of names) if (!this.names.includes(name)) this.names.push(name); }
  remove(...names) { this.names = this.names.filter(name => !names.includes(name)); }
  contains(name) { return this.names.includes(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    if (on) this.add(name); else this.remove(name);
    return on;
  }
  forEach(callback) { [...this.names].forEach(callback); }
  [Symbol.iterator]() { return [...this.names][Symbol.iterator](); }
}

class FakeNode {
  constructor() { this.listeners = new Map(); this.parentElement = null; this.children = []; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    let node = this;
    while (node) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners.get(event.type) || [])]) listener.call(node, event);
      if (!event.bubbles || event.propagationStopped) break;
      node = node.parentElement || (node !== node.ownerDocument && node.ownerDocument) || null;
    }
    return !event.defaultPrevented;
  }
}

const CLASS_SELECTOR = /^\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)$/;
function classOf(selector) {
  const match = CLASS_SELECTOR.exec(selector);
  if (!match) throw new Error(`fake-dom supports only single-class selectors, got ${JSON.stringify(selector)}`);
  return match[1];
}

class FakeElement extends FakeNode {
  constructor(document, tagName) {
    super();
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.text = '';
  }
  get className() { return this.classList.names.join(' '); }
  get id() { return this.attributes.get('id') || ''; }
  set id(value) { this.attributes.set('id', String(value)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  appendChild(child) {
    if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  contains(node) {
    for (let current = node; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  matches(selector) { return this.classList.contains(classOf(selector)); }
  closest(selector) {
    for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
    return null;
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector) { const name = classOf(selector); return this.descendants().filter(node => node.classList.contains(name)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  // Like a browser: only a natively focusable element or one with a tabindex takes focus.
  get focusable() {
    return this.hasAttribute('tabindex') || ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(this.tagName) || (this.tagName === 'A' && this.hasAttribute('href'));
  }
  focus() { if (this.focusable) this.ownerDocument.moveFocus(this); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.moveFocus(null); }
  click() { this.dispatchEvent(new FakeEvent('click')); }
}

class FakeDocument extends FakeNode {
  constructor() {
    super();
    this.ownerDocument = this;
    this.readyState = 'complete';
    this.body = new FakeElement(this, 'body');
    this.body.parentElement = null;
    this.activeElement = this.body;
  }
  createElement(tagName) { return new FakeElement(this, tagName); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  querySelector(selector) { return this.body.querySelector(selector); }
  // focusout on the old element, then focusin on the new one, both bubbling, like a browser.
  moveFocus(next) {
    const previous = this.activeElement === this.body ? null : this.activeElement;
    if (previous === next) return;
    this.activeElement = next || this.body;
    if (previous) previous.dispatchEvent(new FakeEvent('focusout', { relatedTarget: next }));
    if (next) next.dispatchEvent(new FakeEvent('focusin', { relatedTarget: previous }));
  }
}
// A manual clock: timers run only when the test advances time.
function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay = 0) { const id = nextId++; timers.set(id, { at: now + Math.max(0, delay), callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    pending() { return timers.size; },
    now() { return now; },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = end;
    }
  };
}

// Builds `h('div', 'a b', [children] | 'text')`.
function builder(document) {
  return function h(tag, classes, content) {
    const element = document.createElement(tag);
    if (classes) element.classList.add(...classes.split(/\s+/).filter(Boolean));
    if (typeof content === 'string') element.text = content;
    else for (const child of content || []) element.appendChild(child);
    return element;
  };
}

// The body of every <script> in an Embed's code.
function scriptsOf(embedCode) {
  return [...embedCode.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
}

// A page with `build(h)` appended to body, the Embed's script run against it.
// `embedCode` may be an array: several Embeds on one page, run in order.
// clipboard: true (writes succeed), false (no clipboard API) or 'reject' (writeText rejects).
// readyState: 'complete', or 'loading' until the test calls ready().
function runEmbed(embedCode, build, { reducedMotion = false, intersectionObserver = true, clipboard = true, readyState = 'complete' } = {}) {
  const document = new FakeDocument();
  document.readyState = readyState;
  const h = builder(document);
  for (const element of [].concat(build(h))) document.body.appendChild(element);
  const clock = createClock();
  const observers = [];
  class IntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    unobserve(target) { this.targets = this.targets.filter(item => item !== target); }
    disconnect() { this.targets = []; }
  }
  const copied = [];
  const window = {
    document,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    matchMedia: query => ({ matches: reducedMotion && /prefers-reduced-motion:\s*reduce/.test(query), media: query, addEventListener() {}, removeEventListener() {} }),
    navigator: clipboard ? { clipboard: { writeText: text => {
      if (clipboard === 'reject') return Promise.reject(new Error('NotAllowedError'));
      copied.push(text);
      return Promise.resolve();
    } } } : {}
  };
  if (intersectionObserver) window.IntersectionObserver = IntersectionObserver;
  window.window = window;
  const context = vm.createContext(window);
  for (const embed of [].concat(embedCode)) for (const code of scriptsOf(embed)) vm.runInContext(code, context);
  // Reports the intersection state of `target` to every observer watching it.
  const view = (target, isIntersecting) => {
    for (const observer of observers) if (observer.targets.includes(target)) observer.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }], observer);
  };
  const key = (target, keyName) => {
    const event = new FakeEvent('keydown', { key: keyName });
    target.dispatchEvent(event);
    return event;
  };
  const fire = (target, type, init) => target.dispatchEvent(new FakeEvent(type, init));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const ready = () => { document.readyState = 'complete'; document.dispatchEvent(new FakeEvent('DOMContentLoaded', { bubbles: false })); };
  return { document, clock, observers, copied, view, key, fire, flush, ready };
}

module.exports = { runEmbed, scriptsOf, FakeEvent };
