<script setup lang="ts">
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import Button from "primevue/button"
import Column from "primevue/column"
import DataTable from "primevue/datatable"
import InputText from "primevue/inputtext"
import { useConfirm } from "primevue/useconfirm"
import { useToast } from "primevue/usetoast"

import { createRoom, deleteRoom, listRooms, roomLink, type Room } from "src/api/rooms"

const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const rooms = ref<Room[]>([])
const loading = ref(false)
const creating = ref(false)
const title = ref("")

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
    rooms.value = await listRooms()
  } catch (e) {
    showError(e)
  } finally {
    loading.value = false
  }
}

async function copy(room: Room) {
  await navigator.clipboard.writeText(roomLink(room.code))
  toast.add({
    severity: "success",
    summary: "Посилання скопійовано",
    detail: roomLink(room.code),
    life: 2500,
  })
}

async function create() {
  creating.value = true
  try {
    const room = await createRoom(title.value)
    title.value = ""
    await load()
    await copy(room)
  } catch (e) {
    showError(e)
  } finally {
    creating.value = false
  }
}

function remove(room: Room) {
  confirm.require({
    header: "Видалити зустріч?",
    message: `Посилання ${room.code} перестане працювати.`,
    icon: "pi pi-trash",
    acceptProps: { label: "Видалити", severity: "danger" },
    rejectProps: { label: "Скасувати", severity: "secondary", text: true },
    accept: async () => {
      try {
        await deleteRoom(room.code)
        await load()
      } catch (e) {
        showError(e)
      }
    },
  })
}

const date = (iso: string) => new Date(iso).toLocaleDateString("uk-UA")

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-3">
    <form class="flex flex-wrap items-center gap-2" @submit.prevent="create">
      <InputText v-model="title" placeholder="Назва (необов'язково)" class="min-w-48 flex-1" />
      <Button type="submit" label="Нова зустріч" icon="pi pi-plus" :loading="creating" />
      <Button
        icon="pi pi-refresh"
        severity="secondary"
        text
        :loading="loading"
        aria-label="Оновити"
        title="Оновити"
        @click="load"
      />
    </form>
    <p class="text-sm text-muted-color">
      Зустріч постійна: одне посилання працює, доки ви її не видалите. Після створення посилання
      копіюється автоматично.
    </p>

    <DataTable :value="rooms" :loading="loading" data-key="code" size="small">
      <template #empty><span class="text-muted-color">Зустрічей поки немає</span></template>
      <Column header="Зустріч">
        <template #body="{ data }">
          <div>{{ data.title || "Без назви" }}</div>
          <div class="font-mono text-xs text-muted-color">{{ data.code }}</div>
        </template>
      </Column>
      <Column header="Створено" class="whitespace-nowrap">
        <template #body="{ data }">{{ date(data.created_at) }}</template>
      </Column>
      <Column header="" class="w-px whitespace-nowrap">
        <template #body="{ data }">
          <Button
            icon="pi pi-link"
            text
            rounded
            aria-label="Скопіювати посилання"
            title="Скопіювати посилання"
            @click="copy(data)"
          />
          <Button
            icon="pi pi-video"
            text
            rounded
            aria-label="Увійти"
            title="Увійти"
            @click="router.push(`/meet/${data.code}`)"
          />
          <Button
            icon="pi pi-trash"
            text
            rounded
            severity="danger"
            aria-label="Видалити"
            title="Видалити"
            @click="remove(data)"
          />
        </template>
      </Column>
    </DataTable>
  </div>
</template>
