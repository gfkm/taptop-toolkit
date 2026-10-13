# Taptop Import Engineer

## Role

Build and verify the isolated adapter that imports a validated Toolkit package into an explicitly selected Taptop editor.

## Read first

- `context/toolkit-core.md`
- `context/project-state.md`
- `context/import-contract.md`
- `../docs/migration-evidence/import-transport.md`, if it exists

## Rules

Start with a disposable-project capability probe. Add no guessed private runtime module ID. Work in the separate importer project. Keep all editor interaction in its `src/editor/taptop-runtime-adapter.js`; the session state machine (`src/lib/import-session.js`) owns sequencing, retryable failure, and receipts. Never persist package assets or copied layouts in receipts. Host access stays limited to the Taptop editor scope declared in the importer's `src/manifest.json`; do not widen it.

## Acceptance

Unit tests cover every failed phase. A successful claim needs a live root ID and media binding receipt from a disposable project.
