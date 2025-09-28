import { db, getKV, setKV } from './db'

export type ToastAction =
  | { type: 'undo-delete-note'; label: string; payload: { noteId: number } }
  | { type: 'undo-delete-filter'; label: string; payload: { filterId: number } }
  | { type: 'undo-delete-filters-bulk'; label: string; payload: { filterIds: number[] } }

export interface ToastItem {
  id: string
  message: string
  kind?: 'info' | 'success' | 'warning' | 'error'
  action?: ToastAction
  timeoutMs?: number
  createdAt: string
  dismissedAt?: string | null
}

const TOASTS_KV = 'toasts'

let toasts: ToastItem[] = []
const listeners = new Set<() => void>()
const timers = new Map<string, number>()

function emit() {
  for (const l of listeners) l()
  try { window.dispatchEvent(new Event('focuz:toasts-changed')) } catch {}
}

async function persist() {
  await setKV(TOASTS_KV, toasts)
}

function scheduleExpiry(t: ToastItem) {
  const timeout = t.timeoutMs ?? 6000
  const created = new Date(t.createdAt).getTime()
  const due = created + timeout
  const remaining = Math.max(0, due - Date.now())
  if (remaining === 0) {
    dismissToast(t.id)
    return
  }
  clearTimer(t.id)
  const handle = window.setTimeout(() => dismissToast(t.id), remaining)
  timers.set(t.id, handle)
}

function clearTimer(id: string) {
  const h = timers.get(id)
  if (h) window.clearTimeout(h)
  timers.delete(id)
}

export async function initToasts(): Promise<void> {
  const stored = (await getKV<ToastItem[]>(TOASTS_KV, [])) || []
  // Drop already expired toasts
  toasts = stored.filter(t => {
    const timeout = t.timeoutMs ?? 6000
    const created = new Date(t.createdAt).getTime()
    return Date.now() < created + timeout && !t.dismissedAt
  })
  // reschedule timers
  for (const t of toasts) scheduleExpiry(t)
  emit()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getToasts(): ToastItem[] {
  return toasts.slice()
}

export async function addToast(partial: Omit<ToastItem, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<ToastItem> {
  const item: ToastItem = {
    id: partial.id || crypto.randomUUID(),
    message: partial.message,
    kind: partial.kind || 'info',
    action: partial.action,
    timeoutMs: partial.timeoutMs ?? 6000,
    createdAt: partial.createdAt || new Date().toISOString(),
    dismissedAt: null,
  }
  toasts = [...toasts, item]
  scheduleExpiry(item)
  await persist()
  emit()
  return item
}

export async function dismissToast(id: string): Promise<void> {
  clearTimer(id)
  toasts = toasts.map(t => (t.id === id ? { ...t, dismissedAt: new Date().toISOString() } : t))
  await persist()
  emit()
}

export async function invokeAction(id: string): Promise<void> {
  const t = toasts.find(x => x.id === id)
  if (!t?.action) return
  const a = t.action
  try {
    if (a.type === 'undo-delete-note') {
      const noteId = a.payload.noteId
      const rec = await db.notes.get(noteId)
      if (rec && rec.deletedAt) {
        const now = new Date().toISOString()
        await db.notes.update(noteId, { deletedAt: null, modifiedAt: now, isDirty: 1 })
        try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
      }
    } else if (a.type === 'undo-delete-filter') {
      const filterId = a.payload.filterId
      const rec = await db.filters.get(filterId)
      if (rec && rec.deletedAt) {
        const now = new Date().toISOString()
        await db.filters.update(filterId, { deletedAt: null, modifiedAt: now, isDirty: 1 })
        try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
      }
    } else if (a.type === 'undo-delete-filters-bulk') {
      const now = new Date().toISOString()
      for (const id of a.payload.filterIds) {
        const rec = await db.filters.get(id)
        if (rec && rec.deletedAt) {
          await db.filters.update(id, { deletedAt: null, modifiedAt: now, isDirty: 1 })
        }
      }
      try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
    }
  } finally {
    await dismissToast(id)
  }
}


