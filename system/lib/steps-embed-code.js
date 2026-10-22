// Steps (stepper or tabs): a script switches state classes on one root. Every
// state is ordinary page CSS gated on a root class (`.root.is-x-s2 .panel`),
// which the normalizer keeps in the embed stylesheet because the classes are
// `is-` names; the editor and visitors without JavaScript see the state the
// source put on the root (state 0). The adapter only switches classes and
// restores the ARIA the normalizer strips from Taptop layers.

const CLASS_NAME = /^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/;
// A class name the normalizer keeps verbatim in Embed selectors as a script
// state (html-normalizer.js, STATE_CLASS: `^(is|has)-`).
const STATE_NAME = /^(is|has)-[_a-zA-Z0-9-]*$/;
// How long the copy control's "copied" state lasts: the value of the design
// canvas boards this adapter was made for (landing-page design canvases, 2026-10).
const COPIED_MS = 1600;
// Any part of the block in the viewport counts as "in view" (same threshold as the reveal adapter).
const VIEW_THRESHOLD = 0.01;
// The live region is emptied, then gets the message after this delay: screen
// readers coalesce a clear and a set in one task and would not announce an
// identical message twice. Common live-region practice, not measured here.
// Must stay below COPIED_MS, or the message is written after the clear and stays.
const REANNOUNCE_DELAY_MS = 100;
// Tab and panel ids end in a counter kept on window: several steps Embeds on
// one page (and the same block placed twice) are separate scripts, and only a
// global they all read keeps the ids unique across them.
const ID_COUNTER = 'taptopStepsIdCounter';

const STRUCTURE_KEYS = ['rootClass', 'itemClass'];
const STATE_KEYS = ['backClass', 'autoClass', 'manualClass'];
const PREFIX_KEYS = ['statePrefix', 'fromPrefix'];
const REQUIRED = [...STRUCTURE_KEYS, 'count', ...PREFIX_KEYS, ...STATE_KEYS, 'startedClass', 'intervalMs', 'onManual',
  'pauseOnHover', 'pauseOnFocus', 'pattern', 'labels', 'hiddenClasses'];
// The copy control's keys: all or none. Its texts come from the config, not
// the DOM: a code panel's layers (line numbers, one layer per line) do not
// give the code back as text, and Taptop's published shape of them is unknown.
const COPY_KEYS = ['copyClass', 'copiedClass', 'copyTexts', 'copiedMessage', 'copyLabel'];
const OPTIONAL = ['panelClass', ...COPY_KEYS];
const ALLOWED = new Set([...REQUIRED, ...OPTIONAL]);
const PATTERNS = ['stepper', 'tabs'];

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isClass = value => typeof value === 'string' && CLASS_NAME.test(value);

// Every concrete class a config makes the script toggle, by family.
function stateClassesOf(config) {
  const concrete = [];
  for (let n = 0; n < config.count; n += 1) concrete.push(config.statePrefix + n, config.fromPrefix + n);
  return [...concrete, ...STATE_KEYS.map(key => config[key]), config.startedClass, ...(config.copiedClass ? [config.copiedClass] : [])];
}

// Every class a config names, structural ones first.
function structuralClassesOf(config) {
  return [...STRUCTURE_KEYS.map(key => config[key]), ...(config.panelClass ? [config.panelClass] : []),
    ...(config.copyClass ? [config.copyClass] : []), ...config.hiddenClasses];
}

