import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setKV, getKV } from './lib/db'
import type { NoteRecord, FilterRecord, SpaceRecord } from './lib/types'
import { ensureDefaultSpace, getCurrentSpaceId, runSync, scheduleAutoSync, login, register, isAuthenticated, logout, deleteNote, onAuthRequired, isAuthRequired, getLastUsername } from './lib/sync'
import { updateNoteLocal } from './lib/sync'
import { searchNotes, ensureNoteIndexForSpace, initSearch } from './lib/search'
import HighlightedText from './components/HighlightedText'
import Toasts from './components/Toasts'
import { formatRelativeShort } from './lib/time'
import { formatExactDateTime } from './lib/time'
import NoteEditor, { type NoteEditorValue } from './components/NoteEditor'

function TopBar({ onOpenSpaces, onOpenSettings, onLogout, isThread, onBack }: { onOpenSpaces: () => void; onOpenSettings: () => void; onLogout: () => void; isThread?: boolean; onBack?: () => void }) {
  return (
    <header className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        {isThread ? (
          <button className="button" onClick={onBack}>←</button>
        ) : (
          <button className="button" onClick={onOpenSpaces}>☰</button>
        )}
        <h1 className="text-xl font-semibold">focuz</h1>
      </div>
      <div className="flex items-center gap-2">
        <button className="button" onClick={onOpenSettings}>⚙️</button>
        <button className="button" onClick={onLogout}>Logout</button>
      </div>
    </header>
  )
}

