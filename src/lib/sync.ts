import { db, getKV, setKV, wipeLocalData, deleteDatabase, deleteDatabaseWithRetry, ensureDbOpen } from './db'
import { parseDurationToMs } from './time'
import type { FilterRecord, NoteRecord, SpaceRecord, TagRecord, AttachmentRecord, JobRecord, ActivityRecord, ActivityTypeRecord } from './types'

const API_BASE = (import.meta as any).env.VITE_API_BASE_URL as string | undefined
const BASE_SYNC_INTERVAL_MS = Number(((import.meta as any).env.VITE_SYNC_INTERVAL_MS ?? '60000')) || 60000
const DEBOUNCE_LOCAL_MS = Number(((import.meta as any).env.VITE_SYNC_DEBOUNCE_MS ?? '2000')) || 2000
const WS_COOLDOWN_MS = Number(((import.meta as any).env.VITE_SYNC_WS_COOLDOWN_MS ?? '3000')) || 3000
const NO_CHANGE_BACKOFF_MS = Number(((import.meta as any).env.VITE_SYNC_BACKOFF_MS ?? '15000')) || 15000
const LAST_SYNC_KV = 'lastSyncAt'
const CURRENT_SPACE_KV = 'currentSpaceId'
const TOKEN_KV = 'authToken'
const USERNAME_LS = 'authUsername'
const AUTH_REQUIRED_LS = 'authRequired'

let authRequired = false
let authBC: BroadcastChannel | null = null
try {
  authBC = new BroadcastChannel('focuz-auth')
} catch {}

function emitAuthRequired(next: boolean) {
  authRequired = next
  try { localStorage.setItem(AUTH_REQUIRED_LS, next ? '1' : '0') } catch {}
  try { window.dispatchEvent(new CustomEvent('focuz:auth-required', { detail: next })) } catch {}
  try { authBC?.postMessage({ type: 'auth-required', value: next }) } catch {}
}

export function isAuthRequired(): boolean {
  return authRequired || (typeof localStorage !== 'undefined' && localStorage.getItem(AUTH_REQUIRED_LS) === '1')
}

export function onAuthRequired(handler: (required: boolean) => void): () => void {
  const fn = (e: Event) => {
    const required = (e as CustomEvent<boolean>).detail
    handler(!!required)
  }
  const storageFn = (e: StorageEvent) => {
    if (e.key === AUTH_REQUIRED_LS) handler(e.newValue === '1')
  }
  const bcFn = (msg: MessageEvent) => {
    if (msg?.data?.type === 'auth-required') handler(!!msg.data.value)
  }
  window.addEventListener('focuz:auth-required', fn as EventListener)
  window.addEventListener('storage', storageFn)
  authBC?.addEventListener('message', bcFn)
  // fire current state immediately
  handler(isAuthRequired())
  return () => {
    window.removeEventListener('focuz:auth-required', fn as EventListener)
    window.removeEventListener('storage', storageFn)
    try { authBC?.removeEventListener('message', bcFn) } catch {}
  }
}

function getAuthToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KV) ?? undefined
  } catch {
    return undefined
  }
}

function getLastUsernameLS(): string | undefined {
  try { return localStorage.getItem(USERNAME_LS) ?? undefined } catch { return undefined }
}

function setLastUsernameLS(username: string) {
  try { localStorage.setItem(USERNAME_LS, username) } catch {}
}

async function api(path: string, init?: RequestInit) {
  if (!API_BASE) throw new Error('Missing VITE_API_BASE_URL')
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    // If we're online and server says unauthorized (expired/invalid token) for a protected endpoint → require re-auth
    const isAuthEndpoint = path.startsWith('/login') || path.startsWith('/register')
    if (navigator.onLine && res.status === 401 && !isAuthEndpoint) {
      emitAuthRequired(true)
      throw new Error('AUTH_REQUIRED')
    }
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json()
}

