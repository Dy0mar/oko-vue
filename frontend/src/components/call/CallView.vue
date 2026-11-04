<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import Button from "primevue/button"
import SelectButton from "primevue/selectbutton"

import QualityBadge from "src/components/call/QualityBadge.vue"
import VideoTile from "src/components/call/VideoTile.vue"
import { roomLink } from "src/api/rooms"
import { useAuth } from "src/composables/useAuth"
import { useCall, type RemoteView } from "src/composables/call/useCall"
import type { ConnStats } from "src/composables/call/stats"

const props = defineProps<{ code: string; iceServers: RTCIceServer[] }>()
const emit = defineEmits<{ left: [reason: "left" | "full" | "error", message?: string] }>()

const { isAdmin, user } = useAuth()
const call = useCall(props.code, props.iceServers)
const { media, remotes, status, policy } = call

const showStats = ref(false)
const showSettings = ref(false)

const policyOptions = [
  { label: "Авто", value: "all" },
  { label: "Тільки через TURN", value: "relay" },
]

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

const copied = ref(false)
async function copyLink() {
  await navigator.clipboard.writeText(roomLink(props.code))
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
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
          <Button
            v-if="isAdmin"
            :label="copied ? 'Скопійовано' : 'Скопіювати посилання'"
            icon="pi pi-link"
            severity="secondary"
            size="small"
            @click="copyLink"
          />
        </div>
      </div>

      <div v-for="r in remotes" :key="r.peerId" class="relative min-h-0">
        <VideoTile
          class="h-full"
          :stream="r.stream"
          :label="name(r)"
          :cam-on="r.camOn"
          :mic-on="r.micOn"
        >
          <template #badge>
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
    <div class="absolute right-6 bottom-24 z-[1] aspect-video w-40 shadow-2xl sm:w-60">
      <VideoTile
        class="h-full"
        :stream="media.stream.value"
        :label="user?.email?.split('@')[0] ?? 'Ви'"
        muted
        mirrored
        :cam-on="media.camOn.value"
        :mic-on="media.micOn.value"
      />
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
      class="glass-solid absolute right-6 bottom-24 z-10 flex flex-col gap-3 p-4 text-sm"
    >
      <p class="font-semibold">Маршрут медіа (для всіх у дзвінку)</p>
      <SelectButton
        :model-value="policy"
        :options="policyOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        @update:model-value="(v: RTCIceTransportPolicy) => call.setPolicy(v)"
      />
      <p class="max-w-64 text-white/60">
        «Тільки через TURN» — якщо пряме з'єднання ріжуть. Якщо робочого TURN немає, дзвінок
        лишиться на поточному маршруті. Перевірте результат у статистиці (📊 → Маршрут).
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
        :icon="media.micOn.value ? 'pi pi-microphone' : 'pi pi-microphone-slash'"
        :severity="media.micOn.value ? 'secondary' : 'danger'"
        rounded
        :aria-label="media.micOn.value ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'"
        :title="media.micOn.value ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'"
        :disabled="!media.stream.value?.getAudioTracks().length"
        @click="media.toggleMic()"
      />
      <Button
        :icon="media.camOn.value ? 'pi pi-video' : 'pi pi-eye-slash'"
        :severity="media.camOn.value ? 'secondary' : 'danger'"
        rounded
        :aria-label="media.camOn.value ? 'Вимкнути камеру' : 'Увімкнути камеру'"
        :title="media.camOn.value ? 'Вимкнути камеру' : 'Увімкнути камеру'"
        :disabled="!media.stream.value?.getVideoTracks().length"
        @click="media.toggleCam()"
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
