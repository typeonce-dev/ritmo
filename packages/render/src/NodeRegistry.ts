/**
 * Renderer nodes keyed by ECS entity.
 *
 * Hosts mirror ECS entities into renderer objects (sprites, containers,
 * meshes, DOM elements). The registry owns the bookkeeping every game
 * repeats: one node per entity, attaching new nodes to the scene (or under
 * another entity's node), detaching and destroying them when the entity
 * loses its renderable or is despawned, and teardown. It does not import or
 * assume any renderer: what attaching and detaching mean is passed to `make`.
 *
 * Nodes are keyed by the entity's numeric value, so an `EntityId`, a query
 * match's `entity.id`, or a stored `Handle` all address the same node.
 *
 * @module NodeRegistry
 * @docGroup render
 *
 * @example
 * ```ts
 * // Three.js, reduced to what the registry touches:
 * interface Geometry { dispose(): void }
 * declare class Mesh {
 *   constructor(geometry: Geometry, material: object)
 *   readonly geometry: Geometry
 *   add(child: Mesh): void
 *   removeFromParent(): void
 * }
 * declare const scene: { add(mesh: Mesh): void }
 * declare const geometry: Geometry
 * declare const turretGeometry: Geometry
 * declare const material: object
 * declare const tank: Entity.EntityId<typeof Game.schema>
 * declare const turret: Entity.EntityId<typeof Game.schema>
 * declare const despawned: Entity.EntityId<typeof Game.schema>
 * // ---cut---
 * const meshes = NodeRegistry.make({
 *   attach: (mesh: Mesh, parent) => (parent ?? scene).add(mesh),
 *   detach: (mesh) => {
 *     mesh.removeFromParent()
 *     mesh.geometry.dispose()
 *   }
 * })
 * meshes.ensure(tank, () => new Mesh(geometry, material))
 * meshes.ensure(turret, () => new Mesh(turretGeometry, material), tank) // under the tank's node
 * meshes.remove(despawned)
 * meshes.clear()
 * ```
 */

/**
 * An entity's numeric identity: an `EntityId`, a `Handle`, or the plain number
 * (ids and handles are branded numbers).
 */
export type EntityKey = number

/**
 * One renderer node per entity, made with `make` (or a renderer adapter such
 * as `PixiNodeRegistry.make`). Provide it as a runtime service and hand that
 * service to `RenderSync.system`, which fills and empties it; host code reads
 * it with `get`.
 *
 * A node sits at the root of the scene or under another entity's node (its
 * parent): `RenderSync.system`'s `hierarchy` option keeps that in step with
 * a `Descriptor.Hierarchy`. Removing a parent's node first moves the nodes
 * attached under it back to the root, so an entity's node is only ever
 * destroyed by removing that entity.
 */
export interface NodeRegistry<Node> {
  /** Number of live nodes. */
  readonly size: number
  /** The entity's node, or `undefined` when it has none. Use `ensure` to create one. */
  get(entity: EntityKey): Node | undefined
  /**
   * Returns the entity's node, creating and attaching it first when missing:
   * under `parent`'s node when `parent` is given and has one, else at the
   * root. An existing node is returned where it is; use `reparent` to move it.
   */
  ensure(entity: EntityKey, create: () => Node, parent?: EntityKey): Node
  /**
   * Moves the entity's existing node under `parent`'s node, or to the root
   * when `parent` is `undefined` or has no node. Does nothing when the node
   * is already there. Returns `false`, moving nothing, when the entity has
   * no node or `parent`'s node is the entity's own or attached under it (a
   * loop); `true` otherwise.
   */
  reparent(entity: EntityKey, parent: EntityKey | undefined): boolean
  /**
   * Each node attached under another entity's node: the entity's key to its
   * parent's key. Nodes at the root are absent.
   */
  readonly parents: ReadonlyMap<EntityKey, EntityKey>
  /**
   * Detaches and destroys the entity's node, after moving the nodes attached
   * under it to the root. Returns whether one existed.
   */
  remove(entity: EntityKey): boolean
  /**
   * Detaches and destroys every node, children before their parents.
   */
  clear(): void
  /** The live nodes with their entity keys. */
  entries(): IterableIterator<readonly [number, Node]>
}

