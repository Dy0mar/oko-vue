<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import Button from "primevue/button"

import QualityBadge from "src/components/call/QualityBadge.vue"
import VideoTile from "src/components/call/VideoTile.vue"
import { useAuth } from "src/composables/useAuth"
import { useCall, type MediaRoute, type RemoteView } from "src/composables/call/useCall"
import type { ConnStats } from "src/composables/call/stats"
import type { LocalMedia } from "src/composables/call/useLocalMedia"
import type { IceServerEntry } from "src/api/iceServers"

const props = defineProps<{ code: string; entries: IceServerEntry[]; media: LocalMedia }>()
const emit = defineEmits<{ left: [reason: "left" | "full" | "error", message?: string] }>()

const { isAdmin, user } = useAuth()
const call = useCall(props.code, props.entries, props.media)
const { remotes, status, route, turnServers, screen, sharing } = call
const media = props.media

const showStats = ref(false)
const showSettings = ref(false)

const routeOptions = computed<{ label: string; value: MediaRoute }[]>(() => [
  { label: "Авто: напряму, TURN як запасний", value: { mode: "auto" } },
  ...(turnServers.length
    ? [
        {
          label: "Тільки через TURN (будь-який)",
          value: { mode: "relay", serverId: null } as MediaRoute,
        },
        ...turnServers.map((s) => ({
          label: `Тільки через ${s.label}`,
          value: { mode: "relay", serverId: s.id } as MediaRoute,
        })),
      ]
    : []),
])
const isRoute = (r: MediaRoute) => JSON.stringify(r) === JSON.stringify(route.value)

onMounted(() => void call.join())

// "full" arrives with the presence sync, "error" from the channel — both after join().
watch(status, (s) => {
  if (s === "full") emit("left", "full")
  if (s === "error") emit("left", "error", call.error.value ?? undefined)
})

async function hangUp() {
  await call.leave()
  emit("left", "left")
}

const STATE_TEXT: Partial<Record<RTCPeerConnectionState, string>> = {
  new: "Підключення…",
  connecting: "Підключення…",
  disconnected: "Перепідключення…",
  failed: "З'єднання втрачено, шукаємо інший шлях…",
}

const ROUTE_TEXT: Record<NonNullable<ConnStats["route"]>, string> = {
  direct: "напряму (P2P)",
  local: "локальна мережа",
  relay: "через TURN",
}

const name = (r: RemoteView) => r.email?.split("@")[0] ?? "Співрозмовник"
const gridClass = computed(() => (remotes.value.length > 1 ? "md:grid-cols-2" : "grid-cols-1"))

// --- self view: resizable like in Google Meet (drag the top-left corner) -------------
const SELF_WIDTH_KEY = "oko:self-view-width"
const SELF_MIN = 140
const selfMax = () => Math.max(SELF_MIN, Math.round(window.innerWidth * 0.6))

function initialSelfWidth(): number {
  let saved = NaN
  try {
    saved = Number(localStorage.getItem(SELF_WIDTH_KEY))
  } catch {
    // storage unavailable
  }
  const fallback = window.innerWidth < 640 ? 160 : 240
  return Math.min(selfMax(), Math.max(SELF_MIN, saved || fallback))
}

const selfWidth = ref(initialSelfWidth())
let drag: { x: number; y: number; width: number } | null = null

