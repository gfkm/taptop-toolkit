const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildStepsEmbedCode, validateStepsConfig, COPIED_MS, REANNOUNCE_DELAY_MS } = require('../lib/steps-embed-code');
const { runEmbed } = require('../test-support/fake-dom');

// Synthetic block: neutral names and copy, no client material.
const CONFIG = Object.freeze({
  rootClass: 'demo-steps', itemClass: 'demo-steps-item', count: 3,
  statePrefix: 'is-demo-steps-s', fromPrefix: 'is-demo-steps-from', backClass: 'is-demo-steps-back',
  autoClass: 'is-demo-steps-auto', manualClass: 'is-demo-steps-manual', copiedClass: 'is-demo-steps-copied',
  startedClass: 'is-inview', intervalMs: 6000, onManual: 'stop', pauseOnHover: true, pauseOnFocus: true,
  pattern: 'stepper', labels: ['Step one', 'Step two', 'Step three'], hiddenClasses: ['demo-steps-deco'],
  panelClass: 'demo-steps-panel', copyClass: 'demo-steps-copy',
  copyTexts: ['code one', 'if (a) {\n  run(1);\n}', 'code three'], copiedMessage: 'Copied note', copyLabel: 'Copy label'
});
const COPY_KEYS = ['copyClass', 'copiedClass', 'copyTexts', 'copiedMessage', 'copyLabel'];
const without = (...keys) => Object.fromEntries(Object.entries(config()).filter(([key]) => !keys.includes(key)));
const config = changes => ({ ...structuredClone(CONFIG), ...changes });

// root > list > 3 items; 3 panels with code in no-break spaces; copy control; a decorative layer.
function block(h, prefix = 'demo-steps') {
  return h('div', `${prefix} is-${prefix}-s0 is-${prefix}-manual`, [
    h('div', `${prefix}-list`, [0, 1, 2].map(n => h('div', `${prefix}-item`, `Item ${n + 1}`))),
    h('div', `${prefix}-panels`, [0, 1, 2].map(n => h('div', `${prefix}-panel`, `line  ${n}`))),
    h('div', `${prefix}-copy`, 'Copy'),
    h('div', `${prefix}-deco`, '')
  ]);
}
const start = (options = {}, changes = {}) => {
  const page = runEmbed(buildStepsEmbedCode(config(changes)), h => block(h), options);
  const root = page.document.querySelector('.demo-steps');
  const items = root.querySelectorAll('.demo-steps-item');
  const panels = root.querySelectorAll('.demo-steps-panel');
  return { ...page, root, items, panels, has: name => root.classList.contains(name) };
};
const stateOf = root => [...root.classList].filter(name => /^is-demo-steps-(s\d+|from.*|back)$/.test(name)).sort();

// ----- config -----

