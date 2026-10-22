const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { initProject } = require('../lib/project');
const { addArtifact } = require('../lib/project-artifacts');
const { buildArtifact } = require('../lib/build-artifact');
const { collapseAsciiWhitespace, trimAsciiWhitespace, isBlankText, splitClassList } = require('../lib/html-whitespace');
const { tempWorkspace, write } = require('../test-support/managed-project');

// U+00A0 NO-BREAK SPACE (written as \xa0) and the other Unicode spaces are text; only ASCII whitespace collapses.
test('html-whitespace collapses and trims ASCII whitespace only', () => {
  assert.equal(collapseAsciiWhitespace(' a \t\n\f\r b '), ' a b ');
  assert.equal(collapseAsciiWhitespace('a\xa0\xa0b'), 'a\xa0\xa0b');
  assert.equal(trimAsciiWhitespace(' \n\xa0a\xa0\t '), '\xa0a\xa0');
  assert.equal(trimAsciiWhitespace('\u{2007}a\u{202f}'), '\u{2007}a\u{202f}');
  assert.equal(isBlankText(' \t\n\f\r'), true);
  assert.equal(isBlankText(''), true);
  assert.equal(isBlankText(undefined), true);
  assert.equal(isBlankText('\xa0'), false);
  assert.equal(isBlankText('\u{feff}'), false);
  assert.deepEqual(splitClassList(' a\tb\nc\xa0d  '), ['a', 'b', 'c\xa0d']);
  assert.deepEqual(splitClassList(undefined), []);
});

test('a built package keeps every no-break space of the page text', async t => {
  const workspace = tempWorkspace(t, 'taptop-nbsp-');
  const root = path.join(workspace, 'projects', 'synthetic-site');
  initProject(root, 'synthetic-site');
  write(root, 'input/demo/index.html', '<!doctype html><html><head><title>Demo</title></head><body><section class="demo-page">'
    + '<h2 class="demo-title">Example&nbsp;heading</h2>'
    + '<p class="demo-lead">&nbsp;lead and tail&nbsp;</p>'
    + '<div class="demo-row"><svg class="demo-icon" width="8" height="8" viewBox="0 0 8 8"><rect width="8" height="8"></rect></svg>&nbsp;12&nbsp;kg</div>'
    + '<a class="demo-link" href="/more">Read&nbsp;more</a>'
    + '</section></body></html>');
  write(root, 'input/demo/styles.css', '.demo-page { display: block; }\n.demo-row { display: flex; }\n.demo-icon { display: block; }\n');
  addArtifact(root, { key: 'pages/demo', html: 'input/demo/index.html', stylesheets: ['input/demo/styles.css'] });
  const built = await buildArtifact({ projectRoot: root, artifactKey: 'pages/demo' });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, built.jsonPath), 'utf8'));
  const texts = Object.values(pkg.clipboardData.copiedLayout.tree.tags).filter(tag => tag.widgetName === 'text').map(tag => tag.data.text.value).sort();
  assert.deepEqual(texts, ['\xa012\xa0kg', '\xa0lead and tail\xa0', 'Example\xa0heading', 'Read\xa0more'].sort());
});