function Settings({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme || 'dark')
  function save() {
    document.documentElement.dataset.theme = theme
    onClose()
  }
  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50">
      <div className="w-full sm:max-w-md bg-neutral-900 border border-neutral-800 rounded-t-xl sm:rounded-xl p-4 space-y-3">
        <h2 className="text-lg font-medium">Settings</h2>
        <div className="space-y-2">
          <label className="text-sm text-neutral-400">Theme</label>
          <select className="input" value={theme} onChange={e => setTheme(e.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

function AuthScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setLoading(true)
    setError(null)
    try {
      if (mode === 'register') {
        if (password !== password2) throw new Error('Passwords do not match')
        await register(username.trim(), password)
      }
      await login(username.trim(), password)
      await ensureDefaultSpace()
      await runSync()
      onDone()
    } catch (e: any) {
      setError(e?.message || 'Auth failed')
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = username.trim().length >= 3 && password.length >= 8 && (mode === 'login' || password === password2)

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-sm card space-y-4">
        <h2 className="text-lg font-medium">{mode === 'register' ? 'Create account' : 'Sign in'}</h2>
        <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className="input" placeholder="Password" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} />
            <button className="button" onClick={() => setShow(s => !s)} type="button">{show ? 'Hide' : 'Show'}</button>
          </div>
          {mode === 'register' && (
            <input className="input" placeholder="Confirm password" type={show ? 'text' : 'password'} value={password2} onChange={e => setPassword2(e.target.value)} />
          )}
        </div>
        {error && <div className="text-sm text-red-400">{error}</div>}
        <div className="flex justify-between items-center">
          <button className="button" onClick={() => setMode(mode === 'register' ? 'login' : 'register')} type="button">
            {mode === 'register' ? 'Have an account? Sign in' : "No account? Create new"}
          </button>
          <button className="button" onClick={submit} disabled={!canSubmit || loading}>{loading ? '...' : (mode === 'register' ? 'Register & Sign in' : 'Sign in')}</button>
        </div>
      </div>
    </div>
  )
}

function SpaceDrawer({ open, onClose, currentId, onSelected }: { open: boolean; onClose: () => void; currentId?: number | null; onSelected?: (id: number) => void }) {
  const spaces = useLiveQuery(() => db.spaces.orderBy('createdAt').toArray(), []) ?? []
  async function selectSpace(id: number) {
    await setKV('currentSpaceId', id)
    await runSync()
    if (onSelected) onSelected(id)
    else onClose()
  }
  return (
    <div className={`fixed inset-0 z-40 transition ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/60 ${open ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <aside className={`absolute left-0 top-0 h-full w-72 bg-neutral-900 border-r border-neutral-800 p-4 ${open ? '' : '-translate-x-full'} transition-transform`}>
        <h2 className="text-lg font-medium mb-3">Spaces</h2>
        <ul className="space-y-2">
          {spaces.map((s: SpaceRecord) => (
            <li key={s.id}>
              <button className={`w-full text-left input ${currentId === s.id ? 'border-sky-500' : ''}`} onClick={() => selectSpace(s.id!)}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

function FiltersList({ spaceId, onSelect }: { spaceId: number; onSelect: (f: FilterRecord | null) => void }) {
  const filters = useLiveQuery(() => db.filters.where('spaceId').equals(spaceId).filter(f => !f.deletedAt).toArray(), [spaceId]) ?? []
  async function addDefault() {
    const now = new Date().toISOString()
    const id = await db.filters.add({
      name: 'All notes',
      params: { sort: 'modifiedat,DESC' },
      spaceId,
      parentId: null,
      serverId: null,
      createdAt: now,
      modifiedAt: now,
      deletedAt: null,
      isDirty: 1,
    })
    window.dispatchEvent(new Event('focuz:local-write'))
    const rec = await db.filters.get(id)
    onSelect(rec!)
  }
  return (
    <aside className="hidden md:block w-64 shrink-0">
      <div className="card">
        <div className="mb-2 font-medium">Filters</div>
        <ul className="space-y-2">
          {filters.map(f => (
            <li key={f.id}>
              <button className="w-full text-left input" onClick={() => onSelect(f)}>{f.name}</button>
            </li>
          ))}
          {filters.length === 0 && <div className="text-sm text-neutral-400">No filters</div>}
        </ul>
        <div className="mt-3 flex justify-end">
          <button className="button" onClick={addDefault}>+ Add</button>
        </div>
      </div>
    </aside>
  )
}

type SortField = 'date' | 'createdat' | 'modifiedat'

function QuickFiltersPanel({
  value,
  onChange,
  hideNoParents = false,
}: {
  value: { text: string; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }
  onChange: (v: { text: string; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }) => void
  hideNoParents?: boolean
}) {
  const [text, setText] = useState(value.text)
  const [noParents, setNoParents] = useState(value.noParents)
  const [sortField, setSortField] = useState<SortField>(value.sort.split(',')[0] as SortField)
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>(value.sort.split(',')[1] as 'ASC' | 'DESC')

  useEffect(() => { setText(value.text); setNoParents(value.noParents); setSortField(value.sort.split(',')[0] as SortField); setSortDir(value.sort.split(',')[1] as 'ASC' | 'DESC') }, [value])

  return (
    <aside className="hidden lg:block w-64 shrink-0">
      <div className="card space-y-3">
        <div className="mb-1 font-medium">Quick filters</div>
        <input className="input" placeholder="Search" value={text} onChange={e => { const v = e.target.value; setText(v); onChange({ text: v, noParents, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }} />
        {!hideNoParents && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noParents} onChange={e => { setNoParents(e.target.checked); onChange({ text, noParents: e.target.checked, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }} />
            No parents
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={sortField} onChange={e => { const f = e.target.value as SortField; setSortField(f); onChange({ text, noParents, sort: `${f},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }}>
            <option value="modifiedat">modified_at</option>
            <option value="createdat">created_at</option>
            <option value="date">date</option>
          </select>
          <select className="input" value={sortDir} onChange={e => { const d = e.target.value as 'ASC' | 'DESC'; setSortDir(d); onChange({ text, noParents, sort: `${sortField},${d}` as `${SortField},ASC` | `${SortField},DESC` }) }}>
            <option value="DESC">desc</option>
            <option value="ASC">asc</option>
          </select>
        </div>
      </div>
    </aside>
  )
}

