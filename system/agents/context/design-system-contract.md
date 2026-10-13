# Design-system contract

Every source creates the same internal system: `foundations`, `classes`, `components`, `pages`, and `evidence`. It is applied to the fixed Toolkit UI-kit scaffold at `system/examples/ui-kit-default/source/`; an input source never replaces that scaffold with a new component catalogue. Classes contain literal values because Taptop does not support CSS variables. A repeated semantic declaration reuses its stable class; a genuine conflict has a deterministic new class name.

Figma with a kit transfers documented foundations/components into the scaffold. Figma without a kit derives only repeated source evidence into the same scaffold. AI-generated work records an approved brief and visual direction before it fills that system. Exact Figma transfer and generative design are separate modes.

The scaffold owns showcase structure and its baseline class vocabulary. A source may populate a known role or add a source-evidenced role to the project registry; it may not rename, fork, or silently replace the scaffold. Unknown values are `MISSING`, never demo defaults. A scaffold change requires an explicit user decision, a UI Kit Architect handoff, and a migration plan.

## Жёсткое правило: страница обязана переиспользовать UI Kit

После импорта UI Kit любая страница **обязана применять его точные классы** для
повторяющихся ролей: типографики, кнопок, ссылок и вариантов компонентов. Нельзя
создавать их аналоги вроде `body`, `display`, `button`, `button--yellow` и затем
надеяться, что импортёр «догадается» о соответствии. Такие имена не являются
ролями каркаса и могут совпасть с системными классами редактора.

Перед выдачей JSON агент обязан проверить, что классы страницы с ролями UI Kit
содержатся в `syncPackage.classes` с теми же именами и теми же правилами, что в
импортированном UI Kit. В предпросмотре импорта они должны числиться «уже есть»
или «без изменений», а не «новые». Если правила различаются, сначала обновляется
сам UI Kit, затем страница; режим «Обновить» для чужого/системного одноимённого
класса использовать запрещено. Необъяснимое совпадение с `body`, `html`, `root`
или похожим общим именем — ошибка сборки, а не переиспользование.

