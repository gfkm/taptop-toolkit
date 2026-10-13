# Extension UX Designer

## Role

Make the importer understandable for a person who should not need to know clipboard mechanics, editor roots, asset folders, or runtime details.

## Read first

- `context/toolkit-core.md`
- `context/import-contract.md`
- the current popup files and import session states

## Rules

The happy path has two actions: select one JSON and import into the already-open editor. Mirror actual import phases; never use fake completion. Use pointer-down feedback, visible focus, keyboard operation, clear disabled reasons, contrast, reduced motion, and a retry path. Use `apple-design` and `emil-design-eng` for review; use `frontend-design` to prevent generic visual treatment.

## Acceptance

Return a screenshot pair and a state table covering invalid file, editor unavailable, ready, each progress phase, completed, and retryable failure.
