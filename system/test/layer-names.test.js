const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { addArtifact } = require('../lib/project-artifacts');
const { buildArtifact } = require('../lib/build-artifact');
const { normalizeHtmlSource, createClassNames, layerNameClass } = require('../lib/html-normalizer');
const { managedProject, pageHtml, write } = require('../test-support/managed-project');

// Layer names in the Taptop layer panel (tag.name). Synthetic markup only.
const PNG_1X1 = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const page = body => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

async function buildPackage(t, { html, css, externalCss }) {
  const { root } = managedProject(t);
  write(root, 'input/page/images/pic.png', PNG_1X1);
  write(root, 'input/page/index.html', html);
  write(root, 'input/page/styles.css', css);
  const entry = { key: 'pages/page', html: 'input/page/index.html', stylesheets: ['input/page/styles.css'] };
  if (externalCss !== undefined) {
    write(root, 'input/page/site.css', externalCss);
    entry.externalStylesheets = ['input/page/site.css'];
  }
  addArtifact(root, entry);
  const result = await buildArtifact({ projectRoot: root, artifactKey: 'pages/page' });
  const text = fs.readFileSync(path.join(root, result.jsonPath), 'utf8');
  return { text, pkg: JSON.parse(text) };
}

const tagsOf = pkg => Object.values(pkg.clipboardData.copiedLayout.tree.tags);
const named = (pkg, name) => tagsOf(pkg).filter(tag => tag.name === name);

test('data-taptop-name names every layer kind the compiler builds', async t => {
  const html = '<section class="block" data-taptop-name="Block">'
    + '<div class="box" data-taptop-name="Box"><p class="caption" data-taptop-name="Caption">Text</p></div>'
    + '<p class="lead" data-taptop-name="Lead">Start <strong>now</strong></p>'
    + '<svg class="icon" data-taptop-name="Icon" width="24" height="24" viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>'
    + '<button class="cta" type="button" data-taptop-name="Action">Go</button>'
    + '<img class="pic" src="images/pic.png" alt="" data-taptop-name="Picture">'
    + '<a class="more" href="/more" data-taptop-name="More link">More</a>'
    + '<a class="card" href="/card" data-taptop-name="Card link"><span class="card-title">Card</span></a>'
    + '</section>';
  const css = '.block { display: block; } .box { display: block; } .caption { color: #111111; } .lead { color: #222222; } .icon { display: block; } .cta { color: #333333; } .pic { width: 24px; height: 24px; } .more { color: #444444; } .card { display: block; } .card-title { color: #555555; }';
  const { pkg } = await buildPackage(t, { html, css });
  const expected = { Block: 'div', Box: 'div', Caption: 'text', Lead: 'tt_rich_text', Icon: 'tt_svg_icon', Action: 'tt_link_universal', Picture: 'tt_image', 'More link': 'tt_link_universal', 'Card link': 'tt_link_universal' };
  for (const [name, widgetName] of Object.entries(expected)) {
    const tags = named(pkg, name);
    assert.equal(tags.length, 1, `one layer named ${name}`);
    assert.equal(tags[0].widgetName, widgetName, `${name} is a ${widgetName}`);
  }
  assert.equal(named(pkg, 'card-title').length, 1, 'an element without the attribute keeps its class name');
});

test('data-taptop-name is trimmed, inner whitespace collapses, and a blank value counts as absent', async t => {
  const html = '<section class="block"><p class="title" data-taptop-name="  Hero \n  card\ttitle  ">A</p><p class="note" data-taptop-name="   ">B</p></section>';
  const { pkg } = await buildPackage(t, { html, css: '.block { display: block; } .title { color: #111111; } .note { color: #222222; }' });
  assert.equal(named(pkg, 'Hero card title').length, 1);
  assert.equal(named(pkg, 'note').length, 1);
  assert.equal(tagsOf(pkg).filter(tag => tag.name === '' || tag.name === '   ').length, 0);
});

