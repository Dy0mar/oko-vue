import { supabase } from "src/api/supabase"

export interface DiagReportRow {
  id: number
  user_email: string | null
  created_at: string
  report: DiagReport
}

interface ReportRow {
  label: string
  target: string
  status: "idle" | "running" | "ok" | "fail"
  ms?: number | null
  detail?: string
}

/** Shape written by DiagPage. */
export interface DiagReport {
  env?: { userAgent?: string; timezone?: string; network?: unknown }
  services?: ReportRow[]
  ice?: ReportRow[]
  nat?: { verdict: string; publicIps: string[] } | null
  media?: { ok: boolean; error?: string } | null
}

export async function listDiagReports(limit = 50): Promise<DiagReportRow[]> {
  const { data, error } = await supabase
    .from("diag_reports")
    .select("id, user_email, created_at, report")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as DiagReportRow[]
}

export async function deleteDiagReport(id: number): Promise<void> {
  const { error } = await supabase.from("diag_reports").delete().eq("id", id)
  if (error) throw error
}
