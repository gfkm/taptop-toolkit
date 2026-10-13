# HTML normalizer — rules

Every HTML/CSS page a user sends goes through the normalizer before compiling.
Nobody hand-edits a user's page into the compiler profile. The normalizer is
deterministic, keeps the user's files untouched, and reports every change.

Managed projects (layout version 2) run it as part of every build:

```sh
npm run toolkit -- artifact add --project projects/<folder> --key pages/<name> --html input/<name>/index.html --css design-system/roles.css --css input/<name>/styles.css --depends ui-kit
npm run toolkit -- build --project projects/<folder> --artifact pages/<name>
```

The build normalizes into `.taptop/work/<artifact>/` (a stable, tool-owned folder that is replaced on each build; its path takes part in the source revision, so it never contains a build ID) and publishes a copy with the preview to `output/html/<artifact>--<build>/`. Several stylesheets are one cascade in the listed order. Legacy single-page projects keep the original commands, which write `source/normalized/` once:

```sh
npm run toolkit -- normalize <project> <html> <css> [--root .class]
npm run toolkit -- compile <project> source/normalized/manifest.json <new-output.json>
```

Files produced in either location (legacy location never overwritten):

| File | Purpose |
| --- | --- |
| `page.html` | Prepared HTML: classes, stable `data-taptop-key`, portable attributes only |
| `page.css` | Single-class rules and `:hover/:focus/:focus-visible/:active` states on Toolkit breakpoints |
| `page.embed.css` | CSS Taptop classes cannot express; ships as one hidden Embed in `Scripts` |
| `behaviors.json` | Declared behaviors (accordion, menu, supported Tilda slider/carousel and MP4 video structures, plus Tilda viewport reveals) for generated Embed scripts |
| `manifest.json` | Compiler manifest incl. `selectorMappings`, `behaviorManifest`, `embedStylesheet` |
| `normalization-report.json` | Every decision: `level`, `code`, `decision`, `reason`, samples |
| `taptop-preview.css` | Taptop page defaults for local preview only; never packaged |

## Principles

1. **Nothing is lost silently.** A rule is either converted to a Taptop class,
   moved verbatim into the embed stylesheet, or reported as an error.
2. **Editable first.** Visible structure becomes ordinary Taptop layers and
   classes; behavior and relational CSS go to Embed and work on the published page.
3. **Fail closed.** Unsupported content is an `error` and blocks compiling until
   the source is fixed or an adapter exists.
4. **Prove fidelity.** Compare original and normalized pages with
   `system/docs/tools/normalize-compare.html` at 1440/992/768/480/320 and
   900/700/375 before import (`npm run toolkit -- serve`, then the `links.compare`
   URL printed by `build`). Zero differences is the target; any difference is
   explained in the report. The tool matches elements by `data-taptop-key` when
   the original has keys, otherwise by document order, and reports how many
   elements it compared: zero compared elements is a failed comparison. It treats
   the documented `FONT_NAME` and text blockification (`TAPTOP_BASE_RESET`)
   results as equal, skips the generated `.page` wrapper (`ROOT_WRAPPED`), and
   reports “font not installed locally” when a page font renders in a fallback —
   text sizes are then not comparable until the font is installed or linked.

## Transformations