function startResize(e: PointerEvent) {
  drag = { x: e.clientX, y: e.clientY, width: selfWidth.value }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onResize(e: PointerEvent) {
  if (!drag) return
  // Anchored bottom-right: moving the handle up/left grows the tile.
  const dx = drag.x - e.clientX
  const dy = ((drag.y - e.clientY) * 16) / 9
  // Follow the axis the pointer moved along the most (grow and shrink both work).
  const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy
  selfWidth.value = Math.min(selfMax(), Math.max(SELF_MIN, Math.round(drag.width + delta)))
}

function endResize() {
  if (!drag) return
  drag = null
  try {
    localStorage.setItem(SELF_WIDTH_KEY, String(selfWidth.value))
  } catch {
    // storage unavailable
  }
}
</script>

<template>
  <div class="relative flex h-dvh flex-col gap-3 p-3">
    <!-- Remote participants -->
    <section class="grid min-h-0 flex-1 auto-rows-[minmax(0,1fr)] gap-3" :class="gridClass">
      <div v-if="remotes.length === 0" class="glass grid place-items-center p-6 text-center">
        <div class="flex flex-col items-center gap-3">
          <i class="pi pi-users text-4xl text-white/50" />
          <p class="text-lg">Очікуємо співрозмовника…</p>
        </div>
      </div>

      <div v-for="r in remotes" :key="r.peerId" class="relative min-h-0">
        <VideoTile
          class="h-full"
          :stream="r.stream"
          :label="r.sharing ? `${name(r)} · екран` : name(r)"
          :cam-on="r.camOn || r.sharing"
          :mic-on="r.micOn"
          :contain="r.sharing"
        >
          <template #badge>
            <i v-if="r.sharing" class="pi pi-desktop text-sky-300" title="демонструє екран" />
            <!-- how WE receive them / how THEY receive us -->
            <QualityBadge :quality="r.stats?.quality ?? 'unknown'" label="у вас" />
            <QualityBadge :quality="r.theirQuality" :label="`у ${name(r)}`" />
          </template>
        </VideoTile>
        <div
          v-if="STATE_TEXT[r.state]"
          class="glass-solid absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-sm"
        >
          {{ STATE_TEXT[r.state] }}
        </div>
      </div>
    </section>

    <!-- Self view (picture-in-picture) -->
    <div
      class="absolute right-6 bottom-24 z-[1] aspect-video shadow-2xl"
      :style="{ width: `${selfWidth}px` }"
    >
      <!-- While sharing, show what the others see: the screen, not mirrored. -->
      <VideoTile
        class="h-full"
        :stream="sharing ? screen : media.stream.value"
        :label="(user?.email?.split('@')[0] ?? 'Ви') + (sharing ? ' · ваш екран' : '')"
        muted
        :mirrored="!sharing"
        :contain="sharing"
        :cam-on="sharing || media.camOn.value"
        :mic-on="media.micOn.value"
      />
      <!-- Resize handle -->
      <div
        class="absolute -top-1.5 -left-1.5 z-[2] grid size-6 cursor-nwse-resize touch-none place-items-center rounded-full border border-white/20 bg-black/70 text-white/80 hover:bg-black/90"
        title="Змінити розмір"
        aria-label="Змінити розмір свого відео"
        @pointerdown.prevent="startResize"
        @pointermove="onResize"
        @pointerup="endResize"
        @pointercancel="endResize"
      >
        <i class="pi pi-arrows-alt text-[10px]" />
      </div>
    </div>

    <!-- Stats panel -->
    <aside
      v-if="showStats"
      class="glass-solid absolute top-6 left-6 z-10 flex max-w-sm flex-col gap-3 p-4 text-sm"
    >
      <p v-if="remotes.length === 0" class="text-white/60">Немає з'єднань</p>
      <div v-for="r in remotes" :key="r.peerId" class="flex flex-col gap-1">
        <p class="font-semibold">{{ name(r) }}</p>
        <template v-if="r.stats">
          <p>Маршрут: {{ r.stats.route ? ROUTE_TEXT[r.stats.route] : "—" }}</p>
          <p class="text-white/70">
            Кандидати: {{ r.stats.localCandidate ?? "—" }} ↔ {{ r.stats.remoteCandidate ?? "—" }}
          </p>
          <p v-if="r.stats.server" class="text-white/70 wrap-anywhere">
            Сервер: {{ r.stats.server }}
          </p>
          <p>RTT {{ r.stats.rttMs ?? "—" }} мс · втрати {{ r.stats.lossPct ?? "—" }}%</p>
          <p>↓ {{ r.stats.inKbps ?? "—" }} кбіт/с · ↑ {{ r.stats.outKbps ?? "—" }} кбіт/с</p>
          <p v-if="r.stats.video" class="text-white/70">
            Відео {{ r.stats.video.width }}×{{ r.stats.video.height }}, {{ r.stats.video.fps }} fps
          </p>
        </template>
        <p v-else class="text-white/60">збираємо дані…</p>
      </div>
    </aside>

    <!-- Admin settings -->
    <aside
      v-if="isAdmin && showSettings"
      class="glass-solid absolute bottom-40 left-6 z-10 flex flex-col gap-3 p-4 text-sm"
    >
      <p class="font-semibold">Маршрут медіа (для всіх у дзвінку)</p>
      <div class="flex flex-col gap-1" role="radiogroup" aria-label="Маршрут медіа">
        <Button
          v-for="opt in routeOptions"
          :key="opt.label"
          :label="opt.label"
          :icon="isRoute(opt.value) ? 'pi pi-check-circle' : 'pi pi-circle'"
          :severity="isRoute(opt.value) ? 'info' : 'secondary'"
          text
          size="small"
          class="justify-start"
          role="radio"
          :aria-checked="isRoute(opt.value)"
          @click="call.setRoute(opt.value)"
        />
      </div>
      <p v-if="!turnServers.length" class="max-w-64 text-amber-300">
        Немає жодного ввімкненого TURN-сервера — додайте його в адмінці.
      </p>
      <p class="max-w-64 text-white/60">
        «Тільки через TURN» — якщо пряме з'єднання ріжуть. Якщо вибраний TURN недоступний, дзвінок
        лишиться на поточному маршруті. Результат — у 📊 → Маршрут і Сервер.
      </p>
    </aside>

    <!-- Notices -->
    <p
      v-if="media.warning.value"
      class="glass-solid absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 text-sm text-amber-300"
    >
      {{ media.warning.value }}
    </p>

    <!-- Controls -->
    <nav
      class="glass-solid mx-auto flex items-center gap-2 px-3 py-2"
      aria-label="Керування дзвінком"
    >
      <Button
        :icon="media.micOn.value ? 'pi pi-microphone' : 'pi pi-microphone icon-off'"
        :severity="media.micOn.value ? 'secondary' : 'danger'"
        rounded
        :aria-label="media.micOn.value ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'"
        :title="media.micOn.value ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'"
        :disabled="!media.stream.value?.getAudioTracks().length"
        @click="media.toggleMic()"
      />
      <Button
        :icon="media.camOn.value ? 'pi pi-video' : 'pi pi-video icon-off'"
        :severity="media.camOn.value ? 'secondary' : 'danger'"
        rounded
        :aria-label="media.camOn.value ? 'Вимкнути камеру' : 'Увімкнути камеру'"
        :title="media.camOn.value ? 'Вимкнути камеру' : 'Увімкнути камеру'"
        :disabled="!media.stream.value?.getVideoTracks().length"
        @click="media.toggleCam()"
      />
      <Button
        v-if="call.canShareScreen"
        icon="pi pi-desktop"
        :severity="sharing ? 'info' : 'secondary'"
        rounded
        :aria-label="sharing ? 'Зупинити показ екрана' : 'Показати екран'"
        :title="sharing ? 'Зупинити показ екрана' : 'Показати екран'"
        :aria-pressed="sharing"
        @click="call.toggleScreenShare()"
      />
      <Button
        icon="pi pi-chart-bar"
        :severity="showStats ? 'info' : 'secondary'"
        rounded
        text
        aria-label="Статистика з'єднання"
        title="Статистика з'єднання"
        @click="showStats = !showStats"
      />
      <Button
        v-if="isAdmin"
        icon="pi pi-cog"
        :severity="showSettings ? 'info' : 'secondary'"
        rounded
        text
        aria-label="Налаштування маршруту"
        title="Налаштування маршруту"
        @click="showSettings = !showSettings"
      />
      <Button
        icon="pi pi-phone"
        severity="danger"
        rounded
        class="rotate-[135deg]"
        aria-label="Завершити дзвінок"
        title="Завершити дзвінок"
        @click="hangUp"
      />
    </nav>
  </div>
</template>
