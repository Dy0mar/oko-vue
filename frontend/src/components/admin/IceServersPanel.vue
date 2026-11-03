<script setup lang="ts">
import { onMounted, ref } from "vue"
import Button from "primevue/button"
import Column from "primevue/column"
import DataTable from "primevue/datatable"
import Tag from "primevue/tag"
import ToggleSwitch from "primevue/toggleswitch"
import { useConfirm } from "primevue/useconfirm"
import { useToast } from "primevue/usetoast"

import {
  deleteIceServer,
  listIceServers,
  updateIceServer,
  type IceServerRow,
} from "src/api/adminIceServers"
import { fetchIceServers } from "src/api/iceServers"
import { expandIceServers, testIceUrl, type IceUrlTest } from "src/diagnostics/ice"
import IceServerDialog from "src/components/admin/IceServerDialog.vue"

interface UrlResult {
  label: string
  status: "running" | "ok" | "fail"
  ms?: number | null
  detail?: string
}

const toast = useToast()
const confirm = useConfirm()

const servers = ref<IceServerRow[]>([])
const loading = ref(false)
const results = ref<Record<string, UrlResult[]>>({})
const dialogVisible = ref(false)
const editing = ref<IceServerRow | null>(null)

function showError(e: unknown) {
  toast.add({
    severity: "error",
    summary: "Помилка",
    detail: e instanceof Error ? e.message : String(e),
    life: 5000,
  })
}

async function load() {
  loading.value = true
  try {
    servers.value = await listIceServers()
  } catch (e) {
    showError(e)
  } finally {
    loading.value = false
  }
}

function openDialog(server: IceServerRow | null) {
  editing.value = server
  dialogVisible.value = true
}

async function toggleEnabled(server: IceServerRow, enabled: boolean) {
  try {
    await updateIceServer(server.id, { enabled })
    server.enabled = enabled
  } catch (e) {
    showError(e)
  }
}

function remove(server: IceServerRow) {
  confirm.require({
    header: "Видалити сервер?",
    message: `«${server.label}» буде видалено.`,
    icon: "pi pi-trash",
    acceptProps: { label: "Видалити", severity: "danger" },
    rejectProps: { label: "Скасувати", severity: "secondary", text: true },
    accept: async () => {
      try {
        await deleteIceServer(server.id)
        await load()
      } catch (e) {
        showError(e)
      }
    },
  })
}

/** Static servers: tested from the row itself. Cloudflare: via the edge function (fresh credentials). */
async function urlTests(server: IceServerRow): Promise<IceUrlTest[] | string> {
  if (server.kind === "static") {
    const ice: RTCIceServer = { urls: server.urls }
    if (server.username) ice.username = server.username
    if (server.credential) ice.credential = server.credential
    return expandIceServers(server.label, [ice])
  }
  if (!server.enabled) return "Увімкніть сервер, щоб отримати тимчасові креденшели"
  const entry = (await fetchIceServers()).find((e) => e.id === server.id)
  if (!entry) return "Сервер не повернувся з edge function"
  if (entry.error) return entry.error
  return expandIceServers(server.label, entry.iceServers)
}

async function test(server: IceServerRow) {
  results.value[server.id] = [{ label: "підготовка…", status: "running" }]
  try {
    const tests = await urlTests(server)
    if (typeof tests === "string") {
      results.value[server.id] = [{ label: server.label, status: "fail", detail: tests }]
      return
    }
    const rows = tests.map((t) => ({ label: t.label, status: "running" as const }))
    results.value[server.id] = rows
    await Promise.all(
      tests.map(async (t, i) => {
        const r = await testIceUrl(t)
        results.value[server.id]![i] = {
          label: rows[i]!.label,
          status: r.ok ? "ok" : "fail",
          ms: r.ms,
          detail: r.detail,
        }
      }),
    )
  } catch (e) {
    results.value[server.id] = [{ label: server.label, status: "fail", detail: String(e) }]
  }
}

const resultSeverity = { running: "info", ok: "success", fail: "danger" } as const

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-muted-color">
        Ці сервери отримують учасники дзвінка. Вимкнений сервер не використовується.
      </p>
      <div class="flex gap-2">
        <Button icon="pi pi-refresh" severity="secondary" text :loading="loading" @click="load" />
        <Button label="Додати" icon="pi pi-plus" @click="openDialog(null)" />
      </div>
    </div>

    <DataTable :value="servers" :loading="loading" data-key="id" size="small">
      <Column header="" class="w-px">
        <template #body="{ data }">
          <ToggleSwitch
            :model-value="data.enabled"
            @update:model-value="(v: boolean) => toggleEnabled(data, v)"
          />
        </template>
      </Column>
      <Column header="Сервер">
        <template #body="{ data }">
          <div class="flex flex-wrap items-center gap-2">
            <span :class="{ 'text-muted-color': !data.enabled }">{{ data.label }}</span>
            <Tag v-if="data.kind === 'cloudflare'" value="Cloudflare" severity="warn" />
            <i v-if="data.credential" class="pi pi-key text-xs text-muted-color" title="є пароль" />
          </div>
          <div class="font-mono text-xs text-muted-color wrap-anywhere">
            {{ data.kind === "cloudflare" ? "генерується автоматично" : data.urls.join(" · ") }}
          </div>
          <ul v-if="results[data.id]" class="mt-2 flex flex-col gap-1">
            <li
              v-for="r in results[data.id]"
              :key="r.label"
              class="flex flex-wrap items-start gap-2 text-xs"
            >
              <Tag
                :value="r.status === 'running' ? '…' : r.status.toUpperCase()"
                :severity="resultSeverity[r.status]"
              />
              <span>{{ r.label }}</span>
              <span v-if="r.ms != null" class="text-muted-color">{{ r.ms }} мс</span>
              <span class="text-muted-color wrap-anywhere">{{ r.detail }}</span>
            </li>
          </ul>
        </template>
      </Column>
      <Column field="sort" header="#" class="w-px text-muted-color" />
      <Column header="" class="w-px whitespace-nowrap">
        <template #body="{ data }">
          <Button
            icon="pi pi-bolt"
            title="Тест"
            text
            rounded
            aria-label="Тест"
            @click="test(data)"
          />
          <Button
            icon="pi pi-pencil"
            text
            rounded
            title="Редагувати"
            aria-label="Редагувати"
            @click="openDialog(data)"
          />
          <Button
            icon="pi pi-trash"
            text
            rounded
            severity="danger"
            title="Видалити"
            aria-label="Видалити"
            @click="remove(data)"
          />
        </template>
      </Column>
    </DataTable>

    <IceServerDialog v-model:visible="dialogVisible" :server="editing" @saved="load" />
  </div>
</template>
