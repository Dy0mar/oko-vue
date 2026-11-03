<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue"
import Button from "primevue/button"
import Dialog from "primevue/dialog"
import InputNumber from "primevue/inputnumber"
import InputText from "primevue/inputtext"
import Message from "primevue/message"
import Password from "primevue/password"
import SelectButton from "primevue/selectbutton"
import Textarea from "primevue/textarea"
import ToggleSwitch from "primevue/toggleswitch"

import {
  createIceServer,
  parseUrls,
  updateIceServer,
  validateIceServer,
  type IceServerInput,
  type IceServerRow,
} from "src/api/adminIceServers"

const props = defineProps<{ server: IceServerRow | null }>()
const visible = defineModel<boolean>("visible", { required: true })
const emit = defineEmits<{ saved: [] }>()

const kindOptions = [
  { label: "Статичний", value: "static" },
  { label: "Cloudflare TURN", value: "cloudflare" },
]

const form = reactive({
  label: "",
  kind: "static" as IceServerRow["kind"],
  urlsText: "",
  username: "",
  credential: "",
  enabled: true,
  sort: 100,
})
const error = ref<string | null>(null)
const saving = ref(false)
const isEdit = computed(() => props.server !== null)

// Fill the form every time the dialog opens.
watch(visible, (open) => {
  if (!open) return
  const s = props.server
  Object.assign(form, {
    label: s?.label ?? "",
    kind: s?.kind ?? "static",
    urlsText: s?.urls.join("\n") ?? "",
    username: s?.username ?? "",
    credential: s?.credential ?? "",
    enabled: s?.enabled ?? true,
    sort: s?.sort ?? 100,
  })
  error.value = null
})

async function save() {
  const input: IceServerInput = {
    label: form.label,
    kind: form.kind,
    urls: parseUrls(form.urlsText),
    username: form.username || null,
    credential: form.credential || null,
    enabled: form.enabled,
    sort: form.sort,
  }
  error.value = validateIceServer(input)
  if (error.value) return

  saving.value = true
  try {
    if (props.server) await updateIceServer(props.server.id, input)
    else await createIceServer(input)
    visible.value = false
    emit("saved")
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="isEdit ? 'Редагувати сервер' : 'Новий сервер'"
    class="w-full max-w-lg"
  >
    <form class="flex flex-col gap-4" @submit.prevent="save">
      <div class="flex flex-col gap-2">
        <label for="ice-label">Назва</label>
        <InputText id="ice-label" v-model="form.label" placeholder="Мій TURN" />
      </div>

      <SelectButton
        v-model="form.kind"
        :options="kindOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
      />

      <template v-if="form.kind === 'static'">
        <div class="flex flex-col gap-2">
          <label for="ice-urls">Адреси (по одній на рядок)</label>
          <Textarea
            id="ice-urls"
            v-model="form.urlsText"
            rows="4"
            class="font-mono text-sm"
            placeholder="stun:stun.example.com:3478&#10;turn:turn.example.com:3478?transport=udp&#10;turns:turn.example.com:443?transport=tcp"
          />
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-2">
            <label for="ice-username">Логін (для TURN)</label>
            <InputText id="ice-username" v-model="form.username" autocomplete="off" />
          </div>
          <div class="flex flex-col gap-2">
            <label for="ice-credential">Пароль (для TURN)</label>
            <Password
              v-model="form.credential"
              input-id="ice-credential"
              :feedback="false"
              toggle-mask
              fluid
              autocomplete="new-password"
            />
          </div>
        </div>
      </template>
      <Message v-else severity="secondary">
        Тимчасові логін і пароль генеруються автоматично з ключів <code>CF_TURN_KEY_ID</code> /
        <code>CF_TURN_API_TOKEN</code> (Supabase secrets).
      </Message>

      <div class="flex flex-wrap items-center gap-6">
        <label class="flex items-center gap-2">
          <ToggleSwitch v-model="form.enabled" />
          Увімкнено
        </label>
        <label class="flex items-center gap-2">
          Порядок
          <InputNumber v-model="form.sort" :min="0" :step="10" show-buttons input-class="w-20" />
        </label>
      </div>

      <Message v-if="error" severity="error">{{ error }}</Message>

      <div class="flex justify-end gap-2">
        <Button label="Скасувати" severity="secondary" text @click="visible = false" />
        <Button type="submit" label="Зберегти" icon="pi pi-check" :loading="saving" />
      </div>
    </form>
  </Dialog>
</template>
