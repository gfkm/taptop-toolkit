const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeHtmlSource } = require('../lib/html-normalizer');
const { initProject } = require('../lib/project');
const { addArtifact } = require('../lib/project-artifacts');
const { buildArtifact } = require('../lib/build-artifact');
const { preflightImportPackage } = require('../lib/import-package-preflight');
const { tempWorkspace, write } = require('../test-support/managed-project');

// Synthetic steps block in the shape the canvas converter emits (contract C2):
// state 0 on the root, items sharing one class, config JSON on the root.
const CONFIG = Object.freeze({
  rootClass: 'demo-steps', itemClass: 'demo-steps-item', count: 3,
  statePrefix: 'is-demo-steps-s', fromPrefix: 'is-demo-steps-from', backClass: 'is-demo-steps-back',
  autoClass: 'is-demo-steps-auto', manualClass: 'is-demo-steps-manual', copiedClass: 'is-demo-steps-copied',
  startedClass: 'is-inview', intervalMs: 6000, onManual: 'stop', pauseOnHover: true, pauseOnFocus: true,
  pattern: 'tabs', labels: ['Step one', 'Step two', 'Step three'], hiddenClasses: ['demo-steps-deco'],
  panelClass: 'demo-steps-panel', copyClass: 'demo-steps-copy',
  copyTexts: ['code one', 'code\n  two', 'code three'], copiedMessage: 'Copied note', copyLabel: 'Copy label'
});
const attribute = value => JSON.stringify(value).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
const page = body => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
function block({ config = CONFIG, classes = {}, rootExtra = '', items = 3, panels = 3, raw } = {}) {
  const c = { root: 'demo-steps', item: 'demo-steps-item', panel: 'demo-steps-panel', copy: 'demo-steps-copy', deco: 'demo-steps-deco', ...classes };
  const data = raw !== undefined ? raw : attribute(config);
  const dataAttr = data === null ? '' : ` data-taptop-steps='${data}'`;
  return page(`<div class="${c.root} is-demo-steps-s0 is-demo-steps-manual${rootExtra}" data-taptop-behavior="steps"${dataAttr}>`
    + `<div class="demo-steps-list">${Array.from({ length: items }, (_, n) => `<div class="${c.item}">Item ${n + 1}</div>`).join('')}</div>`
    + `<div class="demo-steps-panels">${Array.from({ length: panels }, (_, n) => `<div class="${c.panel}">Panel ${n + 1}</div>`).join('')}</div>`
    + `<div class="${c.copy}">Copy</div><div class="${c.deco}"></div></div>`);
}
const CSS = [
  '.demo-steps { display: flex; }',
  '.demo-steps-panel { display: none; }',
  '.demo-steps.is-demo-steps-s0 .demo-steps-panel:nth-child(1) { display: block; }',
  '.demo-steps.is-demo-steps-s1 .demo-steps-panel:nth-child(2) { display: block; }',
  '.demo-steps.is-demo-steps-s2 .demo-steps-panel:nth-child(3) { display: block; }'
].join('\n');
const normalize = (html, { css = CSS, external } = {}) => normalizeHtmlSource({
  htmlText: html, stylesheets: [{ label: 'page.css', text: css }],
  ...(external ? { externalStylesheets: [{ label: 'design-system/target.css', text: external, href: '../../../design-system/target.css' }] } : {})
});
const steps = result => result.behaviors.behaviors.filter(item => item.adapter === 'taptop/embed-steps-v1');
const refusals = result => result.report.items.filter(item => item.code === 'STEPS_CONFIG_INVALID');

test('the normalizer declares a steps behavior from data-taptop-steps and drops the attribute quietly', async () => {
  const result = await normalize(block());
  assert.equal(result.report.ok, true, JSON.stringify(result.report.items.filter(item => item.level === 'error')));
  const [behavior] = steps(result);
  assert.ok(behavior, 'steps behavior declared');
  assert.match(behavior.key, /^steps\//);
  assert.deepEqual(behavior.config, CONFIG);
  assert.equal(behavior.nodeKeys.length, 1 + 3 + 3 + 1, 'root, items, panels and the copy control');
  assert.doesNotMatch(result.html, /data-taptop-steps/);
  const removed = result.report.items.filter(item => item.code === 'ATTRIBUTE_REMOVED').flatMap(item => [item.decision, ...(item.samples || [])]);
  assert.ok(!removed.some(text => /data-taptop-steps/.test(text)), 'the config attribute is not reported as a lost attribute');
  assert.match(result.embedCss, /\.demo-steps\.is-demo-steps-s1 \.demo-steps-panel:nth-child\(2\)/);
});

test('classes the normalizer renames are renamed in the config too', async () => {
  // `badge` and `link` are Taptop base classes: the normalizer renames them u-badge and u-link.
  const config = { ...structuredClone(CONFIG), itemClass: 'badge', hiddenClasses: ['link'] };
  const result = await normalize(block({ config, classes: { item: 'badge', deco: 'link' } }), { css: `${CSS}\n.badge { color: #111111; }` });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.items.filter(item => item.level === 'error')));
  const [behavior] = steps(result);
  assert.equal(behavior.config.itemClass, 'u-badge');
  assert.deepEqual(behavior.config.hiddenClasses, ['u-link']);
});

