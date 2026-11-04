import { onBeforeUnmount, ref, watch, type Ref } from "vue"

/**
 * Microphone level 0..1 for the preview meter. Cheap on purpose (weak laptops):
 * a small analyser sampled 10×/s, and only while the caller keeps it mounted.
 */
export function useAudioLevel(stream: Ref<MediaStream | null>, enabled: Ref<boolean>) {
  const level = ref(0)
  let ctx: AudioContext | null = null
  let timer: ReturnType<typeof setInterval> | undefined

  // Browsers start an AudioContext "suspended" until a user gesture.
  const resume = () => void ctx?.resume()

  function stop() {
    clearInterval(timer)
    void ctx?.close()
    ctx = null
    level.value = 0
    window.removeEventListener("pointerdown", resume)
  }

  watch(
    [stream, enabled],
    ([s, on]) => {
      stop()
      const track = s?.getAudioTracks()[0]
      if (!s || !track || !on) return
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      window.addEventListener("pointerdown", resume)
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (const v of data) sum += ((v - 128) / 128) ** 2
        level.value = Math.min(1, Math.sqrt(sum / data.length) * 4)
      }, 100)
    },
    { immediate: true },
  )

  onBeforeUnmount(stop)
  return { level }
}
