# Agent operating model

## Purpose

This is a lean team for building and operating Taptop Toolkit. It improves quality through explicit expertise and evidence, not through a permanent swarm of agents. One primary agent owns a normal task. A specialist is invoked only when the task matches a listed trigger.

## Default route

1. **Orchestrator** reads the task and attaches only the necessary context files.
2. **One owner** completes the bounded work and records evidence.
3. **QA Reviewer** is added for an acceptance check, a regression, an import, or a visual change.
4. **Action Synthesizer** is used only when two independent reviews disagree or a decision has competing evidence.

At most two working specialists are active for normal implementation. Parallel work is allowed only when neither task changes the same files or relies on the other’s result.

## Roles and triggers

| Role | Invoke only when | Do not invoke for |
|---|---|---|
| Orchestrator | Every new nontrivial request | Writing or reviewing code itself |
| Source Extractor | Figma/source evidence is incomplete or ambiguous | An established local class-system issue |
| UI Kit Architect | A naming, reuse, component, or foundation decision changes the project system | One-off CSS debugging |
| Product Designer | An AI-generated site needs a visual direction before UI is made | Exact Figma transfer |
| Taptop Import Engineer | Taptop runtime/upload/insertion/receipt behaviour is involved | Generic extension layout work |
| Extension UX Designer | Popup flow, feedback, interaction, or accessibility is involved | Editor runtime compatibility |
| QA Reviewer | A measurable acceptance check is needed | Early ideation without a prototype |
| Action Synthesizer | Independent outputs conflict | Ordinary sequential handoff |

## Shared handoff envelope

Every specialist returns no more than 250 words plus artifact links:

```yaml
status: ready | blocked | needs-decision
artifact_path: absolute path or none
decisions:
  - one concrete decision
evidence:
  - test name, screenshot path, or live receipt
risks_or_missing:
  - MISSING / UNSUPPORTED / NEEDS HUMAN REVIEW, if any
next_owner: role name
```

The next agent reads the linked artifact, not a copy of the previous agent’s reasoning. Evidence takes priority over opinions.

## Quality gates

- **Source transfer:** source evidence, responsive availability, missing data, and project-system manifest exist before implementation.
- **Class reuse:** second use points to the original class/component stable key; no equivalent duplicate class is created.
- **Taptop import:** live receipt records imported root and target-local media IDs; unit tests alone are insufficient.
- **Visual extension work:** screenshot before/after plus keyboard, focus, progress, error, and reduced-motion review.
- **Release:** three pilots, one per source mode, and `npm test` all pass.

## Local design skills

`frontend-design`, `apple-design`, `emil-design-eng`, and `improve-animations` live in the local Codex environment. Use them only when creating or reviewing visual extension UI or an AI-generated site’s visual direction. They are not source material for a customer project and are never bundled in Toolkit.

## Stop rules

Stop with `MISSING`, `UNSUPPORTED`, or `NEEDS HUMAN REVIEW` rather than inventing a Taptop runtime API, Figma value, responsive behaviour, class, or public-license conclusion. The Orchestrator escalates only the concrete missing decision.