async function apiMultipart(path: string, form: FormData): Promise<any> {
  if (!API_BASE) throw new Error('Missing VITE_API_BASE_URL')
  const token = getAuthToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form, headers })
  if (!res.ok) {
    if (navigator.onLine && res.status === 401) { emitAuthRequired(true); throw new Error('AUTH_REQUIRED') }
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function register(username: string, password: string): Promise<void> {
  await api('/register', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export async function login(username: string, password: string): Promise<void> {
  // Reopen DB after previous logout/delete cycle
  await ensureDbOpen().catch(() => {})
  const resp = await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  const token = resp?.data?.token as string
  if (!token) throw new Error('No token')
  setLastUsernameLS(username)
  localStorage.setItem(TOKEN_KV, token)
  emitAuthRequired(false)
}

export function getLastUsername(): string | undefined {
  return getLastUsernameLS()
}

export function logout(): void {
  try { localStorage.removeItem(TOKEN_KV) } catch {}
  try { authBC?.postMessage({ type: 'logout' }) } catch {}
  // Best-effort full DB drop to avoid stale state across sessions
  deleteDatabase().catch(() => { wipeLocalData().catch(() => {}) })
  // Do not write to IndexedDB after deletion, or it will be recreated empty
}

export async function purgeAndLogout(): Promise<void> {
  try { teardownSync() } catch {}
  try { localStorage.removeItem(TOKEN_KV) } catch {}
  try { authBC?.postMessage({ type: 'logout' }) } catch {}
  try { await deleteDatabaseWithRetry(4000) } catch { try { await wipeLocalData() } catch {} }
}

export function isAuthenticated(): boolean {
  return !!getAuthToken()
}

export async function listSpaces(): Promise<Array<{ id: number; name: string }>> {
  const resp = await api('/spaces', { method: 'GET' })
  return resp?.data?.data ?? []
}

export async function ensureDefaultSpace(): Promise<number> {
  const existing = await db.spaces.filter(s => !s.deletedAt).toArray()
  if (existing.length > 0) {
    const current = (await getKV<number>(CURRENT_SPACE_KV)) ?? existing[0].id!
    await setKV(CURRENT_SPACE_KV, current)
    return current
  }

  const now = new Date().toISOString()
  let serverId: number | null = null
  try {
    if (navigator.onLine && API_BASE && getAuthToken()) {
      const spaces = await listSpaces()
      if (spaces.length > 0) {
        const found = spaces[0]
        const id = await db.spaces.add({
          serverId: found.id,
          name: found.name,
          createdAt: now,
          modifiedAt: now,
          deletedAt: null,
          isDirty: 0,
        } as SpaceRecord)
        await setKV(CURRENT_SPACE_KV, id)
        return id
      }
      const resp = await api('/spaces', { method: 'POST', body: JSON.stringify({ name: 'My Space' }) })
      serverId = resp?.data?.id ?? null
    }
  } catch {
    // ignore
  }

  const id = await db.spaces.add({
    serverId,
    name: 'My Space',
    createdAt: now,
    modifiedAt: now,
    deletedAt: null,
    isDirty: serverId ? 0 : 1,
  } as SpaceRecord)
  await setKV(CURRENT_SPACE_KV, id)
  return id
}

async function awaitSpaceIdToServer(localSpaceId: number): Promise<number> {
  const s = await db.spaces.get(localSpaceId)
  if (!s) throw new Error('Space not found')
  if (s.serverId) return s.serverId
  try {
    const resp = await api('/spaces', { method: 'POST', body: JSON.stringify({ name: s.name }) })
    const sid = resp?.data?.id as number
    await db.spaces.update(localSpaceId, { serverId: sid, isDirty: 0 })
    return sid
  } catch {
    return 0 as unknown as number
  }
}

export async function deleteNote(localId: number): Promise<void> {
  const now = new Date().toISOString()
  await db.notes.update(localId, { deletedAt: now, modifiedAt: now, isDirty: 1 })
}

// ---- Activities: local create/update + validation mirroring backend ----

function parseBooleanLoose(v: string): boolean | null {
  const s = v.trim().toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'no') return false
  return null
}

export async function createOrUpdateLocalActivity(noteLocalId: number, typeServerId: number, rawValue: string): Promise<number> {
  const note = await db.notes.get(noteLocalId)
  if (!note) throw new Error('Note not found')
  const type = await db.activityTypes.where('serverId').equals(typeServerId).first()
  if (!type) throw new Error('Activity type not found')
  const checked = validateActivityValue(type, rawValue)
  const now = new Date().toISOString()
  // Uniqueness per (noteId, typeId); update if exists
  const existing = await db.activities.where('noteId').equals(noteLocalId).filter(a => !a.deletedAt && a.typeId === typeServerId).first()
  if (existing?.id) {
    await db.activities.update(existing.id, { valueRaw: checked, modifiedAt: now, isDirty: 1 })
    await db.notes.update(noteLocalId, { modifiedAt: now, isDirty: 1 })
    try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
    return existing.id
  }
  const id = await db.activities.add({
    noteId: noteLocalId,
    serverId: null,
    typeId: typeServerId,
    valueRaw: checked,
    createdAt: now,
    modifiedAt: now,
    deletedAt: null,
    isDirty: 1,
  } as ActivityRecord)
  await db.notes.update(noteLocalId, { modifiedAt: now, isDirty: 1 })
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
  return id
}

export async function deleteLocalActivity(noteLocalId: number, typeServerId: number): Promise<void> {
  const now = new Date().toISOString()
  const existing = await db.activities
    .where('noteId').equals(noteLocalId)
    .filter(a => !a.deletedAt && a.typeId === typeServerId)
    .first()
  if (existing?.id) {
    await db.activities.update(existing.id, { deletedAt: now, modifiedAt: now, isDirty: 1 })
    await db.notes.update(noteLocalId, { modifiedAt: now, isDirty: 1 })
    try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
  }
}

export function validateActivityValue(t: ActivityTypeRecord, raw: string): string {
  const trimmed = (raw ?? '').toString().trim()
  if (!trimmed) throw new Error('Value is required')
  switch (t.valueType) {
    case 'integer': {
      const v = Number(trimmed)
      if (!Number.isInteger(v)) throw new Error('Value must be integer')
      if (typeof t.minValue === 'number' && v < t.minValue) throw new Error('Value is out of range')
      if (typeof t.maxValue === 'number' && v > t.maxValue) throw new Error('Value is out of range')
      return String(v)
    }
    case 'float': {
      const f = Number(trimmed)
      if (!Number.isFinite(f)) throw new Error('Value must be float')
      if (typeof t.minValue === 'number' && f < t.minValue) throw new Error('Value is out of range')
      if (typeof t.maxValue === 'number' && f > t.maxValue) throw new Error('Value is out of range')
      return String(f)
    }
    case 'boolean': {
      const b = parseBooleanLoose(trimmed)
      if (b == null) throw new Error('Value must be boolean')
      return b ? 'true' : 'false'
    }
    case 'time': {
      const ms = parseDurationToMs(trimmed)
      if (!Number.isFinite(ms)) throw new Error('Value must be a duration (e.g. 1h 2m 3s 250ms)')
      if (typeof t.minValue === 'number' && ms < t.minValue) throw new Error('Value is out of range')
      if (typeof t.maxValue === 'number' && ms > t.maxValue) throw new Error('Value is out of range')
      return String(Math.round(ms))
    }
    case 'text':
    default:
      return trimmed
  }
}

function toServerActivityValue(t: ActivityTypeRecord | undefined, raw: string): any {
  const base = (raw ?? '').toString()
  const type = t?.valueType
  try {
    switch (type) {
      case 'integer': return { data: Number.parseInt(base, 10) }
      case 'float': return { data: Number(base) }
      case 'boolean': {
        const b = parseBooleanLoose(base)
        return { data: !!b }
      }
      case 'time': {
        // Convert milliseconds (string) to PostgreSQL interval literal like '1 hour 2 minutes 3 seconds'
        const ms = Number(base)
        if (!Number.isFinite(ms)) return { data: base }
        const totalMs = Math.max(0, Math.round(ms))
        const h = Math.floor(totalMs / 3600000)
        const m = Math.floor((totalMs % 3600000) / 60000)
        const s = Math.floor((totalMs % 60000) / 1000)
        const msR = totalMs % 1000
        let parts: string[] = []
        if (h) parts.push(`${h} hour${h !== 1 ? 's' : ''}`)
        if (m) parts.push(`${m} minute${m !== 1 ? 's' : ''}`)
        if (s || (!h && !m && !msR)) parts.push(`${s} second${s !== 1 ? 's' : ''}`)
        if (msR) parts.push(`${msR} milliseconds`)
        const interval = parts.join(' ')
        return { data: interval }
      }
      case 'text':
      default: return { data: base }
    }
  } catch {
    return { data: base }
  }
}

function fromServerActivityValue(v: any): string {
  if (v == null) return ''
  if (typeof v === 'object' && 'data' in v) {
    const d = (v as any).data
    if (typeof d === 'boolean') return d ? 'true' : 'false'
    if (typeof d === 'number') return String(d)
    return String(d ?? '')
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return '' }
}

export async function createFilterLocal(spaceId: number, name: string, params: any, parentServerId?: number | null): Promise<number> {
  const now = new Date().toISOString()
  const id = await db.filters.add({
    spaceId,
    name,
    params,
    parentId: parentServerId ?? null,
    createdAt: now,
    modifiedAt: now,
    deletedAt: null,
    isDirty: 1,
    serverId: null,
    clientId: crypto.randomUUID(),
  } as unknown as FilterRecord)
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
  return id
}

export async function updateFilterLocal(localId: number, changes: { name?: string; params?: any; parentServerId?: number | null }): Promise<void> {
  const now = new Date().toISOString()
  const partial: any = { modifiedAt: now, isDirty: 1 }
  if (typeof changes.name === 'string') partial.name = changes.name
  if (typeof changes.parentServerId !== 'undefined') partial.parentId = (changes.parentServerId ?? null)
  if (typeof changes.params !== 'undefined') partial.params = changes.params
  await db.filters.update(localId, partial)
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
}

export async function deleteFilterLocal(localId: number): Promise<void> {
  const now = new Date().toISOString()
  await db.filters.update(localId, { deletedAt: now, modifiedAt: now, isDirty: 1 })
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
}

export async function updateNoteLocal(localId: number, changes: { text?: string; tags?: string[] }): Promise<void> {
  const now = new Date().toISOString()
  await db.notes.update(localId, { ...changes, modifiedAt: now, isDirty: 1 })
}

export async function addLocalAttachment(noteId: number, file: File): Promise<number> {
  const now = new Date().toISOString()
  const id = await db.attachments.add({
    noteId,
    serverId: null,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    data: file,
    createdAt: now,
    modifiedAt: now,
    deletedAt: null,
    isDirty: 1,
  } as AttachmentRecord)
  await db.jobs.add({
    kind: 'attachment-upload',
    attachmentId: id,
    priority: 5,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  })
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
  return id
}

export async function deleteLocalAttachment(attachmentLocalId: number): Promise<void> {
  const now = new Date().toISOString()
  const att = await db.attachments.get(attachmentLocalId)
  if (!att) return
  await db.transaction('rw', db.attachments, db.notes, async () => {
    await db.attachments.update(attachmentLocalId, { deletedAt: now, modifiedAt: now, isDirty: 1 })
    // Touch parent note so /sync will accept attachment edits
    const note = await db.notes.get(att.noteId)
    if (note?.id) {
      await db.notes.update(note.id, { modifiedAt: now, isDirty: 1 })
    }
  })
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
}

export async function reorderNoteAttachments(noteId: number, orderedAttachmentLocalIds: number[]): Promise<void> {
  // Assign increasing modifiedAt to reflect new order; smallest first
  const base = Date.now()
  await db.transaction('rw', db.attachments, db.notes, async () => {
    for (let i = 0; i < orderedAttachmentLocalIds.length; i++) {
      const id = orderedAttachmentLocalIds[i]
      const ts = new Date(base + i).toISOString()
      const att = await db.attachments.get(id)
      if (!att || att.deletedAt) continue
      // Only server-backed attachments participate in server reordering; still update locals for UX
      await db.attachments.update(id, { modifiedAt: ts, isDirty: (att.serverId ? 1 : att.isDirty) as 0 | 1 })
    }
    const note = await db.notes.get(noteId)
    if (note?.id) {
      await db.notes.update(note.id, { modifiedAt: new Date(base + orderedAttachmentLocalIds.length).toISOString(), isDirty: 1 })
    }
  })
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
}

function toNoteChange(n: NoteRecord) {
  return {
    id: n.serverId ?? null,
    clientId: n.serverId ? null : (n.clientId || `tmp-${n.id}`),
    space_id: 0,
    user_id: undefined,
    text: n.text,
    tags: n.tags,
    created_at: n.createdAt,
    modified_at: n.modifiedAt,
    deleted_at: n.deletedAt ?? null,
    parent_id: n.parentId ?? null,
    date: n.date ?? n.createdAt,
  }
}

function toFilterChange(f: FilterRecord) {
  return {
    id: f.serverId ?? null,
    clientId: f.serverId ? null : (f.clientId || `tmp-${f.id}`),
    space_id: 0,
    user_id: undefined,
    parent_id: (f.parentId ?? null),
    name: f.name,
    params: f.params as any,
    created_at: f.createdAt,
    modified_at: f.modifiedAt,
    deleted_at: f.deletedAt ?? null,
  }
}

function toTagChange(t: TagRecord) {
  return {
    id: t.serverId ?? null,
    space_id: 0,
    name: t.name,
    created_at: t.createdAt,
    modified_at: t.modifiedAt,
    deleted_at: t.deletedAt ?? null,
  }
}

async function pushDirty() {
  if (!navigator.onLine || !API_BASE || !getAuthToken() || isAuthRequired()) return { applied: 0 }

  const notes = await db.notes.where('isDirty').equals(1).toArray()
  const filters = await db.filters.where('isDirty').equals(1).toArray()
  const tags = await db.tags.where('isDirty').equals(1).toArray()
  const attachments = await db.attachments.where('isDirty').equals(1).toArray()
  const activities = await db.activities.where('isDirty').equals(1).toArray()

  // Fallback: call deprecated delete endpoint for server-backed notes with deletedAt
  const deletions = notes.filter(n => n.deletedAt && n.serverId)
  for (const n of deletions) {
    try {
      await api(`/notes/${n.serverId}/delete`, { method: 'PATCH' })
      await db.notes.update(n.id!, { isDirty: 0 })
    } catch {
      // ignore and let /sync try
    }
  }

  const remainingNotes = await db.notes.where('isDirty').equals(1).toArray()
  const notesForSync = remainingNotes
  if (notesForSync.length + filters.length + tags.length + attachments.length + activities.length === 0) return { applied: 0 }

  const spaceServerIdByLocal = new Map<number, number>()
  async function toServerSpaceId(localId: number): Promise<number> {
    if (spaceServerIdByLocal.has(localId)) return spaceServerIdByLocal.get(localId)!
    const sid = await awaitSpaceIdToServer(localId)
    spaceServerIdByLocal.set(localId, sid)
    return sid
  }

  // Group dirty attachments by note localId
  const dirtyByNoteLocal = new Map<number, AttachmentRecord[]>()
  for (const a of attachments) {
    if (!dirtyByNoteLocal.has(a.noteId)) dirtyByNoteLocal.set(a.noteId, [])
    dirtyByNoteLocal.get(a.noteId)!.push(a)
  }
  // Group dirty activities by note localId
  const actByNoteLocal = new Map<number, ActivityRecord[]>()
  for (const a of activities) {
    if (!actByNoteLocal.has(a.noteId)) actByNoteLocal.set(a.noteId, [])
    actByNoteLocal.get(a.noteId)!.push(a)
  }
  // Ensure notes for which attachments are dirty are included in notesForSync
  for (const [noteLocalId] of dirtyByNoteLocal) {
    if (!notesForSync.find(n => n.id === noteLocalId)) {
      const note = await db.notes.get(noteLocalId)
      if (note) notesForSync.push(note)
    }
  }
  // Ensure notes for which activities are dirty are included
  for (const [noteLocalId] of actByNoteLocal) {
    if (!notesForSync.find(n => n.id === noteLocalId)) {
      const note = await db.notes.get(noteLocalId)
      if (note) notesForSync.push(note)
    }
  }
  const notesPayload = await Promise.all(notesForSync.map(async (n) => {
    const space_id = await toServerSpaceId(n.spaceId)
    const base = { ...toNoteChange(n), space_id }
    const atts = dirtyByNoteLocal.get(n.id!) || []
    const acts = actByNoteLocal.get(n.id!) || []

    const out: any = { ...base }
    if (atts.length > 0) {
      // Build minimal attachment updates: only server-backed items matter to server
      const attPayload = atts
        .filter(a => !!a.serverId)
        .map(a => ({
          id: a.serverId as string,
          modified_at: a.modifiedAt,
          is_deleted: !!a.deletedAt,
        }))
      if (attPayload.length > 0) out.attachments = attPayload
    }
    if (acts.length > 0) {
      // Build activity updates: include created/modified/deleted and value
      // Load types for value parsing
      const typeIds = Array.from(new Set(acts.map(a => a.typeId)))
      const types = await db.activityTypes.where('serverId').anyOf(typeIds).toArray()
      const typeById = new Map<number, ActivityTypeRecord>(types.map(t => [t.serverId!, t]))
      const actPayload = acts.map(a => {
        const t = typeById.get(a.typeId)
        const value = toServerActivityValue(t, a.valueRaw)
        return {
          id: (a.serverId ?? null),
          type_id: a.typeId,
          value,
          created_at: a.createdAt,
          modified_at: a.modifiedAt,
          deleted_at: a.deletedAt ?? null,
        }
      })
      if (actPayload.length > 0) out.activities = actPayload
    }
    return out
  }))
  const filtersPayload = await Promise.all(filters.map(async (f) => ({ ...toFilterChange(f), space_id: await toServerSpaceId(f.spaceId) })))
  const tagsPayload = await Promise.all(tags.map(async (t) => ({ ...toTagChange(t), space_id: await toServerSpaceId(t.spaceId) })))

  const resp = await api('/sync', {
    method: 'POST',
    body: JSON.stringify({ notes: notesPayload, filters: filtersPayload, tags: tagsPayload, charts: [] }),
  })

  const mappings: Array<{ resource: string; clientId: string; serverId: number }> = resp?.data?.mappings ?? []

  await db.transaction('rw', [db.notes, db.filters, db.tags, db.attachments, db.activities] as any, async () => {
    for (const n of notesForSync) await db.notes.update(n.id!, { isDirty: 0 })
    for (const f of filters) await db.filters.update(f.id!, { isDirty: 0 })
    for (const t of tags) await db.tags.update(t.id!, { isDirty: 0 })
    for (const a of attachments) await db.attachments.update(a.id!, { isDirty: 0 })
    for (const a of activities) await db.activities.update(a.id!, { isDirty: 0 })
    for (const m of mappings) {
      if (m.resource === 'note' || m.resource === 'notes') {
        const local = await db.notes.where('clientId').equals(m.clientId).first()
        if (local) await db.notes.update(local.id!, { serverId: m.serverId })
        // Deduplicate: if multiple notes now share the same serverId, keep the one with a clientId (local) if exists
        const withSame = await db.notes.where('serverId').equals(m.serverId).toArray()
        if (withSame.length > 1) {
          const keep = withSame.find(n => !!n.clientId)
          for (const x of withSame) {
            if (x.id !== keep!.id) {
              await db.notes.delete(x.id!)
            }
          }
        }
      } else if (m.resource === 'filter' || m.resource === 'filters') {
        const local = await db.filters.where('clientId').equals(m.clientId).first()
        if (local) await db.filters.update(local.id!, { serverId: m.serverId })
        // If any children were temporarily referencing this parent via params._parentClientId,
        // fix them up to use server parent_id and mark dirty for push
        const all = await db.filters.toArray()
        for (const ch of all) {
          const p = (ch.params as any) || {}
          if (p && p._parentClientId === m.clientId) {
            const nextParams = { ...p }
            delete nextParams._parentClientId
            await db.filters.update(ch.id!, { parentId: m.serverId, params: nextParams as any, isDirty: 1, modifiedAt: new Date().toISOString() })
          }
        }
      } else if (m.resource === 'activity' || m.resource === 'activities') {
        // Map clientId activities if server echoes mapping; our activities currently do not use clientId, so skip
      }
    }
  })

  try { window.dispatchEvent(new Event('focuz:sync-applied')) } catch {}

  return { applied: resp?.data?.applied ?? 0 }
}

async function pullSince() {
  if (!navigator.onLine || !API_BASE || !getAuthToken() || isAuthRequired()) return { pulled: 0 }
  const since = (await getKV<string>(LAST_SYNC_KV, '1970-01-01T00:00:00Z'))!
  const resp = await api(`/sync?since=${encodeURIComponent(since)}`)
  const data = resp?.data || {}

  // Advance checkpoint only to the max server modified_at we actually saw
  let maxSyncAt = since
  const updateMax = (iso?: string) => { if (iso && iso > maxSyncAt) maxSyncAt = iso }
  for (const s of (data.spaces ?? [])) updateMax(s.modified_at)
  for (const n of (data.notes ?? [])) updateMax(n.modified_at)
  for (const t of (data.tags ?? [])) updateMax(t.modified_at ?? t.created_at)
  for (const f of (data.filters ?? [])) updateMax(f.modified_at)
  for (const at of (data.activityTypes ?? [])) updateMax(at.modified_at)
  for (const n of (data.notes ?? [])) {
    if (Array.isArray(n.attachments)) {
      for (const a of n.attachments) updateMax(a.modified_at ?? a.created_at)
    }
    if (Array.isArray(n.activities)) {
      for (const a of n.activities) updateMax(a.modified_at)
    }
  }

  let pulled = 0
  await db.transaction('rw', [db.spaces, db.notes, db.tags, db.filters, db.attachments, db.activities, db.activityTypes, db.jobs] as any, async () => {
    for (const s of (data.spaces ?? [])) {
      pulled++
      const existing = await db.spaces.where('serverId').equals(s.id).first()
      const rec: SpaceRecord = {
        id: existing?.id,
        serverId: s.id,
        name: s.name,
        createdAt: s.created_at,
        modifiedAt: s.modified_at,
        deletedAt: s.deleted_at ?? null,
        isDirty: 0,
      }
      if (existing) await db.spaces.put(rec)
      else await db.spaces.add(rec)
    }

    for (const n of (data.notes ?? [])) {
      pulled++
      let existing = await db.notes.where('serverId').equals(n.id!).first()
      if (!existing && n.clientId) {
        // try match by clientId if provided from server (conflict/mapping echo)
        existing = await db.notes.where('clientId').equals(n.clientId).first()
      }
      const rec: NoteRecord = {
        id: existing?.id,
        serverId: n.id ?? null,
        clientId: existing?.clientId ?? n.clientId ?? null,
        spaceId: (await db.spaces.where('serverId').equals(n.space_id).first())?.id!,
        title: null,
        text: n.text ?? '',
        tags: n.tags ?? [],
        createdAt: n.created_at,
        modifiedAt: n.modified_at,
        date: n.date ?? n.created_at,
        parentId: n.parent_id ?? null,
        deletedAt: n.deleted_at ?? null,
        isDirty: 0,
      }
      if (existing) await db.notes.put(rec)
      else await db.notes.add(rec)
    }

    for (const t of (data.tags ?? [])) {
      pulled++
      const existing = await db.tags.where('serverId').equals(t.id).first()
      const rec: TagRecord = {
        id: existing?.id,
        serverId: t.id,
        spaceId: (await db.spaces.where('serverId').equals(t.space_id).first())?.id!,
        name: t.name,
        createdAt: t.created_at,
        modifiedAt: t.modified_at,
        deletedAt: t.deleted_at ?? null,
        isDirty: 0,
      }
      if (existing) await db.tags.put(rec)
      else await db.tags.add(rec)
    }

    for (const f of (data.filters ?? [])) {
      pulled++
      const existing = await db.filters.where('serverId').equals(f.id).first()
      const rec: FilterRecord = {
        id: existing?.id,
        serverId: f.id,
        spaceId: (await db.spaces.where('serverId').equals(f.space_id).first())?.id!,
        parentId: f.parent_id ?? null,
        name: f.name,
        params: (f.params ?? {}) as any,
        createdAt: f.created_at,
        modifiedAt: f.modified_at,
        deletedAt: f.deleted_at ?? null,
        isDirty: 0,
      }
      if (existing) await db.filters.put(rec)
      else await db.filters.add(rec)
    }

    // Activity Types
    for (const t of (data.activityTypes ?? [])) {
      pulled++
      const existing = await db.activityTypes.where('serverId').equals(t.id).first()
      let spaceLocalId = 0
      if (typeof t.space_id === 'number') {
        const s = await db.spaces.where('serverId').equals(t.space_id).first()
        spaceLocalId = s?.id ?? 0
      }
      const rec: ActivityTypeRecord = {
        id: existing?.id,
        serverId: t.id,
        spaceId: spaceLocalId,
        name: t.name,
        valueType: (t.value_type || t.valueType) as any,
        minValue: typeof t.min_value === 'number' ? t.min_value : (typeof t.minValue === 'number' ? t.minValue : null),
        maxValue: typeof t.max_value === 'number' ? t.max_value : (typeof t.maxValue === 'number' ? t.maxValue : null),
        aggregation: (t.aggregation ?? null),
        unit: (t.unit ?? null),
        categoryId: (t.category_id ?? t.categoryId ?? null),
        createdAt: t.created_at,
        modifiedAt: t.modified_at,
        deletedAt: t.deleted_at ?? null,
      }
      if (existing) await db.activityTypes.put(rec)
      else await db.activityTypes.add(rec)
    }

    const upsertAttachment = async (a: any) => {
      pulled++
      const existing = await db.attachments.where('serverId').equals(a.id).first()
      const noteLocalId = (await db.notes.where('serverId').equals(a.note_id).first())?.id
      if (!noteLocalId) return
      const rec: AttachmentRecord = {
        id: existing?.id,
        serverId: a.id,
        noteId: noteLocalId,
        fileName: a.file_name,
        fileType: a.file_type,
        fileSize: a.file_size,
        data: existing?.data ?? null,
        createdAt: a.created_at,
        modifiedAt: a.modified_at,
        deletedAt: null,
        isDirty: 0,
      }
      const attId = existing ? (await db.attachments.put(rec)) : (await db.attachments.add(rec))
      // remove any local duplicates for the same note with same fileName+fileSize and null serverId
      const dups = await db.attachments.where('noteId').equals(noteLocalId).filter(x => !x.serverId && x.fileName === rec.fileName && x.fileSize === rec.fileSize).toArray()
      for (const d of dups) {
        if (!rec.data && d.data) {
          await db.attachments.update(attId, { data: d.data })
        }
        await db.attachments.delete(d.id!)
      }
    }

    // Top-level attachments removed in new API; rely on per-note attachments
    for (const n of (data.notes ?? [])) {
      for (const a of (n.attachments ?? [])) {
        // include parent note id if not present
        a.note_id = a.note_id ?? n.id
        await upsertAttachment(a)
      }
      // Upsert activities nested under notes with deduplication against local drafts
      for (const a of (n.activities ?? [])) {
        pulled++
        const noteLocalId = (await db.notes.where('serverId').equals(n.id).first())?.id
        if (!noteLocalId) continue

        const existingByServer = (typeof a.id === 'number')
          ? (await db.activities.where('serverId').equals(a.id).first())
          : null
        const localDup = await db.activities
          .where('noteId').equals(noteLocalId)
          .filter(x => !x.serverId && !x.deletedAt && x.typeId === a.type_id)
          .first()

        const rec: ActivityRecord = {
          id: existingByServer?.id ?? localDup?.id,
          serverId: (typeof a.id === 'number' ? a.id : null),
          noteId: noteLocalId,
          typeId: a.type_id,
          valueRaw: fromServerActivityValue(a.value),
          createdAt: a.created_at,
          modifiedAt: a.modified_at,
          deletedAt: a.deleted_at ?? null,
          isDirty: 0,
        }

        if (existingByServer && localDup && existingByServer.id !== localDup.id) {
          // Prefer server-backed record; update it and remove local duplicate
          await db.activities.put({ ...rec, id: existingByServer.id })
          await db.activities.delete(localDup.id!)
        } else if (localDup && !existingByServer) {
          // Promote local draft to server-backed by assigning serverId and server fields
          await db.activities.put(rec)
        } else if (existingByServer) {
          await db.activities.put({ ...rec, id: existingByServer.id })
        } else {
          await db.activities.add(rec)
        }

        // Ensure only one activity per (noteId, typeId): remove any extras keeping the best candidate
        const allOfType = await db.activities
          .where('noteId').equals(noteLocalId)
          .filter(x => !x.deletedAt && x.typeId === a.type_id)
          .toArray()
        if (allOfType.length > 1) {
          // Choose winner: prefer with serverId; tie-breaker by latest modifiedAt
          let winner = allOfType[0]
          for (const it of allOfType.slice(1)) {
            const prefer = (Number(!!it.serverId) - Number(!!winner.serverId)) || ((it.modifiedAt || '').localeCompare(winner.modifiedAt || ''))
            if (prefer > 0) winner = it
          }
          for (const it of allOfType) {
            if (it.id !== winner.id) await db.activities.delete(it.id!)
          }
        }
      }
    }
  })

  await setKV(LAST_SYNC_KV, maxSyncAt)

  try { window.dispatchEvent(new Event('focuz:sync-applied')) } catch {}

  return { pulled }
}

let syncTimer: number | null = null
let ws: WebSocket | null = null
let wsRetryMs = 1000
let syncQueued = false
let syncRunning = false
let backoffUntilMs = 0
let lastSyncAtMs = 0
let lastWSTriggerMs = 0

// Background control & cleanup handles
let stopRequested = false
let baselineIntervalId: number | null = null
let wsRetryTimeoutId: number | null = null
let onOnline: (() => void) | null = null
let onFocus: (() => void) | null = null
let onVisibilityChange: (() => void) | null = null
let lastCleanup: (() => void) | null = null

export async function runSync(force = false): Promise<void> {
  if (stopRequested) return
  const now = Date.now()
  if (!force && now < backoffUntilMs) return
  if (syncRunning) { syncQueued = true; return }
  syncRunning = true
  try {
    const pushed = await pushDirty()
    const pulled = await pullSince()
    lastSyncAtMs = Date.now()
    if ((pushed.applied ?? 0) === 0 && (pulled.pulled ?? 0) === 0) {
      backoffUntilMs = lastSyncAtMs + NO_CHANGE_BACKOFF_MS
    } else {
      backoffUntilMs = 0
    }
  } finally {
    syncRunning = false
    if (syncQueued) {
      syncQueued = false
      setTimeout(() => runSync(), 0)
    }
  }
}

export function scheduleAutoSync() {
  stopRequested = false
  const kick = () => {
    if (syncTimer) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => runSync(true), DEBOUNCE_LOCAL_MS)
  }

  onOnline = () => runSync()
  onFocus = () => { runSync() }
  onVisibilityChange = () => { if (document.visibilityState === 'visible') { runSync() } }
  window.addEventListener('online', onOnline)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)

  // Periodic baseline sync
  baselineIntervalId = window.setInterval(() => runSync(), BASE_SYNC_INTERVAL_MS)

  // Best-effort websocket to get nudges from server when other sessions push
  const connectWS = () => {
    try {
      if (stopRequested) return
      if (!API_BASE) return
      const token = getAuthToken()
      if (!token) return
      const url = new URL(API_BASE)
      const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${wsProto}//${url.host}/ws?token=${encodeURIComponent(token)}`
      ws = new WebSocket(wsUrl, [])
      ws.onopen = () => { wsRetryMs = 1000 }
      ws.onmessage = () => {
        const now = Date.now()
        if (now - lastWSTriggerMs < WS_COOLDOWN_MS) return
        lastWSTriggerMs = now
        runSync()
      }
      ws.onclose = () => {
        ws = null
        if (stopRequested) return
        wsRetryTimeoutId = window.setTimeout(connectWS, wsRetryMs)
        wsRetryMs = Math.min(wsRetryMs * 2, 30000)
      }
      ws.onerror = () => { try { ws?.close() } catch {} }
    } catch {
      if (stopRequested) return
      wsRetryTimeoutId = window.setTimeout(connectWS, wsRetryMs)
      wsRetryMs = Math.min(wsRetryMs * 2, 30000)
    }
  }

  connectWS()
  // also start background job processing loop
  startJobWorker()
  const cleanup = () => {
    stopRequested = true
    if (syncTimer) { window.clearTimeout(syncTimer); syncTimer = null }
    if (jobTimer) { window.clearTimeout(jobTimer); jobTimer = null }
    if (baselineIntervalId) { window.clearInterval(baselineIntervalId); baselineIntervalId = null }
    if (ws) { try { ws.close(1000, 'logout') } catch {}; ws = null }
    if (wsRetryTimeoutId) { window.clearTimeout(wsRetryTimeoutId); wsRetryTimeoutId = null }
    if (onOnline) { window.removeEventListener('online', onOnline); onOnline = null }
    if (onFocus) { window.removeEventListener('focus', onFocus); onFocus = null }
    if (onVisibilityChange) { document.removeEventListener('visibilitychange', onVisibilityChange); onVisibilityChange = null }
  }
  lastCleanup = cleanup
  return { kick, cleanup }
}

