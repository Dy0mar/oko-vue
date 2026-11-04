<script setup lang="ts">
import { ref } from "vue"
import { useRouter } from "vue-router"
import Button from "primevue/button"
import InputText from "primevue/inputtext"

import { parseRoomCode } from "src/api/rooms"
import { useAuth } from "src/composables/useAuth"

const router = useRouter()
const { signOut } = useAuth()

const link = ref("")
const invalid = ref(false)

function open() {
  const code = parseRoomCode(link.value)
  invalid.value = !code
  if (code) void router.push(`/meet/${code}`)
}
</script>

<template>
  <main class="grid min-h-dvh place-items-center p-4">
    <section class="glass flex w-full max-w-md flex-col gap-6 px-6 py-10">
      <header class="text-center">
        <h1 class="text-3xl font-semibold tracking-tight">OKO</h1>
        <p class="mt-2 text-white/60">Відкрийте посилання на зустріч від адміністратора</p>
      </header>

      <form class="flex flex-col gap-2" @submit.prevent="open">
        <InputText
          v-model="link"
          placeholder="https://…/meet/abc-defg-hij або abc-defg-hij"
          :invalid="invalid"
          aria-label="Посилання або код зустрічі"
        />
        <small v-if="invalid" class="text-red-400">Не схоже на посилання OKO</small>
        <Button type="submit" label="Перейти" icon="pi pi-arrow-right" icon-pos="right" />
      </form>

      <nav class="flex flex-wrap justify-center gap-2 text-sm">
        <RouterLink to="/diag" class="nav-link">Діагностика</RouterLink>
        <button type="button" class="nav-link" @click="signOut">Вийти</button>
      </nav>
    </section>
  </main>
</template>
