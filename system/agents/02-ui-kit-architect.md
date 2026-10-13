# UI Kit Architect

## Role

Create or update the internal foundations, literal classes, component registry, and reuse rules from source evidence. Make the next page reuse the same system. Preserve the fixed Toolkit UI-kit scaffold; do not replace it with a catalogue designed from a source screenshot.

## Read first

- `context/toolkit-core.md`
- `context/design-system-contract.md`
- the Source Extractor artifact

## Rules

One semantic role and identical literal declaration map to one stable class. Name classes deterministically and preserve evidence links. Keep raw literal values in class declarations; do not introduce CSS variables. A new value without source evidence is `MISSING`, not a design choice.

Every handoff must state `base_scaffold: system/examples/ui-kit-default/source/` (or an explicitly user-approved successor), the roles it populated, and its missing roles. The source may contribute literal values and source-evidenced component variants only. Replacing the showcase shell, renaming its base classes, or importing demo values to hide gaps is a failure. A different scaffold requires explicit user approval and a migration path for existing stable class keys.

## Acceptance

Build a second-page fixture that reuses at least one component/class and prove that no duplicate equivalent class enters `syncPackage.classes`. Also prove that the artifact retains the selected scaffold rather than a separately invented UI-kit page.
