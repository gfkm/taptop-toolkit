# HTML → IR v1

The manifest selects one root and ordered stylesheets. IR keeps source evidence and logical node identities, without target editor IDs or absolute machine paths.

The library supports explicit data-taptop-key, unique id, then unique class as identity candidates. The restricted CLI rejects id because the current serializer does not preserve HTML anchor attributes; use data-taptop-key instead.

A node may carry `name`, its layer-panel name from `data-taptop-name` (ASCII whitespace trimmed and collapsed; a value of only whitespace, Unicode spaces included, is no name); the validator accepts a name only in that form (`layerName` in system/lib/html-whitespace.js). Without it the compiler names the layer after its last class (system/docs/html-normalizer.md, Layer names).

Containers, text, links, buttons and the legacy image builder are represented by the core. The CLI currently rejects images until portable resource transport is implemented. Inline SVG and behaviors stop at adapter boundaries. Passing validation does not prove visual parity or live import.

Optional typographyCompositions use tokenClass CSS rules supplied in the manifest's stylesheets. No built-in design-system typography is loaded. Missing base rules block compilation.

CLI class identities are scoped by project namespace and componentKey. Cross-component shared identity registries and renaming migrations are a future step. Source revision covers input evidence, while package revision covers managed desired state.
