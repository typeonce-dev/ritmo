import type { Vec2 } from "@typeonce/ritmo-math"
import { WORLD_HEIGHT, WORLD_WIDTH } from "./constants.ts"

export const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/** Whether two centered boxes overlap; touching edges do not count. */
export const intersects = (
  firstPosition: Vec2.Vec2,
  firstCollider: { width: number; height: number },
  secondPosition: Vec2.Vec2,
  secondCollider: { width: number; height: number }
): boolean =>
  Math.abs(firstPosition.x - secondPosition.x) * 2 < firstCollider.width + secondCollider.width &&
  Math.abs(firstPosition.y - secondPosition.y) * 2 < firstCollider.height + secondCollider.height

export const resolveHorizontalMovement = (
  position: Vec2.Vec2,
  deltaX: number,
  collider: { width: number; height: number },
  walls: ReadonlyArray<{ position: Vec2.Vec2; collider: { width: number; height: number } }>
): number => {
  if (deltaX === 0) {
    return position.x
  }

  const halfWidth = collider.width * 0.5
  let nextX = clamp(position.x + deltaX, halfWidth, WORLD_WIDTH - halfWidth)

  for (const wall of walls) {
    if (!intersects({ x: nextX, y: position.y }, collider, wall.position, wall.collider)) {
      continue
    }

    const wallHalfWidth = wall.collider.width * 0.5
    nextX =
      deltaX > 0
        ? wall.position.x - wallHalfWidth - halfWidth
        : wall.position.x + wallHalfWidth + halfWidth
  }

  return clamp(nextX, halfWidth, WORLD_WIDTH - halfWidth)
}

export const resolveVerticalMovement = (
  position: Vec2.Vec2,
  deltaY: number,
  collider: { width: number; height: number },
  walls: ReadonlyArray<{ position: Vec2.Vec2; collider: { width: number; height: number } }>
): number => {
  if (deltaY === 0) {
    return position.y
  }

  const halfHeight = collider.height * 0.5
  let nextY = clamp(position.y + deltaY, halfHeight, WORLD_HEIGHT - halfHeight)

  for (const wall of walls) {
    if (!intersects({ x: position.x, y: nextY }, collider, wall.position, wall.collider)) {
      continue
    }

    const wallHalfHeight = wall.collider.height * 0.5
    nextY =
      deltaY > 0
        ? wall.position.y - wallHalfHeight - halfHeight
        : wall.position.y + wallHalfHeight + halfHeight
  }

  return clamp(nextY, halfHeight, WORLD_HEIGHT - halfHeight)
}
