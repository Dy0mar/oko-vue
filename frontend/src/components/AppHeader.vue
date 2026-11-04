<script setup lang="ts">
import Button from "primevue/button"

import { useAuth } from "src/composables/useAuth"

const { user, signOut } = useAuth()
</script>

<template>
  <header class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-4">
      <!-- "/" is the dashboard for the admin and the "open a link" screen for a user -->
      <RouterLink to="/" class="text-2xl font-semibold tracking-tight" title="На головну">
        OKO
      </RouterLink>
      <nav class="flex gap-1 text-sm">
        <RouterLink to="/diag" class="nav-link" active-class="nav-link-active">
          Діагностика
        </RouterLink>
      </nav>
    </div>
    <div class="flex items-center gap-2 text-sm text-muted-color">
      {{ user?.email }}
      <Button label="Вийти" icon="pi pi-sign-out" size="small" text @click="signOut" />
    </div>
  </header>
</template>
