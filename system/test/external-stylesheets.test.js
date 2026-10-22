const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const postcss = require('postcss');
const { initProject } = require('../lib/project');
const { addArtifact, getArtifact, readArtifacts } = require('../lib/project-artifacts');
const { buildArtifact } = require('../lib/build-artifact');
const { compileProject } = require('../lib/compile-project');
const { artifactStatuses, readCatalog } = require('../lib/output-catalog');
const { normalizeHtmlSource } = require('../lib/html-normalizer');
const { preflightImportPackage } = require('../lib/import-package-preflight');
const { selectorUsesClass } = require('../lib/build-compiler-identity-manifest');
const { tempWorkspace, write } = require('../test-support/managed-project');

// Synthetic stand-in for a target site's own class library: the site-* classes
// exist on the target; the page may use them by name but never restyle them.
const TARGET_CSS = [
  'body { margin: 0; font-family: Arial; }',
  '.site-title { font-weight: 500; font-size: 20px; line-height: 24px; }',
  '.site-title:hover { color: #224466; }',
  '.site-body { font-size: 16px; line-height: 22px; margin-top: 4px; }',
  '.site-card { padding: 24px; border-radius: 12px; background-color: #f4f4f4; }',
  '.site-unused { color: #0000ff; }',
  '.site-tab.is-current { color: #aa0000; }',
  '.site-mark::before { content: ""; }',
  '@media (max-width: 767px) { .site-title { font-size: 16px; line-height: 20px; } }'
].join('\n');
const PAGE_HTML = '<!doctype html><html><head><title>Demo</title></head><body><section class="demo-page"><div class="demo-card site-card"><h2 class="demo-title site-title">Example heading</h2><p class="demo-text site-body">Example text</p></div></section></body></html>';
const PAGE_CSS = '.demo-page { display: block; }\n.demo-text { color: #222222; }\np { margin-bottom: 0; }\n';
const EXTERNAL = ['site-body', 'site-card', 'site-title'];
const COLLECTIONS = ['mainSelectorCollection', 'designSelectorCollection', 'cmSelectorCollection', 'animationSelectorCollection'];

const json = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const codes = report => report.items.map(item => item.code);
const selectorsOf = css => { const out = []; postcss.parse(css).walkRules(rule => out.push(...rule.selectors.map(item => item.trim()))); return out; };
const rulesOf = css => {
  const out = {};
  postcss.parse(css).walkRules(rule => {
    const media = rule.parent.type === 'atrule' ? rule.parent.params : 'screen';
    out[`${media} ${rule.selector}`] = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(decl => [decl.prop, decl.value]));
  });
  return out;
};
const normalize = ({ html = PAGE_HTML, css = PAGE_CSS, external = TARGET_CSS } = {}) => normalizeHtmlSource({
  htmlText: html, stylesheets: [{ label: 'page.css', text: css }],
  externalStylesheets: [{ label: 'design-system/target.css', text: external, href: '../../../design-system/target.css' }]
});

function project(t) {
  const workspace = tempWorkspace(t, 'taptop-external-');
  const root = path.join(workspace, 'projects', 'synthetic-site');
  initProject(root, 'synthetic-site');
  write(root, 'design-system/target.css', TARGET_CSS);
  write(root, 'input/demo/index.html', PAGE_HTML);
  write(root, 'input/demo/styles.css', PAGE_CSS);
  return { workspace, root };
}
const demo = { key: 'pages/demo', html: 'input/demo/index.html', stylesheets: ['input/demo/styles.css'] };

// ----- registry -----

test('artifact add stores external stylesheets in order and validates them like sources', t => {
  const { root } = project(t);
  write(root, 'design-system/second.css', '.site-extra { color: #111111; }');
  const before = fs.readFileSync(path.join(root, 'source/artifacts.json'), 'utf8');
  assert.throws(() => addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.txt'] }), /INVALID_ARTIFACT_SOURCE/);
  assert.throws(() => addArtifact(root, { ...demo, externalStylesheets: ['design-system/missing.css'] }), /ARTIFACT_SOURCE_MISSING/);
  assert.throws(() => addArtifact(root, { ...demo, externalStylesheets: ['../outside.css'] }), /UNSAFE_PROJECT_PATH/);
  assert.throws(() => addArtifact(root, { ...demo, externalStylesheets: ['output/site.css'] }), /ARTIFACT_SOURCE_LOCATION/);
  assert.throws(() => addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css', 'design-system/target.css'] }), /DUPLICATE_STYLESHEET/);
  assert.throws(() => addArtifact(root, { ...demo, externalStylesheets: ['input/demo/styles.css'] }), /DUPLICATE_STYLESHEET/);
  assert.throws(() => addArtifact(root, { ...demo, externalStylesheets: [] }), /INVALID_EXTERNAL_STYLESHEETS/);
  assert.throws(() => addArtifact(root, { ...demo, externalStylesheets: 'design-system/target.css' }), /INVALID_EXTERNAL_STYLESHEETS/);
  assert.equal(fs.readFileSync(path.join(root, 'source/artifacts.json'), 'utf8'), before);
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css', 'design-system/second.css'] });
  assert.deepEqual(getArtifact(root, 'pages/demo').externalStylesheets, ['design-system/target.css', 'design-system/second.css']);
  assert.deepEqual(json(root, 'source/artifacts.json').artifacts[0].externalStylesheets, ['design-system/target.css', 'design-system/second.css']);
  addArtifact(root, { ...demo, key: 'pages/plain' });
  assert.equal(Object.hasOwn(readArtifacts(root).artifacts.find(item => item.key === 'pages/plain'), 'externalStylesheets'), false);
});

test('the published artifact schema describes externalStylesheets with the source path rules', () => {
  const schema = require('../contracts/project/artifacts.schema.json');
  const field = schema.properties.artifacts.items.properties.externalStylesheets;
  assert.equal(field.type, 'array');
  assert.equal(field.minItems, 1);
  assert.equal(field.uniqueItems, true);
  assert.equal(field.items.$ref, '#/$defs/projectPath');
});

test('the CLI takes --external-css more than once', t => {
  const { workspace } = project(t);
  const CLI = path.resolve(__dirname, '../bin/taptop.js');
  write(path.join(workspace, 'projects/synthetic-site'), 'design-system/second.css', '.site-extra { color: #111111; }');
  const result = spawnSync(process.execPath, [CLI, 'artifact', 'add', '--project', 'projects/synthetic-site', '--key', 'pages/demo', '--html', 'input/demo/index.html',
    '--css', 'input/demo/styles.css', '--external-css', 'design-system/target.css', '--external-css', 'design-system/second.css'], { cwd: workspace, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).artifact.externalStylesheets, ['design-system/target.css', 'design-system/second.css']);
  const { COMMANDS } = require('../lib/cli-usage');
  assert.match(COMMANDS.find(item => item.name === 'artifact add').synopsis, /--external-css <file\.css>/);
});

// ----- normalizer -----

test('external classes stay on the layers, join the cascade first and are never written to page CSS', async () => {
  const result = await normalize();
  assert.equal(result.report.ok, true, JSON.stringify(result.report.items.filter(item => item.level === 'error')));
  const selectors = selectorsOf(result.css);
  for (const name of EXTERNAL) assert.ok(!selectors.some(selector => selectorUsesClass(selector, name)), `${name} has a page rule: ${selectors.join(' ')}`);
  assert.doesNotMatch(result.embedCss, /site-|font-family: Arial/);
  assert.deepEqual(result.manifest.externalClasses, EXTERNAL);
  // Values the normalizer derives for a layer go on the element's page class, never on the site class.
  const rules = rulesOf(result.css);
  assert.equal(rules['screen .demo-card']?.width, 'auto');
  assert.equal(rules['screen .demo-title']?.display, 'block');
  assert.match(result.html, /class="demo-card site-card"/);
  assert.match(result.html, /class="demo-title site-title"/);
  // A tag rule lands on the page class; the property the site class sets keeps the site value.
  assert.equal(rules['screen .demo-text']['margin-bottom'], '0');
  assert.equal(rules['screen .demo-text']['margin-top'], undefined);
  assert.match(result.html, /class="demo-text site-body"/);
  // No generated class is ever named after an external class.
  assert.doesNotMatch(`${result.html}${result.css}`, /site-[a-z]+(?:--|-inline|__)/);
  // The preview links the external sheet after Taptop's layer base and before the page's own CSS.
  const links = [...result.html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1]);
  assert.deepEqual(links.slice(-3), ['taptop-preview.css', '../../../design-system/target.css', 'page.css']);
});

test('an element whose classes are all external stays valid when the page needs nothing on it', async () => {
  const result = await normalize({ html: '<!doctype html><html><head></head><body><div class="demo-page"><span class="site-title">Inline</span></div></body></html>', css: '.demo-page { display: flex; }' });
  assert.equal(result.report.ok, true);
  assert.match(result.html, /<span class="site-title" data-taptop-key=/);
  assert.doesNotMatch(result.html, /class="[^"]*site-title[-_]/);
  assert.equal(result.css.includes('site-title'), false);
});

