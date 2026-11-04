<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(defineProps<{ value: number; size?: number; stroke?: number }>(), {
  size: 168,
  stroke: 10,
})

const radius = computed(() => (props.size - props.stroke) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const offset = computed(
  () => circumference.value * (1 - Math.min(100, Math.max(0, props.value)) / 100),
)
</script>

<template>
  <div
    class="relative inline-grid place-items-center"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <svg :width="size" :height="size" class="-rotate-90" aria-hidden="true">
      <defs>
        <linearGradient id="oko-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#34d399" />
          <stop offset="100%" stop-color="#818cf8" />
        </linearGradient>
      </defs>
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        stroke="rgb(255 255 255 / 0.08)"
        :stroke-width="stroke"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        stroke="url(#oko-ring)"
        :stroke-width="stroke"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset"
        class="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
      />
    </svg>
    <span
      class="absolute text-3xl font-semibold tabular-nums"
      role="progressbar"
      :aria-valuenow="Math.round(value)"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      {{ Math.round(value) }}%
    </span>
  </div>
</template>
