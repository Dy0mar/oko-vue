<script setup lang="ts">
import { computed } from "vue"

import type { Quality } from "src/composables/call/stats"

const props = defineProps<{ quality: Quality; label?: string }>()

const LEVEL: Record<Quality, number> = { good: 3, fair: 2, poor: 1, unknown: 0 }
const COLOR: Record<Quality, string> = {
  good: "bg-emerald-400",
  fair: "bg-amber-400",
  poor: "bg-red-500",
  unknown: "bg-white/40",
}
const TEXT: Record<Quality, string> = {
  good: "добра",
  fair: "середня",
  poor: "погана",
  unknown: "невідомо",
}

const level = computed(() => LEVEL[props.quality])
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 text-xs"
    :title="`${label ? label + ': ' : ''}якість ${TEXT[quality]}`"
  >
    <span class="flex h-3.5 items-end gap-0.5" aria-hidden="true">
      <span
        v-for="bar in 3"
        :key="bar"
        class="w-1 rounded-sm"
        :class="bar <= level ? COLOR[quality] : 'bg-white/20'"
        :style="{ height: `${bar * 33}%` }"
      />
    </span>
    <span v-if="label" class="text-white/80">{{ label }}</span>
  </span>
</template>
