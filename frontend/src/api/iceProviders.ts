/** ICE server kinds: `static` is stored as-is, the rest get credentials from the provider's API. */
export type IceKind = "static" | "cloudflare" | "metered" | "turnix"
export type ProviderKind = Exclude<IceKind, "static">

/** Mirrors the providers of the `ice-servers` edge function. */
export const PROVIDERS: Record<ProviderKind, { label: string; secrets: string[]; site: string }> = {
  cloudflare: {
    label: "Cloudflare TURN",
    secrets: ["CF_TURN_KEY_ID", "CF_TURN_API_TOKEN"],
    site: "https://developers.cloudflare.com/realtime/turn/",
  },
  metered: {
    label: "Metered Open Relay",
    secrets: ["METERED_APP_NAME", "METERED_API_KEY"],
    site: "https://www.metered.ca/tools/openrelay/",
  },
  turnix: {
    label: "Turnix",
    secrets: ["TURNIX_API_TOKEN"],
    site: "https://turnix.io/",
  },
}

export const isProvider = (kind: IceKind): kind is ProviderKind => kind !== "static"
