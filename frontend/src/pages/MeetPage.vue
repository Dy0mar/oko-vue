<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue"
import { useRoute } from "vue-router"
import Button from "primevue/button"

import ProgressRing from "src/components/ProgressRing.vue"
import CallView from "src/components/call/CallView.vue"
import { getRoom, ROOM_CODE_RE, type Room } from "src/api/rooms"
import { fetchIceServers, toRtcIceServers, type IceServerEntry } from "src/api/iceServers"
import { useAuth } from "src/composables/useAuth"
import { useNetworkCheck, type CheckVerdict } from "src/composables/useNetworkCheck"
import { loadDeviceCheck, saveDeviceCheck, serversFingerprint } from "src/diagnostics/deviceCheck"

type Phase = "loading" | "not-found" | "check" | "ready" | "call" | "left" | "error"

const route = useRoute()
const { isAdmin } = useAuth()
const check = useNetworkCheck()

const code = String(route.params.code ?? "").toLowerCase()
const phase = ref<Phase>("loading")
const room = shallowRef<Room | null>(null)
const entries = shallowRef<IceServerEntry[]>([])
/** null for the admin: no check, no conditions. */
const verdict = ref<CheckVerdict | null>(null)
const message = ref<string | null>(null)

const iceServers = computed(() => toRtcIceServers(entries.value))
const title = computed(() => room.value?.title || "Зустріч")

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
    if (isAdmin.value) {
      entries.value = await fetchIceServers()
      phase.value = "ready"
      return
    }
    // The user: skip the check if this device passed it for the current server list.
    entries.value = await fetchIceServers()
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

function onLeft(reason: "left" | "full" | "error", text?: string) {
  message.value =
    reason === "full"
      ? "Кімната заповнена"
      : reason === "error"
        ? (text ?? "Не вдалося підключитися до кімнати")
        : null
  phase.value = "left"
}
</script>

<template>
  <CallView v-if="phase === 'call'" :code="code" :ice-servers="iceServers" @left="onLeft" />

  <main v-else class="grid min-h-dvh place-items-center p-4">
    <section class="glass flex w-full max-w-md flex-col items-center gap-6 px-6 py-10 text-center">
      <header class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">{{ phase === "not-found" ? "OKO" : title }}</h1>
        <p class="font-mono text-sm text-white/50">{{ code }}</p>
      </header>

      <!-- loading -->
      <i v-if="phase === 'loading'" class="pi pi-spin pi-spinner text-3xl text-white/60" />

      <!-- not found -->
      <p v-else-if="phase === 'not-found'" class="text-white/80">
        Зустріч не знайдено. Перевірте посилання або попросіть нове в адміністратора.
      </p>

      <!-- network check -->
      <template v-else-if="phase === 'check'">
        <ProgressRing :value="check.progress.value" />
        <p class="text-white/70">Перевіряємо з'єднання…</p>
      </template>

      <!-- ready / result -->
      <template v-else-if="phase === 'ready'">
        <div v-if="verdict === 'fail'" class="flex flex-col items-center gap-3">
          <i class="pi pi-times-circle text-5xl text-red-400" />
          <p class="text-lg">Неможливо підключитись</p>
          <p class="text-sm text-white/60">
            З вашої мережі зараз недоступні потрібні сервери. Спробуйте пізніше або повідомте
            адміністратора.
          </p>
        </div>
        <div v-else-if="verdict === 'warn'" class="flex flex-col items-center gap-3">
          <i class="pi pi-exclamation-triangle text-5xl text-amber-400" />
          <p class="text-lg">З'єднання може не вдатися</p>
          <p class="text-sm text-white/60">
            Можна спробувати — якщо не вийде, повідомте адміністратора.
          </p>
        </div>
        <div v-else class="flex flex-col items-center gap-3">
          <i class="pi pi-check-circle text-5xl text-emerald-400" />
          <p class="text-lg">Усе готово</p>
        </div>

        <Button
          v-if="verdict !== 'fail'"
          label="Приєднатися"
          icon="pi pi-video"
          size="large"
          class="w-full"
          @click="phase = 'call'"
        />
      </template>

      <!-- after the call -->
      <template v-else-if="phase === 'left'">
        <p class="text-lg">{{ message ?? "Ви вийшли з дзвінка" }}</p>
        <Button
          label="Приєднатися знову"
          icon="pi pi-video"
          class="w-full"
          @click="phase = 'call'"
        />
      </template>

      <!-- fatal error -->
      <template v-else-if="phase === 'error'">
        <i class="pi pi-times-circle text-5xl text-red-400" />
        <p class="text-lg">Неможливо підключитись</p>
        <p class="text-sm break-all text-white/50">{{ message }}</p>
      </template>

      <Button
        v-if="!isAdmin && (phase === 'ready' || phase === 'error')"
        label="Повторити перевірку"
        icon="pi pi-refresh"
        severity="secondary"
        text
        @click="runCheck"
      />
    </section>
  </main>
</template>