test('an element whose classes are all external but needs page values is EXTERNAL_ONLY_ELEMENT', async () => {
  const wrap = body => `<!doctype html><html><head></head><body><div class="demo-page">${body}</div></body></html>`;
  const cases = [
    // Taptop block base width: 100% needs width: auto back.
    { html: wrap('<div class="site-card"><span class="demo-text">A</span></div>'), css: '.demo-page { display: block; }', wants: /width/ },
    // A heading outside a flex parent needs display: block back.
    { html: wrap('<h2 class="site-title">A</h2>'), css: '.demo-page { display: block; }', wants: /display/ },
    // An element rule of the page has to land somewhere.
    { html: wrap('<h2 class="site-title">A</h2>'), css: '.demo-page { display: flex; }\nh2 { color: #ff0000; }', wants: /color/ },
    // An inline style becomes a page class named after a page class.
    { html: wrap('<span class="site-title" style="color: #ff0000">A</span>'), css: '.demo-page { display: flex; }', wants: /inline style/ }
  ];
  for (const { html, css, wants } of cases) {
    const result = await normalize({ html, css });
    const item = result.report.items.find(entry => entry.code === 'EXTERNAL_ONLY_ELEMENT');
    assert.ok(item, `not refused: ${html} / ${css}`);
    assert.equal(item.level, 'error');
    assert.match(item.reason, wants);
    assert.match(item.reason, /add a page class/i);
  }
  // A property the site class sets itself needs no page value.
  const owned = await normalize({ html: wrap('<h2 class="site-title">A</h2>'), css: '.demo-page { display: flex; }\nh2 { font-size: 30px; }' });
  assert.equal(owned.report.ok, true, JSON.stringify(owned.report.items.filter(item => item.level === 'error')));
});

test('an image whose classes are all external needs a page class for the overflow reset, unless the site sets overflow', async () => {
  const html = '<!doctype html><html><head></head><body><div class="demo-page"><img class="site-pic" src="data:image/png;base64,AA==" alt=""></div></body></html>';
  // The site class sizes the image, so only the overflow reset needs a page class.
  const sized = await normalize({ html, css: '.demo-page { display: flex; }', external: `${TARGET_CSS}\n.site-pic { width: 40px; height: 40px; }` });
  const item = sized.report.items.find(entry => entry.code === 'EXTERNAL_ONLY_ELEMENT');
  assert.ok(item, 'not refused');
  assert.match(item.reason, /overflow: clip/);
  assert.doesNotMatch(item.reason, /width|height/);
  assert.doesNotMatch(sized.embedCss, /:where\(\.image, img\)/, 'the Embed never restyles a site class');
  const owned = await normalize({ html, css: '.demo-page { display: flex; }', external: `${TARGET_CSS}\n.site-pic { width: 40px; height: 40px; overflow: hidden; }` });
  assert.equal(owned.report.ok, true, JSON.stringify(owned.report.items.filter(entry => entry.level === 'error')));
  assert.doesNotMatch(owned.embedCss, /overflow: clip/);
});

test('generated helper classes are named after page classes and avoid every name of the external sheets', async () => {
  const external = `${TARGET_CSS}\n.site-body { color: #333333; }\n.demo-b--order.is-x { color: #000000; }\n.demo-text--sel.is-x { color: #000000; }`;
  const html = '<!doctype html><html><head></head><body><div class="demo-page"><p class="demo-a site-body demo-b">A</p><p class="site-body demo-text">B</p><div class="site-card demo-card"><span>C</span></div></div></body></html>';
  const css = '.demo-page { display: flex; }\n.demo-b { padding-left: 2px; }\n.demo-a { padding-left: 1px; color: #222222; }\n.demo-page > p.demo-text { letter-spacing: 1px; }\n.demo-card { display: flex; }';
  const result = await normalize({ html, css, external });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.items.filter(item => item.level === 'error')));
  // Two page classes compete: the order class is named after the page class sorting last, not after .site-body.
  assert.match(result.html, /class="demo-a site-body demo-b demo-b--order-b"/);
  assert.equal(rulesOf(result.css)['screen .demo-b--order-b']['padding-left'], '1px');
  // A page class against a site class: no order class can sort after the site class, so none is made; a warning says so.
  assert.equal(rulesOf(result.css)['screen .demo-b--order-b'].color, undefined);
  const warning = result.report.items.find(item => item.code === 'EXTERNAL_ORDER_UNVERIFIED');
  assert.ok(warning, 'no EXTERNAL_ORDER_UNVERIFIED');
  assert.equal(warning.level, 'warning');
  // A lowered selector class and a generated child class take the page class, never the site class.
  assert.match(result.html, /class="site-body demo-text demo-text--sel-b"/);
  assert.match(result.html, /<span class="demo-card__span"/);
  assert.doesNotMatch(`${result.html}${result.css}`, /site-[a-z]+(?:--|-inline|__)/);
});

