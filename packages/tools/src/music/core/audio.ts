/**
 * Audio files: songs written as 16-bit stereo WAV (what every game engine
 * and audio editor reads), and WAV files read back for `music listen`
 * (16-bit, 24-bit, or float PCM, any rate, mixed down to mono).
 */
import type { Stereo } from "./render.ts"

const ascii = (bytes: Uint8Array, at: number, text: string): void => {
  for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i)
}

/** A WAV file of 16-bit PCM, one or two channels. */
const encode = (channels: ReadonlyArray<Float32Array>, sampleRate: number): Uint8Array<ArrayBuffer> => {
  const count = channels.length
  const frames = channels[0]?.length ?? 0
  const bytes = new Uint8Array(44 + frames * count * 2)
  const view = new DataView(bytes.buffer)
  ascii(bytes, 0, "RIFF")
  view.setUint32(4, 36 + frames * count * 2, true)
  ascii(bytes, 8, "WAVE")
  ascii(bytes, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, count, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * count * 2, true)
  view.setUint16(32, count * 2, true)
  view.setUint16(34, 16, true)
  ascii(bytes, 36, "data")
  view.setUint32(40, frames * count * 2, true)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      // Past full scale is clipped here, as any playback would.
      const x = Math.max(-1, Math.min(1, channels[c]![i]!))
      view.setInt16(44 + (i * count + c) * 2, Math.round(x * 32767), true)
    }
  }
  return bytes
}

export const stereoWav = (song: Stereo): Uint8Array<ArrayBuffer> => encode([song.left, song.right], song.sampleRate)
export const monoWav = (samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> => encode([samples], sampleRate)

export interface Mono {
  readonly sampleRate: number
  readonly samples: Float32Array<ArrayBuffer>
}

export type ReadWav = { readonly ok: true; readonly value: Mono } | { readonly ok: false; readonly error: string }

/** Reads a WAV file, mixed down to mono. */
export const readWav = (bytes: Uint8Array): ReadWav => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return { ok: false, error: "not a WAV file (convert it first, e.g. `ffmpeg -i in.mp3 out.wav`)" }
  let format = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let at = 12
  while (at + 8 <= bytes.length) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === "fmt ") {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      // WAVE_FORMAT_EXTENSIBLE names the real format in its sub-format.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true)
    }
    if (id === "data") {
      if (channels === 0) return { ok: false, error: "the WAV file has no format before its data" }
      const width = bits / 8
      const end = Math.min(bytes.length, body + size)
      const frames = Math.floor((end - body) / (width * channels))
      const samples = new Float32Array(frames)
      const read = (offset: number): number => {
        if (format === 3 && bits === 32) return view.getFloat32(offset, true)
        if (format === 3 && bits === 64) return view.getFloat64(offset, true)
        if (bits === 16) return view.getInt16(offset, true) / 32768
        if (bits === 24) return ((view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16)) / 8388608)
        if (bits === 32) return view.getInt32(offset, true) / 2147483648
        if (bits === 8) return (view.getUint8(offset) - 128) / 128
        return 0
      }
      if (!((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && [32, 64].includes(bits)))) return { ok: false, error: `unsupported WAV encoding (format ${format}, ${bits} bits): use 16-bit PCM` }
      for (let i = 0; i < frames; i++) {
        let sum = 0
        for (let c = 0; c < channels; c++) sum += read(body + (i * channels + c) * width)
        samples[i] = sum / channels
      }
      return { ok: true, value: { sampleRate, samples } }
    }
    at = body + size + (size % 2)
  }
  return { ok: false, error: "the WAV file has no audio data" }
}