async function processOneJob(): Promise<boolean> {
  if (stopRequested) return false
  if (!navigator.onLine || isAuthRequired() || !getAuthToken()) return false
  const job = await db.jobs.orderBy('priority').first()
  if (!job) return false
  await db.jobs.update(job.id!, { status: 'running', updatedAt: new Date().toISOString() })
  try {
    if (job.kind === 'attachment-upload') {
      const att = await db.attachments.get(job.attachmentId)
      if (!att || att.deletedAt) throw new Error('Attachment missing')
      const note = await db.notes.get(att.noteId)
      if (!note?.serverId) return false // wait until note mapped to server
      const form = new FormData()
      const blob = (att.data as Blob) || new Blob()
      form.append('file', blob, att.fileName)
      form.append('note_id', String(note.serverId))
      const resp = await apiMultipart('/upload', form)
      const serverId = (resp?.data?.attachment_id as string | undefined) || (resp?.data?.id as string | undefined)
      await db.transaction('rw', db.attachments, async () => {
        if (serverId) {
          // If another record with same serverId already exists (from pull), merge and dedupe
          const existing = await db.attachments.where('serverId').equals(serverId).first()
          if (existing && existing.id !== att.id) {
            const preferCurrent = !!att.data && !existing.data
            const source = preferCurrent ? att : existing
            const target = preferCurrent ? existing : att
            // Move data if needed
            if (!target.data && source.data) {
              await db.attachments.update(target.id!, { data: source.data })
            }
            // Ensure serverId set on target
            await db.attachments.update(target.id!, { serverId, isDirty: 0 })
            // Remove the duplicate source record
            await db.attachments.delete(source.id!)
          } else {
            await db.attachments.update(att.id!, { serverId, isDirty: 0 })
          }
        } else {
          await db.attachments.update(att.id!, { isDirty: 0 })
        }
      })
    } else if (job.kind === 'attachment-download') {
      const att = await db.attachments.get(job.attachmentId)
      if (!att?.serverId) { await db.jobs.delete(job.id!); return true }
      // get signed URL
      const meta = await api(`/files/${encodeURIComponent(att.serverId)}`, { method: 'GET' })
      const url = meta?.data?.url || meta?.data?.URL || meta?.data?.signedUrl || meta?.data?.signed_url
      if (!url) throw new Error('No URL')
      const res = await fetch(url)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      await db.attachments.update(att.id!, { data: blob, modifiedAt: new Date().toISOString() })
    }
    await db.jobs.delete(job.id!)
    return true
  } catch (e) {
    const attempts = (job.attempts ?? 0) + 1
    await db.jobs.update(job.id!, { status: 'failed', attempts, updatedAt: new Date().toISOString() })
    return false
  }
}

