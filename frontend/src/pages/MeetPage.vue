<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import { useRoute } from "vue-router"
import Button from "primevue/button"

import ProgressRing from "src/components/ProgressRing.vue"
import CallView from "src/components/call/CallView.vue"
import VideoTile from "src/components/call/VideoTile.vue"
import { getRoom, ROOM_CODE_RE, type Room } from "src/api/rooms"
import { fetchIceServers, toRtcIceServers, type IceServerEntry } from "src/api/iceServers"
import { useAuth } from "src/composables/useAuth"
import { useNetworkCheck, type CheckVerdict } from "src/composables/useNetworkCheck"
import { useLocalMedia } from "src/composables/call/useLocalMedia"
import { useAudioLevel } from "src/composables/call/useAudioLevel"
import { MAX_PARTICIPANTS } from "src/composables/call/useCall"
import { createSignaling, type PeerInfo } from "src/composables/call/signaling"
import { loadDeviceCheck, saveDeviceCheck, serversFingerprint } from "src/diagnostics/deviceCheck"

type Phase = "loading" | "not-found" | "check" | "ready" | "call" | "left" | "error"

const route = useRoute()
const { isAdmin, user } = useAuth()
const check = useNetworkCheck()
/** Owned here: the preview camera continues into the call without a second prompt. */
const media = useLocalMedia()

const code = String(route.params.code ?? "").toLowerCase()
const phase = ref<Phase>("loading")
const room = shallowRef<Room | null>(null)
const entries = shallowRef<IceServerEntry[]>([])
/** null for the admin: no check, no conditions. */
const verdict = ref<CheckVerdict | null>(null)
const message = ref<string | null>(null)

const iceServers = computed(() => toRtcIceServers(entries.value))
const title = computed(() => room.value?.title || "Зустріч")
const canJoin = computed(() => verdict.value !== "fail")

// --- preview: camera, mic level, who is already in the room ---------------------
const inPreview = computed(
  () => (phase.value === "ready" || phase.value === "left") && canJoin.value,
)
const { level } = useAudioLevel(
  media.stream,
  computed(() => inPreview.value && media.micOn.value),
)

const lobbyPeers = ref<PeerInfo[]>([])
let lobby: ReturnType<typeof createSignaling> | null = null
const roomFull = computed(() => lobbyPeers.value.length >= MAX_PARTICIPANTS)

function openLobby() {
  if (lobby) return
  lobby = createSignaling(
    code,
    // Watch-only: we are not announced in the room until "Join".
    { peerId: crypto.randomUUID(), userId: "", email: null, isAdmin: false, joinedAt: Date.now() },
    { onSignal: () => {}, onPeers: (peers) => (lobbyPeers.value = peers), onStatus: () => {} },
    { watchOnly: true },
  )
  void lobby.join()
}

async function closeLobby() {
  const l = lobby
  lobby = null
  lobbyPeers.value = []
  await l?.leave()
}

/** Keeps the user's on/off choice when the camera is re-acquired (e.g. after leaving). */
const prefer = { mic: true, cam: true }

watch(inPreview, async (on) => {
  if (on) {
    openLobby()
    if (!media.stream.value) await media.start(prefer)
  } else if (phase.value !== "call") {
    await closeLobby()
  }
})

function toggleMic() {
  media.toggleMic()
  prefer.mic = media.micOn.value
}
function toggleCam() {
  media.toggleCam()
  prefer.cam = media.camOn.value
}

async function join() {
  // One Realtime subscription per topic: the lobby watcher must leave before the call joins.
  await closeLobby()
  phase.value = "call"
}

const peerName = (p: PeerInfo) => p.email?.split("@")[0] ?? "учасник"

// --- check ------------------------------------------------------------------------
async function runCheck(): Promise<void> {
  phase.value = "check"
  const v = await check.run()
  entries.value = check.entries.value
  saveDeviceCheck(serversFingerprint(entries.value), v)
  void check.saveReport({ source: "meet", room: code })
  verdict.value = v
  phase.value = "ready"
}

onMounted(async () => {
  try {
    if (!ROOM_CODE_RE.test(code) || !(room.value = await getRoom(code))) {
      phase.value = "not-found"
      return
    }
    entries.value = await fetchIceServers()
    if (isAdmin.value) {
      phase.value = "ready"
      return
    }
    // The user: skip the check if this device passed it for the current server list.
    const cached = loadDeviceCheck(serversFingerprint(entries.value))
    if (cached) {
      verdict.value = cached
      phase.value = "ready"
    } else {
      await runCheck()
    }
  } catch (e) {
    // Could not even load the room/servers: same as "no connection".
    message.value = e instanceof Error ? e.message : String(e)
    phase.value = "error"
  }
})

onBeforeUnmount(() => {
  void closeLobby()
  media.stop()
})

function onLeft(reason: "left" | "full" | "error", text?: string) {
  // Keep what the user chose during the call for the preview (and the next join).
  prefer.mic = media.micOn.value
  prefer.cam = media.camOn.value
  message.value =
    reason === "full"
      ? "Кімната заповнена"
      : reason === "error"
        ? (text ?? "Не вдалося підключитися до кімнати")
        : "Ви вийшли з дзвінка"
  phase.value = "left"
}
</script>

