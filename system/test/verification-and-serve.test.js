const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildArtifact } = require('../lib/build-artifact');
const { recordCheck } = require('../lib/record-check');
const { readCatalog } = require('../lib/output-catalog');
const { startStaticServer } = require('../lib/static-server');
const { managedProject } = require('../test-support/managed-project');
const { linkOrSkip } = require('../test-support/link');

test('verification levels are recorded separately on the current build only', async t => {
  const { root } = managedProject(t);
  const kit = await buildArtifact({ projectRoot: root, artifactKey: 'ui-kit' });
  assert.throws(() => recordCheck({ projectRoot: root, artifactKey: 'ui-kit', level: 'editor', result: 'passed' }), /EVIDENCE_REQUIRED/);
  recordCheck({ projectRoot: root, artifactKey: 'ui-kit', level: 'local', result: 'passed', note: '8 widths, 0 differences' });
  recordCheck({ projectRoot: root, artifactKey: 'ui-kit', level: 'editor', result: 'failed', note: 'tablet canvas overflow' });
  const build = readCatalog(root).artifacts['ui-kit'].builds[0];
  assert.equal(build.buildId, kit.buildId);
  assert.equal(build.verification.local, 'passed');
  assert.equal(build.verification.editor, 'failed');
  assert.equal(build.verification.published, 'not-recorded');
  assert.equal(build.checks.length, 2);
  assert.ok(fs.readFileSync(path.join(root, 'output/html/index.html'), 'utf8').includes('editor: failed'));
  assert.throws(() => recordCheck({ projectRoot: root, artifactKey: 'ui-kit', level: 'visual', result: 'passed', note: 'x' }), /INVALID_CHECK_LEVEL/);
  assert.throws(() => recordCheck({ projectRoot: root, artifactKey: 'pages/none', level: 'local', result: 'passed', note: 'x' }), /UNKNOWN_ARTIFACT/);
});

test('the local server only serves files under its root, on the loopback interface', async t => {
  const { workspace, root } = managedProject(t);
  await buildArtifact({ projectRoot: root, artifactKey: 'ui-kit' });
  fs.writeFileSync(path.join(path.dirname(workspace), `${path.basename(workspace)}-secret.txt`), 'secret');
  t.after(() => fs.rmSync(path.join(path.dirname(workspace), `${path.basename(workspace)}-secret.txt`), { force: true }));
  const server = await startStaticServer({ root: workspace, port: 0 });
  t.after(() => server.close());
  assert.equal(server.address().address, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(`${base}/projects/synthetic-site/output/html/index.html`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  for (const attempt of ['/../secret.txt', '/%2e%2e/secret.txt', `/..%2f${path.basename(workspace)}-secret.txt`, `/..%5c${path.basename(workspace)}-secret.txt`, '/projects/synthetic-site/../../x']) {
    const response = await fetch(`${base}${attempt}`);
    assert.notEqual(response.status, 200, attempt);
  }
  assert.equal((await fetch(`${base}/projects/synthetic-site/output/html/index.html`, { method: 'POST' })).status, 405);
});

// Two folders under one origin: a tool page and a project elsewhere, so the tool can read the project's pages in
// same-origin frames. Each mount keeps the root's guards.
function mountFolders(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-mounts-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const tool = path.join(base, 'tool');
  const site = path.join(base, 'site');
  const outside = path.join(base, 'outside');
  for (const dir of [tool, path.join(site, 'pages'), outside]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(tool, 'compare.html'), '<p>tool</p>');
  fs.writeFileSync(path.join(site, 'pages', 'index.html'), '<p>site</p>');
  fs.writeFileSync(path.join(site, 'pages', 'photo.jpeg'), 'jpeg');
  fs.writeFileSync(path.join(outside, 'index.html'), 'secret');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
  return { base, tool, site, outside };
}

test('mounts serve several folders under one origin, each with the root guards', async t => {
  const { tool, site, outside } = mountFolders(t);
  linkOrSkip(t, outside, path.join(site, 'linked'), 'dir');
  const server = await startStaticServer({ mounts: { tool, site }, port: 0 });
  t.after(() => server.close());
  assert.equal(server.address().address, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(`${base}/tool/compare.html`)).text(), '<p>tool</p>');
  const index = await fetch(`${base}/site/pages/`);
  assert.equal(await index.text(), '<p>site</p>', 'a folder answers with its index.html');
  assert.equal((await fetch(`${base}/site/pages/photo.jpeg`)).headers.get('content-type'), 'image/jpeg');
  for (const attempt of ['/nothing/compare.html', '/site/..%2ftool%2fcompare.html', '/site/%2e%2e/secret.txt', '/site/..%2fsecret.txt', '/site/linked/index.html', '/site/linked/', '/compare.html', '/', '/site/..%5csecret.txt', '/site/pages%5c..%5c..%5csecret.txt', '/site/..%5c..%5ctool%5ccompare.html']) {
    assert.notEqual((await fetch(`${base}${attempt}`)).status, 200, attempt);
  }
  assert.equal((await fetch(`${base}/tool/compare.html`, { method: 'POST' })).status, 405);
  await assert.rejects(startStaticServer({ mounts: { 'a/b': tool }, port: 0 }), /INVALID_SERVER_MOUNT/);
  await assert.rejects(startStaticServer({ mounts: { '..': tool }, port: 0 }), /INVALID_SERVER_MOUNT/);
  await assert.rejects(startStaticServer({ root: tool, mounts: { tool }, port: 0 }), /INVALID_SERVER_MOUNT/);
  await assert.rejects(startStaticServer({ mounts: {}, port: 0 }), /INVALID_SERVER_MOUNT/);
});

test('a folder whose index.html links out of the root is refused, with a root and with mounts', async t => {
  const { site, outside } = mountFolders(t);
  fs.mkdirSync(path.join(site, 'trap'));
  if (!linkOrSkip(t, path.join(outside, 'index.html'), path.join(site, 'trap', 'index.html'), 'file')) return;
  for (const options of [{ root: site }, { mounts: { site } }]) {
    const server = await startStaticServer({ ...options, port: 0 });
    const base = `http://127.0.0.1:${server.address().port}${options.mounts ? '/site' : ''}`;
    try {
      assert.notEqual((await fetch(`${base}/trap/`)).status, 200);
      assert.notEqual((await fetch(`${base}/trap/index.html`)).status, 200);
    } finally { server.close(); }
  }
});