let jobTimer: number | null = null
function startJobWorker() {
  const tick = async () => {
    const did = await processOneJob()
    const delay = did ? 0 : 2000
    jobTimer = window.setTimeout(tick, delay)
  }
  if (jobTimer) window.clearTimeout(jobTimer)
  tick()
}

async function ensureDownloadJob(attachmentLocalId: number, priority = 10): Promise<void> {
  // Skip if job already exists
  const existing = await db.jobs.where('attachmentId').equals(attachmentLocalId).filter(j => j.kind === 'attachment-download').first()
  if (existing) return
  // Ensure attachment exists and its parent note is not deleted
  const att = await db.attachments.get(attachmentLocalId)
  if (!att) return
  const note = await db.notes.get(att.noteId)
  if (!note || !!note.deletedAt) return
  const now = new Date().toISOString()
  await db.jobs.add({ kind: 'attachment-download', attachmentId: attachmentLocalId, priority, status: 'pending', attempts: 0, createdAt: now, updatedAt: now } as JobRecord)
}

const prefetchCooldownMs = 5000
const lastPrefetchByAttachment = new Map<number, number>()
export async function requestAttachmentPrefetch(attachmentLocalId: number, priority = 1): Promise<void> {
  const now = Date.now()
  const last = lastPrefetchByAttachment.get(attachmentLocalId) || 0
  if (now - last < prefetchCooldownMs) return
  lastPrefetchByAttachment.set(attachmentLocalId, now)
  await ensureDownloadJob(attachmentLocalId, priority)
}

export async function setAuthToken(token: string) {
  await ensureDbOpen().catch(() => {})
  localStorage.setItem(TOKEN_KV, token)
  emitAuthRequired(false)
  await runSync(true)
}

export async function getCurrentSpaceId(): Promise<number> {
  const id = await getKV<number>(CURRENT_SPACE_KV)
  if (id) return id
  return ensureDefaultSpace()
} 

export function teardownSync(): void {
  stopRequested = true
  if (lastCleanup) {
    try { lastCleanup() } catch {}
    lastCleanup = null
  }
}

// Cross-tab listener to stop background work and drop DB on logout elsewhere
try {
  authBC?.addEventListener('message', (msg: MessageEvent) => {
    if (msg?.data?.type === 'logout') {
      try { teardownSync() } catch {}
      deleteDatabaseWithRetry(4000).catch(() => { wipeLocalData().catch(() => {}) })
      try { emitAuthRequired(true) } catch {}
    }
  })
} catch {}