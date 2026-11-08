export const inr = (v: number | null | undefined, d = 0) => v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })
export const cr = (v: number | null | undefined) => v == null ? '—' : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L cr` : `₹${inr(Math.round(v))} cr`
export const pct = (v: number | null | undefined, d = 1) => v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`
export const chg = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100
export const tone = (v: number | null | undefined) => v == null ? 'text-mute' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-mute'

export function ago(iso: string, now = Date.now()) {
  const m = Math.round((now - +new Date(iso)) / 60000)
  if (m < 60) return `${Math.max(1, m)}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
export const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
