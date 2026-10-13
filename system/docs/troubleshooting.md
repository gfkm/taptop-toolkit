# Troubleshooting

Start with the read-only diagnosis. It never changes, deletes or re-pins anything:

```sh
npm run toolkit -- doctor --project projects/<folder>
```

Each issue has `level` (`error` blocks work, `warning` needs attention, `info` is a state), `code`, `path`, `message` and `nextAction`.

## Doctor codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `PROJECT_CONFIG_INVALID` | `taptop.project.json` or `design-system/registry.json` is unreadable, has an invalid namespace, unknown layout, or pins another Toolkit version (`INCOMPATIBLE_TOOLKIT`) | Use the Toolkit version pinned by the project or migrate deliberately. Never edit the pinned version to silence the error |
| `DUPLICATE_NAMESPACE` | Two folders under `projects/` share a namespace, usually a copied folder | Keep one. For an independent site, `init` a new project and copy only `input/` |
| `LEGACY_LAYOUT` | Project created before layout version 2 | Keep using `normalize`/`compile`, or create a new project for managed builds |
| `SYMLINKED_PROJECT_FOLDER` | `input`, `design-system`, `source`, `output` or `.taptop` is a symbolic link | Replace it with a real folder inside the project |
| `LOCK_HELD` / `LOCK_ABANDONED` / `LOCK_UNREADABLE` | A task is writing; its process is gone (the next command recovers the lock); the lock cannot be read | Wait; nothing; make sure no task runs, then delete `.taptop/lock` yourself |
| `ARTIFACT_REGISTRY_INVALID` | `source/artifacts.json` is broken, has an unknown field, a cycle or a dependency on a page | Fix or restore it; register entries with `artifact add` |
| `ARTIFACT_SOURCE_MISSING` | A registered HTML, CSS or intake file is gone | Restore the file or register the artifact again with the right path |
| `INTAKE_INVALID` | The artifact's intake lacks required evidence | Complete it with real evidence; keep unknown values `MISSING` |
| `UI_KIT_MODIFIED` | `source/ui-kit/` was edited by hand | Move the change into `design-system/kit.json` / `roles.css`, restore the generated file from `.taptop/history/ui-kit/`, run `ui-kit --replace` |
| `CATALOG_CORRUPT` | `.taptop/outputs.json` is unreadable | Restore the newest copy from `.taptop/history/outputs/`; do not delete outputs |
| `NOT_BUILT` | Registered but never built | Run the printed `build` command |
| `STALE_RESULT` | An input file or image, the registration, a dependency build or the Toolkit version changed since the current build | Rebuild; the old pair stays available as history |
| `OUTPUT_MISSING` / `OUTPUT_MODIFIED` | The current JSON or preview was deleted or edited | Rebuild; never hand-edit generated JSON |
| `UNREGISTERED_RESULT` | Results exist for an artifact no longer in the registry | Register it again or keep the files as history |
| `CLASS_RULE_CONFLICT` | Two current, unrelated artifacts give one class name different rules | Give the class one rule set (normally in the UI kit) and rebuild both |
| `ORPHAN_OUTPUT` | A file in `output/` that no finished build lists (an interrupted build or a hand-added file) | Do not import it; delete it yourself when no longer needed |
| `INTERRUPTED_BUILD` | A build journal says `started` and no task holds the lock | Rebuild; the last finished result is unchanged |
| `CATALOG_PAGE_MISSING` / `CATALOG_PAGE_OUT_OF_DATE` | `output/html/index.html` is missing or does not list the current builds | `npm run toolkit -- catalog --project projects/<folder>` |

## Build and command errors

