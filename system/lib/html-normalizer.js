// Normalizes arbitrary user HTML/CSS into the prepared-HTML profile that the
// Toolkit compiler accepts. Nothing is dropped silently: every change is a
// report item, and CSS that Taptop classes cannot express is kept verbatim in
// an embed stylesheet that ships to the published page.
const postcss = require('postcss');
const { RESERVED_CLASS_NAMES, renamedClass, counterSafeClass } = require('./taptop-system-classes');
const { parseSelector, staticPart, selectMatching, specificity, CLASS_SELECTOR, STATE_SELECTOR, STRUCTURAL } = require('./selector-match');
const { readExternalStylesheets, findRedefinitions, classTokens, mentionsBesidesContext } = require('./external-stylesheets');
const { trimAsciiWhitespace, collapseAsciiWhitespace, isBlankText, splitClassList, layerName } = require('./html-whitespace');
// No cycle: compile-project.js does not load the normalizer.
const { shipsStylesEmbed } = require('./compile-project');
const { BEHAVIOR_CLASS, OWN_RULES, RUNTIME_CLASSES, isToolkitClass, ownRuleText, purposeOf } = require('./toolkit-classes');
const { validateStepsConfig, stateClassesOf } = require('./steps-embed-code');

const { BREAKPOINTS, MEDIA_ORDER, CHAIN, levelRangeMedia, longhandLeaves, compareRank, cssEscapeIdent, createCascade, planScope, samePlan } = require('./css-cascade');
const STATE_PSEUDO = new Set([':hover', ':focus', ':focus-visible', ':active']);
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'word-spacing',
  'overflow-wrap', 'word-wrap', 'word-break', 'white-space', 'hyphens', 'text-wrap', 'text-indent', 'text-shadow', 'font-variant', 'font-feature-settings', 'font-variation-settings', 'font-stretch', 'text-rendering', 'cursor', 'visibility', 'direction', 'list-style-type', 'tab-size']);
// Properties Taptop's class sync refuses to keep, so they stay in the Embed stylesheet. Each entry is a live import
// failure, never a guess: `transform-box` — «Не удалось обновить класс … (transform-box)», no layers added
// (live import of a canvas board, 2026-10-19).
const CLASS_REJECTED_PROPERTIES = new Set(['transform-box']);
const KEEP_ATTRIBUTES = { a: ['href'], button: ['type'], img: ['src', 'width', 'height', 'alt'] };
const BLOCKED_TAGS = new Set(['script', 'style', 'iframe', 'form', 'input', 'select', 'textarea', 'video', 'audio', 'canvas', 'object', 'embed']);
// Inline formatting a Taptop Rich Text layer keeps verbatim (checked live 2026-10-11).
const RICH_INLINE_TAGS = new Set(['span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'br', 'a', 'sup', 'sub', 'small', 'mark', 'code']);
const isRichText = node => attr(node, 'data-taptop-kind') === 'rich-text';
// Children of an SVG icon or a rich-text block are markup inside one layer, not layers.
const isLeafLayer = node => node.tagName === 'svg' || isRichText(node);
const BORDER_STYLES = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
const TAG_SELECTOR = /^[a-z][a-z0-9]*$/;
// Page defaults observed on a published Taptop site (2026-10-07). Linked only by
// the local preview so it renders like Taptop; it is never part of the package.
const TAPTOP_PREVIEW_CSS = 'body {\n  margin: 0;\n}\n\n* {\n  box-sizing: border-box;\n}\n';
// Every Taptop layer type ships its own base class before the user's classes
// (read from the editor canvas, 2026-10-08). The normalizer neutralizes the
// values the source never asked for; the preview applies the same base with
// zero specificity so a local comparison shows what Taptop will render.
const TAPTOP_BASE = {
  container: { width: '100%', position: 'relative' },
  text: { display: 'inline-flex', 'vertical-align': 'top', position: 'relative', margin: '0' },
  image: { position: 'relative', display: 'inline-flex', 'vertical-align': 'top', overflow: 'hidden', width: '100px', height: '100px' },
  'link-block': { display: 'inline-flex', cursor: 'pointer', 'text-decoration-line': 'none' },
  link: { display: 'inline-flex', cursor: 'pointer' },
  button: { display: 'inline-flex', position: 'relative' },
  // Rich Text layer .tt-rich-text (editor canvas stylesheet, 2026-10-12).
  'rich-text': { display: 'block', position: 'relative', margin: '0', 'max-width': '100%' },
  // SVG Icon layer (editor canvas, 2026-10-11): the inner <svg> fills it.
  svg: { display: 'inline-flex', position: 'relative', width: '32px', height: '32px', overflow: 'hidden', 'align-items': 'center', 'justify-content': 'center' }
};
const NORMALIZER_CONTAINER_TAGS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'ul', 'ol', 'li']);
const BLOCK_TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', ...NORMALIZER_CONTAINER_TAGS]);

function createReport() {
  const items = [];
  const grouped = new Map();
  return {
    items,
    add(level, code, decision, reason, source) {
      items.push({ level, code, decision, reason, ...(source ? { source } : {}) });
    },
    // Aggregates repeated findings (e.g. 40 removed aria attributes) into one item.
    count(level, code, decision, reason, sample) {
      const key = `${code}|${decision}`;
      if (!grouped.has(key)) {
        const item = { level, code, decision, reason, count: 0, samples: [] };
        grouped.set(key, item);
        items.push(item);
      }
      const item = grouped.get(key);
      item.count += 1;
      if (sample && item.samples.length < 5 && !item.samples.includes(sample)) item.samples.push(sample);
    }
  };
}

// ---------- HTML helpers (parse5 tree) ----------

const isElement = node => node && typeof node.tagName === 'string';
const children = node => (node.childNodes || []).filter(isElement);
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const classList = node => splitClassList(attr(node, 'class'));
function setAttr(node, name, value) {
  const existing = node.attrs.find(item => item.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
}
function walk(node, visit) {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}
// The element's own text without its edge ASCII whitespace. A no-break space
// is text (html-whitespace.js), so the layer decisions below agree with what
// the compiler puts in the package.
function directText(node) {
  return trimAsciiWhitespace((node.childNodes || []).filter(child => child.nodeName === '#text').map(child => child.value).join(''));
}
// Every class the normalizer generates is <base><suffix>, or <base><suffix>-b,
// -c … (a trailing -number would read as Taptop's duplicate counter) when a
// class of the page, of its CSS or of an external stylesheet has that name.
function letterSuffix(index) {
  return (index < 25 ? '' : letterSuffix(Math.floor(index / 25) - 1)) + String.fromCharCode(98 + (index % 25));
}
function uniqueClassName(base, suffix, taken) {
  let name = `${base}${suffix}`;
  for (let index = 0; taken.has(name); index += 1) name = `${base}${suffix}-${letterSuffix(index)}`;
  taken.add(name);
  return name;
}
// `unique` gives every call its own name; `shared` gives every element asking
// for the same base and suffix one name (classless siblings, text runs).
// `reserve` records classes added to the page since the last call: call it
// after any pass that adds classes outside the namer. `generatedKind` tells
// what a name the namer made is for (layerNameClass): 'structural' for
// `__<tag>`, `__text`, `__panel` — the BEM element name that gives a classless
// or wrapper element its own identity — and 'lowering' for `--sel`, `--inner`,
// `--base`, `--order`, `--size`, `-inline<n>`, appended to carry a selector's,
// a reset's, an order's or an inline style's values, often to many elements
// and named after the first of them; undefined for any other class.
// `renamed` carries kinds over a source-class rename (renameReservedClasses
// runs after <details> panels are named), so a rename cannot drop one.
const STRUCTURAL_SUFFIX = /^__/;
function createClassNames(document, cssText, mentionedClasses) {
  const taken = new Set(mentionedClasses);
  const shared = new Map();
  const generated = new Map();
  const make = (base, suffix) => {
    const name = uniqueClassName(base, suffix, taken);
    generated.set(name, STRUCTURAL_SUFFIX.test(suffix) ? 'structural' : 'lowering');
    return name;
  };
  const reserve = (css = '') => {
    walk(document, node => { for (const name of classList(node)) taken.add(name); });
    for (const name of classTokens(css)) taken.add(name);
  };
  reserve(cssText);
  return {
    reserve,
    add: name => taken.add(name),
    generatedKind: name => generated.get(name),
    renamed: renames => {
      for (const [from, to] of renames) {
        if (!generated.has(from)) continue;
        generated.set(to, generated.get(from));
        generated.delete(from);
        taken.add(to);
      }
      for (const [key, name] of shared) if (renames.has(name)) shared.set(key, renames.get(name));
    },
    unique: make,
    shared: (base, suffix) => {
      const key = `${base}\u0000${suffix}`;
      if (!shared.has(key)) shared.set(key, make(base, suffix));
      return shared.get(key);
    }
  };
}

// The class a layer is named after (html-normalizer.md, Layer names): its
// first own class (not generated, not `excluded`), else its first structural
// generated class, else its last class. A lowering class names a layer only
// when nothing better is there: one lowered selector puts the same class on
// every element it reaches.
function layerNameClass(classes, { generatedKind, excluded }) {
  return classes.find(name => !excluded(name) && !generatedKind(name))
    || classes.find(name => !excluded(name) && generatedKind(name) === 'structural')
    || classes.at(-1);
}

function describe(node) {
  const cls = classList(node)[0];
  return `<${node.tagName}${cls ? ` class="${cls}"` : ''}>`;
}

function markKnownTildaBehaviors(document, report) {
  const addClass = (node, name) => setAttr(node, 'class', [...classList(node), name].join(' '));
  const descendants = (root, name) => {
    const found = [];
    walk(root, node => { if (node !== root && classList(node).includes(name)) found.push(node); });
    return found;
  };
  walk(document, node => {
    if (attr(node, 'data-taptop-behavior')) return;
    if (classList(node).includes('t-slds') && descendants(node, 't-slds__item').length > 1) {
      addClass(node, `toolkit-slider_${node.__sourceIndex}`);
      setAttr(node, 'data-taptop-behavior', 'slider');
      const style = attr(node, 'style');
      if (style) setAttr(node, 'style', style.replace(/(?:^|;)\s*visibility\s*:\s*hidden\s*;?/i, ';'));
      const first = descendants(node, 't-slds__item')[0];
      addClass(first, 'toolkit-slide-active');
      const bullet = descendants(node, 't-slds__bullet')[0];
      if (bullet) addClass(bullet, 'toolkit-bullet-active');
      report.count('info', 'TILDA_SLIDER_DECLARED', 'slider behavior', 'Tilda slides, arrows and bullets became editable layers with a generated slider behavior.', describe(node));
    } else if (classList(node).includes('t1196') && descendants(node, 't1196__slider').length && descendants(node, 't1196__control').length) {
      addClass(node, `toolkit-carousel_${node.__sourceIndex}`);
      setAttr(node, 'data-taptop-behavior', 'carousel-scroll');
      report.count('info', 'TILDA_CAROUSEL_DECLARED', 'scroll behavior', 'The Tilda card carousel keeps editable cards and gets generated arrow scrolling.', describe(node));
    } else if (classList(node).includes('t-video-lazyload') && attr(node, 'data-videolazy-type') === 'mp4' && attr(node, 'data-videolazy-id')) {
      addClass(node, `toolkit-video_${node.__sourceIndex}`);
      setAttr(node, 'data-taptop-behavior', 'inline-video');
      const poster = attr(node, 'data-videolazy-image');
      if (poster?.startsWith('images/')) {
        const image = { nodeName: 'img', tagName: 'img', attrs: [{ name: 'class', value: 'toolkit-video-poster' }, { name: 'src', value: poster }, { name: 'alt', value: '' }, { name: 'style', value: 'display:block;width:100%;height:100%;object-fit:cover' }], childNodes: [], parentNode: node, namespaceURI: node.namespaceURI };
        node.childNodes = [...(node.childNodes || []), image];
      }
      report.count('info', 'TILDA_INLINE_VIDEO_DECLARED', 'video behavior', 'The source MP4 is loaded by generated video behavior; its poster remains an editable image layer.', describe(node));
    } else if (classList(node).includes('t-popup') && attr(node, 'data-tooltip-hook') && descendants(node, 't1013__html5video').length) {
      addClass(node, `toolkit-video-dialog_${node.__sourceIndex}`);
      setAttr(node, 'data-taptop-behavior', 'video-dialog');
      report.count('info', 'TILDA_VIDEO_DIALOG_DECLARED', 'video dialog behavior', 'The popup shell remains editable and a generated behavior opens its MP4 video from the source link.', describe(node));
    }
  });
}

// Browsers give the obsolete <center> element a special block-centering
// behavior. Taptop imports it as an ordinary div, losing that behavior and
// leaving its constrained child at x=0. Preserve the intent with a dedicated
// class and an Embed rule; direct children stay editable layers.
function normalizeLegacyCenterTags(document, report) {
  let count = 0;
  walk(document, node => {
    if (node.tagName !== 'center') return;
    node.tagName = 'div';
    node.nodeName = 'div';
    setAttr(node, 'class', [...classList(node), 'toolkit-center'].join(' '));
    for (const child of children(node)) setAttr(child, 'class', [...classList(child), 'toolkit-centered-block'].join(' '));
    count += 1;
  });
  if (count) report.count('info', 'LEGACY_CENTER_PRESERVED', 'centered Embed layout', 'A legacy <center> wrapper became an editable container whose direct block child is centered by generated Embed CSS.', '<center>');
  return count;
}

// ---------- CSS helpers ----------

function splitTopLevel(value, separator = /\s/) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && separator.test(char)) {
      if (current) parts.push(current);
      current = '';
    } else current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function mapMedia(params) {
  const normalized = params.trim().toLowerCase().replace(/^only\s+/, '').replace(/^screen\s+and\s+/, '').replace(/\s+/g, ' ');
  const match = /^\(max-width: ?(\d+)px\)$/.exec(normalized);
  return match && BREAKPOINTS[match[1]] ? BREAKPOINTS[match[1]] : null;
}

function expandBox(prop, value) {
  const parts = splitTopLevel(value);
  const [top, right = top, bottom = top, left = right] = parts;
  if (parts.length < 1 || parts.length > 4) return null;
  return { [`${prop}-top`]: top, [`${prop}-right`]: right, [`${prop}-bottom`]: bottom, [`${prop}-left`]: left };
}

function expandBorder(value) {
  let width = null;
  let style = null;
  let color = null;
  for (const token of splitTopLevel(value)) {
    if (!width && /^(?:-?[\d.]+[a-z%]*|thin|medium|thick)$/i.test(token)) width = token;
    else if (!style && BORDER_STYLES.has(token.toLowerCase())) style = token;
    else if (!color) color = token;
    else return null;
  }
  return { width: width || 'medium', style: style || 'none', color: color || 'currentcolor' };
}

// font: [style] [variant] [weight] [stretch] size[/line-height] family.
// Taptop has no font shorthand; its parts are separate class properties.
const FONT_SIZE_TOKEN = /^(?:-?[\d.]+(?:px|em|rem|%|vw|vh|vmin|vmax|pt|ch|ex)|0|(?:clamp|calc|min|max|var)\(.*\)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)(?:\/.+)?$/i;
function expandFont(value) {
  const tokens = splitTopLevel(value);
  const sizeIndex = tokens.findIndex(token => FONT_SIZE_TOKEN.test(token));
  if (sizeIndex < 0 || sizeIndex === tokens.length - 1) return null;
  const result = { 'font-style': 'normal', 'font-weight': '400' };
  for (const token of tokens.slice(0, sizeIndex)) {
    const lower = token.toLowerCase();
    if (lower === 'normal') continue;
    if (lower === 'italic' || lower.startsWith('oblique')) result['font-style'] = lower;
    else if (lower === 'bold') result['font-weight'] = '700';
    else if (/^(bolder|lighter|[1-9]00)$/.test(lower)) result['font-weight'] = lower;
    else if (lower === 'small-caps' || /condensed|expanded/.test(lower)) continue;
    else return null;
  }
  const [size, lineHeight] = splitTopLevel(tokens[sizeIndex].replace('/', ' / ')).filter(token => token !== '/');
  result['font-size'] = size;
  result['line-height'] = lineHeight || 'normal';
  result['font-family'] = tokens.slice(sizeIndex + 1).join(' ').split(',')[0].trim().replace(/^["']|["']$/g, '');
  return result;
}

// Returns longhand declarations Taptop stores reliably, or null to keep as is.
function expandDeclaration(prop, value) {
  if (prop === 'font') return expandFont(value);
  if (prop === 'margin' || prop === 'padding') return expandBox(prop, value);
  if (prop === 'gap') {
    const [row, column = row] = splitTopLevel(value);
    return { 'row-gap': row, 'column-gap': column };
  }
  if (prop === 'place-items') {
    const [align, justify = align] = splitTopLevel(value);
    return { 'align-items': align, 'justify-items': justify };
  }
  const side = /^border(?:-(top|right|bottom|left))?$/.exec(prop);
  if (side) {
    const parts = expandBorder(value);
    if (!parts) return null;
    const sides = side[1] ? [side[1]] : ['top', 'right', 'bottom', 'left'];
    return Object.fromEntries(sides.flatMap(name => [
      [`border-${name}-width`, parts.width], [`border-${name}-style`, parts.style], [`border-${name}-color`, parts.color]
    ]));
  }
  return null;
}

function resolveVariables(value, variables) {
  let result = value;
  for (let guard = 0; guard < 10 && /var\(/.test(result); guard += 1) {
    result = result.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (match, name, fallback) => {
      if (variables.has(name)) return variables.get(name);
      if (fallback !== undefined) return fallback.trim();
      return match;
    });
  }
  return result;
}

function removeNode(node) {
  if (node.parentNode) node.parentNode.childNodes = node.parentNode.childNodes.filter(child => child !== node);
}

// Browsers close blocks left open at the end of a stylesheet; each <style>
// element and each linked file is its own stylesheet. Strings and comments are
// skipped when counting braces.
function closeOpenBlocks(css) {
  let depth = 0;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === '/' && css[index + 1] === '*') { const end = css.indexOf('*/', index + 2); index = end < 0 ? css.length : end + 1; continue; }
    if (char === '"' || char === "'") { let cursor = index + 1; while (cursor < css.length && css[cursor] !== char) cursor += css[cursor] === '\\' ? 2 : 1; index = cursor; continue; }
    if (char === '{') depth++;
    else if (char === '}' && depth > 0) depth--;
  }
  return { css: depth ? `${css}\n${'}'.repeat(depth)}` : css, closed: depth };
}

