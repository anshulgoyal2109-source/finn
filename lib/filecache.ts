// Content-addressed LLM cache on disk (pipeline). In CI it is persisted with actions/cache,
// so re-running a day never re-pays for a document already read.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Cache } from './llm'

export function fileCache(dir: string): Cache {
  mkdirSync(dir, { recursive: true })
  return {
    async get(k) { const p = join(dir, k + '.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined },
    async set(k, v) { writeFileSync(join(dir, k + '.json'), JSON.stringify(v)) },
  }
}

export const readJson = <T>(p: string, def: T): T => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return def } }
export const writeJson = (p: string, v: unknown, pretty = false) => writeFileSync(p, JSON.stringify(v, null, pretty ? 1 : 0))