test('renamed root, panel and copy classes are renamed in the config too', async () => {
  // section, container and link are Taptop base classes too.
  const config = { ...structuredClone(CONFIG), rootClass: 'section', panelClass: 'container', copyClass: 'link' };
  const css = CSS.replaceAll('.demo-steps.', '.section.').replace('.demo-steps {', '.section {').replaceAll('.demo-steps-panel', '.container');
  const result = await normalize(block({ config, classes: { root: 'section', panel: 'container', copy: 'link' } }), { css });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.items.filter(item => item.level === 'error')));
  const [behavior] = steps(result);
  assert.deepEqual([behavior.config.rootClass, behavior.config.panelClass, behavior.config.copyClass], ['u-section', 'u-container', 'u-link']);
  assert.match(result.embedCss, /\.u-section\.is-demo-steps-s1 \.u-container/);
});

test('a state class the normalizer would respell breaks its prefix and is refused by name', async () => {
  // Taptop respells a trailing -0 / -1: is-demo-s-0 would become is-demo-s_0, so the prefix is-demo-s- breaks.
  const config = { ...structuredClone(CONFIG), statePrefix: 'is-demo-s-' };
  const html = block({ config }).replace('is-demo-steps-s0', 'is-demo-s-0');
  const result = await normalize(html, { css: CSS.replaceAll('is-demo-steps-s', 'is-demo-s-') });
  assert.equal(steps(result).length, 0);
  assert.equal(result.report.ok, false);
  assert.match(refusals(result).map(item => item.reason).join(' '), /is-demo-s-0/);
});

test('a configured state class with a reserved name is refused, not renamed', async () => {
  const config = { ...structuredClone(CONFIG), manualClass: 'is-active' };
  const html = block({ config }).replace('is-demo-steps-manual', 'is-active');
  const result = await normalize(html);
  assert.equal(steps(result).length, 0);
  assert.match(refusals(result).map(item => item.reason).join(' '), /is-active/);
});

test('a class the config names but the block lacks is refused by name', async () => {
  for (const [key, missing] of [['itemClass', 'demo-steps-itme'], ['hiddenClasses', 'demo-steps-ornament'], ['copyClass', 'demo-steps-clip']]) {
    const config = { ...structuredClone(CONFIG), [key]: key === 'hiddenClasses' ? [missing] : missing };
    const result = await normalize(block({ config }));
    assert.equal(steps(result).length, 0, missing);
    assert.match(refusals(result).map(item => item.reason).join(' '), new RegExp(missing));
  }
});

test('the root must carry state 0, and items and panels must match count', async () => {
  const noState = await normalize(block().replace(' is-demo-steps-s0', ''));
  assert.match(refusals(noState).map(item => item.reason).join(' '), /is-demo-steps-s0/);
  const fewerItems = await normalize(block({ items: 2 }));
  assert.match(refusals(fewerItems).map(item => item.reason).join(' '), /demo-steps-item/);
  const morePanels = await normalize(block({ panels: 4 }));
  assert.match(refusals(morePanels).map(item => item.reason).join(' '), /demo-steps-panel/);
});

test('a missing, unreadable or invalid config is refused', async () => {
  for (const raw of [null, '{not json', attribute({ ...CONFIG, autoplay: true }), attribute({ ...CONFIG, count: 1 })]) {
    const result = await normalize(block({ raw }));
    assert.equal(steps(result).length, 0, String(raw));
    assert.equal(refusals(result).length, 1, String(raw));
    assert.equal(result.report.ok, false);
  }
});

test('a configured class that belongs to the external stylesheet is refused', async () => {
  const result = await normalize(block(), { external: '.demo-steps-item { color: #000000; }' });
  assert.equal(steps(result).length, 0);
  assert.match(refusals(result).map(item => item.reason).join(' '), /demo-steps-item/);
});

test('a state class the external stylesheet uses on the root is EXTERNAL_STATE_CLASS', async () => {
  const result = await normalize(block(), { external: '.is-demo-steps-s1 { color: #000000; }' });
  assert.equal(steps(result).length, 0);
  assert.ok(result.report.items.some(item => item.code === 'EXTERNAL_STATE_CLASS' && /is-demo-steps-s1/.test(item.reason)));
});

test('a managed build ships the steps script as a behavior Embed that passes preflight', async t => {
  const workspace = tempWorkspace(t, 'taptop-steps-');
  const root = path.join(workspace, 'projects', 'synthetic-site');
  initProject(root, 'synthetic-site');
  write(root, 'input/demo/index.html', block());
  write(root, 'input/demo/styles.css', CSS);
  addArtifact(root, { key: 'pages/demo', html: 'input/demo/index.html', stylesheets: ['input/demo/styles.css'] });
  const built = await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, built.jsonPath), 'utf8'));
  assert.equal(preflightImportPackage(pkg).ok, true, preflightImportPackage(pkg).errors.join('; '));
  const item = pkg.behaviorPackages.find(entry => entry.adapter === 'taptop/embed-steps-v1');
  assert.ok(item, 'steps behavior package');
  const tree = item.clipboardData.copiedLayout.tree;
  assert.match(tree.tags[tree.root].embedCode, /"itemClass":"demo-steps-item"/);
});
