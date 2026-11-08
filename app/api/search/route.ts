import { searchCompanies } from '@/lib/screener'
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() || ''
  if (q.length < 2) return Response.json([])
  return Response.json(await searchCompanies(q).catch(() => []), { headers: { 'cache-control': 's-maxage=86400' } })
}
