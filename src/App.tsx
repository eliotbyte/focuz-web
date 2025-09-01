import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setKV } from './lib/db'
import type { NoteRecord, FilterRecord, SpaceRecord } from './lib/types'
import { ensureDefaultSpace, getCurrentSpaceId, runSync, scheduleAutoSync, login, register, isAuthenticated, logout, deleteNote, onAuthRequired, isAuthRequired, getLastUsername } from './lib/sync'
import { searchNotes, ensureNoteIndexForSpace, initSearch } from './lib/search'
import HighlightedText from './components/HighlightedText'
import { formatRelativeShort } from './lib/time'
import NoteEditor, { type NoteEditorValue } from './components/NoteEditor'

function TopBar({ onOpenSpaces, onOpenSettings, onLogout }: { onOpenSpaces: () => void; onOpenSettings: () => void; onLogout: () => void }) {
  return (
    <header className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <button className="button" onClick={onOpenSpaces}>☰</button>
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

function SpaceDrawer({ open, onClose, currentId }: { open: boolean; onClose: () => void; currentId?: number | null }) {
  const spaces = useLiveQuery(() => db.spaces.orderBy('createdAt').toArray(), []) ?? []
  async function selectSpace(id: number) {
    await setKV('currentSpaceId', id)
    await runSync()
    onClose()
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
}: {
  value: { text: string; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }
  onChange: (v: { text: string; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }) => void
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={noParents} onChange={e => { setNoParents(e.target.checked); onChange({ text, noParents: e.target.checked, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }} />
          No parents
        </label>
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
    <NoteEditor value={value} onChange={setValue} onSubmit={addNote} onCancel={() => setValue({ text: '', tags: [] })} mode="create" />
  )
}

function NoteList({ spaceId, filter, quick }: { spaceId: number; filter: FilterRecord | null; quick: { text: string; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` } }) {
  const [idsBySearch, setIdsBySearch] = useState<number[] | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null)

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

    if (quick.noParents || filter?.params?.notReply) {
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
  }, [spaceId, JSON.stringify(filter?.params ?? {}), JSON.stringify(quick), JSON.stringify(idsBySearch)]) ?? []

  const repliesById = useMemo(() => {
    const tally = new Map<number, number>()
    for (const note of notes) {
      const parentId = note.parentId ?? null
      if (parentId !== null) tally.set(parentId, (tally.get(parentId) || 0) + 1)
    }
    return tally
  }, [notes])

  async function removeNote(id: number) {
    await deleteNote(id)
    window.dispatchEvent(new Event('focuz:local-write'))
  }

  return (
    <ul className="space-y-3">
      {notes.map((n: NoteRecord) => (
        <li key={n.id} className="card">
          <div className="flex items-start gap-3">
            <HighlightedText className="flex-1 whitespace-pre-wrap text-sm leading-6" text={n.text} query={(quick.text || filter?.params?.textContains || '') as string} />
            <div className="relative">
              <button
                className="px-2 py-1 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
                onClick={() => setMenuOpenId(menuOpenId === n.id ? null : n.id!)}
                aria-label="Open menu"
              >
                ⋯
              </button>
              {menuOpenId === n.id && (
                <div className="absolute right-0 mt-1 z-10 rounded border border-neutral-800 bg-neutral-900 shadow-lg">
                  <button className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => { setMenuOpenId(null); removeNote(n.id!) }}>Delete</button>
                </div>
              )}
            </div>
          </div>
          {n.tags?.length ? (
            <div className="mt-2 text-sm text-neutral-400">
              {n.tags.join(', ')}
            </div>
          ) : null}
          <div className="mt-2 text-xs text-neutral-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>{n.isDirty ? '✔' : '✔✔'}</span>
              <span>{formatRelativeShort(n.modifiedAt)}</span>
            </div>
            <button className="text-xs text-neutral-400 hover:text-neutral-200 transition" type="button" disabled>
              ({repliesById.get(n.id!) || 0}) Reply
            </button>
          </div>
        </li>
      ))}
      {notes.length === 0 && <li className="text-sm text-neutral-400">No notes</li>}
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

  const [quick, setQuick] = useState<{ text: string; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }>({ text: '', noParents: false, sort: 'modifiedat,DESC' })

  useEffect(() => {
    const off = onAuthRequired(setNeedReauth)
    return () => { off() }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = (document.documentElement.dataset.theme || 'dark')
    initSearch().catch(() => {})
    if (authed) {
      ensureDefaultSpace().then(async () => {
        const id = await getCurrentSpaceId()
        setCurrentSpaceId(id)
        await ensureNoteIndexForSpace(id)
        await runSync()
        setTimeout(() => { runSync() }, 1000)
      })
      const { kick } = scheduleAutoSync()
      const onLocalWrite = () => kick()
      window.addEventListener('focuz:local-write', onLocalWrite)
      return () => { window.removeEventListener('focuz:local-write', onLocalWrite) }
    }
  }, [authed])

  if (!authed) return <AuthScreen onDone={() => setAuthed(true)} />

  const left = currentSpaceId ? <FiltersList spaceId={currentSpaceId} onSelect={setSelectedFilter} /> : null
  const center = currentSpaceId ? (
    <div className="flex-1 space-y-4">
      <NoteComposer spaceId={currentSpaceId} />
      <NoteList spaceId={currentSpaceId} filter={selectedFilter} quick={quick} />
    </div>
  ) : null

  return (
    <div className="container space-y-4">
      <TopBar onOpenSpaces={() => setDrawerOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onLogout={() => { logout(); setAuthed(false) }} />
      <div className="flex gap-4">
        {left}
        {center}
        <QuickFiltersPanel value={quick} onChange={setQuick} />
      </div>

      {drawerOpen && <SpaceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} currentId={currentSpaceId} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {needReauth && <ReauthOverlay onDone={() => setNeedReauth(false)} />}
    </div>
  )
}

export default App