test('a Taptop system name the site also defines is renamed and the warning says the site rules are lost', async () => {
  const result = await normalize({
    html: '<!doctype html><html><head></head><body><div class="demo-page"><p class="demo-text text-secondary">A</p></div></body></html>',
    css: '.demo-page { display: flex; }', external: '.text-secondary { color: #757f95; }'
  });
  assert.match(result.html, /class="demo-text u-text-secondary"/);
  const warning = result.report.items.find(item => item.code === 'RESERVED_CLASS_RENAMED');
  assert.ok(warning);
  assert.match(warning.reason, /external stylesheet/);
  assert.match(warning.reason, /rules .*lost/);
  assert.equal(result.manifest.externalClasses, undefined);
});

test('a page rule on an external class in any form is EXTERNAL_CLASS_REDEFINED', async () => {
  const cases = [
    '.site-title { color: #ff0000; }',
    '.site-title:hover { color: #ff0000; }',
    '@media (max-width: 767px) { .site-title { color: #ff0000; } }',
    '@media (min-width: 1200px) { .site-title { color: #ff0000; } }',
    '.demo-page .site-title { color: #ff0000; }',
    '.demo-text.site-body { color: #ff0000; }',
    '.site-title::after { content: ""; }',
    '.site-unused { color: #ff0000; }'
  ];
  for (const css of cases) {
    const result = await normalize({ css: `${PAGE_CSS}${css}` });
    assert.equal(result.report.ok, false, css);
    const item = result.report.items.find(entry => entry.code === 'EXTERNAL_CLASS_REDEFINED');
    assert.ok(item, `${css} was not refused`);
    assert.equal(item.level, 'error');
  }
  const styled = await normalize({ html: PAGE_HTML.replace('</head>', '<style>.site-card { padding: 0; }</style></head>') });
  assert.ok(codes(styled.report).includes('EXTERNAL_CLASS_REDEFINED'));
  // A site class as context only styles a page class.
  const context = await normalize({ css: `${PAGE_CSS}.site-card .demo-text { color: #ff0000; }` });
  assert.equal(context.report.ok, true, JSON.stringify(context.report.items.filter(item => item.level === 'error')));
});

test('an external class name is referenced as it is: no counter rename', async () => {
  const result = await normalize({
    html: '<!doctype html><html><head></head><body><div class="demo-page"><p class="site-copy-1">Copy</p></div></body></html>',
    css: '.demo-page { display: flex; }', external: '.site-copy-1 { color: #333333; }'
  });
  assert.equal(result.report.ok, true);
  assert.match(result.html, /class="site-copy-1"/);
  assert.ok(!codes(result.report).includes('CLASS_COUNTER_RENAMED'));
  assert.deepEqual(result.manifest.externalClasses, ['site-copy-1']);
});

test('without external stylesheets the normalizer output is what it was before the feature', async () => {
  // Expected values are the output of the normalizer before external stylesheets were added (2026-10-15).
  const html = '<!doctype html><html><head></head><body><div class="demo-page"><p class="demo-text">A</p><details class="demo-faq"><summary class="demo-q">Q</summary>Text</details></div></body></html>';
  const result = await normalizeHtmlSource({ htmlText: html, stylesheets: [{ label: 'page.css', text: PAGE_CSS }] });
  assert.equal(result.css, '.demo-faq {\n  width: auto;\n}\n.demo-faq__panel {\n  display: block;\n}\n.demo-page {\n  display: block;\n  width: auto;\n}\n.demo-q {\n  display: block;\n}\n.demo-text {\n  color: #222222;\n  margin-bottom: 0;\n  display: block;\n}\n');
  assert.equal(result.html.split('<body>')[1].split('</body>')[0].trim(), '<div class="demo-page" data-taptop-key="demo-page-1"><p class="demo-text" data-taptop-key="demo-text-1">A</p><div class="demo-faq" data-taptop-key="demo-faq-1"><div class="demo-q" data-taptop-key="demo-q-1">Q</div><div class="demo-faq__panel" data-taptop-key="demo-faq__panel-1">Text</div></div></div>');
  assert.equal(result.manifest.rootSelector, '.demo-page');
  assert.equal(Object.hasOwn(result.manifest, 'externalClasses'), false);
  assert.ok(!result.report.items.some(item => /^EXTERNAL_/.test(item.code)));
});

test('a generated <details> panel class avoids a class the page already uses, also without external sheets', async () => {
  const html = '<!doctype html><html><head></head><body><div class="demo-page"><p class="demo-faq__panel">Other</p><details class="demo-faq"><summary class="demo-q">Q</summary>Text</details></div></body></html>';
  const result = await normalizeHtmlSource({ htmlText: html, stylesheets: [{ label: 'page.css', text: PAGE_CSS }] });
  assert.match(result.html, /<div class="demo-faq__panel-b"/);
  assert.match(result.html, /<p class="demo-faq__panel"/);
});

