# Release checklist

Updated 2026-10-09. This is a live checklist; the detailed gates are in the the maintainers' development plan (`system/docs/superpowers/`, kept out of the distribution). A local test pass does not establish that a live Taptop import works.

## Local migration

- [x] Private baseline captured: 688 files, 308 passing tests, zero source mutations.
- [x] Personal pilots copied to an external archive, byte-verified and restore-rehearsed before removal from Toolkit.
- [x] Pilot-dependent tests replaced with synthetic fixtures; no Toolkit test needs `pilot/`.
- [x] Core code, contracts, examples, agents, skills and docs moved to `system/`; semantic compiler parity checked.
- [x] Importer extracted into a separate sibling project with independent `npm test` and runtime ZIP build.
- [x] New project layout and read-only project listing introduced; two projects never imply a global active project.
- [x] Multi-artifact registry, repeated page builds, coherent HTML/JSON output catalogue, failure recovery and project doctor implemented with synthetic tests (2026-10-09).
- [x] Importer checked against managed-build packages (shared class keys, UI-kit reuse, image) from an isolated copy; contract hashes identical (2026-10-09).
- [x] Allowlist release candidate assembled by `system/scripts/package-toolkit.js`; clean install in a path with spaces and Cyrillic: `npm ci`, 254 tests, getting-started walkthrough executed verbatim, comparison 0 differences at 8 widths (2026-10-09). Repeat on the final candidate.

## Live verification

- [ ] Use a disposable authorized Taptop project for a real import and capture a redacted receipt; archived author pilots are private test material, not public fixtures.
- [ ] Check image transfer, class reuse, Root placement and editable layers after browser restart.
- [ ] Compare original and normalized pages at 1440/992/768/480/320 and 900/700/375 using `taptop-preview.css`.
- [ ] Check editor canvas at Computer, Tablet 768, Mobile landscape 480 and Mobile portrait 320; scroll fully, save and reload.
- [ ] Check published behavior only after separate authorization to publish a disposable page.

## Public distribution

- [ ] Resolve [license and provenance](PROVENANCE.md), especially adapted Helper class-sync logic, before public source upload.
- [ ] Finish and verify user README, AI skills, examples, troubleshooting and privacy/support documentation.
- [ ] Establish two clean Git repositories; do not stage the unrelated parent index.
- [ ] Create tested Toolkit and importer GitHub releases with distinct versions.
- [ ] Prepare and submit the independent importer ZIP to Chrome Web Store, then verify the installed version. Submission and publication are different states.

The source of both products is published on GitHub under the MIT License (2026-10-13). No npm package or Chrome Web Store listing exists yet.