function NoteComposer({ spaceId }: { spaceId: number }) {
  const [value, setValue] = useState<NoteEditorValue>({ text: '', tags: [] })
  const canAdd = useMemo(() => value.text.trim().length > 0, [value.text])

  async function addNote() {
    if (!canAdd) return
    const now = new Date().toISOString()
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: value.tags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId: null,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    }
    await db.notes.add(payload)
    window.dispatchEvent(new Event('focuz:local-write'))
    setValue({ text: '', tags: [] })
  }

  return (
    <NoteEditor value={value} onChange={setValue} onSubmit={addNote} onCancel={() => setValue({ text: '', tags: [] })} mode="create" spaceId={spaceId} />
  )
}

function NoteList({ spaceId, filter, quick, parentId, onOpenThread }: { spaceId: number; filter: FilterRecord | null; quick: { text: string; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }; parentId?: number | null; onOpenThread?: (noteId: number) => void }) {
  const [idsBySearch, setIdsBySearch] = useState<number[] | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState<{ text: string; tags: string[] }>({ text: '', tags: [] })
  const [replyingForId, setReplyingForId] = useState<number | null>(null)

  useEffect(() => {
    ensureNoteIndexForSpace(spaceId).catch(() => {})
  }, [spaceId])

  useEffect(() => {
    let cancelled = false
    const q = (quick.text || '').trim()
    if (!q) { setIdsBySearch(null); return }
    searchNotes(spaceId, q).then(ids => { if (!cancelled) setIdsBySearch(ids) }).catch(() => { if (!cancelled) setIdsBySearch([]) })
    return () => { cancelled = true }
  }, [spaceId, quick.text])

  useEffect(() => {
    if (editingId != null) {
      const n = notes.find(x => x.id === editingId)
      if (n) setEditingValue({ text: n.text, tags: n.tags || [] })
    }
  }, [editingId])

  // Reset replying editor on filter/quick changes and when thread parent changes
  useEffect(() => {
    setReplyingForId(null)
  }, [JSON.stringify(quick), JSON.stringify(filter?.params ?? {}), parentId ?? null])

  const notes = useLiveQuery(async () => {
    let coll = db.notes
      .where('spaceId')
      .equals(spaceId)
      .filter(n => !n.deletedAt)
    const arr = await coll.toArray()
    let result = arr

    if (idsBySearch) {
      const set = new Set(idsBySearch)
      result = result.filter(n => set.has(n.id!))
      // keep order by search ranking for equal sort later
      const rank = new Map(idsBySearch.map((id, i) => [id, i]))
      result.sort((a,b) => (rank.get(a.id!)! - rank.get(b.id!)!))
    } else if (filter?.params?.textContains) {
      const q = filter.params.textContains.toLowerCase()
      result = result.filter(n => n.text.toLowerCase().includes(q))
    }

    if (parentId != null) {
      result = result.filter(n => (n.parentId ?? null) === parentId)
    } else if (quick.noParents || filter?.params?.notReply) {
      result = result.filter(n => (n.parentId ?? null) === null)
    }
    if (filter?.params?.includeTags?.length) {
      result = result.filter(n => filter!.params!.includeTags!.every(t => n.tags.includes(t)))
    }
    if (filter?.params?.excludeTags?.length) {
      result = result.filter(n => !filter!.params!.excludeTags!.some(t => n.tags.includes(t)))
    }

    const sort = quick.sort || filter?.params?.sort || 'modifiedat,DESC'
    result.sort((a, b) => {
      const field = (typeof sort === 'string' ? sort.split(',')[0] : 'modifiedat') as SortField
      const dir = (typeof sort === 'string' ? sort.split(',')[1] : 'DESC') as 'ASC' | 'DESC'
      const aKey = field === 'createdat' ? (a.createdAt) : field === 'modifiedat' ? (a.modifiedAt) : (a.date || a.createdAt)
      const bKey = field === 'createdat' ? (b.createdAt) : field === 'modifiedat' ? (b.modifiedAt) : (b.date || b.createdAt)
      const cmp = aKey.localeCompare(bKey)
      return dir === 'ASC' ? cmp : -cmp
    })

    return result
  }, [spaceId, JSON.stringify(filter?.params ?? {}), JSON.stringify(quick), JSON.stringify(idsBySearch), parentId ?? null]) ?? []

  // Parent previews for feed (not for thread replies)
  const parentIds = useMemo(() => {
    if (parentId != null) return [] as number[]
    const set = new Set<number>()
    for (const n of notes) {
      const pid = n.parentId ?? null
      if (pid != null) set.add(pid)
    }
    return Array.from(set)
  }, [notes, parentId])
  const parentPreviewById = useLiveQuery(async () => {
    if (!parentIds.length) return new Map<number, NoteRecord>()
    const rows = await db.notes.bulkGet(parentIds)
    const map = new Map<number, NoteRecord>()
    parentIds.forEach((id, i) => {
      const rec = rows[i]
      if (rec && !rec.deletedAt) map.set(id, rec)
    })
    return map
  }, [JSON.stringify(parentIds)]) || new Map<number, NoteRecord>()

  // Count replies across the whole space, not only the filtered list
  const repliesById = useLiveQuery(async () => {
    const all = await db.notes
      .where('spaceId')
      .equals(spaceId)
      .filter(n => !n.deletedAt)
      .toArray()
    const tally = new Map<number, number>()
    for (const note of all) {
      const pid = note.parentId ?? null
      if (pid !== null) tally.set(pid, (tally.get(pid) || 0) + 1)
    }
    return tally
  }, [spaceId]) || new Map<number, number>()

  async function removeNote(id: number) {
    await deleteNote(id)
    window.dispatchEvent(new Event('focuz:local-write'))
    // Toast with undo
    try {
      const { addToast } = await import('./lib/toast')
      addToast({ message: 'Note deleted', action: { type: 'undo-delete-note', label: 'Undo', payload: { noteId: id } } })
    } catch {}
  }

  async function saveEdit(id: number, value: { text: string; tags: string[] }) {
    await updateNoteLocal(id, { text: value.text.trim(), tags: value.tags })
    window.dispatchEvent(new Event('focuz:local-write'))
    setEditingId(null)
  }

  const [replyValue, setReplyValue] = useState<{ text: string; tags: string[] }>({ text: '', tags: [] })

  async function addInlineReply(parent: NoteRecord, value: { text: string; tags: string[] }) {
    const canAdd = value.text.trim().length > 0
    if (!canAdd) return
    const now = new Date().toISOString()
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: value.tags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId: parent.id!,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    }
    await db.notes.add(payload)
    window.dispatchEvent(new Event('focuz:local-write'))
    setReplyingForId(null)
    setReplyValue({ text: '', tags: [] })
  }

  return (
    <ul className="space-y-4">
      {notes.flatMap((n: NoteRecord) => {
        const items: ReactNode[] = []
        // Note item (either editor replacing the note, or the note card)
        items.push(
          <li key={n.id}>
            {editingId === n.id ? (
              <NoteEditor
                value={editingValue}
                onChange={setEditingValue}
                onSubmit={() => saveEdit(n.id!, editingValue)}
                onCancel={() => setEditingId(null)}
                mode="edit"
                autoCollapse={false}
                variant="card"
                spaceId={spaceId}
              />
            ) : (
              <div className="card-nopad">
                {/* Top bar (30px height) */}
                <div className="h-[30px] relative">
                  <div className="absolute right-4 top-0 h-[30px] flex items-center">
                    <button
                      className="px-1 text-neutral-400 hover:text-neutral-100 h-[30px]"
                      onClick={() => setMenuOpenId(menuOpenId === n.id ? null : n.id!)}
                      aria-label="Open menu"
                    >
                      ⋯
                    </button>
                    {menuOpenId === n.id && (
                      <div className="absolute right-0 mt-1 z-10 rounded border border-neutral-800 bg-neutral-900 shadow-lg">
                        <button className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => { setMenuOpenId(null); setEditingId(n.id!); setEditingValue({ text: n.text, tags: n.tags || [] }) }}>Edit</button>
                        <button className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => { setMenuOpenId(null); removeNote(n.id!) }}>Delete</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Middle body: text */}
                <div className="px-4 min-w-0">
                  {/* Parent preview chip (only in feed, not in thread replies) */}
                  {parentId == null && (n.parentId ?? null) != null && parentPreviewById.get(n.parentId!) && (
                    <div className="mb-2 min-w-0 max-w-full">
                      <button
                        className="block w-full max-w-full box-border rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-secondary hover:bg-neutral-800 select-none overflow-hidden text-left"
                        type="button"
                        onClick={() => onOpenThread && onOpenThread(n.parentId!)}
                        title={parentPreviewById.get(n.parentId!)!.text}
                      >
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{parentPreviewById.get(n.parentId!)!.text}</span>
                      </button>
                    </div>
                  )}
                  <HighlightedText className="block whitespace-pre-wrap leading-6 text-primary" text={n.text} query={(quick.text || filter?.params?.textContains || '') as string} />
                  {n.tags?.length ? (
                    <div className="mt-2 text-secondary">
                      {n.tags.join(', ')}
                    </div>
                  ) : null}
                </div>

                {/* Bottom bar */}
                <div className="px-4 py-2 text-secondary flex items-center justify-between">
                  <button className="flex items-center gap-2 text-neutral-400 hover:text-neutral-100" title={formatExactDateTime(n.createdAt)} onClick={() => onOpenThread && onOpenThread(n.id!)}>
                    <span>{n.isDirty ? '✔' : '✔✔'}</span>
                    <span>{formatRelativeShort(n.createdAt)}</span>
                  </button>
                  <div className="flex items-center gap-3">
                    { (repliesById.get(n.id!) || 0) > 0 && (
                      <button className="text-neutral-400 hover:text-neutral-100 transition" type="button" onClick={() => onOpenThread && onOpenThread(n.id!)}>
                        ({repliesById.get(n.id!)})
                      </button>
                    )}
                    <button className="text-neutral-400 hover:text-neutral-100 transition" type="button" onClick={() => setReplyingForId(replyingForId === n.id ? null : n.id!)}>
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </li>
        )
        // Reply form as a separate full card item below the note
        if (replyingForId === n.id) {
          items.push(
            <li key={`reply-form-${n.id}`}>
              <NoteEditor
                value={replyValue}
                onChange={setReplyValue}
                onSubmit={() => addInlineReply(n, replyValue)}
                onCancel={() => setReplyingForId(null)}
                mode="reply"
                autoCollapse={false}
                variant="card"
                defaultExpanded
                spaceId={spaceId}
              />
            </li>
          )
        }
        return items
      })}
      {notes.length === 0 && <li className="text-secondary">No notes</li>}
    </ul>
  )
}

