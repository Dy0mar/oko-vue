<script setup lang="ts">
import Tab from "primevue/tab"
import TabList from "primevue/tablist"
import TabPanel from "primevue/tabpanel"
import TabPanels from "primevue/tabpanels"
import Tabs from "primevue/tabs"

import AppHeader from "src/components/AppHeader.vue"
import RoomsPanel from "src/components/admin/RoomsPanel.vue"
import DiagReportsPanel from "src/components/admin/DiagReportsPanel.vue"
import IceServersPanel from "src/components/admin/IceServersPanel.vue"
</script>

<template>
  <main class="mx-auto flex max-w-5xl flex-col gap-4 p-4">
    <AppHeader title="Адмінка" />
    <Tabs value="rooms">
      <TabList>
        <Tab value="rooms">Зустрічі</Tab>
        <Tab value="servers">Сервери STUN/TURN</Tab>
        <Tab value="reports">Звіти діагностики</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="rooms"><RoomsPanel /></TabPanel>
        <TabPanel value="servers"><IceServersPanel /></TabPanel>
        <TabPanel value="reports"><DiagReportsPanel /></TabPanel>
      </TabPanels>
    </Tabs>
  </main>
</template>
