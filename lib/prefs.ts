'use client'
// Per-investor preferences live on the device (no accounts in the prototype).
import { useEffect, useState } from 'react'
import { DEFAULT_THRESHOLDS, type Thresholds } from './alerts'

function useStored<T>(key: string, init: T): [T, (v: T) => void, boolean] {
  const [v, setV] = useState<T>(init)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    try { const s = localStorage.getItem(key); if (s) setV(JSON.parse(s)) } catch { /* private mode */ }
    setReady(true)
  }, [key])
  const set = (x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)) } catch { /* ignore */ } }
  return [v, set, ready]
}

export const useThresholds = () => useStored<Thresholds>('finn.thresholds', DEFAULT_THRESHOLDS)
export const useDone = () => useStored<string[]>('finn.done', [])
export const useWindow = () => useStored<string>('finn.window', '24h')
export const useRecent = () => useStored<string[]>('finn.recent', [])
