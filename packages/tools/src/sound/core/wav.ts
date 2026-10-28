/** WAV files: 16-bit PCM, mono, what every game engine and audio editor reads. */
import type { Rendered } from "./render.ts"

export const toWav = ({ samples, sampleRate }: Rendered): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i)
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    // Past full scale is clipped here, as any playback would.
    const x = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, Math.round(x * 32767), true)
  }
  return bytes
}
