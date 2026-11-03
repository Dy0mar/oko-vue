<script setup lang="ts">
import { ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import Button from "primevue/button"
import InputText from "primevue/inputtext"
import Message from "primevue/message"
import Password from "primevue/password"

import { useAuth } from "src/composables/useAuth"

const { signIn } = useAuth()
const route = useRoute()
const router = useRouter()

const email = ref("")
const password = ref("")
const pending = ref(false)
const error = ref<string | null>(null)

/** Only same-app paths: "//evil.com" or "https://…" would be an open redirect. */
function redirectTarget(): string {
  const q = route.query.redirect
  return typeof q === "string" && q.startsWith("/") && !q.startsWith("//") ? q : "/"
}

async function submit() {
  pending.value = true
  error.value = await signIn(email.value.trim(), password.value)
  pending.value = false
  if (!error.value) await router.replace(redirectTarget())
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center p-4">
    <form
      class="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-surface bg-surface-900 p-6"
      @submit.prevent="submit"
    >
      <h1 class="text-2xl font-semibold">OKO</h1>

      <div class="flex flex-col gap-2">
        <label for="email">Email</label>
        <InputText
          id="email"
          v-model="email"
          type="email"
          autocomplete="username"
          required
          :disabled="pending"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label for="password">Пароль</label>
        <Password
          v-model="password"
          input-id="password"
          autocomplete="current-password"
          :feedback="false"
          toggle-mask
          fluid
          required
          :disabled="pending"
        />
      </div>

      <Message v-if="error" severity="error">{{ error }}</Message>

      <Button type="submit" label="Увійти" :loading="pending" />
    </form>
  </main>
</template>
