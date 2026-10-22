// The revision of the Toolkit code that turns sources into a package: a hash of
// every file of its runtime sources. A build records it, and a build made by
// other code is stale (output-catalog.js) and builds again (build-artifact.js):
// a compiler or normalizer fix that changes the package but not the normalized
// input keeps the same sourceRevision, and `up-to-date` would otherwise keep
// the package the earlier code wrote (found 2026-10-16: a fix that kept no-break
// spaces in the package text left every existing build "up-to-date").
// package-lock.json is part of it: the parse5 and postcss versions shape the
// package too. Line endings are read as LF (CRLF -> LF): the repository has no
// .gitattributes, so a Windows checkout may hold CRLF for the same sources.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const TOOLKIT_ROOT = path.join(__dirname, '..', '..');
const TOOLKIT_SOURCES = ['package-lock.json', 'system/contracts', 'system/lib'];

// The kinds of source the hash reads as UTF-8 text. A new kind (an image, a
// binary) is a decision about how to hash it, so it is refused, not skipped.
const TEXT_SOURCE = /\.(?:js|json|md)$/;

function files(root, relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`TOOLKIT_SOURCE_UNSUPPORTED: ${relative} is a symbolic link; the revision hashes real files only`);
  if (stat.isDirectory()) return fs.readdirSync(absolute).flatMap(name => files(root, `${relative}/${name}`));
  if (!stat.isFile() || !TEXT_SOURCE.test(relative)) throw new Error(`TOOLKIT_SOURCE_UNSUPPORTED: ${relative} is not a .js, .json or .md file; decide how the revision hashes it (system/lib/toolkit-revision.js)`);
  return [relative];
}

// Every hashed source is text (.js, .json, .md), so CRLF can be read as LF.
function computeRevision(root) {
  const hash = createHash('sha256');
  for (const file of TOOLKIT_SOURCES.flatMap(source => files(root, source)).sort()) {
    hash.update(`${file}\0`);
    hash.update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'));
    hash.update('\0');
  }
  return hash.digest('hex');
}

let cached;
function toolkitRevision() {
  if (!cached) cached = computeRevision(TOOLKIT_ROOT);
  return cached;
}

module.exports = { TOOLKIT_SOURCES, computeRevision, toolkitRevision };
