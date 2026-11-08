import { askDossier } from '@/lib/research'
import { loadDossier } from '@/lib/data'
import { liveNarrative } from '@/lib/live'
import { hasKey, memoryCache } from '@/lib/llm'
export const maxDuration = 120
const cache = memoryCache()
export async function POST(req: Request) {
  const { ticker, question } = await req.json() as { ticker: string; question: string }
  if (!question?.trim() || question.length > 1500) return Response.json({ error: 'Ask a question of up to 1,500 characters.' }, { status: 400 })
  if (!hasKey()) return Response.json({ error: 'GEMINI_API_KEY is not set on the server.' }, { status: 503 })
  const t = ticker.toUpperCase().replace(/[^A-Z0-9&-]/g, '')
  try {
    const d = loadDossier(t) || await liveNarrative(t)
    return Response.json(await askDossier(d, question.trim(), { cache }))
  } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }) }
}
