import { watch } from "vue"
import { createRouter, createWebHistory } from "vue-router"

import { useAuth } from "src/composables/useAuth"

declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresAdmin?: boolean
    /** Only for signed-out users (login page). */
    guestOnly?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: () => import("src/pages/HomePage.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/meet/:code",
      name: "meet",
      component: () => import("src/pages/MeetPage.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/login",
      name: "login",
      component: () => import("src/pages/LoginPage.vue"),
      meta: { guestOnly: true },
    },
    {
      path: "/diag",
      name: "diag",
      component: () => import("src/pages/DiagPage.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/admin",
      name: "admin",
      component: () => import("src/pages/AdminPage.vue"),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
  ],
})

const auth = useAuth()

router.beforeEach(async (to) => {
  await auth.ready
  const signedIn = auth.session.value !== null

  if (to.meta.requiresAuth && !signedIn) {
    return { name: "login", query: { redirect: to.fullPath } }
  }
  if (to.meta.requiresAdmin && !auth.isAdmin.value) return "/"
  if (to.meta.guestOnly && signedIn) return "/"
  // The admin's home is the dashboard.
  if (to.name === "home" && auth.isAdmin.value) return { name: "admin" }
})

// Session ended while on a protected page (sign-out, other tab, refresh token expired).
watch(auth.session, (session) => {
  const current = router.currentRoute.value
  if (!session && current.meta.requiresAuth) {
    router.replace({ name: "login", query: { redirect: current.fullPath } })
  }
})
