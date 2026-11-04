<script setup lang="ts">
import { computed, ref, watchEffect } from "vue"

const props = defineProps<{
  stream: MediaStream | null
  label: string
  /** Local preview: never play our own audio back. */
  muted?: boolean
  mirrored?: boolean
  camOn?: boolean
  micOn?: boolean
}>()

const video = ref<HTMLVideoElement | null>(null)

watchEffect(() => {
  if (video.value && video.value.srcObject !== props.stream) video.value.srcObject = props.stream
})

const showVideo = computed(() => !!props.stream?.getVideoTracks().length && props.camOn !== false)
const initial = computed(() => props.label.trim().charAt(0).toUpperCase() || "?")
</script>

<template>
  <div class="relative overflow-hidden rounded-3xl border border-white/10 bg-black/60">
    <!-- The element stays mounted (it also plays the remote AUDIO) — only hidden when cam is off. -->
    <video
      ref="video"
      autoplay
      playsinline
      :muted="muted"
      class="h-full w-full object-cover"
      :class="{ '-scale-x-100': mirrored, invisible: !showVideo }"
    />
    <div v-if="!showVideo" class="absolute inset-0 grid place-items-center">
      <div
        class="grid size-20 place-items-center rounded-full bg-gradient-to-br from-emerald-400/70 to-indigo-500/70 text-3xl font-semibold"
      >
        {{ initial }}
      </div>
    </div>
    <div class="glass-solid absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1 text-sm">
      <i
        v-if="micOn === false"
        class="pi pi-microphone icon-off text-red-400"
        title="мікрофон вимкнено"
      />
      <span class="max-w-48 truncate">{{ label }}</span>
      <slot name="badge" />
    </div>
  </div>
</template>
