---
"@typeonce/ritmo": patch
---

The `Checkpoint` module doc names the one case where a reader outside the rewound schedule sees a component as `added` again (it saw the component, did not run while a later tick removed it, and a rewind brought it back), and what a host does about it: key what it creates per entity by entity id.
