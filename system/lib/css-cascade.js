// The source cascade, as the normalizer needs it for class rules: the Toolkit breakpoints, the longhands each
// shorthand sets, one rank order, and the plan that limits an Embed declaration of a class rule to where it wins.
// The class layer (html-normalizer.js: class order, Taptop base resets) and the Embed scoping both rank through
// compareRank, so they cannot disagree about a winner. Pure: no DOM, no report.

// Taptop's breakpoints, desktop first (the canvas widths are 1440, 768, 480, 320).
const BREAKPOINTS = { 991: '(max-width: 991px)', 767: '(max-width: 767px)', 479: '(max-width: 479px)' };
const MEDIA_ORDER = ['screen', BREAKPOINTS[991], BREAKPOINTS[767], BREAKPOINTS[479]];
// The widest width each level reaches (null: no upper bound), read from BREAKPOINTS.
const LEVEL_MAX_WIDTH = MEDIA_ORDER.map(media => (media === 'screen' ? null : Number(/(\d+)px/.exec(media)[1])));
// The levels whose rules apply at a level, narrowest first (a max-width rule applies at every narrower width).
const CHAIN = Object.fromEntries(MEDIA_ORDER.map((media, index) => [media, MEDIA_ORDER.slice(0, index + 1).reverse()]));

// The media query of consecutive levels `from`…`to` (MEDIA_ORDER indices, widest first), in Media Queries Level 3
// (the Level 4 range syntax needs Chrome 104+/Safari 16.4+ and was never tried in a Taptop Embed). Without an upper
// bound the lower bound is the exact complement of the next breakpoint, `not all and (max-width: …)`; with one it is
// `min-width` BAND_OFFSET_PX above that breakpoint, so no whole-pixel width falls between two levels.
const BAND_OFFSET_PX = 0.02;
function levelRangeMedia(from, to) {
  const upper = LEVEL_MAX_WIDTH[from];
  const lower = to + 1 < MEDIA_ORDER.length ? LEVEL_MAX_WIDTH[to + 1] : null;
  if (lower === null) return upper === null ? null : MEDIA_ORDER[from];
  return upper === null ? `not all and (max-width: ${lower}px)` : `(min-width: ${lower + BAND_OFFSET_PX}px) and (max-width: ${upper}px)`;
}

