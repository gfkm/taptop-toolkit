# Project layout, selection and builds

Toolkit code and rules live in `system/`. User work lives in separate directories under root `projects/`. The distributed Toolkit starts with no initialized project. `npm run toolkit -- init projects/site-name site-name` creates one; the last argument is its stable namespace. It cannot be an existing destination.

| Project path | Owner and meaning |
| --- | --- |
| `taptop.project.json` | Pinned Toolkit version, stable namespace and layout version; optional human-readable `displayName` |
| `input/` | Original files and source evidence (`input/<name>/index.html`, its CSS and images, intake files). Never rewritten by the Toolkit |
| `design-system/` | This project's values: `foundations.json`, `registry.json`, `sources.md` (sources, evidence, MISSING list, decisions) and, once evidence exists, `kit.json` and `roles.css`. Starts empty, never copied from another project |
| `source/artifacts.json` | Registry of buildable artifacts: `ui-kit`, `components/<name>`, `pages/<name>`; each with `html`, `stylesheets` and optionally `externalStylesheets` (the target site's own stylesheets, `--external-css`), `rootSelector`, `intake`, `dependsOn`, `title` |
| `source/ui-kit/` | UI-kit showcase HTML/CSS written by the generator from `design-system/kit.json`; do not edit by hand |
| `source/components/`, `source/pages/` | Working HTML/CSS written for this project (Figma or AI routes) |
| `output/html/index.html` | Results page: every artifact, its status, local/editor/published checks and links |
| `output/html/<artifact>--<build>/page.html` | Browsable preview of one build with `taptop-preview.css`, its CSS and images |
| `output/json/<artifact>--<build>.json` | The import package of the same build (same `<build>` ID as its preview) |
| `.taptop/` | Private state: `outputs.json` catalogue, `work/` normalization, `builds/` journals, `history/`, `lock`. Never publish it |

`<artifact>` is the artifact key with `/` replaced by `--` (`pages/home` → `pages--home`). `<build>` is `YYYYMMDDTHHMMSSZ-xxxxxxxx`. Earlier builds stay in `output/` and are listed as history; the Toolkit never deletes them.

The layout contract is `system/contracts/project/layout.schema.json`; the artifact registry contract is `system/contracts/project/artifacts.schema.json`. New projects use `layoutVersion: 2`. Projects without `layoutVersion` remain readable by the legacy `normalize`/`compile` flow; `build` refuses them with `MANAGED_BUILD_REQUIRES_LAYOUT_2`. An unknown layout version is an error; no automatic migration rewrites a project. Moving or renaming a directory keeps its namespace and identity. Copying a project folder creates two projects with one namespace; both are then refused (`DUPLICATE_NAMESPACE`) until one is removed. For an independent site run `init` and copy only `input/` material.

## Selecting a project

Run `npm run toolkit -- projects` to inspect the immediate child directories of `projects/`. It reports invalid entries, symlinks, duplicate namespaces (errors) and equal display names (warnings). An AI agent may infer the selected project only when exactly one valid project exists and there are no diagnostics. With several projects it asks the user which project to use. Selection uses `projects/<folder>` or an absolute external project path, never a display name. A stated project path overrides prior chat context. A stale path is an error, never a reason to choose a neighbor. Modifying commands take `--project` (or the legacy positional project path) and there is no global active-project file, so two chats can work on two projects at once. Two writers on the same project are serialized by `.taptop/lock`: the second gets `PROJECT_LOCKED`. A lock left by a process that no longer runs on this computer is recovered by the next command and recorded in `.taptop/history/recovered-locks.jsonl`.

## Managed build flow

```sh
npm run toolkit -- ui-kit projects/site-name --data design-system/kit.json
npm run toolkit -- build --project projects/site-name --artifact ui-kit
npm run toolkit -- artifact add --project projects/site-name --key pages/home --html input/home/index.html --css design-system/roles.css --css input/home/styles.css --depends ui-kit
npm run toolkit -- build --project projects/site-name --artifact pages/home
npm run toolkit -- doctor --project projects/site-name
```

`ui-kit` registers the `ui-kit` artifact the first time. A build validates the project and the artifact's intake, requires every dependency to have a finished build, normalizes, compiles, checks shared classes, assembles the preview and only then publishes the pair. The catalogue (`.taptop/outputs.json`) is written last, so a build that stops earlier never appears as a result; the previous result stays current. A repeated build with unchanged inputs and the same Toolkit code reports `up-to-date` and writes nothing. Each build records `toolkitRevision`, a hash of the Toolkit's runtime sources (`system/lib`, `system/contracts` and `package-lock.json`, whose parse5 and postcss versions shape the package; CRLF read as LF, so a Windows checkout hashes the same; `system/lib/toolkit-revision.js`): a fix to the normalizer or compiler can change the package without changing the prepared input, so a build made by other code builds again instead of keeping the earlier package. Any edit under `system/lib` or `system/contracts`, or to `package-lock.json`, therefore makes every artifact stale, and its next build gets a new build ID; the verification records (`local`, `editor`, `published`) belong to a build and do not carry over, so record the local check again after such a rebuild.

Statuses: `current`; `stale` (an input file or image, the registration — stylesheets, external stylesheets, root selector, intake, dependencies —, a dependency build, the Toolkit version or the Toolkit code changed — `built by other Toolkit code`, also for a build recorded before `toolkitRevision` existed; the files remain usable as history). An edit that does not change the prepared result (a comment, a reset the normalizer drops) is re-validated by the next build without a new output; `output-missing`; `output-modified`; `never-built`; `unregistered`. `doctor` is read-only and gives one next action per issue; see [troubleshooting](troubleshooting.md).

Checks are recorded separately with `npm run toolkit -- check --project … --artifact … --level local|editor|published --result passed|failed --note "…"`. A built JSON is not evidence of a live import.