function repairStylesheet(css, label, report) {
  const { css: repaired, closed } = closeOpenBlocks(css);
  if (closed) report.add('warning', 'CSS_BLOCK_AUTO_CLOSED', `${closed} block(s) closed`, 'The stylesheet ended with an unclosed block; it was closed at its end, as browsers do. Check the source CSS.', label);
  return repaired;
}

// <style> blocks join the cascade after the linked stylesheets, in document order.
function liftStyleBlocks(document, cssText, report) {
  const blocks = [];
  walk(document, node => { if (node.tagName === 'style') blocks.push(node); });
  if (!blocks.length) return cssText;
  const texts = blocks.map((node, index) => repairStylesheet((node.childNodes || []).map(child => child.value || '').join(''), `<style> #${index + 1}`, report));
  blocks.forEach(removeNode);
  report.add('info', 'STYLE_BLOCK_LIFTED', `${blocks.length} block(s)`, 'CSS from <style> elements joined the stylesheet cascade after the linked stylesheets, in document order.', '');
  return [cssText, ...texts].join('\n');
}

// Tilda ships a tiny placeholder in `src` or `background-image`, retaining the
// actual asset in `data-original` until its startup code replaces it. Source
// scripts are deliberately removed from a Taptop package, so make that
// deterministic replacement while both values are still present.
function promoteTildaLazyMedia(document, report) {
  const tildaNode = node => classList(node).some(name => name === 't-bgimg' || /^t(?:-|\d)/.test(name));
  walk(document, node => {
    const original = attr(node, 'data-original');
    if (!original || !tildaNode(node)) return;
    if (node.tagName === 'img' && attr(node, 'src') !== original) {
      setAttr(node, 'src', original);
      report.count('info', 'TILDA_LAZY_IMAGE_PROMOTED', 'original image', 'Tilda keeps the full image in data-original while its source script displays a thumbnail; the prepared image uses the original before scripts are removed.', describe(node));
    }
    const style = attr(node, 'style') || '';
    const background = /background-image\s*:\s*url\(\s*(['"]?)[^)"']+\1\s*\)/i;
    if (!background.test(style)) return;
    setAttr(node, 'style', style.replace(background, (_match, quote) => `background-image: url(${quote}${original}${quote})`));
    report.count('info', 'TILDA_LAZY_BACKGROUND_PROMOTED', 'original background', 'Tilda keeps the full background image in data-original while its source script displays a blurred thumbnail; the prepared background uses the original before scripts are removed.', describe(node));
  });
}

// Source JavaScript is never copied. It is reported once, so the user knows
// which behavior of the original page is not transferred.
function dropScripts(document, report) {
  const scripts = [];
  walk(document, node => { if (node.tagName === 'script') scripts.push(node); });
  if (!scripts.length) return;
  const sources = scripts.map(node => attr(node, 'src') || 'inline');
  scripts.forEach(removeNode);
  report.add('warning', 'SCRIPT_DROPPED', `${scripts.length} script(s) removed`, 'Source JavaScript is not transferred. Interactive parts it drove must come from a Toolkit behavior (accordion, menu) or stay UNSUPPORTED.', [...new Set(sources)].slice(0, 5).join(', '));
}

// Tilda's published markup delegates a few presentational decisions to its
// startup script. Reproduce only the deterministic DOM changes here; source
// JavaScript itself is never copied into the Taptop page.
function applyKnownTildaStaticInitializers(document, report) {
  const scriptText = node => (node.childNodes || []).map(child => child.value || '').join('');
  const descendants = (root, className) => {
    const found = [];
    walk(root, node => { if (node !== root && classList(node).includes(className)) found.push(node); });
    return found;
  };

  // t935__init moves the image off `.t-cover` and onto its carrier. Taptop
  // renders a carrier differently, so retain the image on the editable cover
  // but use the carrier's scroll attachment. `fixed` positions the background
  // against the whole viewport and visibly zooms a half-screen image.
  walk(document, cover => {
    if (!classList(cover).includes('t-cover')) return;
    const carrier = descendants(cover, 't-cover__carrier')[0];
    const source = attr(carrier, 'data-content-cover-bg');
    const style = attr(cover, 'style') || '';
    const image = /background-image\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim();
    if (!carrier || !source || !image) return;
    const thumbnail = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/i.exec(image)?.[2];
    const withOriginal = thumbnail && thumbnail !== source
      ? style.replace(/background-image\s*:\s*url\(\s*(['"]?)[^)'"\s]+\1\s*\)/i, (_match, quote) => `background-image: url(${quote}${source}${quote})`)
      : style;
    const withoutAttachment = withOriginal.replace(/(?:^|;)\s*background-attachment\s*:\s*[^;]+;?/gi, ';').replace(/;?\s*$/, ';');
    setAttr(cover, 'style', `${withoutAttachment} background-attachment: scroll;`);
    if (withOriginal !== style) report.count('info', 'TILDA_COVER_BACKGROUND_PROMOTED', 'original cover background', 'Tilda keeps the cover source on data-content-cover-bg while the cover initially points at a small thumbnail; the prepared cover uses the original before scripts are removed.', describe(cover));
    report.count('info', 'TILDA_COVER_BACKGROUND_SCROLL', 'scroll attachment', 'Tilda startup gives the cover image a carrier-scoped positioning area; the prepared cover keeps the image but uses scroll attachment so its scale matches the source.', describe(cover));
  });

  const defaultHidden = new Set();
  walk(document, node => {
    if (node.tagName !== 'script') return;
    const text = scriptText(node);
    const cards = text.matchAll(/var\s+showBlocks\s*=\s*'([^']*)'\s*;\s*var\s+hideBlocks\s*=\s*'([^']*)'\s*;\s*var\s+card\s*=\s*\{\s*geo\s*:\s*''/g);
    for (const match of cards) for (const id of match[2].split(',').map(value => value.trim()).filter(Boolean)) defaultHidden.add(id);
  });
  if (!defaultHidden.size) return;
  const hidden = [];
  walk(document, node => {
    const id = attr(node, 'id');
    if (id && (defaultHidden.has(id) || (id.startsWith('rec') && defaultHidden.has(id.slice(3))))) hidden.push(node);
  });
  hidden.forEach(removeNode);
  if (hidden.length) report.add('info', 'TILDA_GEO_DEFAULT_APPLIED', `${hidden.length} alternative block(s) removed`, 'Tilda geolocation startup shows the default variant before country detection; alternative blocks are removed so every variant is not displayed together.', [...defaultHidden].slice(0, 5).join(', '));
}

function dropBodyMetadata(document, report) {
  let body;
  walk(document, node => { if (node.tagName === 'body') body = node; });
  if (!body) return;
  const metadata = [];
  walk(body, node => { if (node.tagName === 'meta') metadata.push(node); });
  metadata.forEach(removeNode);
  if (metadata.length) report.add('warning', 'BODY_METADATA_DROPPED', `${metadata.length} tag(s) removed`, 'Body metadata has no editable Taptop layer; set its SEO or preview values separately in Taptop.');
}

// <details>/<summary> become the accordion behavior: details → item,
// summary → trigger, the rest → panel. Native open state becomes is-open.
// The panel class is <item page class>__panel through the class namer.
function detailsToAccordion(document, report, context) {
  const items = [];
  walk(document, node => { if (node.tagName === 'details') items.push(node); });
  if (!items.length) return;
  const panelName = item => context.namer.shared(context.pageClassOf(item) || 'details', '__panel');
  const parents = new Set();
  for (const item of items) {
    const summary = children(item).find(child => child.tagName === 'summary');
    if (!summary) continue;
    const open = item.attrs.some(entry => entry.name === 'open');
    item.attrs = item.attrs.filter(entry => entry.name !== 'open');
    item.tagName = item.nodeName = 'div';
    if (open) {
      setAttr(item, 'class', [...classList(item), 'is-open'].join(' '));
      item.__toolkitOpenClass = 'is-open';
    }
    summary.tagName = summary.nodeName = 'div';
    setAttr(summary, 'role', 'button');
    const rest = (item.childNodes || []).filter(child => child !== summary && (isElement(child) || (child.nodeName === '#text' && !isBlankText(child.value))));
    let panel = rest.length === 1 && isElement(rest[0]) ? rest[0] : null;
    if (!panel) {
      panel = { nodeName: 'div', tagName: 'div', attrs: [{ name: 'class', value: panelName(item) }], childNodes: rest, parentNode: item, namespaceURI: item.namespaceURI };
      for (const child of rest) child.parentNode = panel;
      item.childNodes = [summary, panel];
    }
    setAttr(panel, 'role', 'region');
    parents.add(item.parentNode);
  }
  for (const parent of parents) if (parent && parent.attrs && !attr(parent, 'data-taptop-behavior')) setAttr(parent, 'data-taptop-behavior', 'accordion');
  report.add('info', 'DETAILS_TO_ACCORDION', `${items.length} item(s)`, 'Native <details>/<summary> became the accordion behavior: editable layers in Taptop, opening and closing on the published page.', '');
}

// In a flex or grid container a bare text run is already its own (anonymous)
// item, so wrapping it in a text layer renders identically.
function wrapTextRunsInFlexContainers(document, cssText, report, context) {
  const display = new Map();
  try {
    postcss.parse(cssText).walkRules(rule => {
      if (rule.parent.type !== 'root') return;
      const decl = [...(rule.nodes || [])].reverse().find(node => node.type === 'decl' && node.prop === 'display');
      if (!decl) return;
      for (const selector of rule.selectors) { const match = /^\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)$/.exec(selector.trim()); if (match) display.set(match[1], decl.value.replace(/\s*!important/, '').trim()); }
    });
  } catch { return; }
  const isLayout = value => /^(inline-)?(flex|grid)$/.test(value || '');
  walk(document, node => {
    if (!node.attrs || !directText(node) || !children(node).length) return;
    const inline = /(?:^|;)\s*display\s*:\s*([a-z-]+)/i.exec(attr(node, 'style') || '')?.[1];
    const value = inline || classList(node).map(name => display.get(name)).filter(Boolean).pop();
    if (!isLayout(value)) return;
    const name = context.namer.shared(context.pageClassOf(node) || node.tagName, '__text');
    node.childNodes = node.childNodes.map(child => {
      if (child.nodeName !== '#text' || isBlankText(child.value)) return child;
      const span = { nodeName: 'span', tagName: 'span', attrs: [{ name: 'class', value: name }], childNodes: [], parentNode: node, namespaceURI: node.namespaceURI };
      // A flex item drops the run's edge ASCII whitespace; a no-break space at an edge renders and stays.
      span.childNodes = [{ nodeName: '#text', value: trimAsciiWhitespace(child.value), parentNode: span }];
      return span;
    });
    report.count('info', 'TEXT_RUN_WRAPPED', 'text wrapped', 'A text run beside other elements in a flex/grid container became its own text layer; the layout is unchanged.', name);
  });
}

// Taptop layers keep no id, so an #id rule would lose its element. Each id a
// selector uses becomes a class on that element (id-<id> when the name is
// taken by another class) and #id becomes that class in every selector.
function idSelectorsToClasses(document, cssText, report, context) {
  let ast;
  try { ast = postcss.parse(cssText); } catch { return { cssText, idClasses: new Set() }; }
  const referenced = new Set();
  ast.walkRules(rule => { for (const match of rule.selector.matchAll(/#(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) referenced.add(match[1]); });
  if (!referenced.size) return { cssText, idClasses: new Set() };
  const usedClasses = new Set(context.mentionedClasses);
  walk(document, node => { for (const name of classList(node)) usedClasses.add(name); });
  ast.walkRules(rule => { for (const match of rule.selector.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) usedClasses.add(match[1]); });
  const map = new Map();
  walk(document, node => {
    const id = attr(node, 'id');
    if (!id || !referenced.has(id) || map.has(id)) return;
    const name = usedClasses.has(id) ? `id-${id}` : id;
    map.set(id, name);
    setAttr(node, 'class', [...classList(node), name].join(' '));
  });
  if (!map.size) return { cssText, idClasses: new Set() };
  const pattern = new RegExp(`#(${[...map.keys()].map(id => id.replace(/[-_]/g, '\\$&')).join('|')})(?![\\w-])`, 'g');
  ast.walkRules(rule => { rule.selector = rule.selector.replace(pattern, (match, id) => `.${map.get(id)}`); });
  report.count('info', 'ID_TO_CLASS', 'id selector became a class', 'Taptop layers keep no id; the element got a class for the rules that targeted its id.', [...map.values()].slice(0, 5).join(', '));
  // These classes keep the id's weight in the cascade.
  return { cssText: ast.toString(), idClasses: new Set(map.values()) };
}

// Text mixed with inline formatting becomes one Taptop Rich Text layer whose
// inner HTML is kept verbatim. A link becomes a link block holding it. Mixed
// content with block elements inside stays an error (MIXED_CONTENT).
function markRichText(document, report, context) {
  const candidates = [];
  // Text tags (span, p, h1…) that wrap elements without text of their own.
  const wrappers = [];
  const isTextTag = node => node.tagName && !NORMALIZER_CONTAINER_TAGS.has(node.tagName) && !['a', 'button', 'img', 'svg', 'html', 'body', 'head'].includes(node.tagName);
  const visit = node => {
    if (node.tagName === 'svg' || isRichText(node)) return;
    if (NORMALIZER_CONTAINER_TAGS.has(node.tagName) && children(node).some(child => child.tagName === 'br')) {
      const inner = [];
      walk(node, element => { if (element !== node) inner.push(element); });
      if (inner.every(element => RICH_INLINE_TAGS.has(element.tagName)) && inner.some(element => element.tagName === 'a' || directText(element))) {
        setAttr(node, 'data-taptop-kind', 'rich-text');
        report.count('info', 'INLINE_RUN_AS_RICH_TEXT', 'rich text', 'Inline links and line breaks became one Rich Text layer so the line structure and links stay together.', describe(node));
        return;
      }
    }
    if (node.tagName && directText(node) && children(node).length) { candidates.push(node); return; }
    if (isTextTag(node) && !directText(node) && children(node).length && !attr(node, 'data-taptop-kind')) wrappers.push(node);
    for (const child of children(node)) visit(child);
  };
  visit(document);
  for (const node of wrappers) {
    const inner = [];
    walk(node, element => { if (element !== node) inner.push(element); });
    const inlineOnly = inner.every(element => RICH_INLINE_TAGS.has(element.tagName)) && inner.some(element => directText(element));
    if (inlineOnly && !inner.some(element => isRichText(element))) {
      setAttr(node, 'data-taptop-kind', 'rich-text');
      report.count('info', 'RICH_TEXT_LAYER', 'rich text', 'Text with inline formatting became one Rich Text layer; its inner HTML (bold, line breaks, inner spans and their classes) is kept verbatim.', describe(node));
    } else {
      setAttr(node, 'data-taptop-kind', 'container');
      report.count('info', 'TEXT_TAG_AS_CONTAINER', 'container', 'A text tag that only wraps other blocks became a container layer.', describe(node));
    }
  }
  for (const node of candidates) {
    const inner = [];
    walk(node, element => { if (element !== node) inner.push(element); });
    if (inner.some(element => !RICH_INLINE_TAGS.has(element.tagName))) continue;
    if (node.tagName === 'a') {
      const span = { nodeName: 'span', tagName: 'span', attrs: [{ name: 'class', value: context.namer.shared(context.pageClassOf(node) || 'link', '__text') }, { name: 'data-taptop-kind', value: 'rich-text' }], childNodes: node.childNodes, parentNode: node, namespaceURI: node.namespaceURI };
      for (const child of span.childNodes) child.parentNode = span;
      node.childNodes = [span];
    } else {
      setAttr(node, 'data-taptop-kind', 'rich-text');
    }
    report.count('info', 'RICH_TEXT_LAYER', 'rich text', 'Text with inline formatting became one Rich Text layer; its inner HTML (bold, line breaks, inner spans and their classes) is kept verbatim.', describe(node));
  }
}

const htmlAttribute = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// A source class named like a Taptop system class (button, text, div …) would
// merge with the editor's own class on import. It becomes u-<name> in the HTML,
// in every CSS selector and in the root selector, and the report says so.
// A name Taptop would respell as a duplicate counter (col-1 → col) becomes col_1.
// An external class is the target's existing name and is referenced as it is.
// The name a source class gets in the package (see renameReservedClasses).
function safeClassName(name, externalNames) {
  return RESERVED_CLASS_NAMES.has(name) ? renamedClass(name) : externalNames.has(name) ? name : counterSafeClass(name);
}

function renameReservedClasses(document, cssText, rootSelector, report, external) {
  const externalNames = external.definedClasses;
  const used = new Set();
  walk(document, node => { for (const name of classList(node)) used.add(name); });
  const cssClasses = new Set([...cssText.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map(match => match[1]));
  const safeName = name => safeClassName(name, externalNames);
  // Only classes the page uses: CSS-only names are dropped later as unused rules.
  const reserved = [...used].filter(name => safeName(name) !== name).sort();
  if (!reserved.length) return { cssText, rootSelector, renames: new Map() };
  for (const name of reserved) {
    if (used.has(safeName(name)) || cssClasses.has(safeName(name))) throw new Error(`NORMALIZE_RESERVED_RENAME_CONFLICT: ${name} cannot become ${safeName(name)}, which the source already uses; rename one of them in the source`);
  }
  const map = new Map(reserved.map(name => [name, safeName(name)]));
  walk(document, node => {
    const list = classList(node);
    if (list.some(name => map.has(name))) setAttr(node, 'class', list.map(name => map.get(name) || name).join(' '));
  });
  const pattern = new RegExp(`\\.(${reserved.map(name => name.replace(/[-_]/g, '\\$&')).join('|')})(?![\\w-])`, 'g');
  let renamedCss = cssText;
  try {
    const ast = postcss.parse(cssText);
    ast.walkRules(rule => { rule.selector = rule.selector.replace(pattern, (match, name) => `.${map.get(name)}`); });
    renamedCss = ast.toString();
  } catch { /* the main CSS pass reports the syntax error */ }
  for (const [from, to] of map) {
    if (RESERVED_CLASS_NAMES.has(from) && external.mentionedClasses.has(from)) report.add('warning', 'RESERVED_CLASS_RENAMED', `.${from} → .${to}`, `Taptop uses .${from} for its own layers or base stylesheet, so the source class was renamed to .${to}. The external stylesheet (the target site) defines .${from} too, but a system name is never treated as a site class: Taptop's own rules for it can override the site's. The layer now carries .${to}, which the site does not define, so the site's rules for .${from} are lost on this layer. Use another site class or a page class for these values.`, `.${from}`);
    else if (RESERVED_CLASS_NAMES.has(from)) report.add('warning', 'RESERVED_CLASS_RENAMED', `.${from} → .${to}`, `Taptop uses .${from} for its own layers; the source class was renamed. Use .${to} in the UI kit and other pages too.`, `.${from}`);
    else report.add('warning', 'CLASS_COUNTER_RENAMED', `.${from} → .${to}`, `Taptop reads a trailing -number as its duplicate counter and would store .${from} under another name; the source class was renamed. Use .${to} in the UI kit and other pages too.`, `.${from}`);
  }
  return { cssText: renamedCss, rootSelector: rootSelector && rootSelector.replace(pattern, (match, name) => `.${map.get(name)}`), renames: map };
}

// ---------- main ----------

async function normalizeHtmlSource({ htmlText, cssText, stylesheets, externalStylesheets = [], rootSelector, componentKey = 'page', paths = {} }) {
  const { parse, serialize, serializeOuter } = await import('parse5');
  const report = createReport();
  const files = {
    html: paths.html || 'source/normalized/page.html',
    css: paths.css || 'source/normalized/page.css',
    embedCss: paths.embedCss || 'source/normalized/page.embed.css',
    behaviors: paths.behaviors || 'source/normalized/behaviors.json',
    preview: paths.preview || 'source/normalized/taptop-preview.css'
  };

  // ----- Reserved class names: rename before anything else reads classes -----
  const document = parse(htmlText);
  // Every source element keeps its document-order index through the
  // transformations below, so the original can be keyed like the result.
  let sourceIndex = 0;
  walk(document, node => { if (node.tagName) node.__sourceIndex = sourceIndex++; });
  // Each linked stylesheet is repaired on its own, then they form one cascade in order.
  const linked = stylesheets ? stylesheets.map(sheet => repairStylesheet(sheet.text || '', sheet.label, report)).join('\n') : repairStylesheet(cssText || '', 'stylesheet', report);
  cssText = liftStyleBlocks(document, linked, report);
  // External sheets come first in the cascade (system/lib/external-stylesheets.js).
  const external = readExternalStylesheets(externalStylesheets.map(sheet => ({ label: sheet.label, text: repairStylesheet(sheet.text || '', sheet.label, report) })));
  for (const { label, message } of external.errors) report.add('error', 'CSS_PARSE_ERROR', 'blocked', `The external stylesheet cannot be parsed: ${message}.`, label);
  const isExternal = name => external.definedClasses.has(name);
  // How the external sheets treat one of the Toolkit's own class names
  // (toolkit-classes.js): 'absent' (no rule styles it), 'identical' (one
  // top-level single-class rule with exactly the Toolkit's declarations) or
  // 'different' (anything else that styles it), with the site's rules.
  const declarationKey = ({ prop, value, important }) => `${prop.toLowerCase()}: ${collapseAsciiWhitespace(trimAsciiWhitespace(value)).toLowerCase()}${important ? ' !important' : ''}`;
  const toolkitClassOnSite = name => {
    // Rules with the name as a class of their subject, and any selector naming it other than as plain context.
    const styling = external.subjectRules.get(name) || [];
    const mentions = external.selectorRules.filter(entry => !styling.includes(entry) && mentionsBesidesContext(entry.selector, name));
    const siteRules = [...styling, ...mentions];
    if (!siteRules.length) return { state: 'absent', siteRules };
    const own = OWN_RULES[name]?.map(([prop, value]) => declarationKey({ prop, value, important: false }));
    const [only] = siteRules;
    const identical = own && siteRules.length === 1 && only.plain && !only.context && only.selector === `.${name}`
      && only.declarations.length === own.length && only.declarations.map(declarationKey).every((key, index) => key === own[index]);
    return { state: identical ? 'identical' : 'different', siteRules };
  };
  // The first class of an element that is not external: where derived values and selectors go.
  const pageClassOf = node => classList(node).find(name => !isExternal(name));
  const namer = createClassNames(document, cssText, external.mentionedClasses);
  const context = { isExternal, pageClassOf, namer, mentionedClasses: external.mentionedClasses };
  // A behavior state class (toggled by a script on `toggled` elements, styled
  // by the page's CSS) must not be a class the target site styles there. It
  // clashes when the site defines it, or uses it in a compound whose other
  // classes are all on a toggled element. A compound that cannot reach the
  // element (`.custom-tab.is-open`) passes with an info item.
  const stateClassClash = (toggled, behavior, stateClass, fixedByToolkit) => {
    const node = toggled[0];
    const compounds = external.compoundsByClass.get(stateClass) || [];
    const reaching = compounds.filter(({ others }) => toggled.some(element => others.every(name => classList(element).includes(name))));
    if (!external.definedClasses.has(stateClass) && !reaching.length) {
      if (compounds.length) report.add('info', 'EXTERNAL_STATE_CLASS_COMPOUND', 'allowed', `The ${behavior} behavior toggles .${stateClass}; the external stylesheet uses it only in compounds whose other classes this element does not carry (${[...new Set(compounds.map(item => item.selector))].slice(0, 3).join(', ')}), so the site's rules do not reach it.`, describe(node));
      return false;
    }
    report.add('error', 'EXTERNAL_STATE_CLASS', 'blocked', fixedByToolkit
      ? `The ${behavior} behavior toggles .${stateClass}, which the external stylesheet (the target site) also uses, so the site's rules would apply whenever the state is on. The Toolkit's state name for this behavior is fixed, and the page's CSS is written against it, so it is not renamed; this behavior cannot be used with this site stylesheet until the adapter takes another state class.`
      : `The ${behavior} behavior toggles .${stateClass}, which the external stylesheet (the target site) also uses, so the site's rules would apply whenever the state is on. Rename the state class in the source (HTML and CSS).`, describe(node));
    return true;
  };
  // Values the page needs on an element whose classes are all external. There
  // is no page class to hold them and the Toolkit does not invent one.
  const pageNeeds = new Map();
  const needPageClass = (node, what) => {
    if (!pageNeeds.has(node)) pageNeeds.set(node, new Set());
    pageNeeds.get(node).add(what);
  };
  promoteTildaLazyMedia(document, report);
  applyKnownTildaStaticInitializers(document, report);
  dropScripts(document, report);
  dropBodyMetadata(document, report);
  detailsToAccordion(document, report, context);
  markKnownTildaBehaviors(document, report);
  const legacyCenterCount = normalizeLegacyCenterTags(document, report);
  let classRenames;
  ({ cssText, rootSelector, renames: classRenames } = renameReservedClasses(document, cssText, rootSelector, report, external));
  namer.renamed(classRenames);
  let idClasses;
  ({ cssText, idClasses } = idSelectorsToClasses(document, cssText, report, context));
  namer.reserve(cssText);
  wrapTextRunsInFlexContainers(document, external.cssText ? `${external.cssText}\n${cssText}` : cssText, report, context);
  markRichText(document, report, context);
  walk(document, node => {
    if (node.tagName !== 'button' || !children(node).length || directText(node)) return;
    setAttr(node, 'data-taptop-kind', 'container');
    report.count('warning', 'NESTED_BUTTON_AS_CONTAINER', 'editable container', 'A button wrapping visual layers became a container so its children remain editable. Its click and keyboard action needs a declared behavior adapter.', describe(node));
  });

  // ----- HTML: locate the exported root -----
  const htmlElement = children(document).find(node => node.tagName === 'html');
  const head = children(htmlElement || document).find(node => node.tagName === 'head');
  const body = children(htmlElement || document).find(node => node.tagName === 'body');
  if (!body) throw new Error('NORMALIZE_NO_BODY: the HTML has no <body>');
  let root;
  if (rootSelector) {
    const wanted = rootSelector.replace(/^\./, '');
    walk(body, node => { if (!root && classList(node).includes(wanted)) root = node; });
    if (!root) throw new Error(`NORMALIZE_ROOT_NOT_FOUND: ${rootSelector}`);
  } else if (children(body).length === 1) {
    root = children(body)[0];
  } else {
    root = { nodeName: 'div', tagName: 'div', attrs: [{ name: 'class', value: 'page' }], childNodes: body.childNodes, parentNode: body };
    for (const child of root.childNodes) child.parentNode = root;
    body.childNodes = [root];
    report.add('info', 'ROOT_WRAPPED', 'wrapped', 'The page has several top-level blocks; they were wrapped in one .page root so they import together.');
  }
  const revealTildaRoot = classList(root).includes('t-records');
  // An external root class never becomes a selector of the package.
  const rootByOwnClass = rootSelector && !isExternal(rootSelector.slice(1));
  const revealClass = rootByOwnClass ? rootSelector.slice(1) : 'toolkit-tilda-root';
  if (revealTildaRoot) {
    if (!rootByOwnClass) setAttr(root, 'class', [...classList(root), revealClass].join(' '));
    report.add('info', 'TILDA_ROOT_REVEALED', 'visible root', 'Tilda startup scripts reveal the records root after loading; the prepared page keeps it visible without those scripts.', describe(root));
  }

  // ----- HTML: classes, attributes, unsupported content -----
  const elements = [];
  const innerElements = [];
  const collect = node => {
    elements.push(node);
    if (isLeafLayer(node)) { walk(node, element => { if (element !== node) innerElements.push(element); }); return; }
    for (const child of children(node)) collect(child);
  };
  collect(root);
  const originalAttributes = new Map(elements.map(node => [node, Object.fromEntries(node.attrs.map(item => [item.name, item.value]))]));
  const elementIds = new Map();
  const inlineCounters = new Map();
  const inlineRules = [];

  for (const node of elements) {
    node.childNodes = (node.childNodes || []).filter(child => child.nodeName !== '#comment');
    if (BLOCKED_TAGS.has(node.tagName)) {
      report.add('error', 'UNSUPPORTED_TAG', 'blocked', `<${node.tagName}> has no editable Taptop equivalent yet.`, describe(node));
    }
    if (!classList(node).length) {
      const generated = namer.shared(pageClassOf(node.parentNode || {}) || 'node', `__${node.tagName}`);
      setAttr(node, 'class', generated);
      report.count('info', 'CLASS_GENERATED', 'class added', 'Every Taptop layer needs a class; elements without one got a class derived from their parent.', generated);
    }
    // A link with text and nested elements would lose the elements (the compiler builds a text link).
    if (directText(node) && children(node).length && !isRichText(node)) {
      report.add('error', 'MIXED_CONTENT', 'blocked', 'Text mixed with nested elements is not yet converted; split it into separate text blocks.', describe(node));
    }
    const original = originalAttributes.get(node);
    if (original.id) elementIds.set(original.id, node);
    if (original.style && !pageClassOf(node)) needPageClass(node, 'its inline style');
    else if (original.style) {
      const first = pageClassOf(node);
      const index = (inlineCounters.get(first) || 0) + 1;
      inlineCounters.set(first, index);
      // No hyphen before the number: Taptop would read "-1" as its duplicate counter.
      const generated = namer.unique(first, `-inline${index}`);
      setAttr(node, 'class', [...classList(node), generated].join(' '));
      inlineRules.push({ selector: `.${generated}`, css: original.style });
      report.count('info', 'INLINE_STYLE_TO_CLASS', 'moved to class', 'Inline styles cannot be imported; they became a dedicated class.', generated);
    }
    const keep = new Set(['class', 'data-taptop-key', 'data-taptop-kind', 'data-taptop-name', ...(KEEP_ATTRIBUTES[node.tagName] || [])]);
    // The SVG markup itself (viewBox, size, fill, xmlns …) is the icon's content.
    if (node.tagName === 'svg') for (const item of node.attrs) if (!/^(id|role|tabindex|style|aria-.*|data-.*)$/.test(item.name)) keep.add(item.name);
    node.attrs = node.attrs.filter(item => {
      if (keep.has(item.name)) return true;
      if (item.name === 'data-taptop-behavior' || item.name === 'data-taptop-anchor-prefix' || item.name === 'data-taptop-steps' || item.name === 'style') return false;
      const reason = /^aria-|^role$|^tabindex$/.test(item.name)
        ? 'Accessibility attributes are not stored by Taptop layers; a behavior adapter restores them on the published page.'
        : 'Taptop layers do not carry this attribute.';
      report.count('info', 'ATTRIBUTE_REMOVED', `removed ${item.name}`, reason, describe(node));
      return false;
    });
    // data-taptop-name is the layer's name in the Taptop layer panel (layerNames below); a blank one counts as absent.
    const name = layerName(original['data-taptop-name']);
    if (name) setAttr(node, 'data-taptop-name', name);
    else node.attrs = node.attrs.filter(item => item.name !== 'data-taptop-name');
  }
  // Inside an SVG icon or a rich-text block an element is markup, not a layer: a name there names nothing.
  for (const node of innerElements) node.attrs = node.attrs.filter(item => item.name !== 'data-taptop-name');
  for (const node of elements) {
    const href = attr(node, 'href');
    if (node.tagName === 'a' && href?.startsWith('#') && elementIds.has(href.slice(1))) {
      report.add('warning', 'ANCHOR_TARGET_REMOVED', 'link kept, target id removed', `The link to ${href} needs its target block to get an anchor id in Taptop after import.`, describe(node));
    }
  }

  // ----- HTML: stable keys -----
  const usedKeys = new Set(elements.map(node => attr(node, 'data-taptop-key')).filter(Boolean));
  const keyCounters = new Map();
  for (const node of elements) {
    if (attr(node, 'data-taptop-key')) continue;
    const first = classList(node)[0];
    let key;
    do {
      const next = (keyCounters.get(first) || 0) + 1;
      keyCounters.set(first, next);
      key = `${first}-${next}`;
    } while (usedKeys.has(key));
    usedKeys.add(key);
    setAttr(node, 'data-taptop-key', key);
  }
  const keyOf = node => attr(node, 'data-taptop-key');

  // ----- Behaviors: steps -----
  // The converter writes the config as JSON in data-taptop-steps (adapter
  // taptop/embed-steps-v1, steps-embed-code.js) against the source class
  // names. Structural classes follow the renames above; state classes are the
  // script's own strings and prefixes, so a rename would break them and is
  // refused instead. Every class the config names must exist in the block: a
  // typo would ship a script that finds nothing.
  const stepsParts = node => {
    const refuse = reason => { report.add('error', 'STEPS_CONFIG_INVALID', 'blocked', reason, describe(node)); return null; };
    const raw = originalAttributes.get(node)['data-taptop-steps'];
    if (raw === undefined) return refuse('A steps root needs its config as JSON in data-taptop-steps.');
    let source;
    try { source = JSON.parse(raw); } catch (error) { return refuse(`data-taptop-steps is not JSON: ${error.message}.`); }
    const problems = validateStepsConfig(source);
    if (problems.length) return refuse(`The steps config is invalid: ${problems.join('; ')}.`);
    const respelled = stateClassesOf(source).filter(name => safeClassName(name, external.definedClasses) !== name);
    if (respelled.length) return refuse(`State class ${respelled.map(name => `.${name}`).join(', ')} would be renamed for Taptop (a reserved name, or a trailing -0/-1 Taptop reads as its duplicate counter), which breaks the script's state names; rename the states in the source HTML and CSS.`);
    const rename = name => classRenames.get(name) || name;
    const config = { ...source, rootClass: rename(source.rootClass), itemClass: rename(source.itemClass), hiddenClasses: source.hiddenClasses.map(rename) };
    if (source.panelClass) config.panelClass = rename(source.panelClass);
    if (source.copyClass) config.copyClass = rename(source.copyClass);
    const structural = [config.rootClass, config.itemClass, config.panelClass, config.copyClass, ...config.hiddenClasses].filter(Boolean);
    const siteClasses = structural.filter(isExternal);
    if (siteClasses.length) return refuse(`${siteClasses.map(name => `.${name}`).join(', ')} belongs to the external stylesheet; the steps script must find its parts by page classes.`);
    if (!classList(node).includes(config.rootClass)) return refuse(`The steps root does not carry its rootClass .${config.rootClass}.`);
    if (!classList(node).includes(`${config.statePrefix}0`)) return refuse(`The steps root does not carry state 0 (.${config.statePrefix}0), which the editor and visitors without JavaScript show.`);
    const inside = [];
    walk(node, element => { if (element !== node && element.tagName) inside.push(element); });
    const withClass = name => inside.filter(element => classList(element).includes(name));
    const items = withClass(config.itemClass);
    if (items.length !== config.count) return refuse(`count is ${config.count}, but ${items.length} element(s) of the block carry itemClass .${config.itemClass}.`);
    const panels = config.panelClass ? withClass(config.panelClass) : [];
    if (config.panelClass && panels.length !== config.count) return refuse(`count is ${config.count}, but ${panels.length} element(s) of the block carry panelClass .${config.panelClass}.`);
    const copies = config.copyClass ? withClass(config.copyClass) : [];
    const absent = [...(config.copyClass && !copies.length ? [config.copyClass] : []), ...config.hiddenClasses.filter(name => !withClass(name).length)];
    if (absent.length) return refuse(`The config names ${absent.map(name => `.${name}`).join(', ')}, which no element of the block carries.`);
    // Every state class is checked (and reported) against the target site's rules.
    const clashes = stateClassesOf(config).filter(name => stateClassClash([node], 'steps', name, name === config.startedClass));
    if (clashes.length) return null;
    return { config, nodes: [node, ...items, ...panels, ...copies] };
  };

  // ----- Behaviors: accordion -----
  const behaviors = [];
  const behaviorPanelClasses = new Set();
  for (const node of elements) {
    const marker = originalAttributes.get(node)['data-taptop-behavior'];
    if (!marker) continue;
    if (marker === 'slider' || marker === 'carousel-scroll') {
      const rootClass = classList(node).find(name => name.startsWith(marker === 'slider' ? 'toolkit-slider_' : 'toolkit-carousel_'));
      const itemClass = marker === 'slider' ? 't-slds__item' : 't1196__item';
      const items = [];
      walk(node, element => { if (element !== node && classList(element).includes(itemClass)) items.push(element); });
      if (!rootClass || items.length < 2) {
        report.add('error', 'BEHAVIOR_STRUCTURE', 'blocked', `${marker} needs a unique root class and at least two items.`, describe(node));
        continue;
      }
      const config = { rootClass, mode: marker === 'slider' ? 'slides' : 'scroll', itemClass,
        previousClass: marker === 'slider' ? 't-slds__arrow-left' : 't1196__control_left',
        nextClass: marker === 'slider' ? 't-slds__arrow-right' : 't1196__control_right' };
      if (marker === 'slider') config.bulletClass = 't-slds__bullet';
      behaviors.push({ key: `slider/${keyOf(node)}`, adapter: 'taptop/embed-slider-v1', nodeKeys: [node, ...items].map(keyOf), config });
      report.add('info', 'BEHAVIOR_DECLARED', 'slider embed', `${items.length} editable items; generated ${config.mode} interaction.`, describe(node));
      continue;
    }
    if (marker === 'inline-video' || marker === 'video-dialog') {
      const original = originalAttributes.get(node);
      let src = original['data-videolazy-id'];
      let hook;
      if (marker === 'video-dialog') {
        hook = original['data-tooltip-hook'];
        walk(node, element => { if (element !== node && !src) src = originalAttributes.get(element)?.['data-content-popup-video-url-html5video']; });
      }
      const rootClass = classList(node).find(name => name.startsWith(marker === 'inline-video' ? 'toolkit-video_' : 'toolkit-video-dialog_'));
      if (!rootClass || !/^https:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?$/i.test(src || '') || (hook && !/^#[A-Za-z][\w-]*$/.test(hook))) {
        report.add('error', 'BEHAVIOR_STRUCTURE', 'blocked', 'Video needs a unique root class, a safe HTTPS MP4 URL and a simple popup hook.', describe(node));
        continue;
      }
      const config = { rootClass, mode: marker === 'inline-video' ? 'inline' : 'dialog', src };
      if (hook) config.hook = hook;
      behaviors.push({ key: `video/${keyOf(node)}`, adapter: 'taptop/embed-video-v1', nodeKeys: [keyOf(node)], config });
      report.add('info', 'BEHAVIOR_DECLARED', 'video embed', `Generated ${config.mode} MP4 behavior from the source URL.`, describe(node));
      continue;
    }
    if (marker === 'menu') {
      // Toggle and panel are found by class; the open state is a class on the root.
      const descendants = [];
      walk(node, element => { if (element !== node) descendants.push(element); });
      const byClass = pattern => descendants.find(element => classList(element).some(name => pattern.test(name)));
      const toggle = descendants.find(element => originalAttributes.get(element)?.role === 'button') || byClass(/burger|hamburger|toggle|menu-button|menu-btn/);
      const panel = byClass(/sidebar|drawer|panel|mobile-menu|menu-list|nav-list/);
      const backdrop = byClass(/backdrop|overlay|scrim|shade/);
      if (!toggle || !panel || toggle === panel) {
        report.add('error', 'BEHAVIOR_STRUCTURE', 'blocked', 'The menu needs a toggle (class with burger/toggle) and a panel (class with sidebar/drawer/panel/menu-list).', describe(node));
        continue;
      }
      // The script finds each part by class: a page class, never a site class.
      const parts = [node, toggle, panel, backdrop].filter(Boolean);
      if (parts.some(part => !pageClassOf(part))) {
        for (const part of parts) if (!pageClassOf(part)) needPageClass(part, 'the menu behavior (its script finds this element by class)');
        continue;
      }
      if (stateClassClash([node], 'menu', 'is-open', true)) continue;
      const config = { rootClass: pageClassOf(node), toggleClass: pageClassOf(toggle), panelClass: pageClassOf(panel), openClass: 'is-open' };
      if (backdrop) config.backdropClass = pageClassOf(backdrop);
      const anchorPrefix = originalAttributes.get(node)['data-taptop-anchor-prefix'];
      if (anchorPrefix && /^[_a-zA-Z][_a-zA-Z0-9-]*$/.test(anchorPrefix)) config.anchorPrefix = anchorPrefix;
      behaviors.push({
        key: `menu/${keyOf(node)}`,
        adapter: 'taptop/embed-menu-v1',
        nodeKeys: [node, toggle, panel, backdrop].filter(Boolean).map(keyOf),
        config
      });
      report.add('info', 'BEHAVIOR_DECLARED', 'menu embed', `Menu "${config.rootClass}" opens with "${config.toggleClass}"; the open state is ".${config.rootClass}.is-open" CSS, carried by the embed stylesheet.`, describe(node));
      continue;
    }
    if (marker === 'reveal') {
      // Generic form of the Tilda reveal: the root gets "is-inview" when it scrolls into view, and CSS gated on it
      // (".root.is-inview .x { animation … }") goes to the Embed stylesheet as a script-toggled state selector.
      const targetClass = pageClassOf(node);
      if (!targetClass && classList(node).length) {
        needPageClass(node, 'the reveal behavior (its script and CSS select this element by class)');
        continue;
      }
      if (!targetClass) {
        report.add('error', 'BEHAVIOR_STRUCTURE', 'blocked', 'A reveal root needs a class.', describe(node));
        continue;
      }
      if (stateClassClash([node], 'reveal', 'is-inview', true) || stateClassClash([node], 'reveal', 'toolkit-animate-visible', true)) continue;
      behaviors.push({ key: `reveal/${keyOf(node)}`, adapter: 'taptop/embed-reveal-v1', nodeKeys: [keyOf(node)], config: { targetClass, startedClass: 'is-inview' } });
      report.add('info', 'BEHAVIOR_DECLARED', 'reveal embed', `"${targetClass}" gets "is-inview" when it scrolls into view; CSS gated on that class ships in the Embed stylesheet.`, describe(node));
      continue;
    }
    if (marker === 'steps') {
      const parts = stepsParts(node);
      if (!parts) continue;
      behaviors.push({ key: `steps/${keyOf(node)}`, adapter: 'taptop/embed-steps-v1', nodeKeys: [...new Set(parts.nodes.map(keyOf))], config: parts.config });
      report.add('info', 'BEHAVIOR_DECLARED', 'steps embed', `${parts.config.pattern} "${parts.config.rootClass}" with ${parts.config.count} states; the script switches .${parts.config.statePrefix}N on the root and the CSS gated on it ships in the Embed stylesheet.`, describe(node));
      continue;
    }
    if (marker !== 'accordion') {
      report.add('error', 'BEHAVIOR_UNSUPPORTED', 'blocked', `Behavior "${marker}" has no adapter yet; accordion, menu, reveal and steps are supported.`, describe(node));
      continue;
    }
    const roleOf = element => originalAttributes.get(element)?.role;
    const findIn = (scope, byRole, pattern) => {
      const found = [];
      walk(scope, element => { if (element !== scope) found.push(element); });
      return found.find(element => roleOf(element) === byRole) || found.find(element => classList(element).some(name => pattern.test(name)));
    };
    const items = children(node).map(item => ({
      item,
      trigger: findIn(item, 'button', /trigger|toggle|header|head|question|summary/),
      panel: findIn(item, 'region', /panel|body|content|answer|collapse/)
    })).filter(entry => entry.trigger && entry.panel);
    if (!items.length) {
      report.add('error', 'BEHAVIOR_STRUCTURE', 'blocked', 'The accordion has no items with a trigger and a panel.', describe(node));
      continue;
    }
    // The script finds root, items, triggers and panels by class: page classes only.
    const accordionParts = [node, ...items.flatMap(entry => [entry.item, entry.trigger, entry.panel])];
    if (accordionParts.some(part => !pageClassOf(part))) {
      for (const part of accordionParts) if (!pageClassOf(part)) needPageClass(part, 'the accordion behavior (its script finds this element by class)');
      continue;
    }
    const ownClasses = element => classList(element).filter(name => !isExternal(name));
    const shared = list => list.map(ownClasses).reduce((common, names) => common.filter(name => names.includes(name)));
    // The open state is the class only some items carry, site classes included: a site class there is a clash.
    const allItemClasses = items.map(entry => classList(entry.item));
    const sourceOpenClass = allItemClasses.flat().find(name => allItemClasses.some(list => !list.includes(name)));
    const openClass = sourceOpenClass || 'is-open';
    // `is-open` from an open <details> is the Toolkit's name, not a source class.
    const generatedOpenClass = items.some(entry => entry.item.__toolkitOpenClass === openClass);
    if (stateClassClash(items.map(entry => entry.item), 'accordion', openClass, !sourceOpenClass || generatedOpenClass)) continue;
    const config = {
      rootClass: pageClassOf(node),
      itemClass: shared(items.map(entry => entry.item))[0],
      triggerClass: shared(items.map(entry => entry.trigger))[0],
      panelClass: shared(items.map(entry => entry.panel))[0],
      openClass
    };
    if (Object.values(config).some(value => !value)) {
      report.add('error', 'BEHAVIOR_STRUCTURE', 'blocked', 'Accordion items do not share item, trigger and panel classes (classes of an external stylesheet do not count).', describe(node));
      continue;
    }
    behaviorPanelClasses.add(config.panelClass);
    behaviors.push({
      key: `accordion/${keyOf(node)}`,
      adapter: 'taptop/embed-accordion-v1',
      nodeKeys: [node, ...items.flatMap(entry => [entry.item, entry.trigger, entry.panel])].map(keyOf),
      config
    });
    report.add('info', 'BEHAVIOR_DECLARED', 'accordion embed', `Accordion "${config.rootClass}" becomes editable layers plus a generated embed script.`, describe(node));
  }
  const animationTargets = elements.filter(node => classList(node).includes('t-animate'));
  if (animationTargets.length) {
    behaviors.push({
      key: 'animation/tilda-reveal',
      adapter: 'taptop/embed-reveal-v1',
      nodeKeys: animationTargets.map(keyOf),
      config: { targetClass: 't-animate', startedClass: 't-animate_started' }
    });
    report.add('info', 'TILDA_REVEAL_DECLARED', 'reveal Embed', `${animationTargets.length} Tilda animation target(s) receive an IntersectionObserver reveal script.`, '.t-animate');
  }

  // ----- CSS: collect -----
  let ast;
  try { ast = postcss.parse(cssText || ''); }
  catch (error) {
    report.add('error', 'CSS_PARSE_ERROR', 'blocked', `The CSS cannot be parsed: ${error.reason || error.message}${error.line ? ` (line ${error.line} of the combined CSS)` : ''}.`, '');
    ast = postcss.parse('');
  }
  // A page rule restyling an external class is refused (findRedefinitions).
  const redefined = new Set();
  for (const { selector, names: classes, source } of findRedefinitions(ast, external.definedClasses)) {
    redefined.add(selector);
    report.add('error', 'EXTERNAL_CLASS_REDEFINED', 'blocked', `${classes.map(name => `.${name}`).join(', ')} ${classes.length > 1 ? 'belong' : 'belongs'} to an external stylesheet (the target site's own classes); the package must not restyle them. Put page values on a page class of the element.`, source);
  }
  const variables = new Map();
  ast.walkRules(rule => {
    if (rule.parent.type !== 'root') return;
    if (rule.selectors.some(selector => selector === ':root' || selector === 'html')) {
      rule.walkDecls(decl => { if (decl.prop.startsWith('--')) variables.set(decl.prop, decl.value); });
    }
  });

  // Custom properties inherit through the DOM. Definitions on single-class
  // rules and inline styles are resolved per element, like the browser does;
  // a class takes the context of its first element (others are reported if
  // they would resolve differently).
  const classVarDefs = new Map();
  const varDefinitionBlocks = [];
  ast.walkRules(rule => {
    const defs = (rule.nodes || []).filter(node => node.type === 'decl' && node.prop.startsWith('--'));
    if (!defs.length) return;
    const mediaParams = rule.parent.type === 'atrule' ? rule.parent.params : null;
    varDefinitionBlocks.push({ media: mediaParams, selectors: rule.selectors.map(item => item.trim()), text: `${rule.selector} { ${defs.map(decl => `${decl.prop}: ${decl.value};`).join(' ')} }` });
    if (rule.parent.type !== 'root') return;
    for (const selector of rule.selectors) {
      if (!CLASS_SELECTOR.test(selector.trim())) continue;
      const name = selector.trim().slice(1);
      if (!classVarDefs.has(name)) classVarDefs.set(name, new Map());
      for (const decl of defs) classVarDefs.get(name).set(decl.prop, decl.value);
    }
  });
  for (const { selector, css } of inlineRules) {
    const defs = [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)];
    if (!defs.length) continue;
    const name = selector.slice(1);
    classVarDefs.set(name, new Map(defs.map(match => [match[1], match[2].trim()])));
    varDefinitionBlocks.push({ media: null, selectors: [selector], text: `${selector} { ${defs.map(match => `${match[1]}: ${match[2].trim()};`).join(' ')} }` });
  }
  // A variable redefined inside a media query changes with the viewport: the
  // class keeps the resolved value and the embed repeats the var() form.
  const mediaVariables = new Set();
  ast.walkAtRules('media', atRule => atRule.walkDecls(decl => { if (decl.prop.startsWith('--')) mediaVariables.add(decl.prop); }));
  const definedVariables = new Set([...variables.keys(), ...[...classVarDefs.values()].flatMap(map => [...map.keys()]), ...varDefinitionBlocks.flatMap(block => [...block.text.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]))]);
  const contextsByClass = new Map();
  const assignContexts = (node, inherited) => {
    const context = new Map(inherited);
    for (const name of classList(node)) for (const [prop, value] of classVarDefs.get(name) || []) context.set(prop, value);
    for (const name of classList(node)) {
      if (!contextsByClass.has(name)) contextsByClass.set(name, []);
      contextsByClass.get(name).push(context);
    }
    for (const child of children(node)) assignContexts(child, context);
  };
  if (classVarDefs.size) assignContexts(root, variables);
  // known: the contexts are those of every element the selector reaches (a class or its state), so they settle
  // whether a var() has one value for all of them; a relational or element selector only gets the root values.
  const variablesFor = selector => {
    const name = /^\.([_a-zA-Z-][_a-zA-Z0-9-]*)/.exec(selector || '')?.[1];
    const classSelector = Boolean(name) && (CLASS_SELECTOR.test(selector) || STATE_SELECTOR.test(selector));
    const contexts = classSelector ? contextsByClass.get(name) : null;
    return contexts ? { first: contexts[0], all: contexts, known: true } : { first: variables, all: [variables], known: classSelector && !classVarDefs.size };
  };
  // Every definition of each custom property. The per-element contexts above follow top-level :root, html and
  // single-class rules and inline styles; a definition anywhere else (a media query, a relational or state selector,
  // @property, an external stylesheet) can give an element another value than its context shows.
  const variableDefinitions = new Map();
  const noteDefinition = (name, value, tracked) => {
    if (!variableDefinitions.has(name)) variableDefinitions.set(name, { values: new Set(), tracked: true });
    const definition = variableDefinitions.get(name);
    definition.values.add(value);
    if (!tracked) definition.tracked = false;
  };
  ast.walkDecls(decl => {
    if (!decl.prop.startsWith('--')) return;
    const rule = decl.parent;
    const tracked = rule.type === 'rule' && rule.parent?.type === 'root' && rule.selectors.every(selector => [':root', 'html'].includes(selector.trim()) || CLASS_SELECTOR.test(selector.trim()));
    noteDefinition(decl.prop, decl.value.trim(), tracked);
  });
  for (const { css } of inlineRules) for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) noteDefinition(match[1], match[2].trim(), true);
  ast.walkAtRules('property', atRule => noteDefinition(atRule.params.trim(), null, false));
  for (const match of String(external.cssText || '').matchAll(/(--[\w-]+)\s*:/g)) noteDefinition(match[1], null, false);
  // A var() whose variables have one tracked value each (or none, so the fallback applies) and that resolves the
  // same for every element of its class is a literal: the class holds it and the Embed needs no var() copy, which
  // would only override the class (and every later rule over it) without changing a value.
  const hasOneValue = (value, scope) => {
    if (!scope.known) return false;
    const seen = new Set();
    const settled = text => [...text.matchAll(/var\(\s*(--[\w-]+)/g)].every(([, name]) => {
      if (seen.has(name)) return true;
      seen.add(name);
      const definition = variableDefinitions.get(name);
      if (!definition) return true;
      return definition.tracked && definition.values.size === 1 && settled([...definition.values][0]);
    });
    if (!settled(value)) return false;
    const first = resolveVariables(value, scope.first);
    return !/var\(/.test(first) && scope.all.every(context => resolveVariables(value, context) === first);
  };

  const htmlClasses = new Set(elements.flatMap(classList));
  // Classes and tags that only style markup inside rich text or an SVG icon.
  const innerClasses = new Set(innerElements.flatMap(classList).filter(name => !htmlClasses.has(name)));
  const innerTags = new Set(innerElements.map(node => node.tagName));

  // ----- Relational, attribute and structural selectors -----
  // Taptop keeps no ids, attributes or source structure. A selector that can be
  // decided on the source page gets a class on the elements it reaches; its
  // rule becomes a class rule (or an embed rule on that class for :hover,
  // ::before and media queries Taptop has no breakpoint for).
  const isSource = node => node && node.__sourceIndex !== undefined;
  const sourceDom = {
    tag: node => node.tagName,
    attr: (node, name) => (originalAttributes.has(node) ? originalAttributes.get(node)[name] : attr(node, name)),
    classes: classList,
    parent: node => { let parent = node.parentNode; while (parent?.tagName && !isSource(parent)) parent = parent.parentNode; return parent?.tagName ? parent : null; },
    children: node => children(node).flatMap(child => (isSource(child) ? [child] : sourceDom.children(child))),
    isEmpty: node => !(node.childNodes || []).some(child => child.tagName || (child.nodeName === '#text' && child.value.length))
  };
  const selectorCandidates = [...elements, ...innerElements].filter(isSource);
  const layerSet = new Set(elements);
  const ruleWeights = new Map();
  const selectorClasses = new Map();
  namer.reserve();
  // Classes and attributes that scripts toggle (accordion, tabs, menus) describe
  // a state, not the page: such rules stay in the embed as they are.
  const STATE_CLASS = /^(is|has)-|^(active|open|opened|show|shown|expanded|collapsed|selected|current|hidden|visible|checked|disabled|in)$/;
  const STATE_ATTRIBUTES = new Set(['aria-expanded', 'aria-selected', 'aria-checked', 'aria-pressed', 'aria-current', 'data-state', 'open', 'checked', 'selected', 'disabled']);
  const describesState = steps => steps.some(({ compound }) => compound.classes.some(name => STATE_CLASS.test(name)) || compound.attrs.some(item => STATE_ATTRIBUTES.has(item.name))
    || compound.pseudos.some(pseudo => /^(not|is|where|matches)$/.test(pseudo.name) && /\.(is|has)-|aria-(expanded|selected|checked|pressed|current)/.test(pseudo.arg || '')));
  // A single class or tag (with :hover or ::before) already works in Taptop;
  // only combinators, ids, attributes, structure and tag+class need the page.
  const needsPage = steps => steps.length > 1 || steps.some(({ compound }) => compound.ids.length || compound.attrs.length
    || compound.classes.length > 1
    || compound.pseudos.some(pseudo => !['hover', 'focus', 'focus-visible', 'active'].includes(pseudo.name) && pseudo.name !== 'link')
    || (compound.tag && compound.tag !== '*' && compound.classes.length));
  // Could this selector ever reach an element of the page? States a script
  // toggles and dynamic pseudo-classes are ignored for the question; a rule
  // that still matches nothing is dead weight in the embed, which Taptop caps
  // at 50 000 characters per Embed.
  function reachesPage(selector) {
    if (/^(html|body|:root|\*)$/.test(selector)) return true;
    const steps = parseSelector(selector);
    if (!steps) return true;
    const relaxed = steps.map(({ combinator, compound }) => ({ combinator, compound: {
      ...compound,
      classes: compound.classes.filter(name => !STATE_CLASS.test(name)),
      attrs: compound.attrs.filter(item => !STATE_ATTRIBUTES.has(item.name)),
      pseudos: compound.pseudos.filter(pseudo => STRUCTURAL.has(pseudo.name) && !(/^(not|is|where|matches)$/.test(pseudo.name) && /\.(is|has)-|aria-|:(hover|focus|active|checked)/.test(pseudo.arg || ''))),
      pseudoElement: null
    } }));
    const matched = selectMatching(relaxed, selectorCandidates, sourceDom);
    return matched === null || matched.length > 0;
  }
  function lowerSelector(selector) {
    const steps = parseSelector(selector);
    const split = steps && needsPage(steps) && !describesState(steps) && staticPart(steps);
    if (!split) return null;
    const key = split.steps.map(({ combinator, compound }) => `${combinator || ''}|${JSON.stringify(compound)}`).join(' ');
    if (!selectorClasses.has(key)) {
      const matched = selectMatching(split.steps, selectorCandidates, sourceDom);
      if (!matched || !matched.length) return null;
      const layers = matched.filter(node => layerSet.has(node));
      const inner = matched.filter(node => !layerSet.has(node));
      const baseNode = layers[0] || inner[0];
      const className = namer.unique(pageClassOf(baseNode) || baseNode.tagName, '--sel');
      for (const node of layers.length ? layers : inner) setAttr(node, 'class', [...classList(node), className].join(' '));
      let innerClass = null;
      if (layers.length && inner.length) {
        innerClass = namer.unique(className, '--inner');
        for (const node of inner) setAttr(node, 'class', [...classList(node), innerClass].join(' '));
      }
      selectorClasses.set(key, { className, innerClass, hasLayers: layers.length > 0, hasInner: inner.length > 0, layersOnly: !inner.length, weight: specificity(steps, { idClasses }) });
    }
    return { ...selectorClasses.get(key), suffix: split.suffix };
  }
  const tagsToClasses = new Map();
  const externalOnlyByTag = new Map();
  for (const node of elements) {
    if (!tagsToClasses.has(node.tagName)) tagsToClasses.set(node.tagName, new Set());
    if (pageClassOf(node)) tagsToClasses.get(node.tagName).add(pageClassOf(node));
    else {
      if (!externalOnlyByTag.has(node.tagName)) externalOnlyByTag.set(node.tagName, []);
      externalOnlyByTag.get(node.tagName).push(node);
    }
  }
  // External classes sharing an element with that page class: a property they
  // set wins over an element rule in the source, so the lowered rule skips it.
  const externalPartners = new Map();
  for (const node of elements) {
    const partners = classList(node).filter(isExternal);
    if (!partners.length) continue;
    const key = `${node.tagName}|${pageClassOf(node)}`;
    if (!externalPartners.has(key)) externalPartners.set(key, new Set());
    for (const name of partners) externalPartners.get(key).add(name);
  }
  const classRules = new Map(MEDIA_ORDER.map(media => [media, new Map()]));
  const stateRules = new Map(MEDIA_ORDER.map(media => [media, new Map()]));
  const lowered = [];
  const embedBlocks = [];
  const embedRule = (selector, declarations, mediaParams) => {
    const body = declarations.map(([prop, value]) => `${prop}: ${value};`).join(' ');
    if (!body) return;
    embedBlocks.push({ media: mediaParams || null, text: `${selector} { ${body} }` });
  };

  // Every entry carries `group`, its source declaration's position in the cascade (rules are cleaned in source
  // order), and `important`. A var() declaration repeated in the Embed gives its var() form `varForm` and its
  // resolved values `fromVar`: the class holds those, a rule the Embed carries whole needs only the var() form.
  let declarationOrder = 0;
  function cleanDeclarations(rule, context) {
    const result = [];
    // The variable contexts of the elements the selector reaches, once per rule.
    const scope = variablesFor(context);
    rule.walkDecls(decl => {
      const start = result.length;
      cleanDeclaration(decl, context, scope, result);
      const own = result.slice(start);
      const hasVarForm = own.some(item => item.varForm);
      declarationOrder += 1;
      // sourceProp: the property as written, so a group's longhands come from it and not from the expansion
      // (expandDeclaration writes a border's 12 side longhands, the border shorthand also resets border-image).
      for (const item of own) Object.assign(item, { group: declarationOrder, important: Boolean(decl.important), sourceProp: decl.prop }, hasVarForm && !item.varForm ? { fromVar: true } : {});
    });
    return result;
  }

  function cleanDeclaration(decl, context, scope, result) {
    if (decl.prop.startsWith('--')) {
      // Taptop has no custom-property field. The Embed's definitions block (varDefinitionBlocks: every definition
      // of the page in source order, inline styles last) keeps it and its cascade for consumers beneath the
      // element, so no rule writes it a second time (`definition`).
      report.count('info', 'CUSTOM_PROPERTY_TO_EMBED', 'moved to embed', 'CSS custom properties stay in the Embed stylesheet so dependent declarations retain their source values.', `${context} ${decl.prop}`);
      result.push({ prop: decl.prop, value: decl.value, embedOnly: true, definition: true });
      return;
    }
    const normalizedProp = decl.prop.toLowerCase();
    let value = resolveVariables(decl.value, scope.first);
    let variableEmbedAdded = false;
    // An embed-only declaration (animation, url(), auto margin) resolved from a var() goes before the var() form
    // pushed above, so the var() form wins in the Embed: appended after it, the first element's resolved value
    // overrode every other element's own variable (all entrance delays of a page became the first one's, 2026-10-15).
    const pushEmbedResolved = (prop, resolved) => {
      const entry = { prop, value: resolved, embedOnly: true };
      if (variableEmbedAdded) result.splice(result.length - 1, 0, entry); else result.push(entry);
    };
    if (/var\(/.test(decl.value) && !hasOneValue(decl.value, scope)) {
      // A variable may be defined by a relational selector or on an ancestor,
      // which a Taptop class cannot represent. Keep the original expression
      // after the native fallback so browser CSS supplies the exact value.
      report.count('info', 'VARIABLE_TO_EMBED', 'also in embed', 'A declaration using a CSS variable is repeated in the Embed stylesheet so contextual values survive the class import.', `${context} ${decl.prop}`);
      result.push({ prop: decl.prop, value: decl.value, embedOnly: true, varForm: true });
      variableEmbedAdded = true;
    }
    if ([...decl.value.matchAll(/var\(\s*(--[\w-]+)/g)].some(match => mediaVariables.has(match[1])) && !/var\(/.test(value)) {
      report.count('info', 'VARIABLE_BY_MEDIA', 'also in embed', 'A CSS variable changes in a media query; the class keeps the resolved value and the embed repeats the var() form, so the change still applies.', `${context} ${decl.prop}`);
      if (!variableEmbedAdded) result.push({ prop: decl.prop, value: decl.value, embedOnly: true });
    }
    if (/var\(/.test(decl.value) && scope.all.some(other => resolveVariables(decl.value, other) !== value)) {
      report.count('warning', 'VARIABLE_CONTEXT', 'first context kept', 'Elements sharing this class inherit different values for a CSS variable; the first element\'s value was kept. Give the others their own class.', `${context} ${decl.prop}`);
    }
    if (decl.important) report.count('info', 'IMPORTANT_REMOVED', 'removed !important', 'Taptop class rules have no !important; the value is kept.', `${context} ${decl.prop}`);
    if (/var\(/.test(value)) {
      // A variable defined somewhere still resolves in the embed, whose definitions travel with it.
      const missing = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(match => !definedVariables.has(match[1]));
      if (!missing) { if (!variableEmbedAdded) result.push({ prop: decl.prop, value, embedOnly: true }); return; }
      report.count('warning', 'VARIABLE_UNRESOLVED', 'moved to embed', 'A CSS variable has no value in the element\'s ancestors; the declaration stays in the embed stylesheet.', `${context} ${decl.prop}`);
      if (!variableEmbedAdded) result.push({ prop: decl.prop, value, embedOnly: true });
      return;
    }
    if (/url\(/i.test(value)) {
      report.count('warning', 'URL_TO_EMBED', 'moved to embed', 'Background images and other url() values are not imported into classes.', `${context} ${decl.prop}`);
      pushEmbedResolved(decl.prop, value);
      return;
    }
    if (decl.prop.startsWith('-') || /^(?:webkit|Webkit|moz|Moz|ms|Ms|o|O|khtml|KHTML)[A-Z]/.test(decl.prop)) {
      report.count('info', 'VENDOR_DROPPED', 'removed', 'Vendor-prefixed properties are browser hints that Taptop does not store.', `${context} ${decl.prop}`);
      return;
    }
    if (normalizedProp === 'filter' && /^alpha\s*\(/i.test(value)) {
      report.count('info', 'INVALID_VALUE_DROPPED', 'removed', 'Legacy IE filter syntax is not valid CSS in modern Taptop canvases; the standard declaration, if present, remains.', `${context} ${decl.prop}: ${value}`);
      return;
    }
    if (normalizedProp === 'letter-spacing' && /^-?(?:\d*\.\d+|\d+)$/.test(value) && Number(value) !== 0) {
      report.count('info', 'INVALID_VALUE_DROPPED', 'removed', 'A non-zero letter-spacing needs a CSS unit; browsers ignore this declaration.', `${context} ${decl.prop}: ${value}`);
      return;
    }
    if (/^animation(?:-|$)/.test(normalizedProp)) {
      report.count('info', 'ANIMATION_TO_EMBED', 'moved to embed', 'Taptop does not retain animation declarations on a class; the declaration stays in the Embed stylesheet.', `${context} ${decl.prop}`);
      pushEmbedResolved(decl.prop, value);
      return;
    }
    if (CLASS_REJECTED_PROPERTIES.has(normalizedProp)) {
      report.count('info', 'CLASS_PROPERTY_TO_EMBED', 'moved to embed', 'Taptop class sync does not keep this property; the declaration stays in the Embed stylesheet.', `${context} ${decl.prop}`);
      pushEmbedResolved(decl.prop, value);
      return;
    }
    // Live published-page inspection (2026-10-13): Taptop reads native
    // `{ number: 0, unit: 'auto' }` side margins back as 0px. That pulls
    // constrained source containers to the left edge. Embed CSS preserves
    // auto-centering and remains editable through the surrounding layers.
    // A margin shorthand (`margin: 0 auto`) takes the same route for its auto sides once expanded below; before
    // 2026-10-19 only the longhands did, and centred blocks written with the shorthand lost their centring.
    const autoSide = (prop, side) => (prop === 'margin-left' || prop === 'margin-right') && side.trim().toLowerCase() === 'auto';
    const autoSideToEmbed = prop => report.count('info', 'MARGIN_AUTO_TO_EMBED', 'moved to embed', 'Taptop stores auto side margins as 0px; the Embed stylesheet preserves browser centering.', `${context} ${prop}`);
    if (autoSide(normalizedProp, value)) {
      autoSideToEmbed(decl.prop);
      pushEmbedResolved(decl.prop, value);
      return;
    }
    if (decl.prop === 'font-family') {
      // Taptop fonts are referenced by name only; it keeps no fallback stack.
      const name = value.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (name !== value) report.count('info', 'FONT_NAME', `font-family: ${name}`, 'Taptop fonts are set by name; the fallback list is not stored.', `${context} ${value}`);
      value = name;
    }
    const expanded = expandDeclaration(decl.prop, value);
    if (!expanded) { result.push({ prop: decl.prop, value }); return; }
    for (const [prop, longhand] of Object.entries(expanded)) {
      if (!autoSide(prop, longhand)) { result.push({ prop, value: longhand }); continue; }
      autoSideToEmbed(`${decl.prop} → ${prop}`);
      pushEmbedResolved(prop, longhand);
    }
  }

  // A !important declaration keeps its value against a later normal one of the same class, as in the source.
  const importantProps = new WeakMap();
  const putClass = (store, media, selector, declarations) => {
    const map = store.get(media);
    if (!map.has(selector)) map.set(selector, new Map());
    const target = map.get(selector);
    if (!importantProps.has(target)) importantProps.set(target, new Set());
    const pinned = importantProps.get(target);
    for (const { prop, value, important } of declarations) {
      if (pinned.has(prop) && !important) continue;
      if (important) pinned.add(prop);
      target.delete(prop);
      target.set(prop, value);
    }
  };

  // ----- The source cascade of class rules (css-cascade.js) -----
  // Every declaration of a class rule (a class, a lowered selector's class, an inline style's class, an external
  // class) is recorded with its rank: !important, inline origin, specificity, source order. The class layer (class
  // order, Taptop base resets) and the Embed read winners from the same records. The Embed stylesheet loads after
  // every class rule, so a declaration it carries for a class (a var() copy, an animation, url() or auto side margin)
  // would beat every class rule of equal specificity, including the later modifier, inline style or breakpoint rule
  // that overrode it in the source (a pill gained the border its modifier removed, an overlay lost its inline
  // background: none, 2026-10-19). At output each such declaration is planned with planScope (renderScopedEmbed).
  const inlineClassSelectors = new Set(inlineRules.map(rule => rule.selector));
  // Specificity of a page class: a lowered relational selector keeps the source selector's, a class named after an
  // id an id's; every other class rule is one class.
  const weightOf = selector => {
    const weight = ruleWeights.get(selector) || (idClasses.has(selector.slice(1)) ? [1, 0, 0] : [0, 1, 0]);
    return weight[0] * 1e4 + weight[1] * 1e2 + weight[2];
  };
  const cascade = createCascade();
  const participantByGroup = new Map();
  const participate = (className, level, declarations) => {
    const groups = new Map();
    for (const item of declarations) {
      // Custom properties travel in the definitions block; a var() form stands for its resolved values.
      if (item.definition) continue;
      if (!groups.has(item.group)) groups.set(item.group, { important: item.important, leaves: longhandLeaves(item.sourceProp || item.prop), entries: [] });
      if (!item.fromVar) groups.get(item.group).entries.push({ prop: item.prop, value: item.value });
    }
    const selector = `.${className}`;
    for (const [group, { important, leaves, entries }] of groups) {
      // A declaration the normalizer dropped (vendor prefix, invalid value) takes no part.
      if (!entries.length) continue;
      participantByGroup.set(group, cascade.add({ className, level, leaves, entries, rank: { important: Boolean(important), inline: inlineClassSelectors.has(selector), specificity: weightOf(selector), order: group } }));
    }
  };
  const embedScoped = (className, level, selector, declarations, mediaParams) => {
    const entries = declarations.filter(item => item.embedOnly && !item.definition);
    if (entries.length) embedBlocks.push({ media: mediaParams || null, scoped: { className, level, selector, entries, mediaParams: mediaParams || null } });
  };
  // External rules come first in the source cascade: their order numbers run below every page declaration's.
  const EXTERNAL_ORDER_START = -1e9;
  let externalOrder = EXTERNAL_ORDER_START;

  // The target site's class rules join the cascade first, so the decisions
  // below (Taptop base resets, class order) see them. They are never written out.
  const externalSelectors = new Set();
  // Custom properties are resolved from the sheets' :root/html rules; a value
  // still holding var() stays out of these decisions (it cannot be compared).
  for (const { mediaParams, selector, declarations } of external.rules) {
    const media = mediaParams === null ? 'screen' : mapMedia(mediaParams);
    if (!media || !htmlClasses.has(selector.slice(1))) continue;
    participate(selector.slice(1), media, declarations.map(({ prop, value, important }) => ({ prop, value, important, group: externalOrder++ })));
    const longhands = [];
    for (const { prop, value: raw, important } of declarations) {
      const value = resolveVariables(raw, external.variables);
      if (/var\(/.test(value)) continue;
      const expanded = expandDeclaration(prop, value);
      if (expanded) for (const [longhand, part] of Object.entries(expanded)) longhands.push({ prop: longhand, value: part, important });
      else longhands.push({ prop, value, important });
    }
    putClass(classRules, media, selector, longhands);
    externalSelectors.add(selector);
  }

  for (const { selector, css } of inlineRules) {
    const declarations = cleanDeclarations(postcss.parse(`${selector} { ${css} }`).first, selector);
    putClass(classRules, 'screen', selector, declarations.filter(item => !item.embedOnly));
    participate(selector.slice(1), 'screen', declarations);
    embedScoped(selector.slice(1), 'screen', selector, declarations, null);
  }

  ast.each(node => {
    if (node.type === 'atrule' && node.name === 'media') {
      const media = mapMedia(node.params);
      if (!media) report.count('info', 'MEDIA_TO_EMBED', 'moved to embed', 'This media query is not a Taptop breakpoint (991/767/479 desktop-first); it applies on the published page through the embed stylesheet.', `@media ${node.params}`);
      node.each(rule => { if (rule.type === 'rule') handleRule(rule, media, node.params); });
    } else if (node.type === 'atrule') {
      report.count('info', 'AT_RULE_TO_EMBED', 'moved to embed', `@${node.name} cannot be stored in Taptop classes.`, `@${node.name} ${node.params}`);
      // A relative font file does not travel with the embed: the font renders in a fallback in Taptop.
      if (node.name === 'font-face' && /url\(\s*(?!['"]?(?:https?:|data:|\/\/))/i.test(node.toString())) {
        const family = /font-family\s*:\s*['"]?([^;'"]+)/i.exec(node.toString())?.[1]?.trim() || 'font';
        report.count('warning', 'FONT_FILE_RELATIVE', 'needs the font in Taptop', 'This @font-face points to a font file by a relative path, which does not reach Taptop. Upload the font to the Taptop project (or use a full https:// URL in the source), otherwise text in this font renders in a fallback.', family);
      }
      embedBlocks.push({ media: null, text: node.toString() });
    } else if (node.type === 'rule') handleRule(node, 'screen', null);
  });

  function handleRule(rule, media, mediaParams) {
    for (const rawSelector of rule.selectors) {
      const selector = rawSelector.trim();
      if (redefined.has(selector)) continue;
      const declarations = cleanDeclarations(rule, selector);
      const portable = declarations.filter(item => !item.embedOnly);
      const pairs = list => list.map(item => [item.prop, item.value]);
      const embedOnly = pairs(declarations.filter(item => item.embedOnly && !item.definition));
      // A rule the Embed carries whole: every source declaration once and in source order, a var() one as written.
      // Its resolved values only serve a class; written after the var() form they replaced each element's own value
      // with the first element's (the defect fixed for animations on 2026-10-15, here for whole rules, 2026-10-19).
      // Custom properties are in the definitions block already.
      const whole = (keep = () => true) => pairs(declarations.filter(item => !item.fromVar && !item.definition && (item.embedOnly || keep(item))));
      // :root holds custom properties (the definitions block); its other declarations were never written.
      if (selector === ':root') continue;
      if (!media) {
        // Outside Taptop breakpoints the rule lives in the embed; a relational selector is rewritten to its class.
        if (!reachesPage(selector)) { report.count('info', 'UNUSED_RULE', 'removed', 'No element of the page can match this selector.', selector); continue; }
        const matchedRule = !CLASS_SELECTOR.test(selector) && !STATE_SELECTOR.test(selector) ? lowerSelector(selector) : null;
        if (matchedRule) {
          embedRule(`.${matchedRule.className}${matchedRule.suffix}`, whole(), mediaParams);
          if (matchedRule.innerClass) embedRule(`.${matchedRule.innerClass}${matchedRule.suffix}`, whole(), mediaParams);
        } else embedRule(selector, whole(), mediaParams);
        if (matchedRule) report.count('info', 'SELECTOR_LOWERED', 'class added', 'The selector was matched on the source page; the elements it reaches got a class, and the rule targets that class.', selector);
        continue;
      }
      if (rule.selectors.length > 1) report.count('info', 'GROUP_SPLIT', 'split', 'Grouped selectors became one rule per class.', rule.selector);
      if (CLASS_SELECTOR.test(selector)) {
        const name = selector.slice(1);
        if (!htmlClasses.has(name) && innerClasses.has(name)) {
          report.count('info', 'INNER_STYLE_TO_EMBED', 'moved to embed', 'This class styles markup inside a Rich Text or SVG Icon layer, which has no Taptop class of its own; the rule applies through the embed stylesheet (also in the editor canvas).', selector);
          embedRule(selector, whole(), media === 'screen' ? null : mediaParams);
          continue;
        }
        if (!htmlClasses.has(name)) { report.count('info', 'UNUSED_RULE', 'removed', 'No element in the page uses this class.', selector); continue; }
        participate(name, media, declarations);
        embedScoped(name, media, selector, declarations, mediaParams);
        if (behaviorPanelClasses.has(name)) {
          const display = portable.filter(item => item.prop === 'display');
          if (display.length) {
            embedRule(selector, display.map(item => [item.prop, item.value]), mediaParams && media !== 'screen' ? mediaParams : null);
            report.add('info', 'BEHAVIOR_STATE_TO_EMBED', 'moved to embed', 'The hidden accordion panel state lives in the embed, so every answer stays visible and editable in the editor.', selector);
          }
          putClass(classRules, media, selector, portable.filter(item => item.prop !== 'display'));
          continue;
        }
        putClass(classRules, media, selector, portable);
        continue;
      }
      const state = STATE_SELECTOR.exec(selector);
      if (state && !htmlClasses.has(state[1].slice(1)) && innerClasses.has(state[1].slice(1))) {
        embedRule(selector, whole(), media === 'screen' ? null : mediaParams);
        continue;
      }
      if (state && htmlClasses.has(state[1].slice(1))) {
        embedRule(selector, embedOnly, mediaParams);
        putClass(stateRules, media, selector, portable);
        continue;
      }
      if (selector === '*' || /^\*::?(before|after)$/.test(selector)) {
        const kept = item => !(item.prop === 'box-sizing' && item.value === 'border-box');
        report.add('info', 'GLOBAL_RULE_LOWERED', portable.some(kept) ? 'moved to embed' : 'removed', 'Taptop layers already use border-box sizing.', selector);
        embedRule(selector, whole(kept), mediaParams);
        continue;
      }
      if (selector === 'html') {
        // Taptop scrolls the editor canvas itself; smooth scrolling (the embed
        // stylesheet also loads in the editor) keeps the canvas on the first screen.
        if (portable.some(item => item.prop === 'scroll-behavior')) report.add('warning', 'SCROLL_BEHAVIOR_DROPPED', 'removed', 'scroll-behavior on the document blocks scrolling in the Taptop editor canvas; anchors jump instead of gliding.', selector);
        embedRule(selector, whole(item => item.prop !== 'scroll-behavior'), mediaParams);
        report.add('info', 'GLOBAL_RULE_LOWERED', 'moved to embed', 'Document-level settings apply on the published page through the embed stylesheet.', selector);
        continue;
      }
      // body and element rules depend on the final class rules, so they are lowered after collection.
      if (selector === 'body' || TAG_SELECTOR.test(selector)) {
        // Element rules also reach tags inside rich text, which only the embed can style.
        if (innerTags.has(selector)) embedRule(selector, whole(), media === 'screen' ? null : mediaParams);
        else embedRule(selector, embedOnly, mediaParams);
        lowered.push({ selector, media, mediaParams, declarations: portable });
        continue;
      }
      const matchedRule = lowerSelector(selector);
      if (matchedRule) {
        report.count('info', 'SELECTOR_LOWERED', 'class added', 'The selector was matched on the source page; the elements it reaches got a class, and the rule targets that class.', selector);
        const innerMedia = media === 'screen' ? null : mediaParams;
        if (!matchedRule.suffix && matchedRule.hasLayers) {
          // The class carries the source selector's specificity into its rank.
          ruleWeights.set(`.${matchedRule.className}`, matchedRule.weight);
          participate(matchedRule.className, media, declarations);
          embedScoped(matchedRule.className, media, `.${matchedRule.className}`, declarations, mediaParams);
          putClass(classRules, media, `.${matchedRule.className}`, portable);
          if (matchedRule.innerClass) embedRule(`.${matchedRule.innerClass}`, whole(), innerMedia);
        } else if (matchedRule.hasLayers && /^(:hover|:focus-visible|:focus|:active)$/.test(matchedRule.suffix)) {
          embedRule(`.${matchedRule.className}${matchedRule.suffix}`, embedOnly, mediaParams);
          putClass(stateRules, media, `.${matchedRule.className}${matchedRule.suffix}`, portable);
          if (matchedRule.innerClass) embedRule(`.${matchedRule.innerClass}${matchedRule.suffix}`, whole(), innerMedia);
        } else {
          // ::before, other states, or markup inside a Rich Text/SVG Icon: the embed on the class (also in the editor canvas).
          embedRule(`.${matchedRule.className}${matchedRule.suffix}`, whole(), innerMedia);
          if (matchedRule.innerClass) embedRule(`.${matchedRule.innerClass}${matchedRule.suffix}`, whole(), innerMedia);
        }
        continue;
      }
      if (!reachesPage(selector)) { report.count('info', 'UNUSED_RULE', 'removed', 'No element of the page can match this selector.', selector); continue; }
      report.count('info', 'SELECTOR_TO_EMBED', 'moved to embed', 'Taptop classes cannot express relational, compound or pseudo-element selectors; the rule applies on the published page through the embed stylesheet.', selector);
      embedRule(selector, whole(), mediaParams);
    }
  }

  // ----- Lower global rules onto the classes they reach -----
  // Class rules keep priority; among body/element rules the later one wins.
  // The compiler finds the root by this class; a site class would be no selector of ours.
  const rootClass = pageClassOf(root);
  if (!rootClass) needPageClass(root, 'the root selector of the package (the compiler finds the root by its page class)');
  const classOwned = new Map([...classRules].map(([media, map]) => [media, new Map([...map].map(([selector, props]) => [selector, new Set(props.keys())]))]));
  const ownedBy = (media, selector) => classOwned.get(media).get(selector) || new Set();
  const ownedWith = (media, className, partners) => new Set([...(className ? ownedBy(media, `.${className}`) : []), ...[...(partners || [])].flatMap(name => [...ownedBy(media, `.${name}`)])]);
  // Values lowered from body and element rules, ranked as element selectors in the class layer (classRank).
  const derivedValues = new Set();
  const describeNeeds = (items, from) => `${items.map(item => `${item.prop}: ${item.value}`).join('; ')} (from the ${from} rule)`;
  for (const { selector, media, mediaParams, declarations } of lowered) {
    if (selector === 'body') {
      const owned = ownedWith(media, rootClass, classList(root).filter(isExternal));
      const lifted = declarations.filter(item => (INHERITED.has(item.prop) || item.prop === 'background-color') && !owned.has(item.prop));
      if (!rootClass) { if (lifted.length) needPageClass(root, describeNeeds(lifted, selector)); continue; }
      putClass(classRules, media, `.${rootClass}`, lifted);
      for (const item of lifted) derivedValues.add(`${media}|.${rootClass}|${item.prop}`);
      report.add('info', 'GLOBAL_RULE_LOWERED', `lifted to .${rootClass}`, 'Page-wide text and background settings moved to the root block; body margins do not exist in Taptop.', selector);
      continue;
    }
    const targets = tagsToClasses.get(selector);
    for (const node of externalOnlyByTag.get(selector) || []) {
      const owned = ownedWith(media, null, classList(node));
      const left = declarations.filter(item => !owned.has(item.prop));
      if (left.length) needPageClass(node, describeNeeds(left, selector));
    }
    if (!targets || !targets.size) continue;
    for (const className of targets) {
      const owned = ownedWith(media, className, externalPartners.get(`${selector}|${className}`));
      const kept = declarations.filter(item => !owned.has(item.prop));
      putClass(classRules, media, `.${className}`, kept);
      for (const item of kept) derivedValues.add(`${media}|.${className}|${item.prop}`);
    }
    report.add('info', 'GLOBAL_RULE_LOWERED', `applied to ${targets.size} class(es)`, 'Element rules became class rules on the elements they styled; class values keep priority.', selector);
  }

  // ----- Source cascade helpers -----
  // The rank of a value the class layer holds, from the same records the Embed is planned with (css-cascade.js):
  // of the element's classes the source winner wins, whatever the order in the class attribute. A value lowered
  // from a body or element rule ranks as an element selector, below every class rule; a Taptop base reset
  // (resetValues) below everything, as it stands for "the source left this to the browser".
  const resetValues = new Set();
  const RESET_RANK = { important: false, inline: false, specificity: -1, order: 0 };
  const ELEMENT_RANK = { important: false, inline: false, specificity: 1, order: 0 };
  const classRank = (selector, prop, media) => {
    if (resetValues.has(`${selector}|${prop}`)) return RESET_RANK;
    if (derivedValues.has(`${media}|${selector}|${prop}`)) return ELEMENT_RANK;
    return cascade.rankFor(selector.slice(1), prop, media) || { important: false, inline: inlineClassSelectors.has(selector), specificity: weightOf(selector), order: 0 };
  };
  // Taptop's own result for an element: a breakpoint rule comes after the desktop rules in its stylesheet.
  const ownValue = (node, prop, media) => {
    for (const level of CHAIN[media]) {
      const store = classRules.get(level);
      let best = null;
      for (const name of classList(node)) {
        const selector = `.${name}`;
        const value = store.get(selector)?.get(prop);
        if (value === undefined) continue;
        const rank = classRank(selector, prop, level);
        if (!best || compareRank(rank, best.rank) >= 0) best = { rank, value };
      }
      if (best) return best.value;
    }
    return undefined;
  };
  // Relative and viewport-dependent line-heights (1.5, 120%, 1.2em, clamp …)
  // stay as written: the compiler stores them as custom rules, which Taptop
  // keeps verbatim, so inheritance and every width behave as in the source.
  let customLineHeights = 0;
  for (const store of classRules.values()) for (const [selector, decls] of store) {
    if (externalSelectors.has(selector)) continue;
    const value = decls.get('line-height');
    if (value !== undefined && !/^-?[\d.]+px$/.test(value) && value !== 'normal') customLineHeights += 1;
  }
  if (customLineHeights) report.add('info', 'LINE_HEIGHT_CUSTOM', `${customLineHeights} rule(s)`, 'Relative and fluid line-heights are kept as written; they import as custom values (the native control holds px only).', '');


  // ----- Taptop base classes: undo what the source never set -----
  // A Taptop block is width:100% and position:relative, a text is inline-flex,
  // an image is 100x100. The source left those values to the browser, so the
  // element's own class gets the browser value back (only at screen level,
  // only where no class of any element sharing that class sets the property).
  const kindOf = node => {
    if (node.tagName === 'svg') return 'svg';
    if (isRichText(node)) return 'rich-text';
    if (attr(node, 'data-taptop-kind') === 'container') return 'container';
    if (node.tagName === 'img') return 'image';
    if (node.tagName === 'a') return children(node).length && !directText(node) ? 'link-block' : 'link';
    if (node.tagName === 'button') return 'button';
    if (NORMALIZER_CONTAINER_TAGS.has(node.tagName) && (children(node).length || !directText(node))) return 'container';
    return 'text';
  };
  const KEEP = Symbol('keep Taptop default');
  const layoutParent = node => node.parentNode?.tagName && MEDIA_ORDER.every(media => /^(inline-)?(flex|grid)$/.test(ownValue(node.parentNode, 'display', media) || ''));
  const setsAtScreen = (node, prop) => ownValue(node, prop, 'screen') !== undefined;
  const resets = new Map();
  const wantReset = (node, prop, value) => {
    if (setsAtScreen(node, prop)) return;
    const className = pageClassOf(node);
    if (!className) { if (value !== KEEP) needPageClass(node, `${prop}: ${value} (Taptop gives this layer type another default)`); return; }
    const key = `${className}|${prop}`;
    if (!resets.has(key)) resets.set(key, { className, prop, values: new Set(), votes: [] });
    resets.get(key).values.add(value);
    resets.get(key).votes.push({ node, value });
  };
  // The browser gives an <img> `overflow: clip`; Taptop's image base gives it `hidden`, which makes it a scroll
  // container, and a flex or grid item that is one has a zero automatic minimum size: a 230px image in a narrower
  // `display:flex` tile shrinks to the tile instead of overflowing it, centred and cropped (a real board, source
  // against the local preview at 1440, 2026-10-21).
  // Written for every image the source leaves overflow to, not only for flex and grid items: the parent's display in
  // Taptop is not readable from the class layer alone (link, button and text layers are `inline-flex` by base,
  // and a display can come from an Embed-only rule), and `clip` is what the browser already renders elsewhere.
  // `clip`, not `visible`: an `object-fit: cover` picture would paint outside its box. A single source longhand
  // gets the other axis back, as `hidden` there would turn a `visible` or `clip` axis into `auto`.
  // The value goes to the Embed, never through class sync: Taptop's acceptance of `clip` is unread, and one value
  // class sync refuses fails the whole import (transform-box, CLASS_REJECTED_PROPERTIES). Written at output
  // (imageOverflowEmbed) as the lowest-ranked declaration of the class, so every source overflow wins over it.
  const OVERFLOW_LONGHANDS = longhandLeaves('overflow');
  const IMAGE_OVERFLOW = 'clip';
  const imageOverflow = new Map();
  const wantOverflowReset = node => {
    if (setsAtScreen(node, 'overflow')) return;
    const unset = OVERFLOW_LONGHANDS.filter(prop => !setsAtScreen(node, prop));
    if (!unset.length) return;
    const className = pageClassOf(node);
    if (!className) { needPageClass(node, `overflow: ${IMAGE_OVERFLOW} (Taptop gives this layer type another default)`); return; }
    if (!imageOverflow.has(className)) imageOverflow.set(className, new Set());
    for (const prop of unset.length === OVERFLOW_LONGHANDS.length ? ['overflow'] : unset) imageOverflow.get(className).add(prop);
  };
  for (const node of elements) {
    const kind = kindOf(node);
    // The compiler gives every link and button layer a generated <page class>__fill class.
    if (['link', 'link-block', 'button'].includes(kind) && !pageClassOf(node)) needPageClass(node, 'the <class>__fill class Taptop link and button layers get');
    // The compiler names that fill class after a page class of the layer; it must not be a site class.
    if (['link', 'link-block', 'button'].includes(kind)) {
      for (const name of classList(node).filter(item => !isExternal(item) && external.mentionedClasses.has(`${item}__fill`))) {
        report.add('error', 'EXTERNAL_NAME_COLLISION', 'blocked', `The compiler gives this link or button layer the fill class .${name}__fill (named after its page class .${name}), and the external stylesheet (the target site) already uses .${name}__fill. Rename the page class .${name}.`, describe(node));
      }
    }
    if (kind === 'container') wantReset(node, 'width', 'auto');
    // Rich Text is a block in Taptop; an inline source tag keeps its shrink-to-fit box.
    if (kind === 'rich-text' && !layoutParent(node)) wantReset(node, 'display', BLOCK_TEXT_TAGS.has(node.tagName) ? KEEP : 'inline-block');
    // Inline text keeps Taptop's inline-flex; it still votes, so a class shared
    // by block and inline text is reported instead of breaking one of them.
    // Flex and grid items are blockified, so inline-flex already behaves as block there.
    if (kind === 'text' && !layoutParent(node)) wantReset(node, 'display', BLOCK_TEXT_TAGS.has(node.tagName) ? 'block' : KEEP);
    if (kind === 'image') { wantReset(node, 'width', 'auto'); wantReset(node, 'height', 'auto'); wantOverflowReset(node); }
    // The SVG Icon layer is 32x32 by default and the svg fills it: keep the source size.
    if (kind === 'svg') {
      const size = name => { const value = String(originalAttributes.get(node)?.[name] || ''); return /^\d+(\.\d+)?(px)?$/.test(value) ? `${parseFloat(value)}px` : KEEP; };
      wantReset(node, 'width', size('width'));
      wantReset(node, 'height', size('height'));
    }
  }
  // position:relative changes the containing block of absolute descendants:
  // every unpositioned ancestor between them and their intended block is static.
  const positioned = node => MEDIA_ORDER.some(media => { const value = ownValue(node, 'position', media); return value !== undefined && value !== 'static'; });
  for (const node of elements) {
    if (!MEDIA_ORDER.some(media => ['absolute'].includes(ownValue(node, 'position', media)))) continue;
    for (let parent = node.parentNode; parent?.tagName && elements.includes(parent); parent = parent.parentNode) {
      if (positioned(parent)) break;
      if (kindOf(parent) !== 'link') wantReset(parent, 'position', 'static');
    }
  }
  let baseResets = 0;
  // A reset stands for "the source left this to the browser": any real value
  // from another class of the element wins over it (resetValues, classRank).
  const writeReset = (className, prop, value) => {
    const store = classRules.get('screen');
    if (!store.has(`.${className}`)) store.set(`.${className}`, new Map());
    store.get(`.${className}`).set(prop, value);
    resetValues.add(`.${className}|${prop}`);
    baseResets += 1;
  };
  namer.reserve();
  for (const { className, prop, values, votes } of resets.values()) {
    if (values.size === 1 && values.has(KEEP)) continue;
    if (values.size === 1) { writeReset(className, prop, [...values][0]); continue; }
    // Elements sharing the class need different values: the most common one
    // goes on the class, every other group gets <class>--base[-b …] (sorting
    // after the class); "keep Taptop's default" is written as that default.
    const groups = new Map();
    for (const { node, value } of votes) {
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(node);
    }
    const [[classValue], ...others] = [...groups].sort((a, b) => b[1].length - a[1].length);
    if (classValue !== KEEP) writeReset(className, prop, classValue);
    for (const [value, nodes] of others) {
      const literal = value === KEEP ? TAPTOP_BASE[kindOf(nodes[0])]?.[prop] : value;
      if (literal === undefined) { report.count('warning', 'TAPTOP_BASE_CONFLICT', 'kept Taptop default', 'Elements sharing this class need different values; give them their own class.', `.${className} ${prop}`); continue; }
      const name = namer.unique(className, '--base');
      writeReset(name, prop, literal);
      for (const node of nodes) setAttr(node, 'class', [...classList(node), name].join(' '));
      report.count('info', 'TAPTOP_BASE_VARIANT', 'class added', 'Elements sharing this class need different values for a Taptop layer default; this group got its own class.', `.${name} ${prop}: ${literal}`);
    }
  }
  if (baseResets) report.add('info', 'TAPTOP_BASE_RESET', `${baseResets} value(s)`, 'Taptop layer types carry their own width, display and position; values the source left to the browser were written back on the element class.', '');
  const baseByKind = new Map();
  for (const node of elements) {
    const kind = kindOf(node);
    if (!baseByKind.has(kind)) baseByKind.set(kind, new Set());
    // Taptop gives each layer the base of its type, whatever its classes: one
    // class can sit on a text and on a rich text, so the preview selects elements.
    baseByKind.get(kind).add(`[data-taptop-key="${attr(node, 'data-taptop-key')}"]`);
  }
  const previewCss = TAPTOP_PREVIEW_CSS + [...baseByKind].map(([kind, selectors]) =>
    `\n/* Taptop ${kind} base */\n:where(${[...selectors].join(', ')}) {\n${Object.entries(TAPTOP_BASE[kind]).map(([prop, value]) => `  ${prop}: ${value};`).join('\n')}\n}\n`).join('')
    // In Taptop the icon is a <span class="svg-icon"> wrapper whose <svg> fills it.
    + (baseByKind.has('svg') ? `\n/* Taptop SVG Icon inner svg */\n:where(${[...baseByKind.get('svg')].map(selector => `svg${selector}`).join(', ')}) > * { pointer-events: none; }\n` : '');

  // ----- Class order -----
  // Taptop writes class rules sorted by class name, not in source order
  // (canvas stylesheet read live 2026-10-11). When two classes of one element
  // set the same property, the name sorting later wins there. The output keeps
  // Taptop's order so the local comparison shows Taptop's result, and every
  // element whose winner changes is reported.
  const byTaptopOrder = (a, b) => a.slice(1).localeCompare(b.slice(1), 'en');
  const inlineSelectors = new Set(inlineRules.map(rule => rule.selector));
  const orderConflicts = new Set();
  const overridesByNode = new Map();
  for (const node of elements) {
    const names = classList(node);
    if (names.length < 2) continue;
    for (const media of MEDIA_ORDER) {
      const store = classRules.get(media);
      const rank = (selector, prop) => classRank(selector, prop, media);
      const setters = new Map();
      for (const name of names) {
        const decls = store.get(`.${name}`);
        if (!decls) continue;
        for (const [prop, value] of decls) {
          if (!setters.has(prop)) setters.set(prop, []);
          setters.get(prop).push({ selector: `.${name}`, value });
        }
      }
      for (const [prop, list] of setters) {
        if (list.length < 2 || new Set(list.map(item => item.value)).size < 2) continue;
        const source = [...list].sort((a, b) => compareRank(rank(a.selector, prop), rank(b.selector, prop))).pop();
        const taptop = [...list].sort((a, b) => byTaptopOrder(a.selector, b.selector)).pop();
        if (source.value === taptop.value) continue;
        // A site class among the winners: an order class named after a page
        // class cannot sort after it, and two site classes are the site's own
        // cascade. Nothing is generated; a page value against a site value is reported.
        const externalWinners = [source, taptop].filter(item => isExternal(item.selector.slice(1)));
        if (externalWinners.length) {
          if (externalWinners.length === 1) report.count('warning', 'EXTERNAL_ORDER_UNVERIFIED', 'not resolved', 'A page class and a class of the external stylesheet on this element set the same property. Taptop orders class rules by name and no page class can sort after the site class, so the package cannot force the source winner. Whether Taptop orders site classes and imported classes together is not verified: check this element in the editor.', `${list.map(item => item.selector).join('')} ${prop} @${media}: ${source.selector} ${source.value} vs ${taptop.selector} ${taptop.value}`);
          continue;
        }
        orderConflicts.add(`${list.map(item => item.selector).join('')} ${prop} @${media}: ${source.selector} ${source.value} → ${taptop.selector} ${taptop.value}`);
        if (!overridesByNode.has(node)) overridesByNode.set(node, new Map());
        const perMedia = overridesByNode.get(node);
        if (!perMedia.has(media)) perMedia.set(media, new Map());
        perMedia.get(media).set(prop, source.value);
      }
    }
  }
  // Each such element gets one more class that sorts after all of its classes
  // and repeats the source winners, so Taptop's name order shows the source
  // cascade. Elements with the same classes and winners share the class.
  namer.reserve();
  for (const media of MEDIA_ORDER) for (const selector of [...classRules.get(media).keys(), ...stateRules.get(media).keys()]) namer.add(selector.slice(1));
  const overrideNames = new Map();
  for (const [node, perMedia] of overridesByNode) {
    const classes = classList(node);
    const signature = JSON.stringify([classes, MEDIA_ORDER.map(media => [...(perMedia.get(media) || [])].sort())]);
    if (!overrideNames.has(signature)) {
      const last = classes.filter(item => !isExternal(item)).sort((a, b) => a.localeCompare(b, 'en')).pop();
      const name = namer.unique(last, '--order');
      overrideNames.set(signature, name);
      for (const [media, decls] of perMedia) classRules.get(media).set(`.${name}`, new Map(decls));
      report.count('info', 'CLASS_ORDER_OVERRIDE', 'class added', 'Taptop orders class rules by class name, so another class of this element would win; a class sorting after them repeats the source values.', `.${name}`);
    }
    setAttr(node, 'class', [...classes, overrideNames.get(signature)].join(' '));
  }
  for (const sample of orderConflicts) report.count('info', 'CLASS_ORDER_CONFLICT', 'resolved by an order class', 'Two classes of one element set this property and Taptop, which orders class rules by name, would keep the other value; the element got a class that repeats the source value (CLASS_ORDER_OVERRIDE).', sample);

  // A Taptop image needs width and height on the same screen design class.
  // Relational selectors can put the two dimensions on different classes even
  // when the browser has both values, so give that image one final size class.
  const imageSizeNames = new Map();
  const screenClasses = classRules.get('screen');
  for (const node of elements.filter(item => item.tagName === 'img')) {
    const names = classList(node);
    if (names.some(name => screenClasses.get(`.${name}`)?.has('width') && screenClasses.get(`.${name}`)?.has('height'))) continue;
    const ordered = [...names].sort((a, b) => a.localeCompare(b, 'en'));
    const dimension = prop => ordered.reduce((value, name) => screenClasses.get(`.${name}`)?.get(prop) ?? value, undefined);
    const width = dimension('width');
    const height = dimension('height');
    if (width === undefined || height === undefined) continue;
    const pageNames = ordered.filter(name => !isExternal(name));
    if (!pageNames.length) { needPageClass(node, `width: ${width}; height: ${height} on one class (a Taptop image layer needs both)`); continue; }
    const signature = JSON.stringify([ordered, width, height]);
    if (!imageSizeNames.has(signature)) {
      const last = pageNames[pageNames.length - 1];
      const name = namer.unique(last, '--size');
      screenClasses.set(`.${name}`, new Map([['width', width], ['height', height]]));
      imageSizeNames.set(signature, name);
      report.count('info', 'IMAGE_DIMENSIONS_JOINED', 'class added', 'Taptop image layers need width and height on one screen class; values split across classes were repeated together.', `.${name}`);
    }
    setAttr(node, 'class', [...names, imageSizeNames.get(signature)].join(' '));
  }

  // ----- Layer names: the first own class, not the last class -----
  // The compiler names a layer by data-taptop-name, else by its last class
  // (ir-to-taptop.js). The classes this normalizer appends, the Toolkit's own
  // classes and the target site's would name dozens of layers alike, so the
  // name comes from layerNameClass. Written only where it differs from the last class.
  for (const node of elements) {
    if (attr(node, 'data-taptop-name')) continue;
    const classes = classList(node);
    const name = layerNameClass(classes, {
      generatedKind: namer.generatedKind,
      excluded: className => isExternal(className) || isToolkitClass(className) || className === node.__toolkitOpenClass
    });
    if (name !== classes.at(-1)) setAttr(node, 'data-taptop-name', name);
  }

  for (const [node, needs] of pageNeeds) {
    report.add('error', 'EXTERNAL_ONLY_ELEMENT', 'blocked', `This element needs a page class for ${[...needs].join('; ')}. All of its classes belong to an external stylesheet (the target site), which the package never restyles, and the Toolkit does not invent a class name. Add a page class to the element in the source.`, `${describe(node)} ${attr(node, 'data-taptop-key') || ''}`.trim());
  }
  const externalOnLayers = [...new Set(elements.flatMap(classList).filter(isExternal))].sort();
  if (externalOnLayers.length) report.add('info', 'EXTERNAL_CLASSES_USED', `${externalOnLayers.length} class(es) by name`, 'These classes belong to an external stylesheet (the target site): layers keep them by name, and the package carries no rules for them (externalClasses).', externalOnLayers.slice(0, 5).join(', '));

  // ----- Embed declarations of class rules: written where they win the source cascade -----
  // The elements of each class as their distinct class lists, read once: the class lists are final here.
  const signaturesByClass = new Map();
  for (const node of elements) {
    const names = classList(node);
    const signature = names.join(' ');
    for (const name of names) {
      if (!signaturesByClass.has(name)) signaturesByClass.set(name, new Map());
      signaturesByClass.get(name).set(signature, names);
    }
  }
  const selectorOf = name => `.${cssEscapeIdent(name)}`;
  // An Embed declaration of a class rule, planned by planScope (css-cascade.js). Where it wins everywhere it is
  // written as the source has it. Otherwise per band of Toolkit levels: the elements of a class that overrides it
  // whole are left out with :where(:not(.x)) (zero specificity, so a :hover/:focus state it lost to in the source
  // still wins), and the declarations that override it in part follow it, restricted to its elements
  // (`.c:where(.w)`), in source rank order, so every longhand ends at its source winner.
  function renderScopedEmbed({ className, level, selector, entries, mediaParams }) {
    const signatures = [...(signaturesByClass.get(className)?.values() || [])];
    const offset = MEDIA_ORDER.indexOf(level);
    const levels = MEDIA_ORDER.slice(offset);
    const body = items => items.map(item => `${item.prop}: ${item.value};`).join(' ');
    const groups = [];
    const byGroup = new Map();
    for (const item of entries) {
      if (!byGroup.has(item.group)) {
        const entry = { group: item.group, items: [] };
        byGroup.set(item.group, entry);
        groups.push(entry);
      }
      byGroup.get(item.group).items.push(item);
    }
    for (const entry of groups) {
      entry.self = participantByGroup.get(entry.group);
      entry.plans = entry.self ? planScope({ cascade, self: entry.self, signatures, levels }) : null;
    }
    // A group needs nothing when no level leaves it out and its only followers are later groups of this same rule
    // that need nothing either: written in one block in source order, those already win there.
    const plainSelves = new Set();
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const entry = groups[index];
      entry.plain = !entry.plans || entry.plans.every(plan => !plan.all && !plan.excluded.size
        && plan.follow.every(follower => plainSelves.has(follower) && groups.findIndex(other => other.self === follower) > index));
      if (entry.plain && entry.self) plainSelves.add(entry.self);
    }
    const blocks = [];
    const plainItems = groups.filter(entry => entry.plain).flatMap(entry => entry.items);
    if (plainItems.length) blocks.push({ media: mediaParams, text: `${selector} { ${body(plainItems)} }` });
    for (const entry of groups.filter(item => !item.plain)) {
      report.count('info', 'EMBED_CASCADE_SCOPED', 'written where it wins', 'Another class rule, inline style or breakpoint rule overrides this declaration on some elements in the source. The Embed, which loads after the classes, writes it only where it wins and re-states the declarations that override part of it right after it.', `${selector} ${entry.items.map(item => item.prop).join(', ')}`);
      let start = 0;
      for (let end = 1; end <= entry.plans.length; end += 1) {
        if (end < entry.plans.length && samePlan(entry.plans[end], entry.plans[start])) continue;
        const plan = entry.plans[start];
        if (!plan.all) {
          const media = start === 0 && end === entry.plans.length ? mediaParams : levelRangeMedia(offset + start, offset + end - 1);
          const without = [...plan.excluded].sort().map(name => `:not(${selectorOf(name)})`).join('');
          const own = without ? `${selector}:where(${without})` : selector;
          const rules = [{ target: own, items: [...entry.items] }];
          for (const follower of plan.follow) {
            const target = follower.className === className ? own : `${selector}:where(${selectorOf(follower.className)}${without})`;
            const last = rules[rules.length - 1];
            if (last.target === target) last.items.push(...follower.entries);
            else rules.push({ target, items: [...follower.entries] });
          }
          for (const rule of rules) blocks.push({ media, text: `${rule.target} { ${body(rule.items)} }` });
        }
        start = end;
      }
    }
    return blocks;
  }

  // ----- Output -----
  const blocks = (store, indent) => [...store].filter(([selector, decls]) => decls.size && !externalSelectors.has(selector)).sort(([a], [b]) => byTaptopOrder(a, b)).map(([selector, decls]) =>
    `${indent}${selector} {\n${[...decls].map(([prop, value]) => `${indent}  ${prop}: ${value};`).join('\n')}\n${indent}}`).join('\n');
  const cssParts = [];
  for (const media of MEDIA_ORDER) {
    const body = [blocks(classRules.get(media), media === 'screen' ? '' : '  '), blocks(stateRules.get(media), media === 'screen' ? '' : '  ')].filter(Boolean).join('\n');
    if (!body) continue;
    cssParts.push(media === 'screen' ? body : `@media ${media} {\n${body}\n}`);
  }
  // The image overflow reset (wantOverflowReset): an Embed declaration of the class with the lowest rank, so planScope
  // leaves out every level and element where a source declaration sets overflow. Restricted to image layers with
  // `:where(.image, img)` (zero specificity): `.image` is the tt_image wrapper the compiler emits (buildImage), the
  // layer that carries the base, and `img` the source element in the local preview; a block sharing the class is
  // not reached. First in the Embed, so a source rule the Embed carries at equal specificity comes later and wins.
  const imageOverflowEmbed = [];
  for (const [className, props] of imageOverflow) {
    const entries = [...props].map(prop => ({ prop, value: IMAGE_OVERFLOW, group: (declarationOrder += 1) }));
    for (const { prop, value, group } of entries) {
      participantByGroup.set(group, cascade.add({ className, level: 'screen', leaves: longhandLeaves(prop), entries: [{ prop, value }], rank: RESET_RANK }));
    }
    imageOverflowEmbed.push({ media: null, scoped: { className, level: 'screen', selector: `.${cssEscapeIdent(className)}:where(.image, img)`, entries, mediaParams: null } });
    report.count('info', 'IMAGE_OVERFLOW_TO_EMBED', 'written in embed', 'Taptop\'s image base sets overflow: hidden, which lets a flex or grid parent shrink the image; the browser value clip is written back in the Embed stylesheet, not through class sync.', `.${className} ${[...props].join(', ')}`);
  }
  embedBlocks.unshift(...imageOverflowEmbed);
  // Embed declarations of class rules, each written only where it wins the source cascade (see participate).
  for (let index = 0; index < embedBlocks.length; index += 1) {
    if (!embedBlocks[index].scoped) continue;
    const rendered = renderScopedEmbed(embedBlocks[index].scoped);
    embedBlocks.splice(index, 1, ...rendered);
    index += rendered.length - 1;
  }
  // Consecutive rules with the same media share one block; source order is kept.
  // The definitions block: every custom-property rule that can reach an element of the page, in source order.
  // A single class reaches the page when an element or the markup inside a layer has it (no selector match needed).
  const definitionReaches = selector => (CLASS_SELECTOR.test(selector) ? htmlClasses.has(selector.slice(1)) || innerClasses.has(selector.slice(1)) : reachesPage(selector));
  if (embedBlocks.some(block => /var\(/.test(block.text))) embedBlocks.unshift(...varDefinitionBlocks.filter(block => block.selectors.some(definitionReaches)));
  for (const behavior of behaviors) {
    if (behavior.adapter !== 'taptop/embed-slider-v1' || behavior.config.mode !== 'slides') continue;
    const root = `.${behavior.config.rootClass}`;
    embedBlocks.push({ media: null, text: `${root} { visibility: visible !important; }\n${root} .t-slds__items-wrapper { width: 100% !important; transform: none !important; }\n${root} .t-slds__item { display: none !important; width: 100% !important; float: none !important; }\n${root} .t-slds__item.toolkit-slide-active { display: block !important; }` });
  }
  if (revealTildaRoot) embedBlocks.push({ media: null, text: `.${revealClass} { opacity: 1 !important; }` });
  // A site that defines .toolkit-center identically owns that rule: the layers reference it as an external class.
  if (legacyCenterCount) embedBlocks.push({ media: null, text: `${toolkitClassOnSite('toolkit-center').state === 'identical' ? '' : `${ownRuleText('toolkit-center')}\n`}.toolkit-center > .toolkit-centered-block { margin-left: auto !important; margin-right: auto !important; }` });
  const merged = [];
  for (const block of embedBlocks) {
    const last = merged[merged.length - 1];
    if (last && last.media === block.media && block.media) last.texts.push(block.text);
    else merged.push({ media: block.media, texts: [block.text] });
  }
  const embedCss = merged.map(block => block.media ? `@media ${block.media} {\n${block.texts.map(text => `  ${text}`).join('\n')}\n}` : block.texts.join('\n')).join('\n');
  if (/<\/?style|<script/i.test(embedCss)) throw new Error('NORMALIZE_EMBED_CSS_UNSAFE: CSS must not contain HTML tags');
  // The Embed stylesheet travels as text: a relative url() in it points at a file that is neither packaged nor
  // uploaded, so the image is silently missing in Taptop. @font-face keeps its own warning (FONT_FILE_RELATIVE).
  postcss.parse(embedCss).walkDecls(decl => {
    if (decl.parent?.type === 'atrule' && decl.parent.name === 'font-face') return;
    const lost = [...decl.value.matchAll(/url\(\s*['"]?([^'")\s]+)/gi)].map(match => match[1]).filter(ref => !/^(?:https?:|data:|\/\/)/i.test(ref));
    if (lost.length) report.count('error', 'URL_ASSET_LOST', 'blocked', 'A relative url() cannot reach Taptop: the file is not packaged and the Embed stylesheet cannot load it. Use an <img> layer or a full https:// URL.', `${decl.parent?.selector || decl.parent?.name || ''} ${decl.prop} ${lost.join(' ')}`.trim());
  });

  // ----- The Toolkit's own class names on the target site (toolkit-classes.js) -----
  // Taptop keeps a class that already exists in the project when a package is
  // pasted (the importer treats toolkit-behavior as a base class and never
  // renames it), and behavior scripts name these classes as plain strings. So a
  // site rule for a Toolkit name the package uses applies to the package's
  // layers: allowed only when it is exactly the Toolkit's own rule.
  if (externalStylesheets.length) {
    const used = new Set();
    for (const node of elements) for (const name of classList(node)) if (isToolkitClass(name)) used.add(name);
    for (const name of classTokens(embedCss)) if (isToolkitClass(name)) used.add(name);
    // Every behavior package and the Embed stylesheet's package is an Embed layer with this class.
    if (behaviors.length || shipsStylesEmbed(embedCss)) used.add(BEHAVIOR_CLASS);
    for (const behavior of behaviors) for (const name of RUNTIME_CLASSES[behavior.adapter] || []) used.add(name);
    const ruleText = ({ selector, context, declarations }) => `${context ? `${context} ` : ''}${selector} { ${declarations.map(({ prop, value, important }) => `${prop}: ${value}${important ? ' !important' : ''};`).join(' ')} }`;
    for (const name of [...used].sort()) {
      const { state, siteRules } = toolkitClassOnSite(name);
      if (state === 'absent') continue;
      const onLayers = elements.some(node => classList(node).includes(name));
      if (state === 'identical') {
        report.add('info', 'TOOLKIT_CLASS_ON_SITE', 'allowed', onLayers
          ? `The external stylesheet (the target site) defines .${name}, the Toolkit's own class (${purposeOf(name)}), exactly as the Toolkit does (${ownRuleText(name)}). The layers reference the site's class (externalClasses) and the Embed stylesheet does not repeat its rule.`
          : `The external stylesheet (the target site) defines .${name}, the Toolkit's own class (${purposeOf(name)}), exactly as the Toolkit does (${ownRuleText(name)}). The Embed layers keep shipping the same rule: Taptop keeps the project's class on paste, and in a project without it the Embed stays hidden.`, ruleText(siteRules[0]));
        continue;
      }
      report.add('error', 'TOOLKIT_CLASS_CONFLICT', 'blocked', Object.hasOwn(OWN_RULES, name)
        ? `.${name} is the Toolkit's own class (${purposeOf(name)}), and the external stylesheet (the target site) styles it otherwise than the Toolkit's rule ${ownRuleText(name)}. Taptop keeps a class that already exists in the project when a package is pasted, so the site's rules would apply to these layers instead (an Embed shown or hidden wrongly). Make the site's rules exactly ${ownRuleText(name)} — one top-level rule — or remove them; the Toolkit's names are fixed.`
        : `.${name} is the Toolkit's own class (${purposeOf(name)}), and the external stylesheet (the target site) styles it. The Toolkit has no rule of its own for this name that the site could share, and its scripts and Embed CSS rely on it, so the site's rules would apply wherever the package uses it. Remove the site's rules for .${name}; the Toolkit's names are fixed.`,
        siteRules.map(ruleText).join('; '));
    }
  }

  const selectorMappings = [];
  for (const media of MEDIA_ORDER) for (const selector of stateRules.get(media).keys()) {
    if (selectorMappings.some(item => item.sourceSelector === selector)) continue;
    const [, target, pseudo] = STATE_SELECTOR.exec(selector);
    selectorMappings.push({ sourceSelector: selector, targetClass: target.slice(1), channel: 'cm', pseudoSuffix: pseudo });
  }

  const title = children(head || {}).find(node => node.tagName === 'title');
  // Taptop has these fonts built in; the preview loads them like the source did (http and // links too).
  const fontLinks = children(head || {}).filter(node => node.tagName === 'link' && attr(node, 'rel') === 'stylesheet' && /^(https?:)?\/\/fonts\.googleapis\.com\//.test(attr(node, 'href') || ''));
  // Taptop renders the page fonts itself (built in by name). The preview asks
  // Google Fonts for every non-system family the classes use, one link per
  // family, so an unknown family fails alone. Preview only: nothing is imported.
  const SYSTEM_FONTS = /^(arial|helvetica|helvetica neue|times|times new roman|georgia|verdana|tahoma|courier|courier new|system-ui|-apple-system|blinkmacsystemfont|segoe ui|sans-serif|serif|monospace|cursive|fantasy|inherit|initial)$/i;
  const families = new Set();
  for (const store of classRules.values()) for (const decls of store.values()) {
    const family = (decls.get('font-family') || '').split(',')[0].replace(/["']/g, '').trim();
    if (family && !SYSTEM_FONTS.test(family)) families.add(family);
  }
  const linkedFonts = fontLinks.map(node => attr(node, 'href')).join(' ');
  const previewFonts = [...families].sort().filter(family => !linkedFonts.includes(`family=${family.replace(/ /g, '+')}`))
    .map(family => `https://fonts.googleapis.com/css?family=${family.replace(/ /g, '+')}:100,200,300,400,500,600,700,800,900,100italic,400italic,700italic&subset=latin,cyrillic&display=swap`);
  const file = value => value.split('/').pop();
  const html = `<!doctype html>
<html lang="${attr(htmlElement || {}, 'lang') || 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? directText(title) : 'Page'}</title>
${fontLinks.map(node => `<link rel="stylesheet" href="${attr(node, 'href').replace(/^(https?:)?\/\//, 'https://').replace(/&/g, '&amp;')}">`).join('\n')}
${previewFonts.map(href => `<link rel="stylesheet" href="${href.replace(/&/g, '&amp;')}">`).join('\n')}
<link rel="stylesheet" href="${file(files.preview)}">
${externalStylesheets.filter(sheet => sheet.href).map(sheet => `<link rel="stylesheet" href="${htmlAttribute(sheet.href)}">\n`).join('')}<link rel="stylesheet" href="${file(files.css)}">
${embedCss ? `<link rel="stylesheet" href="${file(files.embedCss)}">` : ''}
</head>
<body>
${serializeOuter(root)}
</body>
</html>
`;

  const manifest = {
    schemaVersion: 1,
    componentKey,
    html: files.html,
    rootSelector: `.${rootClass}`,
    stylesheets: [files.css],
    breakpointMap: { '(max-width: 991px)': '(max-width: 991px)', '(max-width: 767px)': '(max-width: 767px)', '(max-width: 479px)': '(max-width: 479px)' }
  };
  if (selectorMappings.length) manifest.selectorMappings = selectorMappings;
  if (behaviors.length) manifest.behaviorManifest = files.behaviors;
  if (embedCss) manifest.embedStylesheet = files.embedCss;
  if (externalOnLayers.length) manifest.externalClasses = externalOnLayers;

  // The original with the result's keys: the comparison tool matches elements
  // by key instead of document order, whatever the normalizer restructured.
  const keyBySource = new Map();
  walk(root, node => { const key = attr(node, 'data-taptop-key'); if (key && node.__sourceIndex !== undefined) keyBySource.set(node.__sourceIndex, key); });
  const originalDocument = parse(htmlText);
  let originalIndex = 0;
  walk(originalDocument, node => {
    if (!node.tagName) return;
    const key = keyBySource.get(originalIndex++);
    if (key) setAttr(node, 'data-taptop-key', key);
  });
  const keyedOriginal = serialize(originalDocument);

  const errors = report.items.filter(item => item.level === 'error');
  return {
    html,
    keyedOriginal,
    css: cssParts.length ? `${cssParts.join('\n\n')}\n` : '',
    embedCss: embedCss ? `${embedCss}\n` : '',
    previewCss,
    previewPath: files.preview,
    behaviors: { schemaVersion: 1, behaviors },
    manifest,
    report: { ok: errors.length === 0, errors: errors.length, items: report.items }
  };
}

module.exports = { normalizeHtmlSource, mapMedia, expandDeclaration, createClassNames, layerNameClass };
