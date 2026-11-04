<script setup lang="ts">
import { computed, ref, shallowRef } from "vue"
import Button from "primevue/button"
import Card from "primevue/card"
import Message from "primevue/message"
import Tag from "primevue/tag"
import Textarea from "primevue/textarea"

import AppHeader from "src/components/AppHeader.vue"
import { NAT_TEXT, useNetworkCheck, type CheckStatus } from "src/composables/useNetworkCheck"
import { probeMedia, type MediaCheck } from "src/diagnostics/probes"

const check = useNetworkCheck()
const { services, nat, running, env } = check
const natText = NAT_TEXT

const media = shallowRef<MediaCheck | null>(null)
const saved = ref<"idle" | "ok" | "fail">("idle")

async function runAll() {
  saved.value = "idle"
  await check.run()
  saved.value = (await check.saveReport({ source: "diag" })) ? "ok" : "fail"
}

async function runMedia() {
  media.value = await probeMedia()
}

const reportText = computed(() =>
  JSON.stringify(check.buildReport({ media: media.value }), null, 2),
)

const copied = ref(false)
async function copyReport() {
  await navigator.clipboard.writeText(reportText.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

const tag: Record<CheckStatus, { value: string; severity: string }> = {
  idle: { value: "—", severity: "secondary" },
  running: { value: "…", severity: "info" },
  ok: { value: "OK", severity: "success" },
  fail: { value: "FAIL", severity: "danger" },
}

const sections = computed(() => [
  { title: "Сервіси", rows: services, empty: "" },
  {
    title: "STUN-сервери",
    rows: check.ice.value.filter((r) => r.kind === "stun"),
    empty: "ще не перевірено",
  },
  {
    title: "TURN-сервери",
    rows: check.ice.value.filter((r) => r.kind === "turn"),
    empty: "ще не перевірено",
  },
])
</script>

<template>
  <main class="mx-auto flex max-w-4xl flex-col gap-4 p-4">
    <AppHeader title="Діагностика мережі" />

    <p class="text-muted-color">
      Перевіряє, чи доступні з цієї мережі сервіси OKO та сервери для з'єднання. Натисніть
      «Запустити»: результат автоматично отримає адміністратор.
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <Button label="Запустити" icon="pi pi-play" :loading="running" @click="runAll" />
      <Button label="Камера й мікрофон" icon="pi pi-video" severity="secondary" @click="runMedia" />
      <Button
        :label="copied ? 'Скопійовано' : 'Скопіювати звіт'"
        icon="pi pi-copy"
        severity="secondary"
        @click="copyReport"
      />
      <span v-if="saved === 'ok'" class="text-sm text-green-400">
        <i class="pi pi-check" /> Звіт надіслано адміну
      </span>
      <span v-else-if="saved === 'fail'" class="text-sm text-red-400">
        Не вдалося надіслати звіт — скопіюйте його вручну
      </span>
    </div>

    <Message v-if="!env.webrtc" severity="error">Браузер не підтримує WebRTC.</Message>

    <Card>
      <template #title>Тип NAT</template>
      <template #content>
        <p v-if="!nat" class="text-muted-color">ще не перевірено</p>
        <template v-else>
          <Message
            :severity="
              nat.verdict === 'not-symmetric'
                ? 'success'
                : nat.verdict === 'symmetric'
                  ? 'warn'
                  : 'secondary'
            "
          >
            {{ natText[nat.verdict] }}
          </Message>
          <p class="mt-2 text-muted-color">
            Публічні IP: {{ nat.publicIps.join(", ") || "—" }} · робочих STUN: {{ nat.servers }}
          </p>
        </template>
      </template>
    </Card>

    <Card v-for="section in sections" :key="section.title">
      <template #title>{{ section.title }}</template>
      <template #content>
        <p v-if="section.rows.length === 0" class="text-muted-color">{{ section.empty }}</p>
        <table v-else class="w-full">
          <tr v-for="row in section.rows" :key="row.label + row.target" class="diag-row">
            <td class="w-px whitespace-nowrap"><Tag v-bind="tag[row.status]" /></td>
            <td>
              {{ row.label }}
              <div class="text-sm text-muted-color">{{ row.target }}</div>
            </td>
            <td class="text-right whitespace-nowrap">{{ row.ms != null ? `${row.ms} мс` : "" }}</td>
            <td class="text-sm">{{ row.detail }}</td>
          </tr>
        </table>
      </template>
    </Card>

    <Card>
      <template #title>Камера й мікрофон</template>
      <template #content>
        <p v-if="!media" class="text-muted-color">ще не перевірено</p>
        <Message v-else :severity="media.ok ? 'success' : 'error'">
          {{
            media.ok
              ? `Доступ є · камер: ${media.cameras} · мікрофонів: ${media.microphones}`
              : media.error
          }}
        </Message>
      </template>
    </Card>

    <Card>
      <template #title>Звіт</template>
      <template #content>
        <Textarea :model-value="reportText" readonly rows="12" class="w-full font-mono text-xs" />
      </template>
    </Card>
  </main>
</template>