test('a complete steps config is valid and builds a script with its config object', () => {
  assert.deepEqual(validateStepsConfig(config()), []);
  const code = buildStepsEmbedCode(config());
  assert.match(code, /const config = \{[^\n]*"rootClass":"demo-steps"/);
  assert.match(code, /IntersectionObserver/);
});

test('the copy keys are optional together, and panelClass is optional on its own', () => {
  assert.deepEqual(validateStepsConfig(without(...COPY_KEYS, 'panelClass')), []);
  assert.deepEqual(validateStepsConfig(without(...COPY_KEYS)), []);
  assert.deepEqual(validateStepsConfig(without('panelClass')), [], 'copy no longer needs panels');
});

test('every required key is required', () => {
  for (const key of ['rootClass', 'itemClass', 'count', 'statePrefix', 'fromPrefix', 'backClass', 'autoClass', 'manualClass',
    'startedClass', 'intervalMs', 'onManual', 'pauseOnHover', 'pauseOnFocus', 'pattern', 'labels', 'hiddenClasses']) {
    const broken = config();
    delete broken[key];
    assert.ok(validateStepsConfig(broken).some(problem => problem.includes(key)), `missing ${key} is refused`);
    assert.throws(() => buildStepsEmbedCode(broken), /STEPS_CONFIG_INVALID/);
  }
});

test('an unknown key is refused', () => {
  assert.ok(validateStepsConfig(config({ autoplay: true })).some(problem => problem.includes('autoplay')));
  assert.throws(() => buildStepsEmbedCode(config({ autoplay: true })), /STEPS_CONFIG_INVALID/);
});

test('wrong types and values are refused', () => {
  const wrong = {
    rootClass: ['a b', 7, ''], itemClass: ['.item', null], count: [1, 2.5, '3', 0], statePrefix: ['demo-s', 'is s', 3],
    fromPrefix: ['from', ''], backClass: ['back', 'is back'], autoClass: ['auto'], manualClass: ['manual'],
    copiedClass: ['copied', 5], startedClass: ['is-started', 'is-inview '], intervalMs: [0, -1, 1.5, '6000'],
    onManual: ['pause', true], pauseOnHover: [false, 'true'], pauseOnFocus: [false, 1], pattern: ['carousel', ''],
    labels: ['Step', ['Step one', 'Step two'], ['Step one', '', 'Step three'], ['Step one', 2, 'Step three']],
    hiddenClasses: ['demo-steps-deco', ['a b'], [3]], panelClass: ['a b', 4], copyClass: ['a b', false],
    copyTexts: ['code', ['one', 'two'], ['one', 2, 'three']], copiedMessage: ['', '  ', 3], copyLabel: ['', null]
  };
  for (const [key, values] of Object.entries(wrong)) {
    for (const value of values) {
      assert.ok(validateStepsConfig(config({ [key]: value })).length > 0, `${key} = ${JSON.stringify(value)} is refused`);
    }
  }
});

test('labels and copyTexts must match count, and the copy keys go together', () => {
  assert.ok(validateStepsConfig(config({ count: 4 })).some(problem => problem.includes('labels')));
  assert.ok(validateStepsConfig(config({ count: 4, labels: ['a', 'b', 'c', 'd'] })).some(problem => problem.includes('copyTexts')));
  for (const key of COPY_KEYS) {
    assert.ok(validateStepsConfig(without(key)).some(problem => problem.includes(key)), `copy without ${key} is refused`);
  }
});

test('state classes must be distinct', () => {
  assert.ok(validateStepsConfig(config({ autoClass: 'is-demo-steps-manual' })).length > 0);
  assert.ok(validateStepsConfig(config({ backClass: 'is-demo-steps-s1' })).length > 0);
  assert.ok(validateStepsConfig(config({ fromPrefix: 'is-demo-steps-s' })).length > 0);
  assert.ok(validateStepsConfig(config({ rootClass: 'demo-steps-item' })).length > 0);
});

test('the script keeps a < in a label from closing its script element', () => {
  const code = buildStepsEmbedCode(config({ labels: ['</script><b>', 'Step two', 'Step three'] }));
  assert.equal(code.match(/<\/script>/g).length, 1);
});

// ----- runtime -----

test('nothing changes before the block is in view; entering the view starts state 0 in auto mode', () => {
  const page = start();
  assert.equal(page.has('is-inview'), false);
  page.clock.advance(30000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
  page.view(page.root, true);
  assert.equal(page.has('is-inview'), true);
  assert.equal(page.has('is-demo-steps-auto'), true);
  assert.equal(page.has('is-demo-steps-manual'), false);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
});

test('autoplay switches every intervalMs, sets from, and wraps without back', () => {
  const page = start();
  page.view(page.root, true);
  page.clock.advance(5999);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
  page.clock.advance(1);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
  page.clock.advance(6000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from1', 'is-demo-steps-s2']);
  page.clock.advance(6000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from2', 'is-demo-steps-s0']);
  assert.equal(page.has('is-demo-steps-auto'), true);
});

test('hovering pauses autoplay and leaving resumes it with a full interval', () => {
  const page = start();
  page.view(page.root, true);
  page.clock.advance(3000);
  page.fire(page.root, 'pointerenter', { bubbles: false });
  page.clock.advance(20000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
  page.fire(page.root, 'pointerleave', { bubbles: false });
  page.clock.advance(5999);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
  page.clock.advance(1);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
});

test('keyboard focus inside pauses autoplay without stopping it; hover and focus combine', () => {
  const page = start();
  page.view(page.root, true);
  page.items[1].focus();
  page.clock.advance(20000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
  assert.equal(page.has('is-demo-steps-auto'), true);
  page.fire(page.root, 'pointerenter', { bubbles: false });
  page.items[1].blur();
  page.clock.advance(20000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0'], 'still hovered');
  page.fire(page.root, 'pointerleave', { bubbles: false });
  page.clock.advance(6000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
});

test('leaving the view pauses autoplay; coming back resumes it without restarting', () => {
  const page = start();
  page.view(page.root, true);
  page.clock.advance(6000);
  page.view(page.root, false);
  page.clock.advance(60000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
  page.view(page.root, true);
  assert.equal(page.has('is-inview'), true);
  page.clock.advance(6000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from1', 'is-demo-steps-s2']);
});

test('a click on an item shows its state, switches to manual and stops autoplay for good', () => {
  const page = start();
  page.view(page.root, true);
  page.clock.advance(6000);
  page.items[0].click();
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-back', 'is-demo-steps-from1', 'is-demo-steps-s0']);
  assert.equal(page.has('is-demo-steps-manual'), true);
  assert.equal(page.has('is-demo-steps-auto'), false);
  page.fire(page.root, 'pointerenter', { bubbles: false });
  page.fire(page.root, 'pointerleave', { bubbles: false });
  page.view(page.root, false);
  page.view(page.root, true);
  page.clock.advance(120000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-back', 'is-demo-steps-from1', 'is-demo-steps-s0']);
  page.items[2].click();
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s2']);
  page.items[0].click();
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from2', 'is-demo-steps-s0'], 'last → first is not back');
  page.items[1].click();
  page.items[0].click();
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-back', 'is-demo-steps-from1', 'is-demo-steps-s0']);
});

test('Enter and Space on a stepper item select it and stop autoplay; other keys do nothing', () => {
  const page = start();
  page.view(page.root, true);
  assert.equal(page.key(page.items[1], 'a').defaultPrevented, false);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
  assert.equal(page.key(page.items[2], 'Enter').defaultPrevented, true);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s2']);
  assert.equal(page.has('is-demo-steps-manual'), true);
  assert.equal(page.key(page.items[1], ' ').defaultPrevented, true);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-back', 'is-demo-steps-from2', 'is-demo-steps-s1']);
  page.clock.advance(60000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-back', 'is-demo-steps-from2', 'is-demo-steps-s1']);
});

test('reduced motion keeps state 0 in manual mode without a timer; clicks still work', () => {
  const page = start({ reducedMotion: true });
  page.view(page.root, true);
  assert.equal(page.has('is-inview'), true);
  assert.equal(page.has('is-demo-steps-manual'), true);
  assert.equal(page.has('is-demo-steps-auto'), false);
  assert.equal(page.clock.pending(), 0);
  page.clock.advance(60000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
  page.items[1].click();
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
});

test('without IntersectionObserver the block starts at once', () => {
  const page = start({ intersectionObserver: false });
  assert.equal(page.has('is-inview'), true);
  page.clock.advance(6000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
});

test('stepper ARIA: buttons with labels, aria-current on the active step, decorative layers hidden', () => {
  const page = start();
  page.view(page.root, true);
  page.items.forEach((item, n) => {
    assert.equal(item.getAttribute('role'), 'button');
    assert.equal(item.getAttribute('tabindex'), '0');
    assert.equal(item.getAttribute('aria-label'), CONFIG.labels[n]);
  });
  assert.deepEqual(page.items.map(item => item.getAttribute('aria-current')), ['step', null, null]);
  page.clock.advance(6000);
  assert.deepEqual(page.items.map(item => item.getAttribute('aria-current')), [null, 'step', null]);
  assert.equal(page.root.querySelector('.demo-steps-deco').getAttribute('aria-hidden'), 'true');
});

test('tabs ARIA: tablist on the items parent, roving tabindex, selected tab, panels, arrow keys wrap', () => {
  const page = start({}, { pattern: 'tabs' });
  page.view(page.root, true);
  const list = page.root.querySelector('.demo-steps-list');
  assert.equal(list.getAttribute('role'), 'tablist');
  assert.deepEqual(page.items.map(item => item.getAttribute('role')), ['tab', 'tab', 'tab']);
  assert.deepEqual(page.items.map(item => item.getAttribute('aria-selected')), ['true', 'false', 'false']);
  assert.deepEqual(page.items.map(item => item.getAttribute('tabindex')), ['0', '-1', '-1']);
  assert.deepEqual(page.panels.map(panel => panel.getAttribute('role')), ['tabpanel', 'tabpanel', 'tabpanel']);
  page.panels.forEach((panel, n) => {
    assert.equal(panel.getAttribute('aria-labelledby'), page.items[n].id);
    assert.equal(page.items[n].getAttribute('aria-controls'), panel.id);
  });
  page.items[0].focus();
  assert.equal(page.key(page.items[0], 'ArrowLeft').defaultPrevented, true);
  assert.equal(page.document.activeElement, page.items[2]);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s2']);
  assert.equal(page.has('is-demo-steps-manual'), true);
  page.key(page.items[2], 'ArrowRight');
  assert.equal(page.document.activeElement, page.items[0]);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from2', 'is-demo-steps-s0']);
  assert.deepEqual(page.items.map(item => item.getAttribute('tabindex')), ['0', '-1', '-1']);
  page.clock.advance(60000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from2', 'is-demo-steps-s0']);
});

test('arrow keys do nothing on a stepper', () => {
  const page = start();
  page.view(page.root, true);
  assert.equal(page.key(page.items[0], 'ArrowRight').defaultPrevented, false);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
});

test('copy writes copyTexts of the active state verbatim, sets the copied class for COPIED_MS and announces copiedMessage', async () => {
  const page = start();
  page.view(page.root, true);
  page.clock.advance(6000);
  const copy = page.root.querySelector('.demo-steps-copy');
  assert.equal(copy.getAttribute('role'), 'button');
  assert.equal(copy.getAttribute('tabindex'), '0');
  assert.equal(copy.getAttribute('aria-label'), 'Copy label');
  const live = page.document.body.descendants().find(node => node.getAttribute('aria-live') === 'polite');
  assert.ok(live, 'the live region exists from bind');
  assert.equal(live.textContent, '');
  copy.click();
  await page.flush();
  assert.deepEqual(page.copied, ['if (a) {\n  run(1);\n}'], 'the config text, not the panel DOM');
  assert.equal(page.has('is-demo-steps-copied'), true);
  assert.equal(live.textContent, '', 'cleared first');
  page.clock.advance(REANNOUNCE_DELAY_MS);
  assert.equal(live.textContent, 'Copied note');
  assert.equal(COPIED_MS, 1600);
  page.clock.advance(COPIED_MS - REANNOUNCE_DELAY_MS - 1);
  assert.equal(page.has('is-demo-steps-copied'), true);
  page.clock.advance(1);
  assert.equal(page.has('is-demo-steps-copied'), false);
  assert.equal(live.textContent, '', 'the announcement clears with the copied state');
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1'], 'copy keeps the state');
  assert.equal(page.has('is-demo-steps-manual'), true, 'copy stops autoplay');
  assert.equal(page.has('is-demo-steps-auto'), false);
  page.clock.advance(60000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1'], 'and for good');
  page.key(copy, 'Enter');
  await page.flush();
  assert.equal(page.copied.length, 2, 'Enter on the copy control copies too');
});

test('a repeated copy clears the live region and writes the same message again', async () => {
  const page = start();
  page.view(page.root, true);
  const copy = page.root.querySelector('.demo-steps-copy');
  const live = page.document.body.descendants().find(node => node.getAttribute('aria-live') === 'polite');
  copy.click();
  await page.flush();
  page.clock.advance(REANNOUNCE_DELAY_MS);
  assert.equal(live.textContent, 'Copied note');
  copy.click();
  await page.flush();
  assert.equal(live.textContent, '', 'cleared before the repeat');
  page.clock.advance(REANNOUNCE_DELAY_MS);
  assert.equal(live.textContent, 'Copied note');
  page.clock.advance(COPIED_MS - REANNOUNCE_DELAY_MS);
  assert.equal(live.textContent, '');
  assert.equal(page.has('is-demo-steps-copied'), false);
  assert.equal(page.document.body.descendants().filter(node => node.getAttribute('aria-live') === 'polite').length, 1, 'one region per root');
});

test('the message is written before the copied state clears', () => {
  assert.ok(REANNOUNCE_DELAY_MS < COPIED_MS, 'otherwise the message lands after the clear and stays');
});

test('no live region without a copy control', () => {
  const page = runEmbed(buildStepsEmbedCode(without(...COPY_KEYS)), h => block(h));
  assert.equal(page.document.body.descendants().filter(node => node.getAttribute('aria-live')).length, 0);
});

test('U+2028 and U+2029 in the config are escaped in the script and copied back as they are', async () => {
  const text = 'a\u2028b\u2029c';
  const code = buildStepsEmbedCode(config({ copyTexts: [text, 'two', 'three'] }));
  assert.doesNotMatch(code, /[\u2028\u2029]/);
  const page = runEmbed(code, h => block(h));
  page.document.querySelector('.demo-steps-copy').click();
  await page.flush();
  assert.deepEqual(page.copied, [text]);
});

test('Home and End on tabs move focus and state to the first and last tab and stop autoplay', () => {
  const page = start({}, { pattern: 'tabs' });
  page.view(page.root, true);
  page.items[1].focus();
  assert.equal(page.key(page.items[1], 'End').defaultPrevented, true);
  assert.equal(page.document.activeElement, page.items[2]);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s2']);
  assert.equal(page.has('is-demo-steps-manual'), true);
  page.key(page.items[2], 'Home');
  assert.equal(page.document.activeElement, page.items[0]);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from2', 'is-demo-steps-s0']);
  page.clock.advance(60000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from2', 'is-demo-steps-s0']);
  const stepper = start();
  assert.equal(stepper.key(stepper.items[0], 'End').defaultPrevented, false, 'not on a stepper');
});

test('with count 2, going from state 1 to state 0 is never back, for autoplay and manual selection alike', () => {
  const two = { count: 2, labels: ['One', 'Two'], copyTexts: ['one', 'two'] };
  const twoBlock = h => h('div', 'demo-steps is-demo-steps-s0 is-demo-steps-manual', [
    h('div', 'demo-steps-list', [h('div', 'demo-steps-item', 'Item 1'), h('div', 'demo-steps-item', 'Item 2')]),
    h('div', 'demo-steps-panels', [h('div', 'demo-steps-panel', 'One'), h('div', 'demo-steps-panel', 'Two')]),
    h('div', 'demo-steps-copy', 'Copy'), h('div', 'demo-steps-deco', '')
  ]);
  const page = runEmbed(buildStepsEmbedCode(config(two)), twoBlock);
  const root = page.document.querySelector('.demo-steps');
  page.view(root, true);
  page.clock.advance(6000);
  assert.deepEqual(stateOf(root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
  page.clock.advance(6000);
  assert.deepEqual(stateOf(root), ['is-demo-steps-from1', 'is-demo-steps-s0'], 'autoplay wrap');
  root.querySelectorAll('.demo-steps-item')[1].click();
  root.querySelectorAll('.demo-steps-item')[0].click();
  assert.deepEqual(stateOf(root), ['is-demo-steps-from1', 'is-demo-steps-s0'], 'manual last → first');
});

test('running the same script twice binds each root once', () => {
  const code = buildStepsEmbedCode(config());
  const page = runEmbed([code, code], h => block(h));
  const root = page.document.querySelector('.demo-steps');
  // Without the bound guard the second script would bind again: a second observer, a second timer.
  assert.equal(page.observers.filter(observer => observer.targets.includes(root)).length, 1, 'one binding observes the root');
  page.view(root, true);
  page.clock.advance(6000);
  assert.deepEqual(stateOf(root), ['is-demo-steps-from0', 'is-demo-steps-s1'], 'one timer, one step');
  root.querySelectorAll('.demo-steps-item')[2].click();
  assert.deepEqual(stateOf(root), ['is-demo-steps-from1', 'is-demo-steps-s2']);
});

test('tab and panel ids are unique across two embeds and across two roots of one embed', () => {
  const other = config({ rootClass: 'demo-alt', itemClass: 'demo-alt-item', panelClass: 'demo-alt-panel', copyClass: 'demo-alt-copy',
    hiddenClasses: ['demo-alt-deco'], pattern: 'tabs' });
  const page = runEmbed([buildStepsEmbedCode(config({ pattern: 'tabs' })), buildStepsEmbedCode(other)],
    h => [block(h), block(h), block(h, 'demo-alt')]);
  const ids = page.document.body.descendants().map(node => node.getAttribute('id')).filter(Boolean);
  assert.equal(ids.length, 3 * 6, 'three tab roots, three tabs and three panels each');
  assert.equal(new Set(ids).size, ids.length, ids.join(' '));
  for (const root of page.document.body.children) {
    for (const tab of root.querySelectorAll('.' + root.classList.names[0] + '-item')) {
      const panel = page.document.body.descendants().find(node => node.getAttribute('id') === tab.getAttribute('aria-controls'));
      assert.ok(root.contains(panel), 'aria-controls stays inside its own root');
      assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
    }
  }
});

test('a failed clipboard write sets no copied class', async () => {
  const page = start({ clipboard: false });
  page.view(page.root, true);
  page.root.querySelector('.demo-steps-copy').click();
  await page.flush();
  assert.equal(page.has('is-demo-steps-copied'), false);
  assert.equal(page.has('is-demo-steps-manual'), true, 'the click still stops autoplay');
});

test('the adapter core carries no copy text of its own', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/steps-embed-code.js'), 'utf8');
  assert.doesNotMatch(source, /[\u0400-\u04FF]/, 'no Cyrillic literal in the core');
  const code = buildStepsEmbedCode(without(...COPY_KEYS));
  assert.doesNotMatch(code, /Copied note|Copy label/);
});

test('ARIA and keyboard reachability are set when the root is bound, before it enters the view', () => {
  const page = start();
  page.items.forEach((item, n) => {
    assert.equal(item.getAttribute('role'), 'button');
    assert.equal(item.getAttribute('tabindex'), '0');
    assert.equal(item.getAttribute('aria-label'), CONFIG.labels[n]);
  });
  assert.deepEqual(page.items.map(item => item.getAttribute('aria-current')), ['step', null, null]);
  assert.equal(page.root.querySelector('.demo-steps-deco').getAttribute('aria-hidden'), 'true');
  const copy = page.root.querySelector('.demo-steps-copy');
  assert.deepEqual([copy.getAttribute('role'), copy.getAttribute('tabindex'), copy.getAttribute('aria-label')], ['button', '0', 'Copy label']);
  assert.equal(page.has('is-inview'), false);
  assert.equal(page.has('is-demo-steps-manual'), true, 'the editor state stays until start');

  const tabs = start({}, { pattern: 'tabs' });
  assert.equal(tabs.root.querySelector('.demo-steps-list').getAttribute('role'), 'tablist');
  assert.deepEqual(tabs.items.map(item => [item.getAttribute('role'), item.getAttribute('aria-selected'), item.getAttribute('tabindex')]),
    [['tab', 'true', '0'], ['tab', 'false', '-1'], ['tab', 'false', '-1']]);
  assert.deepEqual(tabs.panels.map(panel => panel.getAttribute('role')), ['tabpanel', 'tabpanel', 'tabpanel']);
});

test('keyboard focus before the start lands on an item and keeps autoplay paused once the block starts', () => {
  const page = start();
  page.items[0].focus();
  assert.equal(page.document.activeElement, page.items[0], 'the item is focusable before the start');
  page.view(page.root, true);
  assert.equal(page.has('is-inview'), true);
  assert.equal(page.has('is-demo-steps-auto'), true);
  page.clock.advance(20000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0'], 'paused while focused');
  page.items[0].blur();
  page.clock.advance(6000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
});

test('a selection before the start stops autoplay; the later start adds only startedClass', () => {
  for (const act of [page => page.items[1].click(), page => page.key(page.items[1], 'Enter')]) {
    const page = start();
    act(page);
    assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
    assert.equal(page.has('is-inview'), false);
    page.view(page.root, true);
    assert.equal(page.has('is-inview'), true);
    assert.equal(page.has('is-demo-steps-manual'), true);
    assert.equal(page.has('is-demo-steps-auto'), false);
    assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1'], 'not reset to state 0');
    page.clock.advance(60000);
    assert.deepEqual(stateOf(page.root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
  }
});

test('focus moving from one item to another inside the root keeps autoplay paused', () => {
  const page = start();
  page.view(page.root, true);
  page.items[0].focus();
  // Only the focusout half of the move: its relatedTarget is inside the root.
  page.fire(page.items[0], 'focusout', { relatedTarget: page.items[1] });
  page.clock.advance(20000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
  page.items[1].focus();
  page.clock.advance(20000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
});

test('a rejected clipboard write sets no copied class and says nothing, but the click still stops autoplay', async () => {
  const page = start({ clipboard: 'reject' });
  page.view(page.root, true);
  page.root.querySelector('.demo-steps-copy').click();
  await page.flush();
  assert.equal(page.has('is-demo-steps-copied'), false);
  const live = page.document.body.descendants().find(node => node.getAttribute('aria-live') === 'polite');
  assert.ok(!live || live.textContent === '', 'no announcement');
  assert.equal(page.has('is-demo-steps-manual'), true);
  page.clock.advance(60000);
  assert.deepEqual(stateOf(page.root), ['is-demo-steps-s0']);
});

test('the script waits for DOMContentLoaded while the document is loading', () => {
  const page = runEmbed(buildStepsEmbedCode(config()), h => block(h), { readyState: 'loading' });
  const root = page.document.querySelector('.demo-steps');
  assert.equal(root.querySelector('.demo-steps-item').getAttribute('role'), null, 'not bound yet');
  assert.equal(page.observers.length, 0);
  page.ready();
  assert.equal(root.querySelector('.demo-steps-item').getAttribute('role'), 'button');
  page.view(root, true);
  page.clock.advance(6000);
  assert.deepEqual(stateOf(root), ['is-demo-steps-from0', 'is-demo-steps-s1']);
});

test('several roots on one page run independently', () => {
  const code = buildStepsEmbedCode(config());
  const page = runEmbed(code, h => [block(h), block(h)]);
  const [first, second] = page.document.querySelectorAll('.demo-steps');
  page.view(first, true);
  page.view(second, true);
  page.fire(first, 'pointerenter', { bubbles: false });
  page.clock.advance(6000);
  assert.deepEqual(stateOf(first), ['is-demo-steps-s0']);
  assert.deepEqual(stateOf(second), ['is-demo-steps-from0', 'is-demo-steps-s1']);
  second.querySelectorAll('.demo-steps-item')[0].click();
  page.fire(first, 'pointerleave', { bubbles: false });
  page.clock.advance(6000);
  assert.deepEqual(stateOf(first), ['is-demo-steps-from0', 'is-demo-steps-s1']);
  assert.deepEqual(stateOf(second), ['is-demo-steps-back', 'is-demo-steps-from1', 'is-demo-steps-s0']);
});

test('a root whose item count differs from count is left in its editor state', () => {
  const page = runEmbed(buildStepsEmbedCode(config({ count: 4, labels: ['a', 'b', 'c', 'd'], copyTexts: ['a', 'b', 'c', 'd'] })), h => block(h));
  const root = page.document.querySelector('.demo-steps');
  page.view(root, true);
  page.clock.advance(60000);
  assert.deepEqual(stateOf(root), ['is-demo-steps-s0']);
  assert.equal(root.classList.contains('is-demo-steps-manual'), true);
});
