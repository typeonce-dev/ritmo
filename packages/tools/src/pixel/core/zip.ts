/**
 * ZIP files without compression ("stored"): enough to hand over a folder of
 * frames as one download. PNGs are compressed already.
 */

const table = (() => {
  const values = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    values[n] = c >>> 0
  }
  return values
})()

export const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const byte of bytes) c = table[(c ^ byte) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  readonly name: string
  readonly bytes: Uint8Array
}

/** A ZIP holding the files as they are, dated 1 January 1980 (ZIP's first day), so the same files make the same bytes. */
export const toZip = (entries: ReadonlyArray<ZipEntry>): Uint8Array<ArrayBuffer> => {
  const parts: Array<Uint8Array> = []
  const central: Array<Uint8Array> = []
  let offset = 0
  const encoder = new TextEncoder()
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.bytes)
    const size = entry.bytes.length
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(8, 0, true)
    local.setUint16(12, 0x21, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, size, true)
    local.setUint32(22, size, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, entry.bytes)
    const record = new DataView(new ArrayBuffer(46))
    record.setUint32(0, 0x02014b50, true)
    record.setUint16(4, 20, true)
    record.setUint16(6, 20, true)
    record.setUint16(14, 0x21, true)
    record.setUint32(16, crc, true)
    record.setUint32(20, size, true)
    record.setUint32(24, size, true)
    record.setUint16(28, name.length, true)
    record.setUint32(42, offset, true)
    central.push(new Uint8Array(record.buffer), name)
    offset += 30 + name.length + size
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of all) {
    out.set(part, at)
    at += part.length
  }
  return out
}
