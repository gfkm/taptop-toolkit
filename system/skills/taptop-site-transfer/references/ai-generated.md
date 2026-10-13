# AI-generated design

Only after the user approves a brief and a visual direction. Record both in the intake (`sourceType: ai-generated`, `ai.brief`, `ai.visualDirection`, `ai.approved: true`); `npm run toolkit -- intake` fails with `MISSING_APPROVED_DIRECTION` otherwise.

- Record the brief, the approved direction and every value you propose in `design-system/sources.md` (marked AI-proposed, with the date of approval). Write the kit with [kit data](kit-data.md).
- The approved direction is the source of evidence. Values you introduce (colors, type scale, spacing) are proposals until the user approves them; record them as AI-proposed, not as extracted.
- Build the UI kit first in the canonical scaffold, then pages that use its exact classes.
- Text content comes from the user. Placeholder copy is marked as such and listed in the final report.
- Responsive behavior you design is your decision, not a source fact; say so.
- This route never claims fidelity to a Figma file or website.