<template>
  <CallView
    v-if="phase === 'call'"
    :code="code"
    :ice-servers="iceServers"
    :media="media"
    @left="onLeft"
  />

  <main v-else class="grid min-h-dvh place-items-center p-4">
    <!-- Preview (Google Meet style): camera on the left, status and Join on the right -->
    <section
      v-if="inPreview"
      class="glass grid w-full max-w-4xl gap-6 p-4 sm:p-6 md:grid-cols-[1.5fr_1fr] md:items-center"
    >
      <div class="flex flex-col gap-3">
        <VideoTile
          class="aspect-video w-full"
          :stream="media.stream.value"
          :label="user?.email?.split('@')[0] ?? 'Ви'"
          muted
          mirrored
          :cam-on="media.camOn.value"
          :mic-on="media.micOn.value"
        />
        <div class="flex items-center justify-center gap-3">
          <Button
            :icon="media.micOn.value ? 'pi pi-microphone' : 'pi pi-microphone-slash'"
            :severity="media.micOn.value ? 'secondary' : 'danger'"
            rounded
            :aria-label="media.micOn.value ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'"
            :title="media.micOn.value ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'"
            :disabled="!media.stream.value?.getAudioTracks().length"
            @click="toggleMic"
          />
          <Button
            :icon="media.camOn.value ? 'pi pi-video' : 'pi pi-eye-slash'"
            :severity="media.camOn.value ? 'secondary' : 'danger'"
            rounded
            :aria-label="media.camOn.value ? 'Вимкнути камеру' : 'Увімкнути камеру'"
            :title="media.camOn.value ? 'Вимкнути камеру' : 'Увімкнути камеру'"
            :disabled="!media.stream.value?.getVideoTracks().length"
            @click="toggleCam"
          />
          <!-- Mic level -->
          <div
            class="h-1.5 w-24 overflow-hidden rounded-full bg-white/10"
            title="Рівень мікрофона"
            aria-hidden="true"
          >
            <div
              class="h-full rounded-full bg-emerald-400 transition-[width] duration-100"
              :style="{ width: `${Math.round(level * 100)}%` }"
            />
          </div>
        </div>
        <p v-if="media.warning.value" class="text-center text-sm text-amber-300">
          {{ media.warning.value }}
        </p>
      </div>

      <div class="flex flex-col items-center gap-5 text-center">
        <header class="flex flex-col gap-1">
          <h1 class="text-2xl font-semibold">{{ title }}</h1>
          <p class="font-mono text-sm text-white/50">{{ code }}</p>
        </header>

        <p v-if="phase === 'left' && message" class="text-white/80">{{ message }}</p>

        <p class="text-sm text-white/70">
          <template v-if="lobbyPeers.length === 0">У кімнаті поки нікого немає</template>
          <template v-else>
            У кімнаті:
            <span class="text-white">{{ lobbyPeers.map(peerName).join(", ") }}</span>
          </template>
        </p>

        <p
          v-if="verdict === 'warn'"
          class="flex items-start gap-2 text-left text-sm text-amber-300"
        >
          <i class="pi pi-exclamation-triangle mt-0.5" />
          З'єднання може не вдатися. Можна спробувати — якщо не вийде, повідомте адміністратора.
        </p>

        <Button
          :label="
            roomFull ? 'Кімната заповнена' : phase === 'left' ? 'Приєднатися знову' : 'Приєднатися'
          "
          icon="pi pi-video"
          size="large"
          class="w-full"
          :disabled="roomFull"
          @click="join"
        />
        <Button
          v-if="!isAdmin"
          label="Повторити перевірку"
          icon="pi pi-refresh"
          severity="secondary"
          text
          size="small"
          @click="runCheck"
        />
      </div>
    </section>

    <!-- Everything else: loading / not found / check / cannot connect -->
    <section
      v-else
      class="glass flex w-full max-w-md flex-col items-center gap-6 px-6 py-10 text-center"
    >
      <header class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">{{ phase === "not-found" ? "OKO" : title }}</h1>
        <p class="font-mono text-sm text-white/50">{{ code }}</p>
      </header>

      <i v-if="phase === 'loading'" class="pi pi-spin pi-spinner text-3xl text-white/60" />

      <p v-else-if="phase === 'not-found'" class="text-white/80">
        Зустріч не знайдено. Перевірте посилання або попросіть нове в адміністратора.
      </p>

      <template v-else-if="phase === 'check'">
        <ProgressRing :value="check.progress.value" />
        <p class="text-white/70">Перевіряємо з'єднання…</p>
      </template>

      <!-- verdict "fail" (ready/left) or a fatal error -->
      <template v-else>
        <i class="pi pi-times-circle text-5xl text-red-400" />
        <p class="text-lg">Неможливо підключитись</p>
        <p v-if="phase === 'error'" class="text-sm break-all text-white/50">{{ message }}</p>
        <p v-else class="text-sm text-white/60">
          З вашої мережі зараз недоступні потрібні сервери. Спробуйте пізніше або повідомте
          адміністратора.
        </p>
        <Button
          v-if="!isAdmin"
          label="Повторити перевірку"
          icon="pi pi-refresh"
          severity="secondary"
          text
          @click="runCheck"
        />
      </template>
    </section>
  </main>
</template>
