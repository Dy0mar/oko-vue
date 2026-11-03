import { computed, shallowRef } from "vue"
import type { Session } from "@supabase/supabase-js"

import { supabase } from "src/api/supabase"

// Module-level singleton: one session state for the whole app.
const session = shallowRef<Session | null>(null)

/** Resolves once the stored session has been loaded — guards await it. */
const ready = supabase.auth.getSession().then(({ data }) => {
  session.value = data.session
})

// Token refresh, sign-out (also from another tab), expired refresh token.
supabase.auth.onAuthStateChange((_event, next) => {
  session.value = next
})

const user = computed(() => session.value?.user ?? null)

/** UI only. Real enforcement lives in RLS / edge functions (they read the same JWT claim). */
const isAdmin = computed(() => user.value?.app_metadata.role === "admin")

async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error?.message ?? null
}

async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

export function useAuth() {
  return { session, user, isAdmin, ready, signIn, signOut }
}