test('data-taptop-name never reaches the package and is not reported as a removed attribute', async t => {
  const html = '<section class="block" data-taptop-name="Block"><svg class="icon" data-taptop-name="Icon" width="24" height="24" viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg><p class="lead" data-taptop-name="Lead">A <strong data-taptop-name="Inner">b</strong></p></section>';
  const css = '.block { display: block; } .icon { display: block; } .lead { color: #111111; }';
  const { text } = await buildPackage(t, { html, css });
  assert.doesNotMatch(text, /data-taptop-name/);
  const normalized = await normalizeHtmlSource({ htmlText: page(html), cssText: css });
  assert.equal(normalized.report.items.filter(item => item.code === 'ATTRIBUTE_REMOVED' && item.decision === 'removed data-taptop-name').length, 0);
});

test('without data-taptop-name a layer is named after its first own class, not a generated --sel/--inner class', async t => {
  // `.list p` matches both paragraphs: the normalizer appends one generated
  // class named after the first matched element (lead--sel) to each of them.
  const html = '<section class="list"><p class="lead">A</p><p class="note">B</p></section>';
  const { pkg } = await buildPackage(t, { html, css: '.list { display: block; } .list p { color: #111111; }' });
  const leadTag = named(pkg, 'lead');
  const noteTag = named(pkg, 'note');
  assert.equal(leadTag.length, 1);
  assert.equal(noteTag.length, 1);
  assert.equal(tagsOf(pkg).filter(tag => /--sel/.test(tag.name || '')).length, 0, 'no layer is named after a --sel class');
});

test('a generated --inner class does not name a layer that has its own class', async t => {
  // The selector matches a layer and an element inside a rich-text layer:
  // the layer gets <name>--sel and the inner element <name>--sel--inner.
  const html = '<section class="block"><p class="lead">A <strong class="mark">b</strong></p><span class="mark tag">C</span></section>';
  const { pkg } = await buildPackage(t, { html, css: '.block { display: block; } .block .mark { color: #111111; }' });
  assert.equal(named(pkg, 'mark').length, 1);
  assert.equal(tagsOf(pkg).filter(tag => /--(sel|inner)/.test(tag.name || '')).length, 0);
});

test('an external class does not name a layer that has its own class, before or after it', async t => {
  const html = '<section class="block"><p class="body-font intro">A</p><p class="outro body-font">B</p></section>';
  const { pkg } = await buildPackage(t, { html, css: '.block { display: block; } .intro { color: #111111; } .outro { color: #222222; }', externalCss: '.body-font { font-size: 16px; }' });
  assert.equal(named(pkg, 'intro').length, 1);
  assert.equal(named(pkg, 'outro').length, 1);
  assert.equal(named(pkg, 'body-font').length, 0);
});

test('an element whose only classes are generated or external keeps its last class as the name', async t => {
  // The classless span gets a generated class (block__span); the other span has only the site's class.
  const html = '<section class="block"><span>A</span><span class="body-font">B</span></section>';
  const { pkg } = await buildPackage(t, { html, css: '.block { display: block; }', externalCss: '.body-font { font-size: 16px; }' });
  assert.equal(named(pkg, 'block__span').length, 1);
  assert.equal(named(pkg, 'body-font').length, 1);
});

test('the normalized HTML writes a layer name only where it differs from the last class', async () => {
  const html = page('<section class="list"><p class="lead">A</p><p class="note">B</p><p class="plain">C</p></section>');
  const result = await normalizeHtmlSource({ htmlText: html, cssText: '.list { display: block; } .list .lead, .list .note { color: #111111; } .list > p { margin: 0; } .plain { color: #222222; }' });
  assert.match(result.html, /<p class="note [^"]*--sel[^"]*"[^>]*data-taptop-name="note"/);
  assert.match(result.html, /<p class="plain [^"]*--sel[^"]*"[^>]*data-taptop-name="plain"/);
  assert.match(result.html, /<section class="list"(?![^>]*data-taptop-name)[^>]*>/);
});

