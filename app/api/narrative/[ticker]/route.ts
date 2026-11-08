import { liveNarrative } from '@/lib/live'
import { hasKey } from '@/lib/llm'
export const maxDuration = 120
export async function GET(_: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const t = (await params).ticker.toUpperCase().replace(/[^A-Z0-9&-]/g, '')
  if (!hasKey()) return Response.json({ error: 'GEMINI_API_KEY is not set on the server, so only the numbers are available.' }, { status: 503 })
  try { return Response.json(await liveNarrative(t), { headers: { 'cache-control': 's-maxage=21600' } }) }
  catch (e: any) { return Response.json({ error: `Research failed: ${e.message}` }, { status: 500 }) }
}
