'use client'

import { useCallback, useEffect, useRef } from 'react'

// Признаки списывания (миграция 118): плеер молча копит по каждому заданию
// активное время, уходы со вкладки и вставки из буфера и досылает приращения
// в /api/attempts/[id]/signals. Выводы делает окно проверки учителя
// (lib/attempts/integrity.ts); ученику ничего не показывается.
//
// Активное время — вкладка видима, окно в фокусе и ученик не бездействует
// дольше IDLE_MS (читать условие минуту без движений — нормально, а вот
// оставленная открытой вкладка не должна копить «время решения»).

const FLUSH_MS = 60_000
const IDLE_MS = 3 * 60_000
/** Вставка в течение этого времени после возвращения на вкладку — «ушёл и вставил» */
const AWAY_PASTE_WINDOW_MS = 60_000

interface Counters {
  active_ms: number
  away_count: number
  away_ms: number
  paste_count: number
  pasted_chars: number
  typed_inputs: number
  away_paste_count: number
  blind_paste_count: number
}

const emptyCounters = (): Counters => ({
  active_ms: 0, away_count: 0, away_ms: 0, paste_count: 0, pasted_chars: 0,
  typed_inputs: 0, away_paste_count: 0, blind_paste_count: 0,
})

function isAnswerField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable
}

export function useIntegritySignals(attemptId: string, currentTaskId: string | null) {
  const accRef = useRef(new Map<string, Counters>())
  // набирал ли ученик что-то на задании за эту загрузку страницы — для
  // «вставил, ничего не набрав»
  const typedRef = useRef(new Set<string>())
  const taskRef = useRef(currentTaskId)
  const activeSinceRef = useRef<number | null>(null)
  const lastInteractionRef = useRef(0)
  const awaySinceRef = useRef<number | null>(null)
  const lastReturnRef = useRef<number | null>(null)

  const counters = useCallback((taskId: string) => {
    let c = accRef.current.get(taskId)
    if (!c) { c = emptyCounters(); accRef.current.set(taskId, c) }
    return c
  }, [])

  // Дописывает текущему заданию активное время до «сейчас», но не дальше
  // IDLE_MS после последнего действия ученика
  const settle = useCallback((now: number) => {
    const since = activeSinceRef.current
    const taskId = taskRef.current
    if (since === null || !taskId) return
    const end = Math.min(now, lastInteractionRef.current + IDLE_MS)
    if (end > since) counters(taskId).active_ms += end - since
    activeSinceRef.current = now
  }, [counters])

  const flush = useCallback(async (keepalive = false) => {
    if (awaySinceRef.current === null) settle(Date.now())
    const rows = [...accRef.current.entries()]
      .map(([task_id, c]) => ({ task_id, ...c, active_ms: Math.round(c.active_ms) }))
      .filter(r => Object.entries(r).some(([k, v]) => k !== 'task_id' && v !== 0))
    if (rows.length === 0) return
    accRef.current = new Map()
    try {
      const res = await fetch(`/api/attempts/${attemptId}/signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
        keepalive,
      })
      if (!res.ok) throw new Error('signals')
    } catch {
      // не дошло — вернём приращения в очередь, уйдут со следующей отправкой
      for (const { task_id, ...delta } of rows) {
        const c = counters(task_id)
        for (const k of Object.keys(delta) as (keyof Counters)[]) c[k] += delta[k]
      }
    }
  }, [attemptId, counters, settle])

  // Смена задания: время до перехода — предыдущему
  useEffect(() => {
    const now = Date.now()
    settle(now)
    taskRef.current = currentTaskId
    lastInteractionRef.current = now
  }, [currentTaskId, settle])

  useEffect(() => {
    const now = Date.now()
    lastInteractionRef.current = now
    if (document.visibilityState === 'visible' && document.hasFocus()) activeSinceRef.current = now
    else awaySinceRef.current = now

    function leave() {
      if (awaySinceRef.current !== null) return
      const t = Date.now()
      settle(t)
      activeSinceRef.current = null
      awaySinceRef.current = t
      if (taskRef.current) counters(taskRef.current).away_count++
    }
    function back() {
      if (awaySinceRef.current === null) return
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      const t = Date.now()
      if (taskRef.current) counters(taskRef.current).away_ms += t - awaySinceRef.current
      awaySinceRef.current = null
      lastReturnRef.current = t
      lastInteractionRef.current = t
      activeSinceRef.current = t
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') { leave(); flush(true) } else back()
    }
    function onBlur() {
      // фокус ушёл во встроенный фрейм страницы (видео, документ) — ученик
      // остался на странице
      setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) return
        if (!document.hasFocus()) leave()
      }, 0)
    }
    function onPageHide() { flush(true) }
    function onInteraction() {
      lastInteractionRef.current = Date.now()
    }
    function onPaste(e: ClipboardEvent) {
      onInteraction()
      const taskId = taskRef.current
      if (!taskId || !isAnswerField(e.target)) return
      const c = counters(taskId)
      c.paste_count++
      c.pasted_chars += e.clipboardData?.getData('text').length ?? 0
      const ret = lastReturnRef.current
      if (ret !== null && Date.now() - ret < AWAY_PASTE_WINDOW_MS) c.away_paste_count++
      if (!typedRef.current.has(taskId)) c.blind_paste_count++
    }
    function onInput(e: Event) {
      const taskId = taskRef.current
      if (!taskId || !isAnswerField(e.target)) return
      const type = (e as InputEvent).inputType ?? ''
      // вставка уже учтена в onPaste; перетаскивание текста — та же вставка
      if (type.startsWith('insertFromPaste')) return
      if (type === 'insertFromDrop') {
        counters(taskId).paste_count++
        return
      }
      typedRef.current.add(taskId)
      counters(taskId).typed_inputs++
    }

    const opts = { capture: true, passive: true } as const
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', back)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('paste', onPaste, true)
    document.addEventListener('input', onInput, true)
    for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const) {
      document.addEventListener(ev, onInteraction, opts)
    }
    const timer = setInterval(() => { flush() }, FLUSH_MS)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', back)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('input', onInput, true)
      for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const) {
        document.removeEventListener(ev, onInteraction, opts)
      }
    }
  }, [counters, flush, settle])

  return { flushSignals: flush }
}
