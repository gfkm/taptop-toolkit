# Build and verify

## UI kit first

1. Write `design-system/kit.json` and `design-system/roles.css` from confirmed values only — format, rules and example in [kit data](kit-data.md).
2. Check, generate and build:

```sh
npm run toolkit -- ui-kit projects/<folder> --data design-system/kit.json --check
npm run toolkit -- ui-kit projects/<folder> --data design-system/kit.json
npm run toolkit -- build --project projects/<folder> --artifact ui-kit
```

After each step run `npm run toolkit -- next --project projects/<folder>`; it names the next artifact to build or check. Full command list: `system/docs/cli-reference.md`.

After changing `kit.json` or `roles.css`: `ui-kit projects/<folder> --data design-system/kit.json --replace`, then build `ui-kit` again. Every page that depends on it becomes `stale`. Never edit `source/ui-kit/` by hand (`UI_KIT_MODIFIED`).

## Pages and components

```sh
npm run toolkit -- artifact add --project projects/<folder> --key pages/home --html input/home/index.html --css design-system/roles.css --css input/home/styles.css --depends ui-kit [--intake input/home/intake.json] [--root .home-page]
npm run toolkit -- build --project projects/<folder> --artifact pages/home
```

- Keys: `pages/<name>`, `components/<name>` (lowercase, hyphens). Two pages may both be `index.html`.
- Originals stay in `input/`; Figma/AI-authored HTML goes in `source/pages/` or `source/components/`.
- Use the kit's exact class names for text, buttons and links. `NO_UI_KIT_ROLES_USED` means none were used — check for look-alike classes.
- `UI_KIT_CLASS_MISMATCH`: the page's rule differs from the kit. Change the kit first if the design really changed; otherwise use the kit rule.
- Repeated build with no change → `up-to-date`; nothing new is written. After a Toolkit update every artifact is `stale` (`built by other Toolkit code`) and the next build writes a new pair: build every artifact again before handing anything over.
- The target site already has its own classes (built in the Taptop editor) and the page should use them by name: register the site's stylesheet with `--external-css design-system/<site>.css` (repeatable). Those classes stay on the layers, the package carries no rules for them and lists them in `externalClasses`; the preview and comparison load the sheet. A page rule on such a class stops the build (`EXTERNAL_CLASS_REDEFINED`): put page values on a page class of the element. Give every element its own page class next to the site classes; an element with only site classes that needs page values stops the build (`EXTERNAL_ONLY_ELEMENT`). `EXTERNAL_ORDER_UNVERIFIED` asks for an editor check of that element. The site may define the Toolkit's own classes only exactly as the Toolkit does (`.toolkit-behavior { display: none; }`, reported as `TOOLKIT_CLASS_ON_SITE`); any other site rule for one the package uses stops the build (`TOOLKIT_CLASS_CONFLICT`): tell the user which site rule hides or shows the behavior Embeds. Details: `system/docs/html-normalizer.md`, "External stylesheets".

## Where the results are

`build` prints `htmlPath`, `jsonPath` and `links`. Results page: `projects/<folder>/output/html/index.html`.

```sh
npm run toolkit -- serve
```

Open `links.compare` (comparison at all eight widths) and `links.results`. The tool must report a non-zero number of matched elements and zero differences, or each difference explained. “font not installed locally” means text sizes are not comparable: ask the user to install the font (or the original to link it) and compare again; do not record a pass meanwhile. An image larger in the preview than in the original is an open question that needs the editor check (`system/docs/html-normalizer.md`, Known limits). Then:

```sh
npm run toolkit -- check --project projects/<folder> --artifact pages/home --level local --result passed --note "8 widths, N elements, 0 differences"
```

## Import (separate importer extension)

The user loads the JSON with the Taptop Toolkit Importer in an authorized Taptop editor: UI kit first, then pages. UI-kit roles must appear as already existing / unchanged, not new. After import: Computer, 768, 480, 320 canvases; scroll to the end; editable text; save until the indicator is green; reload; re-check. Record `--level editor` with what was checked. Do not publish a site without explicit consent.
