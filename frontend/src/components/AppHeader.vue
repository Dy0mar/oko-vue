<script setup lang="ts">
import Button from "primevue/button"

import { useAuth } from "src/composables/useAuth"

defineProps<{ title: string }>()

const { user, isAdmin, signOut } = useAuth()
</script>

<template>
  <header class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-4">
      <h1 class="text-2xl font-semibold">{{ title }}</h1>
      <nav class="flex gap-1 text-sm">
        <RouterLink to="/diag" class="nav-link" active-class="nav-link-active">
          Діагностика
        </RouterLink>
        <RouterLink v-if="isAdmin" to="/admin" class="nav-link" active-class="nav-link-active">
          Адмінка
        </RouterLink>
      </nav>
    </div>
    <div class="flex items-center gap-2 text-sm text-muted-color">
      {{ user?.email }}
      <Button label="Вийти" icon="pi pi-sign-out" size="small" text @click="signOut" />
    </div>
  </header>
</template>