/** What attaching and detaching a node mean for one renderer; see `make`. */
export interface RegistryOptions<Node> {
  /**
   * Adds a node to the scene: under `parent` (another entity's node), or at
   * the root when `parent` is `undefined`. Called for new nodes and to move
   * an attached node to a new parent, so it must also take a node out of the
   * parent it is in: Pixi's `addChild` and Three.js's `add` do.
   *
   * Declare both parameters. A one-parameter `attach` still compiles but
   * ignores `parent`, so every node lands on the root.
   */
  readonly attach: (node: Node, parent: Node | undefined) => void
  /**
   * Removes a node from the scene, from the root or the parent node it is
   * attached under, and releases it.
   */
  readonly detach: (node: Node) => void
}

/**
 * Creates a registry with explicit attach/detach behavior: `attach` adds a
 * node under its parent node or at the root, `detach` removes and releases
 * it. Renderer packages build on this (for example `PixiNodeRegistry.make`
 * in `@typeonce/ritmo-pixi`).
 */
export const make = <Node>(options: RegistryOptions<Node>): NodeRegistry<Node> => {
  const nodes = new Map<number, Node>()
  // The tree: each nested node's parent, and each parent's nested children.
  const parents = new Map<number, number>()
  const children = new Map<number, Set<number>>()

  const link = (entity: number, parent: number): void => {
    parents.set(entity, parent)
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, new Set([entity]))
    else siblings.add(entity)
  }
  const unlink = (entity: number): void => {
    const parent = parents.get(entity)
    if (parent === undefined) return
    parents.delete(entity)
    const siblings = children.get(parent)
    siblings?.delete(entity)
    if (siblings?.size === 0) children.delete(parent)
  }
  // Whether `entity`'s node is `ancestor`'s node or attached somewhere under it.
  const nestedUnder = (entity: number, ancestor: number): boolean => {
    for (let current: number | undefined = entity; current !== undefined; current = parents.get(current)) {
      if (current === ancestor) return true
    }
    return false
  }
  // Moves every node nested under `entity`'s node to the root.
  const release = (entity: number): void => {
    const nested = children.get(entity)
    if (nested === undefined) return
    children.delete(entity)
    for (const child of nested) {
      parents.delete(child)
      const node = nodes.get(child)
      if (node !== undefined) options.attach(node, undefined)
    }
  }
  // Detaches a node after the nodes nested under it, depth first.
  const detachTree = (entity: number): void => {
    const nested = children.get(entity)
    if (nested !== undefined) for (const child of nested) detachTree(child)
    const node = nodes.get(entity)
    if (node !== undefined) options.detach(node)
  }

  return {
    get size() {
      return nodes.size
    },
    parents,
    get(entity) {
      return nodes.get(entity)
    },
    ensure(entity, create, parent) {
      const existing = nodes.get(entity)
      if (existing !== undefined) {
        return existing
      }
      const node = create()
      const parentNode = parent === undefined ? undefined : nodes.get(parent)
      nodes.set(entity, node)
      if (parent !== undefined && parentNode !== undefined) link(entity, parent)
      options.attach(node, parentNode)
      return node
    },
    reparent(entity, parent) {
      const node = nodes.get(entity)
      if (node === undefined) {
        return false
      }
      const parentNode = parent === undefined ? undefined : nodes.get(parent)
      const next = parentNode === undefined ? undefined : parent
      if (parents.get(entity) === next) {
        return true
      }
      if (next !== undefined && nestedUnder(next, entity)) {
        return false
      }
      unlink(entity)
      if (next !== undefined) link(entity, next)
      options.attach(node, parentNode)
      return true
    },
    remove(entity) {
      const node = nodes.get(entity)
      if (node === undefined) {
        return false
      }
      release(entity)
      unlink(entity)
      nodes.delete(entity)
      options.detach(node)
      return true
    },
    clear() {
      for (const entity of nodes.keys()) {
        if (!parents.has(entity)) detachTree(entity)
      }
      nodes.clear()
      parents.clear()
      children.clear()
    },
    entries() {
      return nodes.entries()
    }
  }
}