| Source | Result | Report code |
| --- | --- | --- |
| Grouped selectors `.a, .b` | One rule per selector | `GROUP_SPLIT` |
| `@media [only] screen and (max-width: 991/767/479px)` | Toolkit breakpoints | — |
| Other media (`min-width`, other widths, `prefers-reduced-motion`) | Embed, same media | `MEDIA_TO_EMBED` |
| `.class` | Class rule | — |
| `.class:hover/:focus/:focus-visible/:active` | Taptop state rule (`cm` channel) | — |
| Relational, compound, attribute and structural selectors (`#hero > div[aria-hidden] > div:nth-child(3)`, `.a.b`, `.a .b + .b`, `ul li:first-child`) | Matched on the source page (ids, attributes and structure as written); the elements it reaches get `<class>--sel[-b …]` and the rule becomes a class rule with the selector's specificity. Same-element compounds such as `.a.b` must be lowered too: leaving them in the later Embed stylesheet can override the imported class color or background. `:hover`/`:focus`/`:active` of the matched layer → a Taptop state rule; `::before`/`::after`, other states, markup inside Rich Text/SVG Icon and media queries without a Taptop breakpoint → embed on that class | `SELECTOR_LOWERED` |
| Selectors with script-toggled states (`.is-*`, `.active`, `.open`, `[aria-expanded]` …), dynamic parts before the last element (`.card:hover .title`), unsupported syntax, or nothing matched on the page | Embed, verbatim | `SELECTOR_TO_EMBED` |
| `body` | Inherited text settings and background lifted to the root class | `GLOBAL_RULE_LOWERED` |
| Element selectors (`h1`, `p` …) | Applied to the classes of those elements; class values win | `GLOBAL_RULE_LOWERED` |
| `*` `box-sizing: border-box` | Removed — Taptop pages already use it | `GLOBAL_RULE_LOWERED` |
| `html`, other `*` declarations | Embed | `GLOBAL_RULE_LOWERED` |
| `@keyframes`, `@font-face`, other at-rules | Embed | `AT_RULE_TO_EMBED` |
| `var(--x)` with a value on `:root`, on a class rule or in an inline style of an ancestor | Literal value, inherited through the DOM as in the browser; a class used under different values keeps its first element's value | `VARIABLE_CONTEXT` (warning) when contexts differ |
| Custom-property definitions and every declaration using `var()` | Also copied to the Embed stylesheet, while the class retains its resolved fallback. This preserves values set by a parent, an id/relational selector or a breakpoint that a Taptop class cannot represent. | `CUSTOM_PROPERTY_TO_EMBED`, `VARIABLE_TO_EMBED` |
| `body` / element rules repeated in the CSS | Cascade order: the later rule wins; class rules still win over both | — |
| A stylesheet or `<style>` ending with an unclosed block | Closed at its own end, as browsers do | `CSS_BLOCK_AUTO_CLOSED` (warning) |
| CSS the browser cannot recover from either | Reported instead of crashing | `CSS_PARSE_ERROR` (error) |
| Unresolved `var()`, `url()` | Embed | `VARIABLE_UNRESOLVED`, `URL_TO_EMBED` |
| `!important` | Removed, value kept | `IMPORTANT_REMOVED` |
| Vendor-prefixed properties | Removed | `VENDOR_DROPPED` |
| `margin`, `padding`, `border[-side]`, `gap`, `place-items` | Longhands | — |
| `body` text settings | Inherited properties (colour, font, line-height, `overflow-wrap`, `word-break`, `white-space`, `hyphens`, `text-wrap`, `text-shadow`, `font-feature-settings` …) and the background go to the root block | `GLOBAL_RULE_LOWERED` |
| `var(--x)` where `--x` is redefined inside a media query (`@media (max-width: 900px) { #box { --dir: column } }`) | The class keeps the value resolved at desktop; the embed repeats the declaration with `var()` on the same class, together with the variable definitions, so the switch still happens on narrow screens (published page and editor canvas) | `VARIABLE_BY_MEDIA` |
| `@font-face` with a relative font file | Kept in the embed and reported: the file does not reach Taptop; upload the font to the project or use a full URL | `FONT_FILE_RELATIVE` (warning) |
| `font` shorthand (`700 21px/1.2 Inter, Arial`) | `font-style`, `font-weight`, `font-size`, `line-height` (kept as written, see below), `font-family` (first name); `font: inherit` and system-font keywords stay as they are | — |
| Unitless, `%`, `em`, `rem` and fluid (`clamp`, `calc`, `vw`) `line-height` | Kept as written; the compiler stores it as a custom rule, so inheritance and every width behave as in the source | `LINE_HEIGHT_CUSTOM` |
| Inline `style=""` | New class `<class>-inlineN` (no hyphen before the number, see the counter fact) | `INLINE_STYLE_TO_CLASS` |
| Element without class | Class `<parent>__<tag>` | `CLASS_GENERATED` |
| Missing `data-taptop-key` | `<class>-N` | — |
| `#id` in a selector | The element gets a class named after the id (`id-<id>` if that class name is taken) and `#id` becomes that class in every selector; before this, id rules were silently lost because the id is removed | `ID_TO_CLASS` |
| `id`, `role`, `aria-*`, `tabindex`, other `data-*` | Removed | `ATTRIBUTE_REMOVED` |
| Link to a removed `id` | Kept; set the anchor in Taptop | `ANCHOR_TARGET_REMOVED` (warning) |
| `<a>` wrapping elements | Editable link block | — |
| `data-taptop-behavior="accordion"` | `behaviors.json`; panel hide state to Embed | `BEHAVIOR_DECLARED`, `BEHAVIOR_STATE_TO_EMBED` |
| `data-taptop-behavior="menu"` | Toggle (`*burger*`/`*toggle*`), panel (`*sidebar*`/`*drawer*`/`*panel*`), optional backdrop (`*backdrop*`/`*overlay*`/`*shade*`); the script toggles `is-open` on the root, `.root.is-open …` CSS goes to Embed; `data-taptop-anchor-prefix` makes `#name` links scroll to `.<prefix>name` | `BEHAVIOR_DECLARED` |
| Tilda `.t-slds` with more than one `.t-slds__item` | Editable slide layers remain in Root. A generated `taptop/embed-slider-v1` Embed controls arrows, bullets, keyboard navigation and swipe, beginning at the source active slide. Its CSS keeps only the active slide visible. | `TILDA_SLIDER_DECLARED` |
| Tilda `t1196` horizontal card carousel | Editable cards remain in Root. A generated `taptop/embed-slider-v1` Embed scrolls the source card track by one visible card through its controls. | `TILDA_CAROUSEL_DECLARED` |
| Tilda `t-video-lazyload` with an HTTPS `.mp4` source | The lazy shell remains editable; a generated `taptop/embed-video-v1` Embed creates a muted, controlled HTML5 video. A local poster is retained when the source supplies one. | `TILDA_INLINE_VIDEO_DECLARED` |
| Tilda `.t-popup` containing `t1013__html5video` with an HTTPS `.mp4` source | The popup shell remains editable; a generated `taptop/embed-video-v1` Embed opens it from the declared hash link, moves focus, closes by control, backdrop or Escape and restores page scrolling. | `TILDA_VIDEO_DIALOG_DECLARED` |
| Tilda `.t-animate` targets | Editable layers stay in place; a generated `taptop/embed-reveal-v1` Embed adds Tilda's started class as each target enters the viewport and restores visibility if a source effect cannot finish. | `TILDA_REVEAL_DECLARED` |
| Tilda `data-original` lazy images and background images | The prepared image or `background-image` uses `data-original` before source scripts are removed. This replaces Tilda's small blurred placeholder with the original asset. | `TILDA_LAZY_IMAGE_PROMOTED`, `TILDA_LAZY_BACKGROUND_PROMOTED` |
| Legacy `<center>` | Editable `toolkit-center` and `toolkit-centered-block` layers with a generated Embed centering rule. | `LEGACY_CENTER_PRESERVED` |
| Tilda `.t-cover` with a `data-content-cover-bg` carrier | The carrier's original image is promoted to the editable cover, which uses `background-attachment: scroll`, matching the carrier-scoped sizing done by Tilda startup code. | `TILDA_COVER_BACKGROUND_PROMOTED`, `TILDA_COVER_BACKGROUND_SCROLL` |
| Tilda geolocation script with a `geo: ''` default card | Blocks hidden by the default card are removed; the default desktop/mobile pair remains and existing responsive CSS chooses the visible one. | `TILDA_GEO_DEFAULT_APPLIED` |
| `animation` and its longhands | Embed stylesheet; the associated `@keyframes` is already an Embed at-rule. | `ANIMATION_TO_EMBED` |
| `margin-left: auto` or `margin-right: auto` | Embed stylesheet; native Taptop class controls turn these side margins into `0px`. | `MARGIN_AUTO_TO_EMBED` |
| Legacy vendor properties (`-webkit-*`, `Moz*`, `KHTMLOpacity` …), IE `filter: alpha(…)`, or a nonzero unitless `letter-spacing` | Removed. Modern source equivalents such as `opacity` remain. | `VENDOR_DROPPED`, `INVALID_VALUE_DROPPED` |
| `font-family` stacks | Bare Taptop font name; Google Fonts links kept for local preview only | `FONT_NAME` |
| Width, display, height, position the source left to the browser | Browser value written on the element class against Taptop's layer base classes, with the lowest priority (a real value from another class of the element wins, through an order class if needed). A class shared by elements that need different values takes the most common one; every other group gets `<class>--base[-b …]` (Taptop's own default written out when that group needs it); `TAPTOP_BASE_CONFLICT` remains only when no value can be written | `TAPTOP_BASE_RESET`, `TAPTOP_BASE_VARIANT`, `TAPTOP_BASE_CONFLICT` (warning) |
| An `<img>` whose screen `width` and `height` end up on different classes after selector lowering | Both effective values are repeated on one image size class, which the compiler's image layer requires | `IMAGE_DIMENSIONS_JOINED` |
| `html { scroll-behavior }` | Removed: it freezes the editor canvas | `SCROLL_BEHAVIOR_DROPPED` (warning) |
| Class named like a Taptop system class (layer classes `div`, `text`, `button`, `image` …, `html`/`body`/`head`/`root`, and the names of Taptop's base stylesheet in `system/lib/taptop-base-classes.json`: `section`, `container`, `link`, `badge`, `menu__*`, `slider__*`, `pop-up__*` …) | Renamed to `u-<name>` in the HTML, every selector and the root selector; a clash with an existing `u-<name>` stops normalization | `RESERVED_CLASS_RENAMED` (warning) |
| Class ending in `-0`, `-1` or a zero-padded number (`col-1`, `mt-0`, `step-01`) | The trailing `-` becomes `_` (`col_1`) in the HTML, every selector and the root selector; `-2` and larger stay (`card-pad-12`) | `CLASS_COUNTER_RENAMED` (warning) |
| `<style>` elements in the page (head or body) | CSS joins the cascade after the linked stylesheets, in document order | `STYLE_BLOCK_LIFTED` |
| `<script>` elements | Removed; source JavaScript is never transferred; the behavior they drove must come from a Toolkit behavior or is listed as UNSUPPORTED | `SCRIPT_DROPPED` (warning) |
| `<meta>` inside `<body>` | Removed before layer generation; it is metadata, not a visible layer. Set its SEO or preview value separately in Taptop | `BODY_METADATA_DROPPED` (warning) |
| Tilda `.t-records` root hidden with `opacity: 0` until its source script runs | The prepared root receives a generated Embed style that makes it visible in the static preview and after import. This is a source-page normalization rule; the imported editor still needs checking. | `TILDA_ROOT_REVEALED` |
| `<details>`/`<summary>` | Accordion behavior: details → item, summary → trigger, the rest → panel (wrapped in `<item>__panel` when needed); `open` → `is-open` | `DETAILS_TO_ACCORDION` |
| A visual button whose direct child is an icon or another element | An editable container, retaining its visual class and descendants; it is not compiled as a text-only Taptop Button. | `NESTED_BUTTON_AS_CONTAINER` |
| A container whose children are only inline content, including links and line breaks | One Rich Text layer so the inline flow and link markup survive. | `INLINE_RUN_AS_RICH_TEXT` |
| Text beside other elements inside a flex/grid container (e.g. a label next to an icon) | Wrapped in its own text layer `<class>__text`; a flex/grid item already renders this way, so the layout is unchanged | `TEXT_RUN_WRAPPED` |
| Inline `<svg>` | One SVG Icon layer (`tt_svg_icon`) holding the SVG markup; its source `width`/`height` are written on the layer class (the Taptop default is 32×32) | `TAPTOP_BASE_RESET` |
| Text with inline formatting (`strong`, `em`, `u`, `s`, `br`, inner `span`, `a` …) outside a flex/grid container | One Rich Text layer (`tt_rich_text`) with the inner HTML verbatim; a link becomes a link block holding it | `RICH_TEXT_LAYER` |
| Classes and element rules that only style markup inside a Rich Text or SVG Icon layer | Embed stylesheet (it also applies in the editor canvas) | `INNER_STYLE_TO_EMBED` |
| Class rules of one breakpoint | Written in Taptop's order (class name, `localeCompare`), so the preview shows Taptop's cascade. An element whose classes compete for a property and would get a different winner than in the source gets one more class `<last class>--order[-b …]`, sorting after all of its classes and repeating the source winners per breakpoint; elements with the same classes and winners share it | `CLASS_ORDER_CONFLICT` (info, each property), `CLASS_ORDER_OVERRIDE` (info, each class added) |
| `iframe`, forms, media | Blocked | `UNSUPPORTED_TAG` (error) |
| Text mixed with block elements (a `div`, `p`, list … inside running text) | Blocked: neither a text nor a Rich Text layer can hold it faithfully (a link with text and an icon used to lose the icon silently) | `MIXED_CONTENT` (error) |
| Other behaviors | Blocked until an adapter exists | `BEHAVIOR_UNSUPPORTED` (error) |

## Accordion contract

Root marked `data-taptop-behavior="accordion"`; each direct child item holds a
trigger (`role="button"` or a class like `*trigger*`, `*question*`) and a panel
(`role="region"` or `*panel*`, `*answer*`). The class present on only some items
is the open state (default `is-open`). Items, triggers and panels must share a
class each. The Embed script restores `role`, `tabindex`, `aria-expanded`,
click and Enter/Space handling on the published page; every answer stays
visible and editable in the editor.

## Taptop facts the rules rely on (verified live 2026-10-07)

| Fact | Consequence |
| --- | --- |
| The native `line-height` control keeps only px: `1.45`, `120%`, `1.2em` and `normal` become `0px` (initial probe 2026-10-07; `normal` confirmed in the importer's live class-sync readback, 2026-10-13). As a custom rule (`isCustom: true`) any value is kept verbatim and the canvas renders it: `calc(1.04 * clamp(34px, 5.2vw, 66px))` and `1.5` read back unchanged and appeared in the canvas stylesheet (runtime `setCSS` in a disposable project, removed afterwards, 2026-10-12; save and reload of such a rule not yet seen) | The compiler writes every non-px line-height, including `normal`, as a custom rule (`toTaptopRule`); the normalizer keeps line-heights as written (`LINE_HEIGHT_CUSTOM`) |
| Taptop class sync read back `animation` as missing, and native numeric controls read a unitless nonzero `letter-spacing` as `0px` (failed import readback, no layers added, 2026-10-13) | Animation stays in the Embed stylesheet with its `@keyframes`; invalid unitless letter spacing and obsolete vendor/IE declarations are dropped before class sync (`ANIMATION_TO_EMBED`, `INVALID_VALUE_DROPPED`, `VENDOR_DROPPED`) |
| Native Taptop side margins represented as `{ number: 0, unit: 'auto' }` rendered as `0px` on the published page, pulling constrained Tilda containers to the left (published-page inspection, 2026-10-13) | The normalizer sends `margin-left/right: auto` through the Embed stylesheet (`MARGIN_AUTO_TO_EMBED`) |
| Tilda's source runtime adds `t-animate_started`; without it source `.t-animate` layers retain `opacity: 0` after import (published-page inspection, 2026-10-13) | The normalizer declares `taptop/embed-reveal-v1`, which starts effects through `IntersectionObserver` and makes a target visible as a fallback (`TILDA_REVEAL_DECLARED`) |
| Tilda holds the source photo or background in `data-original` while the markup initially points at a small blurred thumbnail; after source scripts are removed, that thumbnail remained in the import (published-page inspection, 2026-10-13) | Before dropping source scripts, the normalizer promotes `data-original` into the editable image `src` or background declaration (`TILDA_LAZY_IMAGE_PROMOTED`, `TILDA_LAZY_BACKGROUND_PROMOTED`) |
| Tilda keeps a cover's full asset in `data-content-cover-bg` while its editable cover can initially point to a tiny thumbnail; it also uses the carrier to scope a half-screen background (published-page comparison, 2026-10-13) | When Tilda supplies `data-content-cover-bg`, the normalizer promotes that asset to the cover and forces `background-attachment: scroll` (`TILDA_COVER_BACKGROUND_PROMOTED`, `TILDA_COVER_BACKGROUND_SCROLL`) |
| Tilda's geolocation scripts hide alternate `rec<id>` blocks after startup; with scripts removed, every country variant otherwise remains visible (published-page comparison, 2026-10-13) | The normalizer applies the `geo: ''` default card and removes its `hideBlocks` before it drops scripts (`TILDA_GEO_DEFAULT_APPLIED`) |
| Fonts are built into Taptop and referenced by name; `font-family` keeps only one family | Normalizer writes the bare font name (`Inter`) and drops the fallback list (`FONT_NAME`) |
| Pasting never changes an existing project class with the same name | The importer creates and updates classes through the editor runtime before the paste: classes from an earlier import of the same file are updated in place (receipt per editor version, namespace, page). Identical same-name classes are reused. Other same-name classes are imported as copies (`faq` → `faq-2`, Embed code rewritten), or updated if the user chooses. If both the file and Taptop changed a value, the user chooses which one to keep |
| Taptop may store a written class value in its own spelling (e.g. gradients, shorthands) | Class sync fails only when Taptop did not keep a value; the stored spelling goes into the receipt (`stored`), so on re-import a spelling difference is not treated as a user edit |
| Taptop breakpoints are `(max-width: 991px)`, `(max-width: 767px)`, `(max-width: 479px)`; the tablet canvas is 768px wide | Rules are written with exactly these keys; `768px`/`480px` keys fire one pixel early and are rejected by the validator |
| Every layer type has a base class before the user's classes: block `width: 100%; position: relative`, text `display: inline-flex`, image `100×100`, link block `inline-flex` | Normalizer writes back `width: auto`, `display: block`, `height: auto`, `position: static` where the source left them to the browser (`TAPTOP_BASE_RESET`); the preview applies the same base so the comparison shows Taptop's result |
| The embed stylesheet also loads in the editor canvas | `scroll-behavior` on `html` froze editor scrolling and is dropped (`SCROLL_BEHAVIOR_DROPPED`) |
| Class changes made through the editor runtime are not autosaved | The importer's paste triggers the save; standalone class fixes need an explicit save |
| Published pages use `body { margin: 0 }` and `* { box-sizing: border-box }` | Normalizer drops those resets; preview uses `taptop-preview.css` |
| Embed `<script>` runs on the published page, also inside a hidden block, before later content exists | Generated scripts wait for `DOMContentLoaded` |
| Rich Text is one layer `tt_rich_text` (class `tt-rich-text`, `can: SELECT, SET_RICH_TEXT`) with `data.text = { type: 'RICH_TEXT', value: '<html>' }`; pasted HTML with inner `span` classes, inline `style`, `br`, `strong`, `em`, `u`, `s`, headings and lists is kept verbatim through save and reload; it renders inside `.text-block-wrap-div`, links get `.tt-rich-link`; inner `p`/`h1` keep browser margins. Checked 2026-10-11 by native copy, paste of a modified copy, Cmd+S and reload in a disposable project | `RICH_TEXT_LAYER`; inner classes go to the embed |
| The Rich Text layer base is `.tt-rich-text { display: block; position: relative; margin: 0; max-width: 100% }` plus a clearfix `::before/::after { display: table }` (editor canvas stylesheet read 2026-10-12). Layer bases follow the layer type, not the user's classes | The preview gives every element the base of its layer type by `data-taptop-key` (one class may sit on a text and on a rich text); an inline source tag outside a flex/grid parent gets `display: inline-block` back (`TAPTOP_BASE_RESET`) |
| SVG Icon is one layer `tt_svg_icon`: a `<span class="svg-icon">` (`can: SELECT, SET_ATTR_SRC_SVG`) with `data.text = { type: 'HTML', value: '<svg …>' }`; it is `inline-flex`, 32×32, `overflow: hidden`, centred, and the inner `<svg>` fills it. Same check, 2026-10-11. The compiler's earlier tag-tree guess for SVG was wrong and is removed | SVG layer; the source size is written on its class |
| The editor canvas writes class rules sorted by class name (`localeCompare`), not in source or creation order (canvas stylesheet read 2026-10-11: 668 rules, two breaks at group boundaries). Of two classes on one element that set the same property, the later name wins (`type--white` lost to `type-h2`; `margin: 0` of `type-small` beat `.section-note { margin-top }`) | The normalizer outputs class rules in that order and reports `CLASS_ORDER_CONFLICT` |
| `background-image` is built only from `items`; a rule with just a gradient string is stored as `items: []` and renders `none` (all gradients of a live import lost, 2026-10-11). A gradient layer is `{ kind: 'gradient', type: 'linear'/'radial', repeat, src, colors: [{ color, number, unit }], angle + rotateType 'angle' or direction ('right bottom') + rotateType 'direction', shape, position, extent }`; two equal stops without an angle are `kind: 'fill'`. Checked by feeding generated items to the editor's own background class: identical CSS for linear with angle and with direction, radial circle and ellipse at a position, solid fill, none | `toTaptopRule` writes `items` for `background-image`; a layer it cannot express stays a custom rule |
| `max-width: none` without a unit is stored as `0px`; Taptop keeps it as `{ number: 0, unit: 'none' }` (editor size class read 2026-10-11) | `toTaptopRule` writes the `none` unit for `max-width`/`max-height` |
| Native layers carry system classes: `div`, `text`, `image`, `link-block` (editor canvas read 2026-10-08); a button is `tt_link_button` with class `button` and a `text-button` label, an image has `image__img`, inline SVG `svg-icon`/`svg-icon__path` (native-copy exports recorded in `component-builders.js`). Found again 2026-10-09: a supplied page used `.button`, which the old reserved list missed | The normalizer renames such source classes to `u-<name>` (`RESERVED_CLASS_RENAMED`); a managed build still refuses any left (`RESERVED_CLASS_NAME`). The list lives in `system/lib/taptop-system-classes.js` and a test checks it against every class name the compiler emits |
| An Embed whose code is longer than 50 000 characters makes every save fail: `saveDesign` answers `DE_ERROR_NOTIFICATION_EMBED_LIMIT_EXCEEDED` («Превышен максимальный размер кода — 50 000 символов»), the indicator stays on unsaved changes (live, 97 773-character embed, 2026-10-12) | The compiler splits the embed CSS at top-level rules into Embeds of at most 45 000 characters, in order; the normalizer drops embed rules no element of the page can match (`UNUSED_RULE`; script states and :hover are ignored for that question) |
| Taptop's base stylesheet (top-level rules of the canvas stylesheet, before the project's `@media` blocks) styles 394 class names of its widgets and states: `section`, `container`, `link`, `badge`, `text-subtitle`, `menu__*`, `slider__*`, `pop-up__*`, `tabs__*`, `form__*`, `is-active` … and is written after the project rules: an imported `.section { display: none }` mega-menu panel showed because the base `.section { display: block }` came later (live import 2026-10-12, list read from the canvas) | The names are in `system/lib/taptop-base-classes.json` and reserved like layer classes: the normalizer renames them to `u-<name>`, `build` and `ui-kit --check` refuse them |
| A native numeric control keeps only a number with px, %, em, rem, vw or vh, or a keyword it knows (`auto`, `none`, `normal`): `width: fit-content` was stored as 0px and collapsed badges to one letter per line (live import 2026-10-12) | `toTaptopRule` sends other values of length properties and `font-weight` (fit-content, max-content, 100svh, inherit) as custom rules |
| A trailing `-<number>` in a class name is Taptop's duplicate counter. Creating a class whose base has no counter yet drops `-0`/`-1` (`col-1` → `col`, `mt-0` → `mt`) and leading zeros (`q-007` → `q-7`); `-2` and larger are kept; `q_1`, `q1`, `q-1a` are stored verbatim; same in the design collection (`generateByName` read and tried without adding, disposable project, 2026-10-12). Found when a 1014-class page import failed with "Не удалось обновить классы": every generated `<class>-inline-1` was refused while `-inline-2` was created | Normalizer renames such source classes to `<base>_<number>` (`CLASS_COUNTER_RENAMED`), inline-style classes are `<class>-inlineN`; `ui-kit --check` and `build` refuse any left (`CLASS_NAME_RESPELLED`). Rule: `counterSafeClass` in `system/lib/taptop-system-classes.js` |

A local zero-difference comparison does not prove the Taptop result: always import into a clean page and check the published page.

## Known limits

- Embed scripts run on the published page only; embed CSS also applies in the editor canvas.
- Open question (2026-10-09, needs a live import): an `<img width height>` inside a stretching flex column keeps its size in the original, but the normalized class gets `width: auto; height: auto` (`TAPTOP_BASE_RESET`) and the local preview stretches it to the column width. The package sets the `tt_image` `maxWidth`/`maxHeight` to the intrinsic size, which `taptop-preview.css` does not emulate. Until the editor result is observed, treat such an image difference in the comparison as unresolved, not as a pass.
- Embed CSS targets class names; if Taptop renames a colliding class on paste,
  the matching Embed rules stop applying. Prefer unique source class names.
- Taptop keeps an existing project class with the same name on paste; class updates go through the runtime class sync, never through paste.
- Re-import receipts live in the editor browser's localStorage: another browser or a cleared storage treats the next import as a first one (same-name classes → choice).
- State rules in the `cm` channel are compiled from an existing contract; their
  editor rendering needs a live receipt per new state type.