// The longhands each shorthand sets, reset-only ones included (CSS Backgrounds 3, Borders 4, Fonts 4, Animations 2,
// Transitions 2, Text Decoration 4, Box Alignment 3, Grid 2, Overflow 3, Lists 3, Multi-column 1, Scroll Snap 1).
// Two declarations compete when their longhands meet: `background: none` overrides `background-color: var(--x)`,
// `font: …` overrides `font-feature-settings`. Logical properties (`margin-inline` …) stay their own longhands:
// which physical side they set depends on the writing mode. This is the only list of shorthand names; the value
// expanders (expandDeclaration in html-normalizer.js, SHORTHAND_EXPANDERS in css-rules.js) split values into the
// longhands Taptop stores, a different question with fewer shorthands.
const SIDES = ['top', 'right', 'bottom', 'left'];
const sides = prefix => SIDES.map(side => `${prefix}-${side}`);
const SHORTHAND_PARTS = {
  margin: sides('margin'),
  padding: sides('padding'),
  inset: SIDES,
  'scroll-margin': sides('scroll-margin'),
  'scroll-padding': sides('scroll-padding'),
  border: ['border-width', 'border-style', 'border-color', 'border-image'],
  ...Object.fromEntries(SIDES.map(side => [`border-${side}`, ['width', 'style', 'color'].map(part => `border-${side}-${part}`)])),
  ...Object.fromEntries(['width', 'style', 'color'].map(part => [`border-${part}`, SIDES.map(side => `border-${side}-${part}`)])),
  'border-radius': ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(corner => `border-${corner}-radius`),
  'border-image': ['source', 'slice', 'width', 'outset', 'repeat'].map(part => `border-image-${part}`),
  background: ['color', 'image', 'position', 'size', 'repeat', 'attachment', 'origin', 'clip'].map(part => `background-${part}`),
  'background-position': ['background-position-x', 'background-position-y'],
  font: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family',
    'font-size-adjust', 'font-kerning', 'font-optical-sizing', 'font-feature-settings', 'font-variation-settings', 'font-language-override'],
  'font-variant': ['caps', 'numeric', 'alternates', 'ligatures', 'east-asian', 'position', 'emoji'].map(part => `font-variant-${part}`),
  'font-synthesis': ['weight', 'style', 'small-caps', 'position'].map(part => `font-synthesis-${part}`),
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'],
  'grid-gap': ['row-gap', 'column-gap'],
  'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'],
  'place-self': ['align-self', 'justify-self'],
  outline: ['outline-color', 'outline-style', 'outline-width'],
  overflow: ['overflow-x', 'overflow-y'],
  'overscroll-behavior': ['overscroll-behavior-x', 'overscroll-behavior-y'],
  'text-decoration': ['text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness'],
  'text-emphasis': ['text-emphasis-style', 'text-emphasis-color'],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'],
  transition: ['property', 'duration', 'timing-function', 'delay', 'behavior'].map(part => `transition-${part}`),
  animation: ['name', 'duration', 'timing-function', 'delay', 'iteration-count', 'direction', 'fill-mode', 'play-state',
    'timeline', 'composition', 'range-start', 'range-end'].map(part => `animation-${part}`),
  'animation-range': ['animation-range-start', 'animation-range-end'],
  columns: ['column-width', 'column-count'],
  'column-rule': ['column-rule-width', 'column-rule-style', 'column-rule-color'],
  grid: ['grid-template-rows', 'grid-template-columns', 'grid-template-areas', 'grid-auto-rows', 'grid-auto-columns', 'grid-auto-flow'],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
  'grid-area': ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
  'grid-row': ['grid-row-start', 'grid-row-end'],
  'grid-column': ['grid-column-start', 'grid-column-end'],
  mask: ['image', 'mode', 'repeat', 'position', 'clip', 'origin', 'size', 'composite'].map(part => `mask-${part}`)
};
function longhandLeaves(prop) {
  const name = prop.startsWith('--') ? prop : prop.toLowerCase();
  return SHORTHAND_PARTS[name] ? [...new Set(SHORTHAND_PARTS[name].flatMap(longhandLeaves))] : [name];
}

// A declaration's place in the source cascade: { important, inline, specificity, order }. `!important` first, then
// an inline style, then specificity (a number, a*1e4 + b*1e2 + c), then source order. A media query adds nothing:
// it only decides at which levels the declaration applies.
function compareRank(a, b) {
  return (Number(a.important) - Number(b.important)) || (Number(a.inline) - Number(b.inline)) || (a.specificity - b.specificity) || (a.order - b.order);
}

// CSSOM "serialize an identifier", so a class such as `md:x` can be written into a selector.
function cssEscapeIdent(name) {
  let out = '';
  for (let index = 0; index < name.length; index += 1) {
    const char = name[index];
    const code = name.charCodeAt(index);
    if (code === 0) out += '�';
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f || (index === 0 && code >= 0x30 && code <= 0x39) || (index === 1 && code >= 0x30 && code <= 0x39 && name[0] === '-')) out += `\\${code.toString(16)} `;
    else if (index === 0 && char === '-' && name.length === 1) out += `\\${char}`;
    else if (code >= 0x80 || char === '-' || char === '_' || /[0-9A-Za-z]/.test(char)) out += char;
    else out += `\\${char}`;
  }
  return out;
}