// Problems with a config, [] when it is valid. Unknown keys and wrong types are refused.
function validateStepsConfig(config) {
  if (!isPlainObject(config)) return ['config must be an object'];
  const problems = [];
  for (const key of Object.keys(config)) if (!ALLOWED.has(key)) problems.push(`unknown key ${key}`);
  for (const key of REQUIRED) if (!Object.hasOwn(config, key)) problems.push(`${key} is required`);
  for (const key of [...STRUCTURE_KEYS, 'panelClass', 'copyClass']) {
    if (Object.hasOwn(config, key) && !isClass(config[key])) problems.push(`${key} must be a class name`);
  }
  for (const key of [...STATE_KEYS, 'copiedClass', ...PREFIX_KEYS]) {
    if (Object.hasOwn(config, key) && !(typeof config[key] === 'string' && STATE_NAME.test(config[key]))) problems.push(`${key} must be an is- or has- class name`);
  }
  if (Object.hasOwn(config, 'startedClass') && config.startedClass !== 'is-inview') problems.push('startedClass must be "is-inview"');
  if (Object.hasOwn(config, 'count') && !(Number.isInteger(config.count) && config.count >= 2)) problems.push('count must be an integer of at least 2');
  if (Object.hasOwn(config, 'intervalMs') && !(Number.isInteger(config.intervalMs) && config.intervalMs > 0)) problems.push('intervalMs must be a positive integer');
  if (Object.hasOwn(config, 'onManual') && config.onManual !== 'stop') problems.push('onManual must be "stop"');
  if (Object.hasOwn(config, 'pauseOnHover') && config.pauseOnHover !== true) problems.push('pauseOnHover must be true');
  if (Object.hasOwn(config, 'pauseOnFocus') && config.pauseOnFocus !== true) problems.push('pauseOnFocus must be true');
  if (Object.hasOwn(config, 'pattern') && !PATTERNS.includes(config.pattern)) problems.push(`pattern must be one of ${PATTERNS.join(', ')}`);
  if (Object.hasOwn(config, 'labels')) {
    if (!Array.isArray(config.labels) || config.labels.some(label => typeof label !== 'string' || !label.trim())) problems.push('labels must be an array of non-empty strings');
    else if (Number.isInteger(config.count) && config.labels.length !== config.count) problems.push(`labels must have count (${config.count}) entries, not ${config.labels.length}`);
  }
  if (Object.hasOwn(config, 'hiddenClasses') && (!Array.isArray(config.hiddenClasses) || !config.hiddenClasses.every(isClass))) problems.push('hiddenClasses must be an array of class names');
  if (Object.hasOwn(config, 'copyTexts')) {
    if (!Array.isArray(config.copyTexts) || config.copyTexts.some(text => typeof text !== 'string')) problems.push('copyTexts must be an array of strings');
    else if (Number.isInteger(config.count) && config.copyTexts.length !== config.count) problems.push(`copyTexts must have count (${config.count}) entries, not ${config.copyTexts.length}`);
  }
  for (const key of ['copiedMessage', 'copyLabel']) {
    if (Object.hasOwn(config, key) && !(typeof config[key] === 'string' && config[key].trim())) problems.push(`${key} must be a non-empty string`);
  }
  const copyKeys = COPY_KEYS.filter(key => Object.hasOwn(config, key));
  if (copyKeys.length && copyKeys.length !== COPY_KEYS.length) problems.push(`the copy keys go together: missing ${COPY_KEYS.filter(key => !copyKeys.includes(key)).join(', ')}`);
  if (problems.length) return problems;
  const seen = new Set();
  for (const name of [...structuralClassesOf(config), ...stateClassesOf(config)]) {
    if (seen.has(name)) problems.push(`class ${name} is named twice`);
    seen.add(name);
  }
  return problems;
}

