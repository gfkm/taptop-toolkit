const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { BEHAVIOR_CLASS, OWN_RULES, INDEXED_PREFIXES, isToolkitClass, ownRuleText } = require('../lib/toolkit-classes');
const { buildAccordionEmbedCode } = require('../lib/accordion-embed-code');
const { buildMenuEmbedCode } = require('../lib/menu-embed-code');

const LIB = path.join(__dirname, '..', 'lib');
const sources = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);

// The normalizer checks the target site's rules for every Toolkit name the package uses; a name missing from the
// registry would never be checked.
test('every toolkit- class name the library writes is in the registry', () => {
  const names = new Set();
  for (const file of sources(LIB)) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?<![\w-])toolkit-[A-Za-z0-9_-]+/g)) names.add(match[0]);
  }
  // Module file names (`require('./toolkit-classes')`) are not class names.
  for (const file of sources(LIB)) names.delete(path.basename(file, '.js'));
  assert.ok(names.size >= 10, [...names].join(', '));
  for (const name of names) {
    const probe = INDEXED_PREFIXES.includes(name) ? `${name}1` : name;
    assert.ok(isToolkitClass(probe), `${name} is not listed in system/lib/toolkit-classes.js`);
  }
});

test('the Toolkit rule for its behavior class has one spelling, shared by every Embed', () => {
  assert.equal(ownRuleText(BEHAVIOR_CLASS), '.toolkit-behavior { display: none; }');
  assert.deepEqual(OWN_RULES[BEHAVIOR_CLASS], [['display', 'none']]);
  assert.ok(buildAccordionEmbedCode({ rootClass: 'a', itemClass: 'b', triggerClass: 'c', panelClass: 'd' }).startsWith(`<style>\n${ownRuleText(BEHAVIOR_CLASS)}\n`));
  assert.ok(buildMenuEmbedCode({ rootClass: 'a', toggleClass: 'b', panelClass: 'c' }).startsWith(`<style>\n${ownRuleText(BEHAVIOR_CLASS)}\n`));
  assert.throws(() => ownRuleText('toolkit-slide-active'), /TOOLKIT_CLASS_UNKNOWN/);
});

// The normalizer's check and the compiler must agree on when the package carries the Embed stylesheet's package
// (an Embed with .toolkit-behavior): one helper decides both.
test('one helper decides whether the Embed stylesheet ships, for the compiler and the normalizer check', () => {
  const { shipsStylesEmbed } = require('../lib/compile-project');
  assert.equal(shipsStylesEmbed(''), false);
  assert.equal(shipsStylesEmbed(' \n\t\f\r'), false);
  assert.equal(shipsStylesEmbed(undefined), false);
  assert.equal(shipsStylesEmbed('.a { color: red; }'), true);
  // CSS whitespace is ASCII: a no-break space is not whitespace there.
  assert.equal(shipsStylesEmbed('\xa0'), true);
  for (const file of ['compile-project.js', 'html-normalizer.js']) {
    assert.match(fs.readFileSync(path.join(LIB, file), 'utf8'), /shipsStylesEmbed\(/, `${file} decides on its own`);
  }
  assert.match(fs.readFileSync(path.join(LIB, 'html-normalizer.js'), 'utf8'), /\{ shipsStylesEmbed \} = require\('\.\/compile-project'\)/);
});