// Before this rule every layer was named after its last class. The names that
// change are listed as [last class, new name]. The generated UI kit names each
// layer after its last class itself (ui-kit/markup.js), so it changes nothing.
// A page's own BEM modifier after the first class no longer names the layer.
test('existing fixtures: the managed UI kit keeps its names; a kit page and a list page rename only the listed layers', async t => {
  const { root } = managedProject(t);
  write(root, 'input/home/index.html', pageHtml('home-page'));
  write(root, 'input/home/styles.css', '');
  addArtifact(root, { key: 'pages/home', html: 'input/home/index.html', stylesheets: ['design-system/roles.css', 'input/home/styles.css'], dependsOn: ['ui-kit'] });
  write(root, 'input/list/index.html', '<section class="hero"><p class="lead">Start <strong>now</strong></p><ul class="list"><li class="item">A</li><li class="item item--x">B</li></ul></section>');
  write(root, 'input/list/styles.css', '.hero { display: block; } .lead { font-size: 20px; } .list li { color: #111111; } .hero > ul > li:first-child { margin: 0; }');
  addArtifact(root, { key: 'pages/list', html: 'input/list/index.html', stylesheets: ['input/list/styles.css'] });
  const renamed = async artifactKey => {
    const result = await buildArtifact({ projectRoot: root, artifactKey });
    const pkg = JSON.parse(fs.readFileSync(path.join(root, result.jsonPath), 'utf8'));
    const classes = pkg.clipboardData.copiedLayout.mainClassNameCollection.map;
    // The last page class of the layer (a button also carries a design-collection fill class).
    const lastClass = tag => classes[tag.classNameIds.filter(id => classes[id]).at(-1)].value;
    return tagsOf(pkg).filter(tag => tag.name !== undefined && tag.name !== lastClass(tag)).map(tag => [lastClass(tag), tag.name]);
  };
  assert.deepEqual(await renamed('ui-kit'), []);
  assert.deepEqual(await renamed('pages/home'), [['btn--secondary', 'btn']]);
  assert.deepEqual(await renamed('pages/list'), [['item--sel-b', 'item'], ['item--sel', 'item']]);
});

// The layer name of every element of the prepared HTML: data-taptop-name, else its last class.
function preparedNames(html) {
  return [...html.matchAll(/<[a-z][a-z0-9]*\s([^>]*)>/g)].flatMap(([, attrs]) => {
    const classes = /(?:^|\s)class="([^"]*)"/.exec(attrs)?.[1].split(' ');
    if (!classes) return [];
    return [{ classes, name: /(?:^|\s)data-taptop-name="([^"]*)"/.exec(attrs)?.[1] ?? classes.at(-1) }];
  });
}
const preparedNameOf = (html, className) => {
  const found = preparedNames(html).filter(item => item.classes.includes(className));
  assert.equal(found.length, 1, `one element with .${className}`);
  return found[0].name;
};
const normalize = (body, cssText) => normalizeHtmlSource({ htmlText: page(body), cssText });

test('the class namer marks __<tag>, __text and __panel structural and every other suffix a lowering class', () => {
  const namer = createClassNames({ childNodes: [] }, '', new Set(['card__panel']));
  for (const suffix of ['__div', '__text', '__panel']) assert.equal(namer.generatedKind(namer.shared('card', suffix)), 'structural', suffix);
  assert.equal(namer.shared('card', '__panel'), 'card__panel-b', 'a taken name gets a letter and keeps its kind');
  for (const suffix of ['--sel', '--inner', '--base', '--order', '--size', '-inline1']) assert.equal(namer.generatedKind(namer.unique('card', suffix)), 'lowering', suffix);
  assert.equal(namer.generatedKind('card'), undefined, 'a source class is not generated');
  // renameReservedClasses runs after <details> panels are named: a renamed generated class keeps its kind.
  namer.renamed(new Map([['card__div', 'u-card__div']]));
  assert.equal(namer.generatedKind('u-card__div'), 'structural');
  assert.equal(namer.generatedKind('card__div'), undefined);
  assert.equal(namer.shared('card', '__div'), 'u-card__div', 'the shared name follows the rename');
});

