// External stylesheets are the target site's own stylesheets (artifact field
// `externalStylesheets`). Their classes already exist on the target: layers
// keep them by name, the package never carries a rule for them, and the page
// must not restyle them. This module reads the sheets and answers which page
// rules would restyle one; the normalizer decides what to do with the answers.
const postcss = require('postcss');
const { RESERVED_CLASS_NAMES } = require('./taptop-system-classes');
const { subjectClasses, parseSelector, splitList, CLASS_SELECTOR, STATE_SELECTOR } = require('./selector-match');

const CLASS_TOKEN = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;
const classTokens = text => [...String(text).matchAll(CLASS_TOKEN)].map(match => match[1]);

// The compounds of a selector (`.a.b > .c` → [['a','b'], ['c']]); classes
// inside :not()/:is() arguments are not members of the compound.
function compoundsOf(selector) {
  let text = selector;
  for (let guard = 0; guard < 10 && /\([^()]*\)/.test(text); guard += 1) text = text.replace(/\([^()]*\)/g, '');
  return text.trim().split(/\s*[>+~]\s*|\s+/).map(classTokens).filter(list => list.length);
}

// sheets: [{ label, text }], each already repaired by the caller.
// - definedClasses: a class with a single-class rule (`.name`, or `.name` with
//   :hover/:focus/:focus-visible/:active) at the top level or in a top-level
//   @media. These are the external classes. Compounds (`.tab.is-open`),
//   relational selectors and pseudo-elements do not define a class. Taptop
//   system names are never external: they keep the reserved-name rename.
// - mentionedClasses: every class any selector mentions; generated class names
//   must avoid all of them.
// - compoundsByClass: for every mentioned class, each compound it appears in,
//   as { others: the compound's other classes, selector }.
// - rules: the plain single-class rules with their raw declarations ({ prop, value, important }; custom
//   properties left out) and media text, for the page's cascade decisions.
// - variables: custom properties of top-level :root/html rules.
// - subjectRules: for every class a block of declarations styles (the class is
//   in the subject, the last compound, of one of its selectors), each such
//   block as { selector, context: the enclosing at-rules or '', declarations:
//   [{ prop, value, important }], plain: it holds only declarations }. A block
//   is a rule at any depth or an at-rule with declarations inside a rule (CSS
//   nesting); a nested selector is resolved against its enclosing rule (`&`,
//   or relative). Keyframes are left out. The Toolkit's own names are checked
//   against it (toolkit-classes.js).
// - selectorRules: the same entries, one per resolved selector of every block.
function readExternalStylesheets(sheets = []) {
  const definedClasses = new Set();
  const mentionedClasses = new Set();
  const compoundsByClass = new Map();
  const subjectRules = new Map();
  const selectorRules = [];
  const rules = [];
  const variables = new Map();
  const texts = [];
  const errors = [];
  for (const sheet of sheets) {
    let ast;
    try { ast = postcss.parse(sheet.text || ''); }
    catch (error) {
      errors.push({ label: sheet.label, message: `${error.reason || error.message}${error.line ? ` (line ${error.line})` : ''}` });
      continue;
    }
    texts.push(sheet.text || '');
    ast.walkRules(rule => {
      for (const name of classTokens(rule.selector)) mentionedClasses.add(name);
      for (const raw of rule.selectors) {
        for (const compound of compoundsOf(raw)) {
          for (const name of compound) {
            if (!compoundsByClass.has(name)) compoundsByClass.set(name, []);
            compoundsByClass.get(name).push({ others: compound.filter(item => item !== name), selector: raw.trim() });
          }
        }
      }
      const parent = rule.parent;
      const atMedia = parent.type === 'atrule' && parent.name === 'media' && parent.parent?.type === 'root';
      if (parent.type !== 'root' && !atMedia) return;
      if (parent.type === 'root' && rule.selectors.some(selector => [':root', 'html'].includes(selector.trim()))) {
        rule.each(decl => { if (decl.type === 'decl' && decl.prop.startsWith('--')) variables.set(decl.prop, decl.value); });
      }
      for (const raw of rule.selectors) {
        const selector = raw.trim();
        const state = STATE_SELECTOR.exec(selector);
        const name = CLASS_SELECTOR.test(selector) ? selector.slice(1) : state ? state[1].slice(1) : null;
        if (!name || RESERVED_CLASS_NAMES.has(name)) continue;
        definedClasses.add(name);
        if (state) continue;
        const declarations = [];
        rule.each(decl => { if (decl.type === 'decl' && !decl.prop.startsWith('--')) declarations.push({ prop: decl.prop.toLowerCase(), value: decl.value, important: Boolean(decl.important) }); });
        rules.push({ mediaParams: atMedia ? parent.params : null, selector, declarations });
      }
    });
    // Every block that holds declarations, nested ones included: a rule, or an
    // at-rule with declarations inside a rule (`.a { @media (…) { color: red } }`).
    ast.walk(node => {
      if (node.type !== 'rule' && !(node.type === 'atrule' && enclosingRule(node))) return;
      if (atRules(node).some(item => /keyframes$/i.test(item.name)) || (node.type === 'atrule' && /keyframes$/i.test(node.name))) return;
      const declarations = [];
      node.each(child => { if (child.type === 'decl') declarations.push({ prop: child.prop.toLowerCase(), value: child.value, important: Boolean(child.important) }); });
      if (node.type === 'atrule' && !declarations.length) return;
      const chain = node.type === 'atrule' ? [...atRules(node), node] : atRules(node);
      const context = chain.map(item => `@${item.name} ${item.params}`).join(' ');
      // Only declarations (and comments) inside: a nested block is a rule of its own.
      const plain = (node.nodes || []).every(child => child.type === 'decl' || child.type === 'comment');
      for (const selector of effectiveSelectors(node.type === 'rule' ? node : enclosingRule(node))) {
        const entry = { selector, context, declarations, plain };
        selectorRules.push(entry);
        for (const name of new Set(subjectClasses(selector))) {
          if (!subjectRules.has(name)) subjectRules.set(name, []);
          subjectRules.get(name).push(entry);
        }
      }
    });
  }
  return { definedClasses, mentionedClasses, compoundsByClass, subjectRules, selectorRules, rules, variables, cssText: texts.join('\n'), errors };
}

