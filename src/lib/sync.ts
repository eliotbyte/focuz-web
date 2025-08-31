import { db, getKV, setKV, wipeLocalData } from './db'
import type { FilterRecord, NoteRecord, SpaceRecord, TagRecord } from './types'

const API_BASE = (import.meta as any).env.VITE_API_BASE_URL as string | undefined
const SYNC_INTERVAL_MS = 5 * 1000
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

export async function register(username: string, password: string): Promise<void> {
  await api('/register', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export async function login(username: string, password: string): Promise<void> {
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
  wipeLocalData().catch(() => {})
  setKV(CURRENT_SPACE_KV, undefined).catch(() => {})
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
    parent_id: null,
  }
}

function toFilterChange(f: FilterRecord) {
  return {
    id: f.serverId ?? null,
    space_id: 0,
    user_id: undefined,
    parent_id: null,
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

  const [notes, filters, tags] = await Promise.all([
    db.notes.where('isDirty').equals(1).toArray(),
    db.filters.where('isDirty').equals(1).toArray(),
    db.tags.where('isDirty').equals(1).toArray(),
  ])

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
  if (notesForSync.length + filters.length + tags.length === 0) return { applied: 0 }

  const spaceServerIdByLocal = new Map<number, number>()
  async function toServerSpaceId(localId: number): Promise<number> {
    if (spaceServerIdByLocal.has(localId)) return spaceServerIdByLocal.get(localId)!
    const sid = await awaitSpaceIdToServer(localId)
    spaceServerIdByLocal.set(localId, sid)
    return sid
  }

  const notesPayload = await Promise.all(notesForSync.map(async (n) => ({ ...toNoteChange(n), space_id: await toServerSpaceId(n.spaceId) })))
  const filtersPayload = await Promise.all(filters.map(async (f) => ({ ...toFilterChange(f), space_id: await toServerSpaceId(f.spaceId) })))
  const tagsPayload = await Promise.all(tags.map(async (t) => ({ ...toTagChange(t), space_id: await toServerSpaceId(t.spaceId) })))

  const resp = await api('/sync', {
    method: 'POST',
    body: JSON.stringify({ notes: notesPayload, filters: filtersPayload, tags: tagsPayload, charts: [], activities: [] }),
  })

  const mappings: Array<{ resource: string; clientId: string; serverId: number }> = resp?.data?.mappings ?? []

  await db.transaction('rw', db.notes, db.filters, db.tags, async () => {
    for (const n of notesForSync) await db.notes.update(n.id!, { isDirty: 0 })
    for (const f of filters) await db.filters.update(f.id!, { isDirty: 0 })
    for (const t of tags) await db.tags.update(t.id!, { isDirty: 0 })
    for (const m of mappings) {
      if (m.resource === 'note' || m.resource === 'notes') {
        const local = await db.notes.where('clientId').equals(m.clientId).first()
        if (local) await db.notes.update(local.id!, { serverId: m.serverId })
        // Deduplicate: if multiple notes now share the same serverId, keep the one with a clientId (local) if exists
        const withSame = await db.notes.where('serverId').equals(m.serverId).toArray()
        if (withSame.length > 1) {
          const keep = withSame.find(n => !!n.clientId) ?? withSame[0]
          for (const x of withSame) {
            if (x.id !== keep.id) {
              await db.notes.delete(x.id!)
            }
          }
        }
      }
    }
  })

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

  let pulled = 0
  await db.transaction('rw', db.spaces, db.notes, db.tags, db.filters, async () => {
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
  })

  // Only move forward to what the server told us exists. If nothing new, keep since unchanged.
  // Use a small overlap window (1ms) because server uses strict '>' comparison.
  const nextSince = (() => {
    try {
      const t = Date.parse(maxSyncAt)
      if (Number.isFinite(t)) return new Date(t - 1).toISOString()
    } catch {}
    return maxSyncAt
  })()
  await setKV(LAST_SYNC_KV, nextSince)
  return { pulled }
}

let syncTimer: number | undefined
let ws: WebSocket | null = null
let wsRetryMs = 1000
let syncRunning = false
let syncQueued = false

export async function runSync(): Promise<void> {
  if (syncRunning) { syncQueued = true; return }
  if (isAuthRequired()) return
  syncRunning = true
  try {
    await pushDirty()
    await pullSince()
  } catch (e) {
    console.debug('sync error', e)
  } finally {
    syncRunning = false
    if (syncQueued) {
      syncQueued = false
      // run again immediately to process any events queued during the last run
      // avoid stack growth
      setTimeout(() => runSync(), 0)
    }
  }
}

export function scheduleAutoSync() {
  const kick = () => {
    if (syncTimer) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => runSync(), 1500)
  }

  window.addEventListener('online', () => runSync())
  window.addEventListener('focus', () => { runSync(); kick() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { runSync(); kick() }
  })

  setInterval(() => runSync(), SYNC_INTERVAL_MS)

  // Best-effort websocket to get nudges from server when other sessions push
  const connectWS = () => {
    try {
      if (!API_BASE) return
      const token = getAuthToken()
      if (!token) return
      const url = new URL(API_BASE)
      const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${wsProto}//${url.host}/ws?token=${encodeURIComponent(token)}`
      ws = new WebSocket(wsUrl, [])
      ws.onopen = () => { wsRetryMs = 1000 }
      ws.onmessage = () => { runSync() }
      ws.onclose = () => {
        ws = null
        setTimeout(connectWS, wsRetryMs)
        wsRetryMs = Math.min(wsRetryMs * 2, 30000)
      }
      ws.onerror = () => { try { ws?.close() } catch {} }
      // Attach token via header is not possible in browser WS; fallback to bearer via initial HTTP group auth.
      // Since /ws is under auth group, ensure the app uses an auth-bearing cookie or proxy. If not, ignore silently.
    } catch {
      setTimeout(connectWS, wsRetryMs)
      wsRetryMs = Math.min(wsRetryMs * 2, 30000)
    }
  }
  connectWS()
  return { kick }
}

export async function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KV, token)
  emitAuthRequired(false)
  await runSync()
}

export async function getCurrentSpaceId(): Promise<number> {
  const id = await getKV<number>(CURRENT_SPACE_KV)
  if (id) return id
  return ensureDefaultSpace()
} 