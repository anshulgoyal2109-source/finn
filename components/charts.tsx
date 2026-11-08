// Tiny dependency-free SVG charts sized for a phone column.
import { inr } from '@/lib/format'

export function Spark({ values, w = 120, h = 36, className = '' }: { values: number[]; w?: number; h?: number; className?: string }) {
  const v = values.filter(x => x != null && isFinite(x))
  if (v.length < 2) return null
  const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${h - 2 - ((x - mn) / r) * (h - 4)}`).join(' ')
  const up = v[v.length - 1] >= v[0]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? 'var(--color-up)' : 'var(--color-down)'} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

/** Labelled column chart; last column highlighted. Negative values hang below the baseline. */
export function Columns({ labels, values, unit, highlightLast = true, fmt }: { labels: string[]; values: (number | null)[]; unit?: string; highlightLast?: boolean; fmt?: (v: number) => string }) {
  const v = values.map(x => x ?? 0)
  const mx = Math.max(0, ...v), mn = Math.min(0, ...v), r = mx - mn || 1
  const H = 92, base = (mx / r) * H
  const f = fmt || ((x: number) => (unit === '%' ? `${x}%` : inr(x)))
  return (
    <div className="flex items-end gap-[3px]" style={{ height: H + 34 }} role="img" aria-label={labels.map((l, i) => `${l}: ${values[i] == null ? 'n/a' : f(values[i]!)}`).join(', ')}>
      {v.map((x, i) => {
        const hgt = Math.max(1, (Math.abs(x) / r) * H)
        const last = highlightLast && i === v.length - 1
        return (
          <div key={i} className="flex flex-1 flex-col items-center" style={{ height: H + 34 }}>
            <div className="relative w-full" style={{ height: H }}>
              <div className={`absolute inset-x-0 rounded-[3px] ${x < 0 ? 'bg-down/70' : last ? 'bg-signal' : 'bg-ink-2/35'}`} style={x >= 0 ? { bottom: H - base, height: hgt } : { top: base, height: hgt }} />
            </div>
            <span className={`num mt-1 text-[9.5px] leading-none ${last ? 'font-semibold text-ink' : 'text-mute'}`}>{values[i] == null ? '' : compact(values[i]!, unit)}</span>
            <span className="mt-1 text-[9.5px] leading-none text-mute">{labels[i]?.replace(/^(\w{3}) 20(\d\d)$/, "$1 ’$2").replace(/^Mar ’/, '’')}</span>
          </div>
        )
      })}
    </div>
  )
}
const compact = (x: number, unit?: string) => unit === '%' ? `${Math.round(x)}%` : Math.abs(x) >= 1e5 ? `${(x / 1e5).toFixed(1)}L` : Math.abs(x) >= 1e3 ? `${(x / 1e3).toFixed(Math.abs(x) >= 1e4 ? 0 : 1)}k` : `${Math.round(x)}`

/** Operating cash vs profit, side by side per year — the cash-quality picture in one glance. */
export function PairColumns({ labels, a, b, aLabel, bLabel }: { labels: string[]; a: (number | null)[]; b: (number | null)[]; aLabel: string; bLabel: string }) {
  const all = [...a, ...b].map(x => x ?? 0)
  const mx = Math.max(0, ...all), mn = Math.min(0, ...all), r = mx - mn || 1, H = 84, base = (mx / r) * H
  const bar = (x: number | null, cls: string) => {
    const v = x ?? 0, h = Math.max(1, (Math.abs(v) / r) * H)
    return <div className="relative h-full flex-1"><div className={`absolute inset-x-0 rounded-[2px] ${v < 0 ? 'bg-down/75' : cls}`} style={v >= 0 ? { bottom: H - base, height: h } : { top: base, height: h }} /></div>
  }
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: H }}>
        {labels.map((l, i) => <div key={l} className="flex h-full flex-1 gap-[2px]">{bar(a[i], 'bg-ink')}{bar(b[i], 'bg-ink-2/30')}</div>)}
      </div>
      <div className="mt-1 flex gap-2">{labels.map(l => <span key={l} className="flex-1 text-center text-[9.5px] text-mute">{l.replace(/^Mar 20/, '’')}</span>)}</div>
      <p className="mt-2 flex gap-4 text-[11px] text-mute"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-ink" />{aLabel}</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-ink-2/30" />{bLabel}</span></p>
    </div>
  )
}
