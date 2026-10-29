/**
 * Recording a hum from the microphone. The browser allows it on localhost
 * or over HTTPS only; elsewhere the page says so and offers a file instead.
 */

export interface Recording {
  /** Stops and resolves with what was recorded, as a file's bytes (the browser's own format). */
  readonly stop: () => Promise<ArrayBuffer>
  readonly cancel: () => void
  /** How loud the microphone is now, 0 to 1, for a level meter. */
  readonly level: () => number
}

export const canRecord = (): boolean => window.isSecureContext && navigator.mediaDevices?.getUserMedia !== undefined && typeof MediaRecorder !== "undefined"

export const startRecording = async (context: AudioContext): Promise<Recording> => {
  // The hum as sung: no noise suppression or level riding, which bend its pitch and loudness.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const recorder = new MediaRecorder(stream)
  const chunks: Array<Blob> = []
  recorder.addEventListener("dataavailable", (event) => chunks.push(event.data))
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  const input = context.createMediaStreamSource(stream)
  input.connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const release = (): void => {
    input.disconnect()
    for (const track of stream.getTracks()) track.stop()
  }
  recorder.start()
  return {
    stop: () =>
      new Promise((done, fail) => {
        recorder.addEventListener("stop", () => {
          release()
          new Blob(chunks, { type: recorder.mimeType }).arrayBuffer().then(done, fail)
        })
        recorder.stop()
      }),
    cancel: () => {
      recorder.stop()
      release()
    },
    level: () => {
      analyser.getFloatTimeDomainData(samples)
      let peak = 0
      for (const x of samples) peak = Math.max(peak, Math.abs(x))
      return Math.min(1, peak * 1.6)
    }
  }
}

/** An audio buffer mixed down to mono. */
export const monoOf = (buffer: AudioBuffer): Float32Array<ArrayBuffer> => {
  const out = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i]! += channel[i]! / buffer.numberOfChannels
  }
  return out
}
