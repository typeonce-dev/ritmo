/**
 * Colors the palette lost: cells whose own color is far from the palette
 * color they snapped to, grouped by that own color.
 *
 * Snapping always picks the nearest palette color, even when none is close:
 * a small saturated accent becomes a duller neighbour, a dark grey becomes
 * black, a grey with no match becomes whatever is nearest (a skin tone). A
 * lost color added to the palette is matched again wherever it is the
 * nearest, so its details come back across the whole picture.
 */
import { fromOklab, toOklab, type Lab, type Rgb } from "./color.ts"
import { medianColor, TRANSPARENT, type CellSamples, type PixelArt } from "./fix.ts"

/** A color the palette lost: its cells (indices into the grid, row by row) and the palette color most of them became. */
export interface LostColor {
  readonly color: Rgb
  readonly became: Rgb
  readonly cells: ReadonlyArray<number>
}

/** The default distance (OKLab) past which a cell's color counts as lost. */
export const defaultLostThreshold = 0.06

/** Lost cells whose own colors are closer than this (OKLab) are one lost color. */
const GROUP_RADIUS = 0.06

const distance = (x: Lab, y: Lab): number => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b)

/**
 * The lost colors of `art`, snapped from `samples` (one pixel per cell),
 * most cells first. Cells marked in `skip` (the background) are left out,
 * and so are colors lost in fewer than `minCells` cells (noise).
 */
export const lostColors = (
  samples: CellSamples,
  art: PixelArt,
  threshold: number,
  skip?: Uint8Array,
  minCells = 2
): Array<LostColor> => {
  const palette = art.palette.map(toOklab)
  const groups: Array<{ sum: Lab; center: Lab; cells: Array<number>; became: Map<number, number> }> = []
  art.indices.forEach((index, i) => {
    const cell = samples.cells[i]
    if (index === TRANSPARENT || skip?.[i] === 1 || cell === undefined || cell.colors.length === 0) return
    const own = toOklab(medianColor(cell.colors))
    if (distance(own, palette[index]!) <= threshold) return
    let group = groups.find((other) => distance(other.center, own) <= GROUP_RADIUS)
    if (group === undefined) {
      group = { sum: { l: 0, a: 0, b: 0 }, center: own, cells: [], became: new Map() }
      groups.push(group)
    }
    group.sum = { l: group.sum.l + own.l, a: group.sum.a + own.a, b: group.sum.b + own.b }
    group.cells.push(i)
    const n = group.cells.length
    group.center = { l: group.sum.l / n, a: group.sum.a / n, b: group.sum.b / n }
    group.became.set(index, (group.became.get(index) ?? 0) + 1)
  })
  return groups
    .filter((group) => group.cells.length >= minCells)
    .sort((x, y) => y.cells.length - x.cells.length)
    .map((group) => {
      const became = [...group.became].sort((x, y) => y[1] - x[1])[0]![0]
      return { color: fromOklab(group.center), became: art.palette[became]!, cells: group.cells }
    })
}
