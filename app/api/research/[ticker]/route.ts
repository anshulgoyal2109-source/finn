import { factsDossier } from '@/lib/live'
export const maxDuration = 30
export async function GET(_: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const t = (await params).ticker.toUpperCase().replace(/[^A-Z0-9&-]/g, '')
  try { return Response.json(await factsDossier(t), { headers: { 'cache-control': 's-maxage=3600' } }) }
  catch (e: any) { return Response.json({ error: `Couldn't find ${t} on screener.in. Check the NSE symbol.` }, { status: 404 }) }
}
