# Provenance and rights review

Status: opened 2026-10-09. Public upload remains gated on verified origins and a chosen compatible license. This file records observations and required decisions, not a legal conclusion.

| Material | Observed origin | Release disposition | Evidence still needed |
|---|---|---|---|
| Compiler/normalizer modules | Extracted from the local `taptop-export` working snapshot; hashes in `docs/extraction-provenance.json` | Review | Authorship and rights to release every copied module |
| Importer class-sync algorithms | Adapted from fork-local Helper work: `import-sync/` is absent from the GoodMade release base commit and untracked in the fork (checked 2026-10-09, see `PROVENANCE.md`) | Block public upload until owner confirms authorship | Owner confirmation that fork-local `import-sync` was written by the owner/agents |
| Importer runtime adapter technique | Same webpack-chunk `require` technique and Taptop internal formats as the GoodMade release (no license file; personal permission only); text not copied | Owner decision | Whether GoodMade's permission covers a separate public product, or explicit written permission/attribution |
| Importer fonts | Bundled Inter with importer `src/fonts/LICENSE.txt` (SIL OFL) | Review and preserve notice | Confirm license applies to the exact distributed font file |
| Importer icons/screenshots | Local extension assets | Review | Authorship and third-party marks; use sanitized screenshots |
| `docs/references/` playbook | External design reference | Exclude from distribution unless rights established | Source and redistribution rights |
| `pilot/` and author Figma assets | User experiments in verified private archive | Exclude | None for public release if absent from source/history/assets |
| `test/fixtures/source-modes/` | Synthetic URLs, refs, values and content | Candidate include | Recheck all eight JSON files during release content scan |
| Node dependencies | Locked in `package-lock.json`: entities 8.1.0 BSD-2-Clause, nanoid 3.3.18 MIT, parse5 8.0.1 MIT, picocolors 1.1.1 ISC, postcss 8.5.27 MIT, source-map-js 1.2.1 BSD-3-Clause (read from installed `package.json`, 2026-10-09) | Permissive; keep notices | `npm audit` reports a high advisory for source-map-js 1.2.1 (GHSA-68fv-2mgg-jv7q); updating the lockfile needs an owner decision |

`docs/PROVENANCE.md` has an older general statement saying Helper code was not included, followed by a later specific record of adapted class-sync algorithms. The later record is more precise. Update the public provenance account after tracing ownership rather than repeating the broad statement.

Do not choose a public license solely from package metadata or a matching SHA. Record the source, license, permission and intended attribution for every included item. If rights cannot be established, replace or exclude the material, then rerun affected tests and acceptance checks.
