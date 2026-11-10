---
"@typeonce/ritmo-math": patch
---

`Collide2.moveCircle` no longer passes through walls where they close in on a circle. Pushing off one wall by the skin could leave the circle a hair inside another, and a wall the circle started in was ignored for the rest of the move, so the slide went through it: a circle sliding between a crate and a wall left the room on the next move, and one pushed into an acute corner of segments came out the other side. Now a circle that starts outside every wall ends outside every wall, also in acute corners and gaps narrower than it, and stops there (`blocked`) when nothing is left to slide along. A wall it touches or is inside, while moving into it, is a contact at once; where the skin would push it into another wall, it stays touching instead.

`Collide2.pushOut` leaves the deepest wall first, leaves both walls of an acute corner at once (pushing out of one alone pushed into the other), and takes a center inside a box out through the nearest side with room, so a circle spawned in a corner or in a crate against a wall comes out clear of every wall. Only walls with no room between them (a gap narrower than the circle) can leave it overlapping.

`FlowField` finds the way to a goal backed into a corner. When the goal's cell and every cell it could step to are blocked (a player pushed into a room corner, or standing against a wall more than one blocked cell deep), the search starts from the nearest open cells the goal can see in a straight line, where every chaser used to get `undefined`. A body in such a blocked cell gets `way` out to the nearest open cell it can see. Every way the field gave before is unchanged.

`moveCircle` is also faster: it skips walls outside the bounds of the swept circle before testing them.
