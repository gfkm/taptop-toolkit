const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const toolkitSource = require('../lib/toolkit-revision');
const { buildArtifact } = require('../lib/build-artifact');
const { readCatalog, writeCatalog, artifactStatuses } = require('../lib/output-catalog');
const { managedProject } = require('../test-support/managed-project');

// A compiler fix that changes the package but not the normalized input keeps the same sourceRevision; the build must
// still not answer `up-to-date` with the package the earlier code wrote.
test('the Toolkit code revision is the hash of its runtime sources, stable within one copy', () => {
  const revision = toolkitSource.toolkitRevision();
  assert.match(revision, /^[a-f0-9]{64}$/);
  assert.equal(toolkitSource.toolkitRevision(), revision);
  assert.deepEqual(toolkitSource.TOOLKIT_SOURCES, ['package-lock.json', 'system/contracts', 'system/lib']);
  assert.equal(toolkitSource.computeRevision(path.join(__dirname, '..', '..')), revision);
});

// A synthetic Toolkit copy: the hashed sources only.
function copyTree(t, files) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'taptop-revision-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}
const SOURCES = {
  'package-lock.json': '{\n  "lockfileVersion": 3\n}\n',
  'system/lib/a.js': 'const a = 1;\nmodule.exports = a;\n',
  'system/contracts/c.json': '{\n  "c": true\n}\n'
};

test('a CRLF checkout of the same sources has the same revision', t => {
  const lf = toolkitSource.computeRevision(copyTree(t, SOURCES));
  const crlf = toolkitSource.computeRevision(copyTree(t, Object.fromEntries(Object.entries(SOURCES).map(([file, text]) => [file, text.replace(/\n/g, '\r\n')]))));
  assert.equal(crlf, lf);
  // A lone CR is content, not a line ending.
  assert.notEqual(toolkitSource.computeRevision(copyTree(t, { ...SOURCES, 'system/lib/a.js': 'const a = 1;\rmodule.exports = a;\n' })), lf);
});

test('a source of another kind is refused, never skipped or read lossily', t => {
  assert.throws(() => toolkitSource.computeRevision(copyTree(t, { ...SOURCES, 'system/lib/logo.png': 'PNG' })), /TOOLKIT_SOURCE_UNSUPPORTED: system\/lib\/logo\.png/);
  assert.throws(() => toolkitSource.computeRevision(copyTree(t, { ...SOURCES, 'system/contracts/notes': 'x' })), /TOOLKIT_SOURCE_UNSUPPORTED: system\/contracts\/notes/);
});

test('a symbolic link among the sources is refused', t => {
  const root = copyTree(t, SOURCES);
  try { fs.symlinkSync(path.join(root, 'system/lib/a.js'), path.join(root, 'system/lib/b.js')); }
  catch (error) { if (error.code === 'EPERM') return t.skip('symbolic links need Developer Mode on Windows'); throw error; }
  assert.throws(() => toolkitSource.computeRevision(root), /TOOLKIT_SOURCE_UNSUPPORTED: system\/lib\/b\.js is a symbolic link/);
});

test('the dependency lock is part of the revision: parse5 and postcss shape the package', t => {
  const base = toolkitSource.computeRevision(copyTree(t, SOURCES));
  assert.notEqual(toolkitSource.computeRevision(copyTree(t, { ...SOURCES, 'package-lock.json': '{\n  "lockfileVersion": 3,\n  "parse5": "8.0.2"\n}\n' })), base);
  assert.notEqual(toolkitSource.computeRevision(copyTree(t, { ...SOURCES, 'system/lib/a.js': 'const a = 2;\nmodule.exports = a;\n' })), base);
});

test('a build made by other Toolkit code is stale and builds again, even with the same inputs', async t => {
  const { root } = managedProject(t);
  const first = await buildArtifact({ projectRoot: root, artifactKey: 'ui-kit' });
  assert.equal(readCatalog(root).artifacts['ui-kit'].builds[0].toolkitRevision, toolkitSource.toolkitRevision());
  assert.equal((await buildArtifact({ projectRoot: root, artifactKey: 'ui-kit' })).status, 'up-to-date');

  const real = toolkitSource.toolkitRevision;
  t.after(() => { toolkitSource.toolkitRevision = real; });
  toolkitSource.toolkitRevision = () => 'f'.repeat(64);
  const row = artifactStatuses(root).find(item => item.key === 'ui-kit');
  assert.equal(row.status, 'stale');
  assert.ok(row.reasons.includes('built by other Toolkit code'), row.reasons.join('; '));
  const second = await buildArtifact({ projectRoot: root, artifactKey: 'ui-kit' });
  assert.equal(second.status, 'built');
  assert.notEqual(second.buildId, first.buildId);
  assert.equal(second.sourceRevision, first.sourceRevision);
  assert.equal(artifactStatuses(root).find(item => item.key === 'ui-kit').status, 'current');
});

test('a build recorded before the Toolkit kept its code revision is stale and builds again', async t => {
  const { root } = managedProject(t);
  const first = await buildArtifact({ projectRoot: root, artifactKey: 'ui-kit' });
  const catalog = readCatalog(root);
  delete catalog.artifacts['ui-kit'].builds[0].toolkitRevision;
  writeCatalog(root, catalog);
  const row = artifactStatuses(root).find(item => item.key === 'ui-kit');
  assert.equal(row.status, 'stale');
  assert.ok(row.reasons.includes('built by other Toolkit code'), row.reasons.join('; '));
  const second = await buildArtifact({ projectRoot: root, artifactKey: 'ui-kit' });
  assert.equal(second.status, 'built');
  assert.notEqual(second.buildId, first.buildId);
  assert.ok(fs.existsSync(path.join(root, first.jsonPath)), 'the earlier build stays as history');
});
