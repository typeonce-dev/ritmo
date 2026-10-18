/** Records/compares a native software-rendered frame without an image-library dependency. */
import { readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { deflateSync, inflateSync } from "node:zlib"
const args = process.argv.slice(2), binary = resolve(args[0]!), record = args.includes("--record")
const golden = resolve("packages/native/test/fixtures/top-down.png"), bitmap = join(dirname(binary), "frame300.bmp"), png = join(dirname(binary), "frame300.png")
const result = spawnSync(binary, ["--headless", "--frames", "300", "--input", resolve("examples/top-down/test/native/right.json"), "--screenshot", bitmap], { encoding: "utf8" })
if (result.status !== 0) throw new Error(`Render native screenshot: ${result.stderr}`)
const bmp = await readFile(bitmap), width = bmp.readInt32LE(18), signedHeight = bmp.readInt32LE(22), height = Math.abs(signedHeight), channels = bmp.readUInt16LE(28) / 8, offset = bmp.readUInt32LE(10)
if (![3, 4].includes(channels) || width < 1 || height < 1 || width > 16384 || height > 16384) throw new Error("Expected the SDL 24/32-bit screenshot format")
const stride = Math.ceil(width * channels / 4) * 4, pixels = Buffer.alloc(width * height * 4)
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const source = offset + (signedHeight > 0 ? height - y - 1 : y) * stride + x * channels, target = (y * width + x) * 4
  pixels[target] = bmp[source + 2]!; pixels[target + 1] = bmp[source + 1]!; pixels[target + 2] = bmp[source]!; pixels[target + 3] = channels === 4 ? bmp[source + 3]! : 255
}
const crc = (data: Buffer): number => { let value = 0xffffffff; for (const byte of data) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1 }; return (value ^ 0xffffffff) >>> 0 }
const chunk = (type: string, data: Buffer) => { const header = Buffer.alloc(8), checksum = Buffer.alloc(4); header.writeUInt32BE(data.length); header.write(type, 4); checksum.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), data]))); return Buffer.concat([header, data, checksum]) }
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
const rows = Buffer.alloc((width * 4 + 1) * height)
for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
const image = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))])
await writeFile(png, image)
if (record) await writeFile(golden, image)
else {
  const expected = await readFile(golden), chunks: Buffer[] = []
  if (expected.readUInt32BE(16) !== width || expected.readUInt32BE(20) !== height) throw new Error("Native screenshot dimensions changed")
  for (let cursor = 8; cursor < expected.length;) { const length = expected.readUInt32BE(cursor); if (expected.toString("ascii", cursor + 4, cursor + 8) === "IDAT") chunks.push(expected.subarray(cursor + 8, cursor + 8 + length)); cursor += length + 12 }
  const reference = inflateSync(Buffer.concat(chunks))
  for (let i = 0; i < rows.length; i++) if (Math.abs(rows[i]! - reference[i]!) > 2) throw new Error(`Native screenshot differs at byte ${i}; inspect ${png}`)
}
console.log(`${record ? "Recorded" : "Matched"} native frame 300: ${png}`)
