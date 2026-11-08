import { Watch } from '@/components/Watch'
import { loadHoldings, loadPrices } from '@/lib/data'
export const dynamic = 'force-dynamic'
export default function Page() {
  const h = loadHoldings(); const p = loadPrices()
  const slim = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.slice(-30)]))
  return <Watch holdings={h.holdings} prices={slim} pushTopic={process.env.NTFY_TOPIC_PUBLIC} />
}