| Message starts with | Cause | What to do |
| --- | --- | --- |
| `INVALID_SELECTION`, `--project is required` | The project path is missing, wrong or not under `projects/` | Run `npm run toolkit -- projects` and pass `--project projects/<folder>` |
| `PROJECT_LOCKED` | Another task is writing this project | Wait for it; if none runs, `doctor` shows whether the lock is abandoned |
| `MANAGED_BUILD_REQUIRES_LAYOUT_2` | Legacy project | See `LEGACY_LAYOUT` |
| `UNKNOWN_ARTIFACT`, `INVALID_ARTIFACT_KEY`, `DUPLICATE_ARTIFACT`, `UNKNOWN_DEPENDENCY`, `INVALID_DEPENDENCY`, `INVALID_DEPENDENCIES`, `DEPENDENCY_CYCLE`, `ARTIFACT_SOURCE_LOCATION`, `ARTIFACT_SOURCE_MISSING`, `INVALID_ARTIFACT_SOURCE`, `MISSING_STYLESHEETS`, `DUPLICATE_STYLESHEET`, `INVALID_ROOT_SELECTOR`, `INVALID_ARTIFACT_TITLE`, `INVALID_ARTIFACT_FIELD`, `INVALID_ARTIFACT_REGISTRY`, `UNSAFE_PROJECT_PATH`, `OUTSIDE_PROJECT` | The registration is wrong: keys are `ui-kit`, `components/<name>`, `pages/<name>`; HTML ends in `.html`, at least one `.css`; a root selector is one `.class`; pages cannot be dependencies and the UI kit depends on nothing; generated folders (`output/`, `.taptop/`, `source/normalized/`) cannot be sources | Correct the `artifact add` arguments; keep originals in `input/`. A hand-edited `source/artifacts.json` must match `system/contracts/project/artifacts.schema.json` |
| `INVALID_NAMESPACE`, `UNSUPPORTED_PROJECT_LAYOUT`, `INCOMPATIBLE_TOOLKIT` | `init` got a namespace that is not lowercase letters/digits/hyphens, or the project's layout or pinned version is not supported | Choose a valid namespace; for layout/version see `PROJECT_CONFIG_INVALID` |
| `INVALID_CHECK_LEVEL`, `INVALID_CHECK_RESULT`, `EVIDENCE_REQUIRED` | `check` needs `--level local\|editor\|published`, `--result passed\|failed` and a `--note` saying what was checked | Repeat with all three |
| `DEPENDENCY_NOT_BUILT: ui-kit` | The page depends on a UI kit with no finished build | Build the UI kit first |
| `INVALID_INTAKE` | The intake file is unreadable or incomplete | See [source intake](source-intake.md) |
| `NORMALIZATION_FAILED: <codes>` | The normalizer found unsupported content (`UNSUPPORTED_TAG`, `MIXED_CONTENT`, `BEHAVIOR_UNSUPPORTED` …) | Read `.taptop/work/<artifact>/normalization-report.json` and the [normalizer rules](html-normalizer.md); change the source, never the generated files |
| `BODY_METADATA_DROPPED` in the normalization report | A source page put `<meta>` inside its body; it has no editable layer | The tag was removed with a warning. Set any needed SEO or social-preview values in Taptop separately |
| `IMAGE_DIMENSIONS_JOINED` in the normalization report | An image's width and height were on different source classes after selector lowering | The normalizer repeated both on one image size class so the compiler could create an image layer; compare its size at every canvas width |
| `TILDA_SLIDER_DECLARED`, `TILDA_CAROUSEL_DECLARED`, `TILDA_INLINE_VIDEO_DECLARED`, `TILDA_VIDEO_DIALOG_DECLARED` or `TILDA_REVEAL_DECLARED` in the normalization report | A supported Tilda interactive structure was converted to editable layers plus a generated Embed behavior package; source JavaScript was not copied | Test the interaction in a local preview, then import into an authorized editor and record the editor and, only with publication consent, published results |
| `NESTED_BUTTON_AS_CONTAINER` or `INLINE_RUN_AS_RICH_TEXT` in the normalization report | The source markup cannot be faithfully expressed as a text-only Button or ordinary text layer | Review the generated editable container or Rich Text layer in the preview; it preserves the source visual structure |
| `TILDA_ROOT_REVEALED` in the normalization report | The source Tilda root relied on its own script to become visible | The generated Embed style makes it visible locally; inspect the imported editor result before passing the page |
| `ANIMATION_TO_EMBED` in the normalization report | Taptop class sync does not retain animation declarations | The animation stays in the generated Embed stylesheet together with its keyframes; check it on a published page only with publication consent |
| `MARGIN_AUTO_TO_EMBED` in the normalization report | Taptop saves native auto side margins as `0px`, which left-aligns constrained sections | The generated Embed stylesheet owns those margins. Re-import the rebuilt package and verify the section at desktop, tablet and mobile canvas widths |
| `TILDA_REVEAL_DECLARED` in the normalization report | Tilda's source script normally starts `t-animate` targets; without it they can remain transparent | The generated reveal Embed starts targets on viewport entry and guarantees visibility after the source effect's normal duration |
| `TILDA_LAZY_IMAGE_PROMOTED` or `TILDA_LAZY_BACKGROUND_PROMOTED` in the normalization report | Tilda initially supplied a blurred lazy-load thumbnail and retained the original asset in `data-original` | Re-import the rebuilt package, then compare the affected cards, sliders, covers and video posters on desktop and mobile canvases |
| `CUSTOM_PROPERTY_TO_EMBED` or `VARIABLE_TO_EMBED` in the normalization report | A class cannot carry a CSS custom-property cascade or every contextual `var()` value | The generated Embed retains the source property and its consumers; compare the affected component at all canvas widths |
| `TILDA_COVER_BACKGROUND_PROMOTED` or `TILDA_COVER_BACKGROUND_SCROLL` in the normalization report | Tilda's cover source is held on its carrier and the startup changes its positioning area | The generated cover uses the carrier's original image and `background-attachment: scroll`; compare the cover at desktop and mobile widths |
| `TILDA_GEO_DEFAULT_APPLIED` in the normalization report | Tilda's source script selects a country-specific group of blocks | The package keeps the source default (`geo: ''`) and removes its hidden alternatives; if another country variant is required, supply it as a deliberate content choice before import |
| `INVALID_VALUE_DROPPED` in the normalization report | A browser-invalid legacy value such as `letter-spacing: .45` or `filter: alpha(…)` was removed | Keep a standards-compliant source declaration if the effect is needed; a modern equivalent such as `opacity` is preserved |
| A button loses its color or background after normalization | A same-element compound selector such as `.btn.flex` may be left in the later Embed stylesheet and override a more specific source rule | Rebuild with the current normalizer, which lowers such selectors to a class (`SELECTOR_LOWERED`), then compare the source and preview at all widths |
| `UNSUPPORTED_*`, `INLINE_CSS`, `PREFLIGHT_FAILED` | The compiler or package preflight rejected the prepared page | Same as above; report a new normalizer case with a synthetic fixture |
| `DEPENDENCY_CLASS_MISMATCH: <class>` | The page gives a class of a component it depends on other rules | Use the component's rules, or change and rebuild the component first |
| `UI_KIT_CLASS_MISMATCH: <class>` | The page gives a UI-kit class rules that differ from the current kit build | Change the UI kit first (`design-system`), rebuild it, then use exactly its rules (list `design-system/roles.css` first) |
| `CLASS_RULE_CONFLICT: <class>` | Another current artifact uses the same class name with other rules | Rename the local class or move the shared rule into the UI kit |
| `RESERVED_CLASS_NAME: <class>` | A class with a Taptop system name (layer classes such as `div`, `text`, `button`, `image`, document names `html`/`body`/`head`/`root`, and every name of Taptop's base stylesheet in `system/lib/taptop-base-classes.json`: `section`, `container`, `link`, `badge`, `menu__*`, `slider__*`, `pop-up__*`, `tabs__*` …) reached the build. Supplied HTML is renamed to `u-<name>` automatically (`RESERVED_CLASS_RENAMED`), so this comes from hand-written HTML/CSS | Use `u-<name>` in `kit.json`, `roles.css` and pages |
| `EMBED_RULE_TOO_LARGE` | A single embed CSS rule is longer than 45 000 characters; Taptop keeps at most 50 000 characters per Embed and refuses to save the page otherwise | Shorten that rule in the source (often a huge inline `url(data:…)`) |
| `CLASS_NAME_RESPELLED: <class>` | The class ends in `-0`, `-1` or a zero-padded number; Taptop reads it as its duplicate counter and would create another name (`col-1` → `col`), so the import fails with «Не удалось обновить классы». Supplied HTML is renamed automatically (`CLASS_COUNTER_RENAMED`) | Use the name it suggests (`col_1`) in `kit.json`, `roles.css` and pages |
| `UI_KIT_EXISTS`, `UI_KIT_MODIFIED` | Generated kit files exist or were edited | Use `ui-kit --replace` for unchanged files; otherwise see `UI_KIT_MODIFIED` above |
| `CATALOG_CORRUPT` | See the doctor table | — |
| `NORMALIZED_EXISTS`, `OUTPUT_EXISTS` | Legacy commands never overwrite | Use a new output name, or move `source/normalized/` aside deliberately |

## Build warnings

| Warning | Meaning | What to do |
| --- | --- | --- |
| `RESERVED_CLASS_RENAMED` (normalizer) | A source class had a Taptop system name and became `u-<name>` | Use `u-<name>` in the UI kit and other pages; the original file is unchanged |
| `CLASS_COUNTER_RENAMED` (normalizer) | A source class ended in `-0`, `-1` or a zero-padded number and became `<base>_<number>` | Use the new name in the UI kit and other pages; the original file is unchanged |
| `FONT_FILE_RELATIVE` (normalizer) | An `@font-face` loads its file by a relative path; the embed keeps the rule, but the file does not reach Taptop and the text renders in a fallback | Upload the font in the Taptop project settings under the same family name, or give the source a full `https://` font URL |
| `CLASS_ORDER_CONFLICT`, `CLASS_ORDER_OVERRIDE` (normalizer) | Two classes of one element set the same property and Taptop, which orders class rules by name, would keep the other value (e.g. a colour modifier `type--white` sorts before `type-h2`). The normalizer resolves it with a class `<class>--order` that sorts last and repeats the source value | Nothing for supplied HTML. In your own kit or pages prefer names that sort right (`white-text` after `type-h2`), so fewer extra classes are needed |
| `NO_UI_KIT_ROLES_USED` | The artifact depends on the UI kit but uses none of its classes | Replace look-alike classes with the kit's exact role classes |
| `CATALOG_PAGE_NOT_UPDATED` | The build is finished and catalogued, but `output/html/index.html` could not be rewritten | `npm run toolkit -- catalog --project projects/<folder>` |
| `STAGING_NOT_CLEANED` | Temporary files of a finished build could not be removed | Harmless; they stay under `.taptop/builds/` |

A build that stops for any reason leaves the previous result current. `output/html/index.html` and `.taptop/outputs.json` only ever list finished builds.

## Local comparison and import

- `normalize-compare` reports “0 elements matched”: the URL is wrong or the page is empty — the comparison failed; it is not a pass.
- “element structure differs”: the original has elements outside the normalized root (`--root`) or the source changed; compare the prepared root on its own page or register the whole page.
- “font not installed locally”: the page font renders in a fallback on this computer, so text sizes differ for a reason unrelated to the transfer. Install the font (Taptop itself has its fonts built in) and compare again.
- The importer rejects a package: check that the importer supports package version 2 and rebuild the artifact rather than editing the JSON.
- After import, check the editor canvases, save and reload; record the result with `check --level editor`. Report a mismatch with the steps in the root `AGENTS.md` (“Каждая найденная ошибка становится правилом”).

When asking for help, share the `doctor` output and the relevant `normalization-report.json`, not the project's `.taptop/` folder or import receipts.
