import { markRaw, ref, shallowRef } from "vue"

// Modest capture: the user's laptop is weak and the network may be throttled.
const VIDEO: MediaTrackConstraints = {
  width: { ideal: 960 },
  height: { ideal: 540 },
  frameRate: { ideal: 24, max: 30 },
}
const AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/** Camera + microphone with default devices (device picker comes later). */
export function useLocalMedia() {
  const stream = shallowRef<MediaStream | null>(null)
  const micOn = ref(false)
  const camOn = ref(false)
  /** Non-fatal: e.g. "no camera" — the call still works with what is available. */
  const warning = ref<string | null>(null)

  async function start(prefer: { mic?: boolean; cam?: boolean } = {}): Promise<void> {
    const attempts: [MediaStreamConstraints, string | null][] = [
      [{ audio: AUDIO, video: VIDEO }, null],
      [{ audio: AUDIO }, "Камера недоступна — дзвінок лише зі звуком"],
      [{ video: VIDEO }, "Мікрофон недоступний — вас не буде чути"],
    ]
    let lastError: unknown = null
    for (const [constraints, note] of attempts) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(constraints)
        stream.value = markRaw(s)
        micOn.value = s.getAudioTracks().length > 0
        camOn.value = s.getVideoTracks().length > 0
        if (prefer.mic === false) setEnabledOn(s, "audio", (micOn.value = false))
        if (prefer.cam === false) setEnabledOn(s, "video", (camOn.value = false))
        warning.value = note
        return
      } catch (e) {
        lastError = e
        // Permission denied applies to everything — no point trying the other combos.
        if (e instanceof DOMException && e.name === "NotAllowedError") break
      }
    }
    stream.value = null
    micOn.value = camOn.value = false
    warning.value =
      lastError instanceof DOMException && lastError.name === "NotAllowedError"
        ? "Немає дозволу на камеру й мікрофон — ви бачите й чуєте співрозмовника, він вас — ні"
        : "Камера й мікрофон недоступні — ви лише бачите й чуєте співрозмовника"
  }

  function setEnabledOn(s: MediaStream, kind: "audio" | "video", enabled: boolean): void {
    ;(kind === "audio" ? s.getAudioTracks() : s.getVideoTracks()).forEach(
      (t) => (t.enabled = enabled),
    )
  }

  function setEnabled(kind: "audio" | "video", enabled: boolean): void {
    const tracks =
      kind === "audio" ? stream.value?.getAudioTracks() : stream.value?.getVideoTracks()
    tracks?.forEach((t) => (t.enabled = enabled))
  }

  function toggleMic(): void {
    if (!stream.value?.getAudioTracks().length) return
    micOn.value = !micOn.value
    setEnabled("audio", micOn.value)
  }

  function toggleCam(): void {
    if (!stream.value?.getVideoTracks().length) return
    camOn.value = !camOn.value
    setEnabled("video", camOn.value)
  }

  function stop(): void {
    stream.value?.getTracks().forEach((t) => t.stop())
    stream.value = null
  }

  return { stream, micOn, camOn, warning, start, toggleMic, toggleCam, stop }
}

export type LocalMedia = ReturnType<typeof useLocalMedia>