// Declarations of class rules ("participants"), each { className, level, rank, leaves, entries }: one per source
// declaration (its longhands as leaves), entries being what to write to re-state it in the Embed.
function createCascade() {
  const byClass = new Map();
  const rankCache = new Map();
  const applies = (participant, level) => CHAIN[level].includes(participant.level);
  return {
    add(participant) {
      const entry = { ...participant, leaves: new Set(participant.leaves) };
      if (!byClass.has(entry.className)) byClass.set(entry.className, []);
      byClass.get(entry.className).push(entry);
      rankCache.clear();
      return entry;
    },
    participantsOf: className => byClass.get(className) || [],
    // The declaration that sets `leaf` at `level` on an element with these classes.
    winner(classNames, leaf, level) {
      let best = null;
      for (const name of classNames) {
        for (const participant of byClass.get(name) || []) {
          if (!participant.leaves.has(leaf) || !applies(participant, level)) continue;
          if (!best || compareRank(participant.rank, best.rank) > 0) best = participant;
        }
      }
      return best;
    },
    // The highest rank among the class's declarations at exactly this level that set `prop` (for the class layer,
    // whose stores hold one value per class, property and level). null: no class declaration set it.
    rankFor(className, prop, level) {
      const key = `${className}\n${prop}\n${level}`;
      if (rankCache.has(key)) return rankCache.get(key);
      const leaves = longhandLeaves(prop);
      let best = null;
      for (const participant of byClass.get(className) || []) {
        if (participant.level !== level || !leaves.some(leaf => participant.leaves.has(leaf))) continue;
        if (!best || compareRank(participant.rank, best) > 0) best = participant.rank;
      }
      rankCache.set(key, best);
      return best;
    },
    applies
  };
}

// Where an Embed declaration `self` of a class rule must apply, per level (from its own level down), given the class
// lists of the elements that carry its class. The Embed loads after the class rules, so `self` written plainly would
// beat every class declaration that wins over it in the source. For each level:
// - all: its own class overrides it there on every element (a later or breakpoint rule): leave the level out;
// - excluded: classes each of which alone overrides every longhand of it on every element they share with it:
//   leave their elements out (the class layer shows the source values there);
// - follow: the declarations that win over it, or over one another, on the remaining elements where it loses only
//   in part (a modifier's background-position against a background shorthand). Written after it in rank order,
//   restricted to its elements, they re-state the source winner of every longhand they touch.
function planScope({ cascade, self, signatures, levels }) {
  return levels.map(level => {
    const outranks = (participant, other) => compareRank(participant.rank, other.rank) > 0;
    const covers = className => [...self.leaves].every(leaf => cascade.participantsOf(className).some(participant => participant !== self
      && participant.leaves.has(leaf) && cascade.applies(participant, level) && outranks(participant, self)));
    if (covers(self.className)) return { all: true, excluded: new Set(), follow: [] };
    const excluded = new Set();
    for (const names of signatures) {
      const winners = [...self.leaves].map(leaf => cascade.winner(names, leaf, level)).filter(winner => winner && winner !== self);
      if (winners.length < self.leaves.size) continue;
      const covering = [...new Set(winners.map(winner => winner.className))].find(covers);
      if (covering) excluded.add(covering);
    }
    const live = signatures.filter(names => !names.some(name => excluded.has(name)));
    const follow = new Set();
    for (let changed = true; changed;) {
      changed = false;
      for (const names of live) {
        for (const participant of [self, ...[...follow].filter(item => names.includes(item.className))]) {
          for (const leaf of participant.leaves) {
            const winner = cascade.winner(names, leaf, level);
            if (!winner || winner === participant || winner === self || follow.has(winner)) continue;
            follow.add(winner);
            changed = true;
          }
        }
      }
    }
    return { all: false, excluded, follow: [...follow].sort((a, b) => compareRank(a.rank, b.rank)) };
  });
}

const samePlan = (a, b) => a.all === b.all && a.excluded.size === b.excluded.size && [...a.excluded].every(name => b.excluded.has(name))
  && a.follow.length === b.follow.length && a.follow.every((participant, index) => participant === b.follow[index]);

module.exports = { BREAKPOINTS, MEDIA_ORDER, LEVEL_MAX_WIDTH, CHAIN, BAND_OFFSET_PX, levelRangeMedia, SHORTHAND_PARTS, longhandLeaves, compareRank, cssEscapeIdent, createCascade, planScope, samePlan };