// Whether a selector refers to class `name` other than as a plain class of a
// compound: the name as a class inside a pseudo-class argument (:not(), :is(),
// :has() …), or an attribute selector on `class` whose value is part of the
// name or holds it (`[class*="toolkit"]` matches `toolkit-behavior`). `.name`
// as the subject's class is subjectRules; as an earlier compound's class it is
// plain context and allowed. Other attributes and ids are not the class.
// Read with parseSelector (selector-match.js, escapes resolved); a selector it
// cannot read falls back to a conservative scan of the text.
function mentionsBesidesContext(selector, name) {
  const steps = parseSelector(selector);
  return steps ? steps.some(step => compoundMentions(step.compound, name)) : scanMentions(selector, name);
}
function compoundMentions(compound, name) {
  const wanted = name.toLowerCase();
  for (const attr of compound.attrs) {
    const value = String(attr.value ?? '').trim().toLowerCase();
    if (attr.name === 'class' && value && (wanted.includes(value) || value.includes(wanted))) return true;
  }
  return compound.pseudos.some(pseudo => pseudo.arg !== null && splitList(pseudo.arg).some(part => {
    const inner = parseSelector(part.replace(/^[>+~]\s*/, ''));
    // An argument parseSelector cannot read (`2n of .x`): the name anywhere in it is a mention.
    return inner ? inner.some(step => step.compound.classes.includes(name) || compoundMentions(step.compound, name)) : namedIn(part, name);
  }));
}
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The name as a whole word of the text, escapes resolved.
const namedIn = (text, name) => new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`).test(text.replace(/\\(.)/g, '$1'));
// The fallback, on the text with escapes resolved: any occurrence of the name
// that is not `.name` at the top level of a compound.
function scanMentions(raw, name) {
  const selector = raw.replace(/\\(.)/g, '$1');
  const plain = new RegExp(`\\.${escapeRegExp(name)}(?![\\w-])`, 'y');
  let rest = '';
  let depth = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    plain.lastIndex = index;
    if (depth === 0 && char === '.' && plain.test(selector)) { index = plain.lastIndex - 1; rest += ' '; continue; }
    rest += char;
  }
  if (namedIn(rest, name)) return true;
  for (const match of rest.matchAll(/\[\s*class\s*[*^$~|]?=\s*(["']?)([^"'\]]*)\1\s*(?:[is]\s*)?\]/gi)) {
    const value = match[2].trim().toLowerCase();
    if (value && name.toLowerCase().includes(value)) return true;
  }
  return false;
}

// The nearest rule around a node (CSS nesting), across at-rules.
function enclosingRule(node) {
  for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) if (parent.type === 'rule') return parent;
  return null;
}

// A rule's selectors with CSS nesting resolved: `&` stands for each selector
// of the enclosing rule; a nested selector without `&` is relative to it
// (`.x` a descendant, `> .x` a child).
function effectiveSelectors(rule) {
  const own = rule.selectors.map(selector => selector.trim());
  const outer = enclosingRule(rule);
  if (!outer) return own;
  return effectiveSelectors(outer).flatMap(parent => own.map(selector => (selector.includes('&') ? selector.replace(/&/g, parent) : `${parent} ${selector}`)));
}

// The at-rules around a rule, outermost first.
function atRules(rule) {
  const chain = [];
  for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) if (parent.type === 'atrule') chain.unshift(parent);
  return chain;
}

// Page rules whose subject (last compound) carries an external class: in any
// form (state, pseudo-element, compound, inside any at-rule) they would
// restyle a class the target owns. An external class as context only
// (`.site-card .page-text`) styles a page class and is allowed.
function findRedefinitions(ast, definedClasses) {
  const found = [];
  if (!definedClasses.size) return found;
  ast.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    for (const raw of rule.selectors) {
      const selector = raw.trim();
      const names = [...new Set(subjectClasses(selector).filter(name => definedClasses.has(name)))];
      if (!names.length) continue;
      const context = rule.parent?.type === 'atrule' ? `@${rule.parent.name} ${rule.parent.params} ` : '';
      found.push({ selector, names, source: `${context}${selector}` });
    }
  });
  return found;
}

module.exports = { readExternalStylesheets, findRedefinitions, classTokens, mentionsBesidesContext };
