/**
 * A project PNG: the source picture with its recipe stored inside, so one
 * file reopens a whole session (the page's **Project PNG**, `pixel fix
 * --project`). The pixels are the picture's own, untouched; the recipe is one
 * uncompressed `iTXt` text chunk with the keyword `ritmo-pixel-recipe`, placed
 * right after the header. Viewers skip it, `exiftool` and `pngcheck -t` list
 * it, and removing it (`exiftool -all=`, `oxipng --strip safe`, or
 * `withoutProjectRecipe`) gives back the plain picture.
 */

/** The keyword of the text chunk that holds the recipe. */
export const PROJECT_KEYWORD = "ritmo-pixel-recipe"

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface Chunk {
  readonly type: string
  readonly data: Uint8Array
  /** The whole chunk as it is in the file: length, type, data, and checksum. */
  readonly raw: Uint8Array
}

/** Whether these bytes start like a PNG. */
export const isPng = (bytes: Uint8Array): boolean => bytes.length >= 8 && SIGNATURE.every((byte, i) => bytes[i] === byte)

/** The file's chunks in order; undefined when it is not a PNG or a chunk runs past the end. */
const chunksOf = (bytes: Uint8Array): ReadonlyArray<Chunk> | undefined => {
  if (!isPng(bytes)) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks: Array<Chunk> = []
  let at = 8
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at)
    const end = at + 12 + length
    if (end > bytes.length) return undefined
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length), raw: bytes.subarray(at, end) })
    at = end
    if (type === "IEND") break
  }
  return chunks
}

const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0))

/** The keyword a text chunk's data starts with. */
const keywordOf = (data: Uint8Array): string => {
  const end = data.indexOf(0)
  return end < 0 ? "" : String.fromCharCode(...data.subarray(0, end))
}

const isRecipeChunk = (chunk: Chunk): boolean => chunk.type === "iTXt" && keywordOf(chunk.data) === PROJECT_KEYWORD

/**
 * The recipe stored in a project PNG, as the JSON text `decodeRecipe` reads;
 * undefined for a plain picture (or anything that is not a PNG).
 */
export const readProjectRecipe = (bytes: Uint8Array): string | undefined => {
  const chunk = chunksOf(bytes)?.find(isRecipeChunk)
  if (chunk === undefined) return undefined
  const data = chunk.data
  // keyword \0, compression flag, compression method, language \0, translated keyword \0, text
  let at = PROJECT_KEYWORD.length + 1
  if (data[at] !== 0) return undefined
  at += 2
  for (let skip = 0; skip < 2; skip++) {
    const end = data.indexOf(0, at)
    if (end < 0) return undefined
    at = end + 1
  }
  return new TextDecoder().decode(data.subarray(at))
}

const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const chunkBytes = (type: string, data: Uint8Array): Uint8Array => {
  const body = concat([latin1(type), data])
  const out = new Uint8Array(body.length + 8)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(body, 4)
  view.setUint32(out.length - 4, crc32(body))
  return out
}

/** The PNG's chunks with every recipe chunk left out; throws when it is not a readable PNG. */
const plainChunks = (png: Uint8Array): ReadonlyArray<Chunk> => {
  const chunks = chunksOf(png)
  if (chunks === undefined || chunks[0]?.type !== "IHDR") throw new Error("not a PNG")
  return chunks.filter((chunk) => !isRecipeChunk(chunk))
}

/**
 * The PNG with this recipe (`encodeRecipe`'s text) stored inside, replacing
 * any recipe it held; the pixels and every other chunk stay as they are.
 * Throws when the bytes are not a PNG.
 */
export const withProjectRecipe = (png: Uint8Array, recipe: string): Uint8Array<ArrayBuffer> => {
  const [header, ...rest] = plainChunks(png)
  const data = concat([latin1(PROJECT_KEYWORD), new Uint8Array([0, 0, 0, 0, 0]), new TextEncoder().encode(recipe)])
  return concat([Uint8Array.from(SIGNATURE), header!.raw, chunkBytes("iTXt", data), ...rest.map((chunk) => chunk.raw)])
}

/** The PNG without its recipe: the plain picture. Throws when the bytes are not a PNG. */
export const withoutProjectRecipe = (png: Uint8Array): Uint8Array<ArrayBuffer> =>
  concat([Uint8Array.from(SIGNATURE), ...plainChunks(png).map((chunk) => chunk.raw)])