test('a layer takes its first own class, else its first structural class, else its last class', () => {
  const kinds = { 'a__p': 'structural', 'b__p': 'structural', 'x__text': 'structural', 'item__panel': 'structural', 'a__p--sel': 'lowering', 'q--sel': 'lowering', 'x-inline1': 'lowering', 'a--base': 'lowering', 'b--order': 'lowering', 'c--size': 'lowering', 'd--sel--inner': 'lowering' };
  const options = { generatedKind: name => kinds[name], excluded: name => name === 'site' || name === 'is-open' || name.startsWith('toolkit-') };
  const cases = [
    [['b__p', 'a__p--sel'], 'b__p'],
    [['x__text', 'q--sel'], 'x__text'],
    [['item__panel', 'a--base', 'b--order'], 'item__panel'],
    [['site', 'a__p', 'c--size'], 'a__p'],
    [['lead--sel', 'extra', 'q--sel'], 'lead--sel'],
    [['site', 'own', 'is-open'], 'own'],
    [['a__p', 'toolkit-centered-block'], 'a__p'],
    [['x-inline1', 'd--sel--inner'], 'd--sel--inner'],
    [['site', 'toolkit-center'], 'toolkit-center']
  ];
  for (const [classes, expected] of cases) assert.equal(layerNameClass(classes, options), expected, classes.join(' '));
});

test('a classless element is named after its own __<tag> class, not a --sel class named after another parent', async t => {
  // `.wrap p` reaches both paragraphs; its class is named after the first one (a__p--sel).
  const html = '<div class="wrap"><div class="a"><p>A</p></div><div class="b"><p>B</p></div></div>';
  const css = '.wrap { display: block; } .wrap p { color: #111111; }';
  const result = await normalize(html, css);
  assert.deepEqual(preparedNames(result.html).filter(item => item.classes.includes('a__p--sel')), [
    { classes: ['a__p', 'a__p--sel'], name: 'a__p' },
    { classes: ['b__p', 'a__p--sel'], name: 'b__p' }
  ]);
  const { pkg } = await buildPackage(t, { html, css });
  assert.equal(named(pkg, 'a__p').length, 1);
  assert.equal(named(pkg, 'b__p').length, 1);
  assert.equal(tagsOf(pkg).filter(tag => /--sel/.test(tag.name || '')).length, 0);
});

test('-inline<n>, --order, --size and --base classes never name a layer that has an own or a structural class', async () => {
  const inline = await normalize('<div class="block"><span style="color: #ff0000">A</span><p class="x" style="margin: 0">B</p></div>', '.block { display: block; } .x { color: #111111; }');
  assert.equal(preparedNameOf(inline.html, 'block__span-inline1'), 'block__span');
  assert.equal(preparedNameOf(inline.html, 'x-inline1'), 'x');
  // The source winner (.wrap > p:first-child) sorts first by name, so an order class follows the two --sel classes.
  const order = await normalize('<div class="wrap"><p>A</p></div>', '.wrap { display: block; } .wrap > p:first-child { color: #222222; } .wrap p { color: #111111; }');
  assert.deepEqual(preparedNames(order.html).find(item => item.classes.includes('wrap__p')), { classes: ['wrap__p', 'wrap__p--sel', 'wrap__p--sel-b', 'wrap__p--sel-b--order'], name: 'wrap__p' });
  const ownOrder = await normalize('<div class="wrap"><p class="lead accent--light">A</p></div>', '.wrap { display: block; } .lead { color: #111111; } .accent--light { color: #ffffff; }');
  assert.equal(preparedNameOf(ownOrder.html, 'lead--order'), 'lead');
  const size = await normalize('<div class="frame"><img src="p.png" alt=""><img class="photo" src="p.png" alt=""></div>', '.frame { display: block; } .frame img { width: 80px; } .frame > img { height: 50px; }');
  assert.equal(preparedNameOf(size.html, 'frame__img--sel-b--size'), 'frame__img');
  assert.equal(preparedNameOf(size.html, 'photo--size'), 'photo');
  const base = await normalize('<div class="root"><div class="caption">A</div><div class="x"><span class="caption">B</span></div></div>', '.caption { color: #111111; }');
  assert.equal(preparedNameOf(base.html, 'caption--base'), 'caption');
});

