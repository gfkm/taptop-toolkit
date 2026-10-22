const assert = require('node:assert/strict');
const test = require('node:test');

const { MEDIA_ORDER, CHAIN, LEVEL_MAX_WIDTH, levelRangeMedia, longhandLeaves, compareRank, cssEscapeIdent, createCascade, planScope } = require('../lib/css-cascade');

const rank = (order, extra = {}) => ({ important: false, inline: false, specificity: 100, order, ...extra });
const [SCREEN, B991, B767, B479] = MEDIA_ORDER;

test('levels, chains and media ranges follow the Taptop breakpoints', () => {
  assert.deepEqual(LEVEL_MAX_WIDTH, [null, 991, 767, 479]);
  assert.deepEqual(CHAIN[B767], [B767, B991, SCREEN]);
  assert.equal(levelRangeMedia(0, 3), null);
  assert.equal(levelRangeMedia(0, 1), 'not all and (max-width: 767px)');
  assert.equal(levelRangeMedia(2, 3), '(max-width: 767px)');
  assert.equal(levelRangeMedia(1, 1), '(min-width: 767.02px) and (max-width: 991px)');
});

test('shorthands list their longhands, reset-only ones included', () => {
  assert.equal(longhandLeaves('border').length, 17);
  assert.ok(longhandLeaves('border').includes('border-image-source'));
  assert.ok(longhandLeaves('font').includes('font-feature-settings'));
  assert.ok(longhandLeaves('font').includes('font-variant-caps'));
  assert.ok(longhandLeaves('animation').includes('animation-timeline'));
  assert.deepEqual(longhandLeaves('Color'), ['color']);
  assert.deepEqual(longhandLeaves('--x'), ['--x']);
});

test('the rank order is importance, inline origin, specificity, source order', () => {
  assert.ok(compareRank(rank(1, { important: true }), rank(9, { inline: true })) > 0);
  assert.ok(compareRank(rank(1, { inline: true }), rank(9, { specificity: 200 })) > 0);
  assert.ok(compareRank(rank(1, { specificity: 200 }), rank(9)) > 0);
  assert.ok(compareRank(rank(9), rank(1)) > 0);
  assert.equal(compareRank(rank(3), rank(3)), 0);
});

test('identifiers are escaped for selectors', () => {
  assert.equal(cssEscapeIdent('md:x'), 'md\\:x');
  assert.equal(cssEscapeIdent('w-1/2'), 'w-1\\/2');
  assert.equal(cssEscapeIdent('1col'), '\\31 col');
  assert.equal(cssEscapeIdent('card--b'), 'card--b');
});

test('the winner of a longhand ranks highest among the declarations that apply at the level', () => {
  const cascade = createCascade();
  const base = cascade.add({ className: 'pl', level: SCREEN, rank: rank(1), leaves: longhandLeaves('border'), entries: [] });
  const modifier = cascade.add({ className: 'pl--crm', level: SCREEN, rank: rank(2), leaves: longhandLeaves('border'), entries: [] });
  const narrow = cascade.add({ className: 'pl', level: B767, rank: rank(0), leaves: ['color'], entries: [] });
  assert.equal(cascade.winner(['pl'], 'border-top-width', SCREEN), base);
  assert.equal(cascade.winner(['pl', 'pl--crm'], 'border-top-width', SCREEN), modifier);
  assert.equal(cascade.winner(['pl'], 'color', SCREEN), null, 'a 767px rule does not apply at desktop');
  assert.equal(cascade.winner(['pl'], 'color', B479), narrow);
  assert.deepEqual(cascade.rankFor('pl', 'border-top-color', SCREEN), rank(1));
  assert.equal(cascade.rankFor('pl', 'border-top-color', B767), null);
});

test('a class that overrides every longhand is excluded; a partial override is followed', () => {
  const cascade = createCascade();
  const self = cascade.add({ className: 'hero', level: SCREEN, rank: rank(1), leaves: longhandLeaves('background'), entries: [] });
  const position = cascade.add({ className: 'hero--alt', level: SCREEN, rank: rank(2), leaves: ['background-position-x', 'background-position-y'], entries: [] });
  const none = cascade.add({ className: 'hero-inline1', level: SCREEN, rank: rank(0, { inline: true }), leaves: longhandLeaves('background'), entries: [] });
  const plan = planScope({ cascade, self, signatures: [['hero'], ['hero', 'hero--alt'], ['hero', 'hero-inline1']], levels: [SCREEN] })[0];
  assert.equal(plan.all, false);
  assert.deepEqual([...plan.excluded], ['hero-inline1']);
  assert.deepEqual(plan.follow, [position]);
  assert.ok(!plan.follow.includes(none));
});

test('its own class overriding it at a level leaves the level out', () => {
  const cascade = createCascade();
  const self = cascade.add({ className: 't', level: SCREEN, rank: rank(1), leaves: ['color'], entries: [] });
  cascade.add({ className: 't', level: B767, rank: rank(2), leaves: ['color'], entries: [] });
  const plans = planScope({ cascade, self, signatures: [['t']], levels: MEDIA_ORDER });
  assert.deepEqual(plans.map(plan => plan.all), [false, false, true, true]);
});

test('an earlier declaration with higher specificity or !important beats a later one', () => {
  const cascade = createCascade();
  const self = cascade.add({ className: 't', level: SCREEN, rank: rank(5), leaves: ['color'], entries: [] });
  cascade.add({ className: 't--sel', level: SCREEN, rank: rank(1, { specificity: 200 }), leaves: ['color'], entries: [] });
  cascade.add({ className: 'u', level: SCREEN, rank: rank(2, { important: true }), leaves: ['color'], entries: [] });
  cascade.add({ className: 'v', level: SCREEN, rank: rank(9), leaves: ['color'], entries: [] });
  const [plan] = planScope({ cascade, self, signatures: [['t', 't--sel'], ['t', 'u'], ['t', 'v']], levels: [SCREEN] });
  assert.deepEqual([...plan.excluded].sort(), ['t--sel', 'u', 'v']);
  const important = cascade.add({ className: 'w', level: SCREEN, rank: rank(0, { important: true }), leaves: ['color'], entries: [] });
  const [kept] = planScope({ cascade, self: important, signatures: [['w', 'v']], levels: [SCREEN] });
  assert.equal(kept.excluded.size, 0, 'a later normal declaration does not beat an earlier !important one');
});

test('follow is closed over the longhands the followers touch', () => {
  const cascade = createCascade();
  const self = cascade.add({ className: 'a', level: SCREEN, rank: rank(1), leaves: ['background-image'], entries: [] });
  const wide = cascade.add({ className: 'b', level: SCREEN, rank: rank(2), leaves: ['background-image', 'background-color'], entries: [] });
  const color = cascade.add({ className: 'c', level: SCREEN, rank: rank(3), leaves: ['background-color'], entries: [] });
  // b overrides all of a, so b is excluded; on an element without b nothing follows.
  const [plan] = planScope({ cascade, self, signatures: [['a', 'b', 'c'], ['a']], levels: [SCREEN] });
  assert.deepEqual([...plan.excluded], ['b']);
  assert.deepEqual(plan.follow, []);
  // When a only loses in part, the follower's other longhand gets its own source winner after it.
  const both = cascade.add({ className: 'd', level: SCREEN, rank: rank(0), leaves: ['background-image', 'background-size'], entries: [] });
  const [partial] = planScope({ cascade, self: both, signatures: [['d', 'b', 'c']], levels: [SCREEN] });
  assert.deepEqual(partial.follow, [wide, color]);
});