function buildStepsEmbedCode(config) {
  const problems = validateStepsConfig(config);
  if (problems.length) throw new TypeError(`STEPS_CONFIG_INVALID: ${problems.join('; ')}`);
  const runtimeConfig = { ...config, copiedMs: COPIED_MS, viewThreshold: VIEW_THRESHOLD, reannounceMs: REANNOUNCE_DELAY_MS, idCounter: ID_COUNTER };
  // `<` escaped so a label cannot close the script element; U+2028/U+2029 so
  // the line stays one line (preflight reads the config object from one line)
  // and parses in engines older than ES2019.
  const safe = JSON.stringify(runtimeConfig).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script>
(function () {
  'use strict';
  const config = ${safe};
  const bind = root => {
    if (root.dataset.taptopStepsBound === 'true') return;
    const items = [...root.querySelectorAll('.' + config.itemClass)];
    if (items.length !== config.count) return;
    root.dataset.taptopStepsBound = 'true';
    const panels = config.panelClass ? [...root.querySelectorAll('.' + config.panelClass)] : [];
    const tabs = config.pattern === 'tabs';
    window[config.idCounter] = (window[config.idCounter] || 0) + 1;
    const id = 'taptop-steps-' + config.rootClass + '-' + window[config.idCounter];
    const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let index = 0;
    let started = false;
    let stopped = false;
    let inView = false;
    let hovered = false;
    let focused = false;
    let timer = null;
    const aria = () => {
      items.forEach((item, n) => {
        const active = n === index;
        item.setAttribute('aria-label', config.labels[n]);
        if (tabs) {
          item.setAttribute('role', 'tab');
          item.setAttribute('aria-selected', String(active));
          item.setAttribute('tabindex', active ? '0' : '-1');
        } else {
          item.setAttribute('role', 'button');
          item.setAttribute('tabindex', '0');
          if (active) item.setAttribute('aria-current', 'step');
          else item.removeAttribute('aria-current');
        }
      });
    };
    const show = (next, previous) => {
      for (let n = 0; n < config.count; n += 1) root.classList.remove(config.statePrefix + n, config.fromPrefix + n);
      root.classList.add(config.statePrefix + next);
      if (previous !== null) root.classList.add(config.fromPrefix + previous);
      // Wrapping from the last state to the first is a step forward, not back.
      const back = previous !== null && next < previous && !(previous === config.count - 1 && next === 0);
      root.classList.toggle(config.backClass, back);
      index = next;
      aria();
    };
    const mode = manual => {
      root.classList.toggle(config.manualClass, manual);
      root.classList.toggle(config.autoClass, !manual);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = null;
      if (!started || stopped || !inView || hovered || focused) return;
      timer = window.setTimeout(() => {
        timer = null;
        show((index + 1) % config.count, index);
        schedule();
      }, config.intervalMs);
    };
    // The first entry into the view: autoplay starts unless a selection or a
    // copy already stopped it (then only startedClass is added).
    const begin = () => {
      if (started) return;
      started = true;
      root.classList.add(config.startedClass);
      if (stopped) return;
      if (reduced) { stopped = true; mode(true); return; }
      mode(false);
    };
    const select = next => {
      stopped = true;
      window.clearTimeout(timer);
      timer = null;
      mode(true);
      if (next !== index) show(next, index);
      else aria();
    };
    if (tabs) {
      const list = items[0].parentElement;
      if (list && items.every(item => item.parentElement === list)) list.setAttribute('role', 'tablist');
      items.forEach((item, n) => {
        if (!item.id) item.id = id + '-tab-' + n;
        const panel = panels[n];
        if (!panel) return;
        if (!panel.id) panel.id = id + '-panel-' + n;
        item.setAttribute('aria-controls', panel.id);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', item.id);
      });
    }
    config.hiddenClasses.forEach(name => root.querySelectorAll('.' + name).forEach(element => element.setAttribute('aria-hidden', 'true')));
    items.forEach((item, n) => {
      item.addEventListener('click', () => select(n));
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(n); return; }
        // Tabs keys of the WAI-ARIA tablist pattern: arrows wrap, Home and End jump.
        const moves = { ArrowLeft: (n - 1 + config.count) % config.count, ArrowRight: (n + 1) % config.count, Home: 0, End: config.count - 1 };
        if (!tabs || !Object.prototype.hasOwnProperty.call(moves, event.key)) return;
        event.preventDefault();
        const next = moves[event.key];
        select(next);
        items[next].focus();
      });
    });
    root.addEventListener('pointerenter', () => { hovered = true; schedule(); });
    root.addEventListener('pointerleave', () => { hovered = false; schedule(); });
    root.addEventListener('focusin', () => { focused = true; schedule(); });
    root.addEventListener('focusout', event => { focused = !!(event.relatedTarget && root.contains(event.relatedTarget)); schedule(); });
    if (config.copyClass) {
      const live = document.createElement('div');
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      live.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
      document.body.appendChild(live);
      let clear = null;
      let announce = null;
      // A copy is an interaction: it stops autoplay for good but keeps the state.
      const copy = () => {
        stopped = true;
        window.clearTimeout(timer);
        timer = null;
        mode(true);
        const clipboard = window.navigator && window.navigator.clipboard;
        if (!clipboard || !clipboard.writeText) return;
        clipboard.writeText(config.copyTexts[index]).then(() => {
          root.classList.add(config.copiedClass);
          live.textContent = '';
          window.clearTimeout(announce);
          announce = window.setTimeout(() => { live.textContent = config.copiedMessage; }, config.reannounceMs);
          window.clearTimeout(clear);
          clear = window.setTimeout(() => { root.classList.remove(config.copiedClass); live.textContent = ''; }, config.copiedMs);
        }, () => {});
      };
      root.querySelectorAll('.' + config.copyClass).forEach(control => {
        control.setAttribute('role', 'button');
        control.setAttribute('tabindex', '0');
        control.setAttribute('aria-label', config.copyLabel);
        control.addEventListener('click', copy);
        control.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); copy(); }
        });
      });
    }
    // Roles, names and tabindex from the moment the root is bound: a keyboard
    // user reaches the items before the block has ever been in view.
    show(0, null);
    const enter = visible => {
      inView = visible;
      if (visible) begin();
      schedule();
    };
    if (!('IntersectionObserver' in window)) { enter(true); return; }
    new window.IntersectionObserver(entries => entries.forEach(entry => enter(entry.isIntersecting)), { threshold: config.viewThreshold }).observe(root);
  };
  // Scripts is the first layer in Root, so this runs before the content exists.
  const init = () => document.querySelectorAll('.' + config.rootClass).forEach(bind);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>`;
}

module.exports = { buildStepsEmbedCode, validateStepsConfig, stateClassesOf, structuralClassesOf, COPIED_MS, REANNOUNCE_DELAY_MS };