// A generated __text or __panel element is not in the source, so no lowered
// selector reaches it: end to end it carries only its own generated class.
test('__text and __panel name their layers; is-open and Toolkit classes never do', async () => {
  const text = await normalize('<div class="row">Text<span class="tag">T</span></div>', '.row { display: flex; } .row span { color: #111111; }');
  assert.equal(preparedNameOf(text.html, 'row__text'), 'row__text');
  const panel = await normalize('<div class="faq"><details class="item" open><summary class="q">Q</summary><p class="a1">A</p><p class="a2">B</p></details></div>', '.faq { display: block; }');
  assert.deepEqual(preparedNames(panel.html).find(item => item.classes.includes('is-open')), { classes: ['item', 'is-open'], name: 'item' });
  assert.equal(preparedNameOf(panel.html, 'item__panel'), 'item__panel');
  const center = await normalize('<div class="root"><center class="c"><p class="x">A</p></center></div>', '.x { color: #111111; }');
  assert.deepEqual(preparedNames(center.html).filter(item => item.classes.some(name => name.startsWith('toolkit-'))), [
    { classes: ['c', 'toolkit-center'], name: 'c' },
    { classes: ['x', 'toolkit-centered-block'], name: 'x' }
  ]);
});

test('a source class that ends in --sel is an own class and names its layer', async () => {
  const result = await normalize('<div class="block"><p class="lead--sel extra">A</p><p class="z">B</p></div>', '.block { display: block; } .lead--sel { color: #111111; } .extra { margin: 0; } .block p { padding: 0; }');
  // The namer steps around the source's lead--sel: the lowered `.block p` becomes lead--sel--sel.
  assert.deepEqual(preparedNames(result.html).find(item => item.classes.includes('extra')), { classes: ['lead--sel', 'extra', 'lead--sel--sel'], name: 'lead--sel' });
  assert.equal(preparedNameOf(result.html, 'z'), 'z');
});

test('a data-taptop-name of no-break or other Unicode spaces only counts as absent and does not fail the build', async t => {
  const html = '<section class="block"><p class="title extra" data-taptop-name="&nbsp;&nbsp;">A</p><p class="note" data-taptop-name="    ">B</p><p class="kept" data-taptop-name="Hero title">C</p></section>';
  const { pkg } = await buildPackage(t, { html, css: '.block { display: block; } .title { color: #111111; } .extra { margin: 0; } .note { color: #222222; } .kept { color: #333333; }' });
  assert.equal(named(pkg, 'title').length, 1, 'named after its first own class, as without the attribute');
  assert.equal(named(pkg, 'note').length, 1);
  assert.equal(named(pkg, 'Hero title').length, 1, 'a no-break space inside a name is kept');
});

// `compile <project> <manifest> <out>` (system/bin/taptop.js) compiles prepared
// HTML without the normalizer: data-taptop-name still names the layer, but
// nothing picks the first own class, so a layer without it keeps its last class.
test('the compile route without the normalizer: data-taptop-name names the layer, else the last class', async t => {
  const os = require('node:os');
  const { compileProject } = require('../lib/compile-project');
  const css = '.block { display: block; } .lead { color: #111111; } .extra { margin: 0; } .note { color: #222222; }';
  const result = await normalizeHtmlSource({ htmlText: page('<section class="block"><p class="lead extra">A</p><p class="note">B</p></section>'), cssText: css, componentKey: 'pilot/names' });
  assert.match(result.html, /data-taptop-name="lead"/, 'the normalizer names the first paragraph lead');
  const prepared = result.html.replace(' data-taptop-name="lead"', '').replace('<p class="note"', '<p class="note" data-taptop-name="  Note one  "');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-names-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'taptop.project.json', JSON.stringify({ schemaVersion: 1, toolkitVersion: require('../../package.json').version, namespace: 'pilot' }));
  write(root, result.manifest.html, prepared);
  write(root, result.manifest.stylesheets[0], result.css);
  if (result.manifest.embedStylesheet) write(root, result.manifest.embedStylesheet, result.embedCss);
  if (result.manifest.behaviorManifest) write(root, result.manifest.behaviorManifest, JSON.stringify(result.behaviors));
  write(root, 'source/normalized/manifest.json', JSON.stringify(result.manifest));
  await compileProject(root, 'source/normalized/manifest.json', path.join(root, 'out.json'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'out.json'), 'utf8'));
  assert.equal(named(pkg, 'extra').length, 1);
  assert.equal(named(pkg, 'lead').length, 0);
  assert.equal(named(pkg, 'Note one').length, 1);
});
