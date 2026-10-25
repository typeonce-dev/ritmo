---
"@typeonce/ritmo": minor
---

**Breaking: runtime-only helpers leave the public surface.** The relation error constructors `Relation.missingEntityError`, `missingRelationError`, `missingTargetEntityError`, `selfRelationNotAllowedError`, `hierarchyCycleError`, `missingChildEntityError`, `duplicateChildError`, `childNotRelatedToParentError`, `childSetMismatchError`, and `mutationFailure` are internal: only the runtime reports relation failures. `Runtime.ValidateSchedules` and `Runtime.AnyRequirements` are removed. A game reads relation failures as values and narrows on `_tag`; the failure types (`Relation.Relation.MissingEntityError`, ...) stay exported:

```diff
- const failure = Relation.missingEntityError(id)
+ if (result.error._tag === "MissingEntity") { /* result.error.entityId */ }
```

Every exported type helper of `@typeonce/ritmo` now has JSDoc.