function ReauthOverlay({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState<string>(getLastUsername() || '')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setLoading(true)
    setError(null)
    try {
      await login(username.trim(), password)
      await runSync()
      onDone()
    } catch (e: any) {
      setError(e?.message || 'Auth failed')
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = username.trim().length >= 3 && password.length >= 8

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-sm card space-y-4">
          <h2 className="text-lg font-medium">Session expired</h2>
          <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <div className="flex gap-2">
            <input className="input" placeholder="Password" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} />
            <button className="button" onClick={() => setShow(s => !s)} type="button">{show ? 'Hide' : 'Show'}</button>
          </div>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <div className="flex justify-end">
            <button className="button" onClick={submit} disabled={!canSubmit || loading}>{loading ? '...' : 'Sign in'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authed, setAuthed] = useState<boolean>(isAuthenticated())
  const [currentSpaceId, setCurrentSpaceId] = useState<number | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<FilterRecord | null>(null)
  const [needReauth, setNeedReauth] = useState<boolean>(() => isAuthRequired())
  const [currentNoteId, setCurrentNoteId] = useState<number | null>(null)
  // In-memory back trail within tab. Oldest -> newest. Excludes current page. null represents feed (space root)
  const historyTrailRef = useRef<Array<number | null>>([])

  const [quickFeed, setQuickFeed] = useState<{ text: string; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }>({ text: '', noParents: false, sort: 'modifiedat,DESC' })
  const [quickThread, setQuickThread] = useState<{ text: string; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }>({ text: '', noParents: false, sort: 'modifiedat,DESC' })

  useEffect(() => {
    const off = onAuthRequired(setNeedReauth)
    return () => { off() }
  }, [])

  // URL helpers
  function parseQuery(): { space?: number; note?: number } {
    const p = new URLSearchParams(location.search)
    const space = p.get('space')
    const note = p.get('note')
    return { space: space ? Number(space) : undefined, note: note ? Number(note) : undefined }
  }
  function pushQuery(next: { space: number; note?: number | null }, replace = false) {
    const params = new URLSearchParams()
    params.set('space', String(next.space))
    if (next.note != null) params.set('note', String(next.note))
    const url = `${location.pathname}?${params.toString()}`
    if (replace) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = (document.documentElement.dataset.theme || 'dark')
    initSearch().catch(() => {})
    if (!authed) return

    // initial from URL
    const { space, note } = parseQuery()
    ensureDefaultSpace().then(async () => {
      const id = space || await getCurrentSpaceId()
      setCurrentSpaceId(id)
      setCurrentNoteId(note ?? null)
      historyTrailRef.current = note ? [null] : []
      // load persisted quick filters
      if (note) {
        const saved = await getKV<typeof quickThread>(`quick:space:${id}:note:${note}`)
        if (saved) setQuickThread(saved)
      } else {
        const saved = await getKV<typeof quickFeed>(`quick:space:${id}`)
        if (saved) setQuickFeed(saved)
      }
      await ensureNoteIndexForSpace(id)
      await runSync()
      setTimeout(() => { runSync() }, 1000)
      // normalize URL
      pushQuery({ space: id, note: note ?? null }, true)
    })

    const onPop = () => {
      const { space: s, note: n } = parseQuery()
      if (s) setCurrentSpaceId(s)
      setCurrentNoteId(n ?? null)
    }
    window.addEventListener('popstate', onPop)

    const { kick } = scheduleAutoSync()
    const onLocalWrite = () => kick()
    window.addEventListener('focuz:local-write', onLocalWrite)
    return () => {
      window.removeEventListener('focuz:local-write', onLocalWrite)
      window.removeEventListener('popstate', onPop)
    }
  }, [authed])

  function openThread(noteId: number) {
    if (!currentSpaceId) return
    // Update in-tab trail: collapse to before existing target, or push current
    {
      const prev = historyTrailRef.current
      const idx = prev.findIndex(x => x === noteId)
      if (idx !== -1) {
        historyTrailRef.current = prev.slice(0, idx)
      } else if (currentNoteId !== noteId) {
        historyTrailRef.current = [...prev, currentNoteId ?? null]
      }
    }
    setCurrentNoteId(noteId)
    pushQuery({ space: currentSpaceId, note: noteId })
    // load thread quick
    void (async () => {
      const key = `quick:space:${currentSpaceId}:note:${noteId}`
      const saved = await getKV<typeof quickThread>(key)
      if (saved) setQuickThread(saved)
    })()
  }
  function openSpace(spaceId: number) {
    setCurrentSpaceId(spaceId)
    setCurrentNoteId(null)
    historyTrailRef.current = []
    pushQuery({ space: spaceId, note: null })
    // load feed quick for space
    void (async () => {
      const key = `quick:space:${spaceId}`
      const saved = await getKV<typeof quickFeed>(key)
      if (saved) setQuickFeed(saved)
    })()
  }

  function goBack() {
    if (!currentSpaceId) return
    const prev = historyTrailRef.current
    if (prev.length === 0) {
      // back to feed
      setCurrentNoteId(null)
      pushQuery({ space: currentSpaceId, note: null })
      // load feed quick
      void (async () => {
        const saved = await getKV<typeof quickFeed>(`quick:space:${currentSpaceId}`)
        if (saved) setQuickFeed(saved)
      })()
      return
    }
    const next = prev.slice(0, -1)
    const target = prev[prev.length - 1]
    historyTrailRef.current = next
    setCurrentNoteId(target ?? null)
    pushQuery({ space: currentSpaceId, note: target ?? null })
    // load respective quick
    void (async () => {
      if (target == null) {
        const saved = await getKV<typeof quickFeed>(`quick:space:${currentSpaceId}`)
        if (saved) setQuickFeed(saved)
      } else {
        const saved = await getKV<typeof quickThread>(`quick:space:${currentSpaceId}:note:${target}`)
        if (saved) setQuickThread(saved)
      }
    })()
  }

  if (!authed) return <AuthScreen onDone={() => setAuthed(true)} />

  const left = currentSpaceId ? <FiltersList spaceId={currentSpaceId} onSelect={setSelectedFilter} /> : null
  let center: ReactNode = null
  if (currentSpaceId) {
    if (currentNoteId) {
      center = (
        <NoteThread spaceId={currentSpaceId} noteId={currentNoteId} onBack={goBack} onOpenThread={openThread} />
      )
    } else {
      center = (
        <div className="flex-1 min-w-0 space-y-[15px]">
          <NoteComposer spaceId={currentSpaceId} />
          <NoteList spaceId={currentSpaceId} filter={selectedFilter} quick={quickFeed} onOpenThread={openThread} />
        </div>
      )
    }
  }

  return (
    <div className="container space-y-4">
      <TopBar onOpenSpaces={() => setDrawerOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onLogout={() => { logout(); setAuthed(false) }} isThread={!!currentNoteId} onBack={goBack} />
      <div className="flex gap-4">
        {left}
        {center}
        {currentNoteId
          ? <QuickFiltersPanel
              value={quickThread}
              onChange={(v) => { setQuickThread(v); if (currentSpaceId && currentNoteId) setKV(`quick:space:${currentSpaceId}:note:${currentNoteId}`, v) }}
              hideNoParents
            />
          : <QuickFiltersPanel
              value={quickFeed}
              onChange={(v) => { setQuickFeed(v); if (currentSpaceId) setKV(`quick:space:${currentSpaceId}` , v) }}
            />
        }
      </div>

      {drawerOpen && <SpaceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} currentId={currentSpaceId} onSelected={(id) => { openSpace(id) }} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {needReauth && <ReauthOverlay onDone={() => setNeedReauth(false)} />}
      <Toasts />
    </div>
  )
}

// Thread view components
function SingleNoteCard({ note, onEdit, onDelete, onOpenThread }: { note: NoteRecord; onEdit: () => void; onDelete: () => void; onOpenThread: (nid: number) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const parentNote = useLiveQuery(() => note.parentId ? db.notes.get(note.parentId) : Promise.resolve(undefined), [note.parentId]) as NoteRecord | undefined
  return (
    <div className="card-nopad">
      <div className="h-[30px] relative">
        <div className="absolute right-4 top-0 h-[30px] flex items-center">
          <button className="px-1 text-neutral-400 hover:text-neutral-100 h-[30px]" onClick={() => setMenuOpen(s => !s)} aria-label="Open menu">⋯</button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 z-10 rounded border border-neutral-800 bg-neutral-900 shadow-lg">
              <button className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => { setMenuOpen(false); onEdit() }}>Edit</button>
              <button className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => { setMenuOpen(false); onDelete() }}>Delete</button>
            </div>
          )}
        </div>
      </div>
      <div className="px-4 min-w-0">
        {note.parentId != null && parentNote && !parentNote.deletedAt && (
          <div className="mb-2 min-w-0 max-w-full">
            <button
              className="block w-full max-w-full min-w-0 box-border rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-secondary hover:bg-neutral-800 select-none overflow-hidden text-left"
              type="button"
              onClick={() => onOpenThread(parentNote.id!)}
              title={parentNote.text}
            >
              <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{parentNote.text}</span>
            </button>
          </div>
        )}
        <HighlightedText className="block whitespace-pre-wrap leading-6 text-primary" text={note.text} query={''} />
        {note.tags?.length ? (
          <div className="mt-2 text-secondary">{note.tags.join(', ')}</div>
        ) : null}
      </div>
      <div className="px-4 py-2 text-secondary flex items-center justify-between">
        <div className="flex items-center gap-2" title={formatExactDateTime(note.createdAt)}>
          <span>{note.isDirty ? '✔' : '✔✔'}</span>
          <span>{formatRelativeShort(note.createdAt)}</span>
        </div>
        <div />
      </div>
    </div>
  )
}