test('a page using external classes builds; the package lists them and carries no rules for them', async t => {
  const { root } = project(t);
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css'] });
  const built = await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' });
  assert.equal(built.status, 'built');
  const pkg = json(root, built.jsonPath);
  assert.equal(pkg.version, 2);
  assert.deepEqual(pkg.externalClasses, EXTERNAL.map(name => ({ name, collection: 'main' })));
  const managed = pkg.syncPackage.classes.map(item => item.name);
  for (const name of EXTERNAL) assert.ok(!managed.includes(name), `${name} is managed`);
  assert.ok(managed.includes('demo-text'));
  const layout = pkg.clipboardData.copiedLayout;
  for (const collection of COLLECTIONS) {
    for (const entry of Object.values(layout[collection].map)) {
      for (const name of EXTERNAL) assert.ok(!selectorUsesClass(entry.selectorText, name), `${collection} has ${entry.selectorText}`);
    }
  }
  const onLayers = new Set(Object.values(layout.mainClassNameCollection.map).map(item => item.value));
  for (const name of EXTERNAL) assert.ok(onLayers.has(name), `${name} is not on a layer`);
  assert.ok(!onLayers.has('site-unused'));
  assert.doesNotMatch(JSON.stringify(pkg.behaviorPackages || []), /site-/);
  assert.equal(preflightImportPackage(pkg).ok, true, preflightImportPackage(pkg).errors.join('; '));

  // The preview and the keyed original both load the same external sheet first.
  const htmlFile = path.join(root, built.htmlPath);
  const target = path.join(root, 'design-system/target.css');
  const href = /<link rel="stylesheet" href="([^"]*target\.css)">/.exec(fs.readFileSync(htmlFile, 'utf8'))?.[1];
  assert.ok(href, 'page.html does not link the external sheet');
  assert.equal(path.resolve(path.dirname(htmlFile), href), target);
  const original = fs.readFileSync(path.join(path.dirname(htmlFile), 'original.html'), 'utf8');
  const base = /<base href="([^"]+)">/.exec(original)[1];
  const originalHref = /<base href="[^"]+"><link rel="stylesheet" href="([^"]+)">/.exec(original)?.[1];
  assert.ok(originalHref, 'original.html does not link the external sheet first');
  assert.equal(path.resolve(path.dirname(htmlFile), base, originalHref), target);
  // The same files in the work folder resolve to the same sheet.
  const workHtml = path.join(root, '.taptop/work/pages--demo/page.html');
  const workHref = /<link rel="stylesheet" href="([^"]*target\.css)">/.exec(fs.readFileSync(workHtml, 'utf8'))[1];
  assert.equal(path.resolve(path.dirname(workHtml), workHref), target);
  const workOriginal = fs.readFileSync(path.join(path.dirname(workHtml), 'original.html'), 'utf8');
  const [, workBase, workOriginalHref] = /<base href="([^"]+)"><link rel="stylesheet" href="([^"]+)">/.exec(workOriginal);
  assert.equal(path.resolve(path.dirname(workHtml), workBase, workOriginalHref), target);
  assert.doesNotMatch(fs.readFileSync(path.join(path.dirname(htmlFile), 'page.css'), 'utf8'), /\.site-(title|body|card) \{/);

  // The sheet is a registered input: editing it makes the result stale.
  const record = readCatalog(root).artifacts['pages/demo'].builds[0];
  assert.deepEqual(record.registration.externalStylesheets, ['design-system/target.css']);
  assert.ok(record.inputs.some(item => item.path === 'design-system/target.css'));
  assert.equal((await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' })).status, 'up-to-date');
  write(root, 'design-system/target.css', `${TARGET_CSS}\n.site-new { color: #010101; }`);
  const row = artifactStatuses(root).find(item => item.key === 'pages/demo');
  assert.equal(row.status, 'stale');
  assert.ok(row.reasons.includes('input changed: design-system/target.css'), row.reasons.join('; '));
});

test('a page stylesheet rule on an external class stops the build with EXTERNAL_CLASS_REDEFINED', async t => {
  const { root } = project(t);
  write(root, 'input/demo/styles.css', `${PAGE_CSS}.site-title { color: #ff0000; }\n`);
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css'] });
  await assert.rejects(buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' }), /NORMALIZATION_FAILED: .*EXTERNAL_CLASS_REDEFINED/);
  assert.equal(readCatalog(root).artifacts['pages/demo'], undefined);
});

test('the compiler refuses a rule that reaches an external class after normalization', async t => {
  const { root } = project(t);
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css'] });
  await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' });
  const work = '.taptop/work/pages--demo';
  fs.appendFileSync(path.join(root, work, 'page.css'), '\n.site-title {\n  color: #ff0000;\n}\n');
  await assert.rejects(compileProject(root, `${work}/manifest.json`, path.join(root, 'output/json/tampered.json')), /EXTERNAL_CLASS_REDEFINED: \.site-title/);
});

test('a registration without external stylesheets builds exactly as before', async t => {
  const { root } = project(t);
  write(root, 'input/plain/index.html', '<!doctype html><html><head></head><body><div class="demo-page"><p class="demo-text">A</p></div></body></html>');
  write(root, 'input/plain/styles.css', PAGE_CSS);
  addArtifact(root, { key: 'pages/plain', html: 'input/plain/index.html', stylesheets: ['input/plain/styles.css'] });
  const built = await buildArtifact({ projectRoot: root, artifactKey: 'pages/plain' });
  const pkg = json(root, built.jsonPath);
  assert.equal(Object.hasOwn(pkg, 'externalClasses'), false);
  assert.equal(Object.hasOwn(readCatalog(root).artifacts['pages/plain'].builds[0].registration, 'externalStylesheets'), false);
  assert.equal(Object.hasOwn(json(root, '.taptop/work/pages--plain/manifest.json'), 'externalClasses'), false);
});

// ----- package preflight -----

test('preflight accepts a well-formed externalClasses list and refuses a wrong one', async t => {
  const { root } = project(t);
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css'] });
  const built = await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' });
  const pkg = json(root, built.jsonPath);
  const errorsWith = change => { const copy = structuredClone(pkg); change(copy); return preflightImportPackage(copy).errors.join('; '); };
  assert.match(errorsWith(copy => { copy.externalClasses = {}; }), /externalClasses must be an array/);
  assert.match(errorsWith(copy => { copy.externalClasses.reverse(); }), /externalClasses must be sorted by name without duplicates/);
  assert.match(errorsWith(copy => { copy.externalClasses[0].collection = 'cm'; }), /externalClasses\[0\]/);
  assert.match(errorsWith(copy => { copy.externalClasses[0].stableKey = 'x'; }), /externalClasses\[0\]/);
  assert.match(errorsWith(copy => { copy.externalClasses.push({ name: 'site-zzz', collection: 'main' }); }), /external class main\/site-zzz must match exactly one clipboard class/);
  assert.match(errorsWith(copy => { copy.externalClasses.splice(0, 0, { name: 'demo-text', collection: 'main' }); }), /external class demo-text is also a managed class/);
});

// ----- behaviors, root selector and other picks of "the element's class" -----

const BEHAVIOR_SITE_CSS = `${TARGET_CSS}\n.site-burger { color: #111111; }\n.demo-faq__panel.is-x { color: #000000; }`;
const page = body => `<!doctype html><html><head></head><body>${body}</body></html>`;
const needs = result => result.report.items.filter(item => item.code === 'EXTERNAL_ONLY_ELEMENT').map(item => item.reason).join(' | ');

test('behaviors, the root selector and generated panels use the page class, never a first external class', async () => {
  const reveal = await normalize({ external: BEHAVIOR_SITE_CSS, css: '.demo-page { display: flex; }\n.demo-rev { display: flex; }',
    html: page('<section class="site-card demo-page"><div class="site-title demo-rev" data-taptop-behavior="reveal"><span class="demo-text">A</span></div></section>') });
  assert.equal(reveal.report.ok, true, needs(reveal));
  assert.equal(reveal.behaviors.behaviors[0].config.targetClass, 'demo-rev');
  assert.equal(reveal.manifest.rootSelector, '.demo-page');

  const menu = await normalize({ external: BEHAVIOR_SITE_CSS, css: '.demo-menu { display: flex; }\n.demo-drawer { display: flex; }',
    html: page('<nav class="site-card demo-menu" data-taptop-behavior="menu"><button class="site-burger demo-burger" type="button">Menu</button><div class="site-title demo-drawer"><a class="demo-link" href="#a">A</a></div></nav>') });
  assert.equal(menu.report.ok, true, needs(menu));
  const menuConfig = menu.behaviors.behaviors.find(item => item.adapter === 'taptop/embed-menu-v1').config;
  assert.deepEqual([menuConfig.rootClass, menuConfig.toggleClass, menuConfig.panelClass], ['demo-menu', 'demo-burger', 'demo-drawer']);

  const accordion = await normalize({ external: BEHAVIOR_SITE_CSS, css: '.demo-acc { display: flex; }\n.demo-item { display: flex; }',
    html: page('<div class="site-card demo-acc" data-taptop-behavior="accordion"><div class="site-body demo-item"><span class="site-title demo-q" role="button">Q1</span><span class="site-title demo-a" role="region">A1</span></div><div class="site-body demo-item"><span class="site-title demo-q" role="button">Q2</span><span class="site-title demo-a" role="region">A2</span></div></div>') });
  assert.equal(accordion.report.ok, true, needs(accordion));
  const accordionConfig = accordion.behaviors.behaviors.find(item => item.adapter === 'taptop/embed-accordion-v1').config;
  assert.deepEqual([accordionConfig.rootClass, accordionConfig.itemClass, accordionConfig.triggerClass, accordionConfig.panelClass], ['demo-acc', 'demo-item', 'demo-q', 'demo-a']);

  // A <details> panel is named after the page class and avoids every name of the external sheets.
  const details = await normalize({ external: BEHAVIOR_SITE_CSS, css: '.demo-list { display: flex; }\n.demo-faq { display: flex; }',
    html: page('<div class="demo-list"><details class="site-card demo-faq"><summary class="demo-q">Q</summary>Text</details></div>') });
  assert.match(details.html, /class="demo-faq__panel-b"/);
  assert.doesNotMatch(details.html, /site-card__panel/);
});

test('a behavior, the root or a link layer whose classes are all external is EXTERNAL_ONLY_ELEMENT', async () => {
  const cases = [
    [page('<section class="demo-page"><div class="site-title" data-taptop-behavior="reveal"><span class="demo-text">A</span></div></section>'), '.demo-page { display: flex; }', /reveal/],
    [page('<nav class="demo-menu" data-taptop-behavior="menu"><button class="site-burger" type="button">Menu</button><div class="demo-drawer"><a class="demo-link" href="#a">A</a></div></nav>'), '.demo-menu { display: flex; }\n.demo-drawer { display: flex; }', /menu/],
    [page('<div class="demo-page"><div class="site-card" data-taptop-behavior="accordion"><div class="demo-item"><span class="demo-q" role="button">Q</span><span class="demo-a" role="region">A</span></div></div></div>'), '.demo-page { display: flex; }\n.demo-item { display: flex; }', /accordion/],
    [page('<section class="site-card"><span class="demo-text">A</span></section>'), '', /root selector/],
    [page('<div class="demo-page"><a class="site-title" href="#a">A</a></div>'), '.demo-page { display: flex; }', /fill/]
  ];
  for (const [html, css, wants] of cases) {
    const result = await normalize({ external: BEHAVIOR_SITE_CSS, html, css });
    assert.equal(result.report.ok, false, html);
    assert.match(needs(result), wants, html);
  }
});

test('the button fill class is never named after an external class', () => {
  const { mirrorButtonFillsToDesignCollection } = require('../lib/component-builders');
  const tags = { t1: { id: 't1', widgetName: 'tt_link_universal', classNameIds: ['c1', 'c2'] } };
  const main = { map: { c1: { id: 'c1', value: 'demo-link' }, c2: { id: 'c2', value: 'site-title' } } };
  const { designClassNameCollection } = mirrorButtonFillsToDesignCollection(structuredClone(tags), main, { map: {} }, new Set(['site-title']));
  assert.deepEqual(Object.values(designClassNameCollection.map).map(item => item.value), ['demo-link__fill']);
  const only = { t1: { id: 't1', widgetName: 'tt_link_universal', classNameIds: ['c2'] } };
  assert.throws(() => mirrorButtonFillsToDesignCollection(only, main, { map: {} }, new Set(['site-title'])), /EXTERNAL_ONLY_ELEMENT/);
});

test('preflight refuses behavior code or embed CSS that targets an external class', async t => {
  const { root } = project(t);
  write(root, 'input/demo/index.html', page('<section class="demo-page"><div class="site-title demo-rev" data-taptop-behavior="reveal"><p class="demo-text site-body">A</p></div></section>'));
  write(root, 'input/demo/styles.css', '.demo-page { display: flex; }\n.demo-rev { display: flex; }\n.demo-rev.is-inview .demo-text { animation: demo-fade 1s; }\n.site-card .demo-text::before { content: ""; }\n@keyframes demo-fade { from { opacity: 0; } to { opacity: 1; } }\n');
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css'] });
  const built = await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' });
  const pkg = json(root, built.jsonPath);
  assert.equal(preflightImportPackage(pkg).ok, true, preflightImportPackage(pkg).errors.join('; '));
  const codeOf = item => item.clipboardData.copiedLayout.tree.tags[item.clipboardData.copiedLayout.tree.root].embedCode;
  assert.match(codeOf(pkg.behaviorPackages.find(item => item.adapter === 'taptop/embed-reveal-v1')), /\.demo-rev\.toolkit-animate-visible/);
  const tamper = (adapter, change) => {
    const copy = structuredClone(pkg);
    const item = copy.behaviorPackages.find(entry => entry.adapter === adapter);
    const tag = item.clipboardData.copiedLayout.tree.tags[item.clipboardData.copiedLayout.tree.root];
    tag.embedCode = change(tag.embedCode);
    item.codeSha256 = require('node:crypto').createHash('sha256').update(tag.embedCode).digest('hex');
    return preflightImportPackage(copy).errors.join('; ');
  };
  assert.match(tamper('taptop/embed-reveal-v1', code => code.replaceAll('demo-rev', 'site-title')), /behaviorPackages\[\d+\].*external class site-title/);
  assert.match(tamper('taptop/embed-styles-v1', code => code.replace('</style>', '.site-body:hover { color: #ff0000; }\n</style>')), /external class site-body/);
  // An external class as context in the Embed stylesheet is not a target.
  assert.equal(tamper('taptop/embed-styles-v1', code => code), '');
});

test('the compiler refuses a root selector that is an external class', async t => {
  const { root } = project(t);
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css'] });
  write(root, 'input/demo/index.html', page('<section class="site-body demo-page"><p class="demo-text">A</p></section>'));
  await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' });
  const work = '.taptop/work/pages--demo';
  const manifest = json(root, `${work}/manifest.json`);
  assert.equal(manifest.rootSelector, '.demo-page');
  fs.writeFileSync(path.join(root, work, 'manifest.json'), JSON.stringify({ ...manifest, rootSelector: '.site-body' }));
  await assert.rejects(compileProject(root, `${work}/manifest.json`, path.join(root, 'output/json/tampered-root.json')), /EXTERNAL_ONLY_ELEMENT: .*root/);
});

// ----- generated names, state classes, doctor, variables -----

test('every generated class name avoids the names the external sheets mention', async () => {
  const external = `${TARGET_CSS}\n.hero__text { color: #000000; }\n.card-inline1 { color: #000000; }\n.card__span { color: #000000; }\n.demo-link__text { color: #000000; }`;
  const result = await normalize({ external, css: '.demo-page { display: flex; }\n.hero { display: flex; }\n.card { display: flex; }',
    html: page('<div class="demo-page"><div class="hero">Lead <span class="hero-a">x</span></div><div class="card"><span>child</span></div><p class="card" style="color: #ff0000">inline</p><a class="demo-link" href="#a">Go <b>now</b></a></div>') });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.items.filter(item => item.level === 'error')));
  assert.match(result.html, /<span class="hero__text-b"/);
  assert.match(result.html, /<span class="card__span-b"/);
  assert.match(result.html, /class="card card-inline1-b"/);
  assert.match(result.html, /<span class="demo-link__text-b"/);
  // The inline style is not lost: it lands on the guarded class.
  assert.equal(rulesOf(result.css)['screen .card-inline1-b'].color, '#ff0000');
  assert.equal(result.manifest.externalClasses, undefined);
});

test('a link or button whose fill class would take a site class name is EXTERNAL_NAME_COLLISION', async () => {
  const result = await normalize({ external: `${TARGET_CSS}\n.demo-btn__fill { color: #000000; }`, css: '.demo-page { display: flex; }',
    html: page('<div class="demo-page"><a class="demo-btn" href="#a">Go</a></div>') });
  const item = result.report.items.find(entry => entry.code === 'EXTERNAL_NAME_COLLISION');
  assert.ok(item, 'not refused');
  assert.equal(item.level, 'error');
  assert.match(item.reason, /demo-btn__fill/);
  assert.match(item.reason, /\.demo-btn\b/);
});

test('a behavior state class the external sheets use is EXTERNAL_STATE_CLASS', async () => {
  const cases = [
    [`${TARGET_CSS}\n.site-nav.is-open { color: #000000; }`, '.demo-menu { display: flex; }\n.demo-drawer { display: flex; }', page('<nav class="demo-menu site-nav" data-taptop-behavior="menu"><button class="demo-burger" type="button">Menu</button><div class="demo-drawer"><a class="demo-link" href="#a">A</a></div></nav>'), /is-open/],
    [`${TARGET_CSS}\n.is-open { color: #000000; }`, '.demo-menu { display: flex; }\n.demo-drawer { display: flex; }', page('<nav class="demo-menu" data-taptop-behavior="menu"><button class="demo-burger" type="button">Menu</button><div class="demo-drawer"><a class="demo-link" href="#a">A</a></div></nav>'), /is-open/],
    [`${TARGET_CSS}\n.is-inview { opacity: 1; }`, '.demo-page { display: flex; }\n.demo-rev { display: flex; }', page('<section class="demo-page"><div class="demo-rev" data-taptop-behavior="reveal"><span class="demo-text">A</span></div></section>'), /is-inview/],
    [`${TARGET_CSS}\n.demo-open { color: #000000; }`, '.demo-acc { display: flex; }\n.demo-item { display: flex; }', page('<div class="demo-acc" data-taptop-behavior="accordion"><div class="demo-item demo-open"><span class="demo-q" role="button">Q1</span><span class="demo-a" role="region">A1</span></div><div class="demo-item"><span class="demo-q" role="button">Q2</span><span class="demo-a" role="region">A2</span></div></div>'), /demo-open.*rename/i]
  ];
  for (const [external, css, html, wants] of cases) {
    const result = await normalize({ external, css, html });
    const item = result.report.items.find(entry => entry.code === 'EXTERNAL_STATE_CLASS');
    assert.ok(item, `not refused: ${wants}`);
    assert.equal(item.level, 'error');
    assert.match(item.reason, wants);
  }
});

test('external rules with custom properties: resolved from the sheets, unresolved ones left out of the comparison', async () => {
  const html = page('<div class="demo-page"><p class="demo-text site-body">A</p></div>');
  const css = '.demo-page { display: flex; }\n.demo-text { color: #333333; }';
  const resolved = await normalize({ html, css, external: ':root { --site-ink: #333333; }\n.site-body { color: var(--site-ink); }' });
  assert.ok(!resolved.report.items.some(item => item.code === 'EXTERNAL_ORDER_UNVERIFIED'), 'equal values after var() were reported');
  const differs = await normalize({ html, css, external: ':root { --site-ink: #111111; }\n.site-body { color: var(--site-ink); }' });
  assert.ok(differs.report.items.some(item => item.code === 'EXTERNAL_ORDER_UNVERIFIED'));
  const unresolved = await normalize({ html, css, external: '.site-body { color: var(--site-unknown); }' });
  assert.ok(!unresolved.report.items.some(item => item.code === 'EXTERNAL_ORDER_UNVERIFIED'));
});

test('doctor reports a missing external stylesheet', t => {
  const { doctorProject } = require('../lib/doctor-project');
  const { root } = project(t);
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css'] });
  fs.rmSync(path.join(root, 'design-system/target.css'));
  const report = doctorProject(root);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(item => item.code === 'ARTIFACT_SOURCE_MISSING' && item.path === 'design-system/target.css'), JSON.stringify(report.issues));
});

test('preflight reads the behavior config and, without one, every string of the script', async t => {
  const { root } = project(t);
  write(root, 'input/demo/index.html', page('<section class="demo-page"><div class="site-title demo-rev" data-taptop-behavior="reveal"><p class="demo-text site-body">A</p></div></section>'));
  write(root, 'input/demo/styles.css', '.demo-page { display: flex; }\n.demo-rev { display: flex; }\n');
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css'] });
  const pkg = json(root, (await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' })).jsonPath);
  const index = pkg.behaviorPackages.findIndex(item => item.adapter === 'taptop/embed-reveal-v1');
  const withCode = change => {
    const copy = structuredClone(pkg);
    const item = copy.behaviorPackages[index];
    const tag = item.clipboardData.copiedLayout.tree.tags[item.clipboardData.copiedLayout.tree.root];
    tag.embedCode = change(tag.embedCode);
    item.codeSha256 = require('node:crypto').createHash('sha256').update(tag.embedCode).digest('hex');
    return preflightImportPackage(copy).errors.join('; ');
  };
  assert.equal(withCode(code => code), '');
  // A *Selector key of the config is read as a selector: its subject counts.
  assert.match(withCode(code => code.replace('"targetClass":"demo-rev"', '"targetClass":"demo-rev","hideSelector":".demo-page .site-title"')), /targets external class site-title/);
  assert.equal(withCode(code => code.replace('"targetClass":"demo-rev"', '"targetClass":"demo-rev","hideSelector":".site-title .demo-text"')), '');
  // Without a config object every string literal is read, in both quote kinds, as a name or a selector.
  const noConfig = code => code.replace(/const config = \{[^\n]*\};/, 'const config = window.cfg;');
  assert.equal(withCode(code => noConfig(code).replace("'use strict';", "'use strict'; const label = 'Menu'; const on = 'click';")), '');
  assert.match(withCode(code => noConfig(code).replace("'use strict';", "'use strict'; const hit = 'site-title';")), /targets external class site-title/);
  assert.match(withCode(code => noConfig(code).replace("'use strict';", "'use strict'; const hit = \".demo-page .site-body\";")), /targets external class site-body/);
});

test('a state class the site uses only in a compound that cannot reach the element passes with an info item', async () => {
  const result = await normalize({ external: `${TARGET_CSS}\n.custom-tab.is-open { color: #000000; }`, css: '.demo-menu { display: flex; }\n.demo-drawer { display: flex; }',
    html: page('<nav class="demo-menu" data-taptop-behavior="menu"><button class="demo-burger" type="button">Menu</button><div class="demo-drawer"><a class="demo-link" href="#a">A</a></div></nav>') });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.items.filter(item => item.level === 'error')));
  const info = result.report.items.find(item => item.code === 'EXTERNAL_STATE_CLASS_COMPOUND');
  assert.ok(info, 'no info item');
  assert.equal(info.level, 'info');
  assert.match(info.reason, /\.custom-tab\.is-open/);
  assert.ok(result.behaviors.behaviors.some(item => item.adapter === 'taptop/embed-menu-v1'));
});

test('the is-open a <details> item gets is the Toolkit\'s name, not a source class to rename', async () => {
  const result = await normalize({ external: `${TARGET_CSS}\n.is-open { color: #000000; }`, css: '.demo-list { display: flex; }\n.demo-faq { display: flex; }',
    html: page('<div class="demo-list"><details class="demo-faq" open><summary class="demo-q">Q1</summary><p class="demo-a">A1</p></details><details class="demo-faq"><summary class="demo-q">Q2</summary><p class="demo-a">A2</p></details></div>') });
  const item = result.report.items.find(entry => entry.code === 'EXTERNAL_STATE_CLASS');
  assert.ok(item, 'not refused');
  assert.match(item.reason, /\.is-open/);
  assert.match(item.reason, /fixed/);
  assert.doesNotMatch(item.reason, /Rename the state class in the source/);
});

// ----- the Toolkit's own class names on the target site -----

// A page with a menu and a reveal: its package carries behaviour Embeds, each hidden by .toolkit-behavior.
const EMBED_PAGE = page('<section class="demo-page"><nav class="demo-menu" data-taptop-behavior="menu"><button class="demo-burger" type="button">Menu</button><div class="demo-drawer"><a class="demo-link" href="#a">A</a></div></nav><div class="demo-rev" data-taptop-behavior="reveal"><p class="demo-text site-body">A</p></div></section>');
const EMBED_CSS = '.demo-page { display: block; }\n.demo-menu { display: flex; }\n.demo-drawer { display: flex; }\n.demo-menu.is-open .demo-drawer { display: block; }\n.demo-rev { opacity: 0; }\n.demo-rev.is-inview { opacity: 1; }\n';
const toolkitItems = (result, code) => result.report.items.filter(item => item.code === code);

test('the site defining .toolkit-behavior exactly as the Toolkit does is allowed and reported', async () => {
  for (const rule of ['.toolkit-behavior {display: none;}', '.toolkit-behavior { DISPLAY: None }']) {
    const result = await normalize({ external: `${TARGET_CSS}\n${rule}`, css: EMBED_CSS, html: EMBED_PAGE });
    assert.equal(result.report.ok, true, JSON.stringify(result.report.items.filter(item => item.level === 'error')));
    const [info] = toolkitItems(result, 'TOOLKIT_CLASS_ON_SITE');
    assert.ok(info, `no TOOLKIT_CLASS_ON_SITE for ${rule}`);
    assert.equal(info.level, 'info');
    assert.match(info.source, /\.toolkit-behavior/);
    assert.deepEqual(toolkitItems(result, 'TOOLKIT_CLASS_CONFLICT'), []);
  }
});

test('the site styling .toolkit-behavior otherwise is TOOLKIT_CLASS_CONFLICT naming both rules', async () => {
  const cases = [
    '.toolkit-behavior { display: block; }',
    '.toolkit-behavior { display: none !important; }',
    '.toolkit-behavior { display: none; color: #ff0000; }',
    '.toolkit-behavior { display: none; }\n@media (max-width: 767px) { .toolkit-behavior { display: block; } }',
    '.toolkit-behavior { display: none; }\n.toolkit-behavior { display: none; }',
    '.toolkit-behavior:hover { display: block; }',
    '.site-card .toolkit-behavior { display: block; }',
    '.embed.toolkit-behavior { display: block; }',
    // CSS nesting: the nested rule or at-rule restyles the class too.
    '.toolkit-behavior { display: none; &:hover { display: block; } }',
    '.toolkit-behavior { display: none; @media (max-width: 767px) { display: block; } }',
    '.toolkit-behavior { display: none; .site-wrap & { display: block; } }',
    '.site-wrap { color: #000000; & > .toolkit-behavior { display: block; } }',
    '.site-wrap { color: #000000; .toolkit-behavior { display: block; } }'
  ];
  for (const rules of cases) {
    const result = await normalize({ external: `${TARGET_CSS}\n${rules}`, css: EMBED_CSS, html: EMBED_PAGE });
    const [item] = toolkitItems(result, 'TOOLKIT_CLASS_CONFLICT');
    assert.ok(item, `not refused: ${rules}`);
    assert.equal(item.level, 'error');
    assert.equal(result.report.ok, false);
    assert.match(item.reason, /\.toolkit-behavior \{ display: none; \}/, 'names the Toolkit rule');
    assert.match(item.source, /toolkit-behavior/, 'names the site rule');
  }
  // The class as context only styles something else: not a conflict.
  for (const rules of ['.toolkit-behavior .site-x { color: #000000; }', '.toolkit-behavior > .site-x, .site-card .toolkit-behavior-like { color: #000000; }']) {
    const context = await normalize({ external: `${TARGET_CSS}\n${rules}`, css: EMBED_CSS, html: EMBED_PAGE });
    assert.deepEqual(toolkitItems(context, 'TOOLKIT_CLASS_CONFLICT'), [], rules);
  }
});

test('a site selector that names a Toolkit class any other way than as plain context is TOOLKIT_CLASS_CONFLICT', async () => {
  const cases = [
    '[class*="toolkit-behavior"] { display: block; }',
    '[class~=toolkit-behavior] { display: block; }',
    '[class*="toolkit"] { display: block; }',
    '[CLASS*="behavior" i] { display: block; }',
    '.embed:not(.toolkit-behavior) { display: block; }',
    '.site-card:has(.toolkit-behavior) { display: block; }',
    '.site-card:is(.toolkit-behavior, .x) .y { color: #000000; }',
    '.site-card:nth-child(2n of .toolkit-behavior) { color: #000000; }'
  ];
  for (const rules of cases) {
    const result = await normalize({ external: `${TARGET_CSS}\n${rules}`, css: EMBED_CSS, html: EMBED_PAGE });
    const items = toolkitItems(result, 'TOOLKIT_CLASS_CONFLICT');
    assert.ok(items.some(item => item.source.includes(rules.split(' {')[0])), `not refused: ${rules}`);
  }
  // Escaped, the name is still the class.
  const escaped = await normalize({ external: `${TARGET_CSS}\n.embed:not(.toolkit\\-behavior) { display: block; }`, css: EMBED_CSS, html: EMBED_PAGE });
  assert.equal(toolkitItems(escaped, 'TOOLKIT_CLASS_CONFLICT').length, 1, 'escaped :not(.toolkit\\-behavior)');
  // Not the class: another attribute's value, an id; and the class as plain context next to a "(" in a string.
  for (const rules of ['[data-note="toolkit-behavior"] { color: #000000; }', '#toolkit-behavior { color: #000000; }', '.site-a[data-x="("] .toolkit-behavior .site-b { color: #000000; }']) {
    const result = await normalize({ external: `${TARGET_CSS}\n${rules}`, css: EMBED_CSS, html: EMBED_PAGE });
    assert.deepEqual(toolkitItems(result, 'TOOLKIT_CLASS_CONFLICT'), [], rules);
  }
  // A site rule identical to the Toolkit's next to a mention is not "exactly the Toolkit's rule" any more.
  const both = await normalize({ external: `${TARGET_CSS}\n.toolkit-behavior { display: none; }\n[class*="toolkit-behavior"] { opacity: 0.5; }`, css: EMBED_CSS, html: EMBED_PAGE });
  assert.deepEqual(toolkitItems(both, 'TOOLKIT_CLASS_ON_SITE'), []);
  assert.equal(toolkitItems(both, 'TOOLKIT_CLASS_CONFLICT').length, 1);
});

test('a package without a behaviour Embed does not use .toolkit-behavior, so the site rule does not matter', async () => {
  const result = await normalize({ external: `${TARGET_CSS}\n.toolkit-behavior { display: block; }` });
  assert.equal(result.embedCss, '');
  assert.deepEqual(result.behaviors.behaviors, []);
  assert.equal(result.report.ok, true, JSON.stringify(result.report.items.filter(item => item.level === 'error')));
  assert.deepEqual(toolkitItems(result, 'TOOLKIT_CLASS_CONFLICT'), []);
});

test('a build against a site with the same .toolkit-behavior rule passes preflight; a different rule stops it', async t => {
  const { root } = project(t);
  write(root, 'input/demo/index.html', EMBED_PAGE);
  write(root, 'input/demo/styles.css', EMBED_CSS);
  write(root, 'design-system/target.css', `${TARGET_CSS}\n.toolkit-behavior {display: none;}\n`);
  addArtifact(root, { ...demo, externalStylesheets: ['design-system/target.css'] });
  const built = await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' });
  const pkg = json(root, built.jsonPath);
  assert.equal(preflightImportPackage(pkg).ok, true, preflightImportPackage(pkg).errors.join('; '));
  // The wrapper's externalClasses are classes of the page's layers; the Embed's own class is not one of them.
  assert.ok(!pkg.externalClasses.some(item => item.name === 'toolkit-behavior'));
  // Every behaviour Embed keeps the Toolkit's rule: identical to the site's, and the Embed stays hidden in a
  // project that lacks the class.
  for (const item of pkg.behaviorPackages) {
    assert.equal(item.clipboardData.copiedLayout.mainSelectorCollection.map['screen/.toolkit-behavior'].rules.display.value, 'none', item.adapter);
  }
  write(root, 'design-system/target.css', `${TARGET_CSS}\n.toolkit-behavior {display: block;}\n`);
  await assert.rejects(buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' }), /NORMALIZATION_FAILED: .*TOOLKIT_CLASS_CONFLICT/);
});

test('a legacy <center> keeps working against a site that defines its Toolkit classes', async () => {
  const html = page('<section class="demo-page"><center class="demo-center"><div class="demo-box"><p class="demo-text">A</p></div></center></section>');
  const css = '.demo-page { display: block; }\n.demo-box { width: 200px; }\n';
  const same = await normalize({ external: `${TARGET_CSS}\n.toolkit-center { text-align: center; }`, css, html });
  assert.equal(same.report.ok, true, JSON.stringify(same.report.items.filter(item => item.level === 'error')));
  assert.ok(toolkitItems(same, 'TOOLKIT_CLASS_ON_SITE').some(item => /toolkit-center/.test(item.source)));
  // Referenced as the site's class: on the layer, listed as external, its own rule not shipped.
  assert.ok(same.manifest.externalClasses.includes('toolkit-center'));
  assert.doesNotMatch(same.embedCss, /^\.toolkit-center \{/m);
  assert.match(same.embedCss, /\.toolkit-center > \.toolkit-centered-block/);
  // A classless <center> then has only the site's class: the values it needs want a page class of its own.
  const classless = await normalize({ external: `${TARGET_CSS}\n.toolkit-center { text-align: center; }`, css, html: html.replace(' class="demo-center"', '') });
  assert.ok(classless.report.items.some(item => item.code === 'EXTERNAL_ONLY_ELEMENT' && /toolkit-center/.test(item.source)));
  for (const external of ['.toolkit-center { text-align: left; }', '.toolkit-centered-block { margin: 0; }']) {
    const result = await normalize({ external: `${TARGET_CSS}\n${external}`, css, html });
    assert.ok(toolkitItems(result, 'TOOLKIT_CLASS_CONFLICT').length, `not refused: ${external}`);
  }
});

test('the Toolkit state and hook classes of the Tilda adapters are TOOLKIT_CLASS_CONFLICT when the site styles them', async () => {
  const slider = page('<div class="demo-page"><div class="t-slds"><div class="t-slds__items-wrapper"><div class="t-slds__item">One</div><div class="t-slds__item">Two</div></div><button class="t-slds__arrow-left">Prev</button><button class="t-slds__arrow-right">Next</button><div class="t-slds__bullet"></div><div class="t-slds__bullet"></div></div></div>');
  const video = page('<div class="demo-page"><a class="demo-launch" href="#watch">Watch</a><div class="t-popup" data-tooltip-hook="#watch"><button class="t-popup__close-wrapper">Close</button><div class="t1013__html5video" data-content-popup-video-url-html5video="https://video.example.test/detail.mp4"><div class="t1013__video-carier"></div></div></div></div>');
  const cases = [[slider, '.toolkit-slide-active { color: #000000; }'], [slider, '.toolkit-bullet-active { color: #000000; }'], [video, '.toolkit-popup-open { display: none; }']];
  for (const [html, external] of cases) {
    const base = await normalize({ external: TARGET_CSS, css: '.demo-page { display: block; }', html });
    assert.deepEqual(toolkitItems(base, 'TOOLKIT_CLASS_CONFLICT'), [], 'the fixture alone is no conflict');
    const result = await normalize({ external: `${TARGET_CSS}\n${external}`, css: '.demo-page { display: block; }', html });
    assert.ok(toolkitItems(result, 'TOOLKIT_CLASS_CONFLICT').some(item => item.source.includes(external.split(' ')[0])), `not refused: ${external}`);
  }
});

test('an external class rule takes part in the source cascade of Embed declarations', async () => {
  const html = '<!doctype html><html><head><title>Demo</title></head><body><section class="demo-page"><div class="card"><p class="demo-text">A</p><p class="demo-text site-ink">B</p></div><div class="card card--b"><p class="demo-text">C</p></div></section></body></html>';
  const css = '.card { --ink: #111111; } .card--b { --ink: #222222; } .demo-text { color: var(--ink); }';
  // The site's !important beats the later page rule on its elements: the Embed copy leaves them out.
  const important = await normalize({ html, css, external: '.site-ink { color: #333333 !important; }' });
  assert.match(important.embedCss, /^\.demo-text:where\(:not\(\.site-ink\)\) \{ color: var\(--ink\); \}$/m, important.embedCss);
  // A normal site rule comes first in the cascade and loses to the page rule: the copy reaches every element.
  const normal = await normalize({ html, css, external: '.site-ink { color: #333333; }' });
  assert.match(normal.embedCss, /^\.demo-text \{ color: var\(--ink\); \}$/m, normal.embedCss);
});
