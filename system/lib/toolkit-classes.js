// Class names the Toolkit itself writes into packages: the Toolkit's own, never
// the source's or the target site's. A target stylesheet (--external-css) that
// styles one changes how the package behaves there, so the normalizer compares
// the site's rules for every one the package uses (html-normalizer.js,
// TOOLKIT_CLASS_CONFLICT / TOOLKIT_CLASS_ON_SITE). A test checks that every
// `toolkit-` name in system/lib is listed here.

// Every behavior Embed layer carries this class; its rule hides the layer.
const BEHAVIOR_CLASS = 'toolkit-behavior';

// The single-class rules the Toolkit ships for its own names, declarations in
// the order written. Only these may be defined by the site too, and only with
// exactly these declarations.
const OWN_RULES = {
  [BEHAVIOR_CLASS]: [['display', 'none']],
  'toolkit-center': [['text-align', 'center']]
};

// Names the site may not style at all: state classes a behavior script
// toggles, hooks it looks up, classes only compound or relational rules use,
// and the Tilda reveal root (its Embed rule is `opacity: 1 !important`). Any
// site rule with one as its subject applies wherever the package uses it.
// `toolkit-animate-visible` (reveal) is checked as EXTERNAL_STATE_CLASS.
const STATE_AND_HOOK_CLASSES = ['toolkit-animate-visible', 'toolkit-bullet-active', 'toolkit-centered-block', 'toolkit-popup-open', 'toolkit-slide-active', 'toolkit-tilda-root', 'toolkit-video-poster'];
// Per-element root classes of the Tilda adapters: `<prefix><source index>`.
const INDEXED_PREFIXES = ['toolkit-carousel_', 'toolkit-slider_', 'toolkit-video-dialog_', 'toolkit-video_'];
// Classes a behavior script adds at runtime, by adapter: on no layer of the page.
const RUNTIME_CLASSES = { 'taptop/embed-video-v1': ['toolkit-popup-open'] };

// What the name does, for the report.
const PURPOSES = {
  [BEHAVIOR_CLASS]: 'it hides every behavior Embed layer',
  'toolkit-center': 'it centers a legacy <center> wrapper'
};
const purposeOf = name => PURPOSES[name] || 'a state, hook or root class of a Toolkit behavior or layout rule';

const isToolkitClass = name => Object.hasOwn(OWN_RULES, name) || STATE_AND_HOOK_CLASSES.includes(name) || INDEXED_PREFIXES.some(prefix => name.startsWith(prefix));

// `.toolkit-behavior { display: none; }` — the one spelling every Embed and the check use.
function ownRuleText(name) {
  if (!Object.hasOwn(OWN_RULES, name)) throw new Error(`TOOLKIT_CLASS_UNKNOWN: ${name} has no rule of its own`);
  return `.${name} { ${OWN_RULES[name].map(([prop, value]) => `${prop}: ${value};`).join(' ')} }`;
}

module.exports = { BEHAVIOR_CLASS, OWN_RULES, STATE_AND_HOOK_CLASSES, INDEXED_PREFIXES, RUNTIME_CLASSES, isToolkitClass, ownRuleText, purposeOf };
