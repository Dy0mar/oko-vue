<script setup lang="ts">
import { onMounted, ref } from "vue"
import Button from "primevue/button"
import Column from "primevue/column"
import DataTable from "primevue/datatable"
import Tag from "primevue/tag"
import { useConfirm } from "primevue/useconfirm"
import { useToast } from "primevue/usetoast"

import { deleteDiagReport, listDiagReports, type DiagReportRow } from "src/api/diagReports"

const toast = useToast()
const confirm = useConfirm()

const reports = ref<DiagReportRow[]>([])
const loading = ref(false)
const expanded = ref<Record<number, boolean>>({})

async function load() {
  loading.value = true
  try {
    reports.value = await listDiagReports()
  } catch (e) {
    toast.add({ severity: "error", summary: "Помилка", detail: String(e), life: 5000 })
  } finally {
    loading.value = false
  }
}

function remove(row: DiagReportRow) {
  confirm.require({
    header: "Видалити звіт?",
    message: `Звіт від ${row.user_email ?? "невідомо"} буде видалено.`,
    icon: "pi pi-trash",
    acceptProps: { label: "Видалити", severity: "danger" },
    rejectProps: { label: "Скасувати", severity: "secondary", text: true },
    accept: async () => {
      await deleteDiagReport(row.id)
      await load()
    },
  })
}

/** "4/6" — how many checks of a group passed. */
function score(rows: { status: string }[] | undefined): { text: string; severity: string } {
  if (!rows?.length) return { text: "—", severity: "secondary" }
  const ok = rows.filter((r) => r.status === "ok").length
  const severity = ok === rows.length ? "success" : ok === 0 ? "danger" : "warn"
  return { text: `${ok}/${rows.length}`, severity }
}

const stun = (r: DiagReportRow) => score(r.report.ice?.filter((x) => x.target.startsWith("stun")))
const turn = (r: DiagReportRow) => score(r.report.ice?.filter((x) => !x.target.startsWith("stun")))
const services = (r: DiagReportRow) => score(r.report.services)

const date = (iso: string) =>
  new Date(iso).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" })

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm text-muted-color">Звіти з /diag, найновіші зверху.</p>
      <Button icon="pi pi-refresh" severity="secondary" text :loading="loading" @click="load" />
    </div>

    <DataTable :value="reports" :loading="loading" data-key="id" size="small">
      <template #empty><span class="text-muted-color">Звітів поки немає</span></template>
      <Column header="Коли" class="whitespace-nowrap">
        <template #body="{ data }">{{ date(data.created_at) }}</template>
      </Column>
      <Column header="Хто">
        <template #body="{ data }">
          {{ data.user_email ?? "—" }}
          <div class="text-xs text-muted-color">{{ data.report.env?.timezone }}</div>
        </template>
      </Column>
      <Column header="Сервіси"
        ><template #body="{ data }"
          ><Tag :value="services(data).text" :severity="services(data).severity" /></template
      ></Column>
      <Column header="STUN"
        ><template #body="{ data }"
          ><Tag :value="stun(data).text" :severity="stun(data).severity" /></template
      ></Column>
      <Column header="TURN"
        ><template #body="{ data }"
          ><Tag :value="turn(data).text" :severity="turn(data).severity" /></template
      ></Column>
      <Column header="NAT">
        <template #body="{ data }">
          <span class="text-xs">{{ data.report.nat?.verdict?.split(":")[0] ?? "—" }}</span>
        </template>
      </Column>
      <Column header="" class="w-px whitespace-nowrap">
        <template #body="{ data }">
          <Button
            :icon="expanded[data.id] ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
            text
            rounded
            title="Деталі"
            aria-label="Деталі"
            @click="expanded[data.id] = !expanded[data.id]"
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

    <template v-for="r in reports" :key="r.id">
      <section v-if="expanded[r.id]" class="rounded-xl border border-surface p-3">
        <h3 class="mb-2 font-semibold">{{ r.user_email }} · {{ date(r.created_at) }}</h3>
        <table class="w-full text-sm">
          <tr
            v-for="row in [...(r.report.services ?? []), ...(r.report.ice ?? [])]"
            :key="row.label + row.target"
            class="diag-row"
          >
            <td class="w-px whitespace-nowrap">
              <Tag
                :value="row.status.toUpperCase()"
                :severity="row.status === 'ok' ? 'success' : 'danger'"
              />
            </td>
            <td>
              {{ row.label }}
              <div class="text-xs text-muted-color">{{ row.target }}</div>
            </td>
            <td class="text-right whitespace-nowrap">{{ row.ms != null ? `${row.ms} мс` : "" }}</td>
            <td class="text-xs wrap-anywhere">{{ row.detail }}</td>
          </tr>
        </table>
        <p class="mt-2 text-xs text-muted-color wrap-anywhere">{{ r.report.env?.userAgent }}</p>
      </section>
    </template>
  </div>
</template>
