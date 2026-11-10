---
"@typeonce/ritmo": patch
---

`lookup.descendants(target, relation, { order: "breadth" })` (and a query's `descendants`) overflowed the stack below a parent with more than about 125,000 children; it now lists them.
