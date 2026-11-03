import { createApp } from "vue"
import PrimeVue from "primevue/config"
import ConfirmationService from "primevue/confirmationservice"
import ToastService from "primevue/toastservice"
import Aura from "@primeuix/themes/aura"
import "primeicons/primeicons.css"
import "src/assets/main.css"

import App from "src/App.vue"
import { router } from "src/router"

createApp(App)
  .use(router)
  .use(PrimeVue, {
    theme: {
      preset: Aura,
      // Put PrimeVue styles into the `primevue` layer declared in main.css.
      options: {
        // Always dark: the class is set statically on <html> in index.html.
        darkModeSelector: ".app-dark",
        cssLayer: { name: "primevue", order: "theme, base, primevue, components, utilities" },
      },
    },
  })
  .use(ToastService)
  .use(ConfirmationService)
  .mount("#app")
