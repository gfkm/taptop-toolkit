const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { inside } = require('./project');

// Read-only static server for local previews and the comparison tool. It binds
// to 127.0.0.1 only, answers GET/HEAD, and never follows a path or symlink out
// of its root. `mounts` ({ name: folder }) serves several folders under one
// origin instead, each at /<name>/ with the same guards: the comparison tool
// reads both pages in same-origin frames, so a project outside the Toolkit
// folder can be compared with the tool page next to it.
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const MOUNT_NAME = /^(?!\.{1,2}$)[^/\\\0]+$/;

function resolveRoots({ root, mounts }) {
  if (mounts === undefined) return { '': fs.realpathSync(root) };
  const names = Object.keys(mounts || {});
  if (root !== undefined || !names.length) throw new Error('INVALID_SERVER_MOUNT: give either root or a non-empty mounts object');
  for (const name of names) if (!MOUNT_NAME.test(name)) throw new Error(`INVALID_SERVER_MOUNT: «${name}» is not one path segment`);
  return Object.fromEntries(names.map(name => [name, fs.realpathSync(mounts[name])]));
}

// The real file for a request path inside its root, or null: every step that
// can leave the root (the path, a link, the folder's index.html) is checked.
function fileFor(realRoot, relative) {
  const within = file => file === realRoot || inside(realRoot, file);
  let file = fs.realpathSync(path.join(realRoot, relative));
  if (!within(file)) return null;
  if (fs.statSync(file).isDirectory()) {
    file = fs.realpathSync(path.join(file, 'index.html'));
    if (!within(file)) return null;
  }
  return file;
}

function startStaticServer({ root, mounts, port = 4320 }) {
  let roots;
  try { roots = resolveRoots({ root, mounts }); } catch (error) { return Promise.reject(error); }
  const server = http.createServer((request, response) => {
    const send = (status, text) => { response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); response.end(text); };
    if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Method not allowed');
    let relative;
    try { relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch { return send(400, 'Bad request'); }
    if (relative.split('/').includes('..') || relative.includes('\0')) return send(403, 'Forbidden');
    let realRoot = roots[''];
    if (mounts !== undefined) {
      const [, name = '', ...rest] = relative.split('/');
      realRoot = Object.hasOwn(roots, name) ? roots[name] : null;
      if (!realRoot) return send(404, 'Not found');
      relative = `/${rest.join('/')}`;
    }
    try {
      const file = fileFor(realRoot, relative);
      if (!file) return send(403, 'Forbidden');
      const bytes = fs.readFileSync(file);
      response.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      send(404, 'Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startStaticServer };