function ReplyComposer({ spaceId, parentId }: { spaceId: number; parentId: number }) {
  const [value, setValue] = useState<NoteEditorValue>({ text: '', tags: [] })
  const canAdd = useMemo(() => value.text.trim().length > 0, [value.text])
  async function addNote() {
    if (!canAdd) return
    const now = new Date().toISOString()
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: value.tags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    }
    await db.notes.add(payload)
    window.dispatchEvent(new Event('focuz:local-write'))
    setValue({ text: '', tags: [] })
  }
  return (
    <NoteEditor value={value} onChange={setValue} onSubmit={addNote} onCancel={() => setValue({ text: '', tags: [] })} mode="reply" defaultExpanded={false} spaceId={spaceId} />
  )
}

function NoteThread({ spaceId, noteId, onBack, onOpenThread }: { spaceId: number; noteId: number; onBack: () => void; onOpenThread: (nid: number) => void }) {
  const mainNote = useLiveQuery(() => db.notes.get(noteId), [noteId]) as NoteRecord | undefined
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState<NoteEditorValue>({ text: '', tags: [] })

  useEffect(() => {
    if (mainNote) setEditValue({ text: mainNote.text, tags: mainNote.tags || [] })
  }, [mainNote])

  async function saveEdit() {
    if (!mainNote?.id) return
    await updateNoteLocal(mainNote.id, { text: editValue.text.trim(), tags: editValue.tags })
    window.dispatchEvent(new Event('focuz:local-write'))
    setEditing(false)
  }
  async function removeMain() {
    if (!mainNote?.id) return
    await deleteNote(mainNote.id)
    window.dispatchEvent(new Event('focuz:local-write'))
    onBack()
  }

  if (!mainNote || mainNote.spaceId !== spaceId || mainNote.deletedAt) {
    return (
      <div className="flex-1 space-y-[15px]">
        <div className="card p-4">
          <div className="mb-3">Note not found</div>
          <button className="button" onClick={onBack}>Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 space-y-[15px]">
      {editing ? (
        <NoteEditor value={editValue} onChange={setEditValue} onSubmit={saveEdit} onCancel={() => setEditing(false)} mode="edit" autoCollapse={false} spaceId={spaceId} />
      ) : (
        <SingleNoteCard note={mainNote} onEdit={() => setEditing(true)} onDelete={removeMain} onOpenThread={onOpenThread} />
      )}
      <ReplyComposer spaceId={spaceId} parentId={noteId} />
      <div className="min-w-0">
        <NoteList spaceId={spaceId} filter={null} quick={{ text: '', noParents: false, sort: 'modifiedat,DESC' }} parentId={noteId} onOpenThread={onOpenThread} />
      </div>
    </div>
  )
}

export default App
