import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setKV } from './lib/db'
import type { NoteRecord, FilterRecord, SpaceRecord } from './lib/types'
import { ensureDefaultSpace, getCurrentSpaceId, runSync, scheduleAutoSync, login, register, isAuthenticated, logout, deleteNote, onAuthRequired, isAuthRequired, getLastUsername } from './lib/sync'

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
      params: { sort: 'createdat,DESC' },
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

function QuickFiltersPanel() {
  return (
    <aside className="hidden lg:block w-64 shrink-0">
      <div className="card">
        <div className="mb-2 font-medium">Quick filters</div>
        <div className="text-sm text-neutral-400">Coming soon</div>
      </div>
    </aside>
  )
}

function NoteComposer({ spaceId }: { spaceId: number }) {
  const [text, setText] = useState('')
  const canAdd = useMemo(() => text.trim().length > 0, [text])

  async function addNote() {
    if (!canAdd) return
    const now = new Date().toISOString()
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: text.trim(),
      tags: [],
      createdAt: now,
      modifiedAt: now,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    }
    await db.notes.add(payload)
    window.dispatchEvent(new Event('focuz:local-write'))
    setText('')
  }

  return (
    <div className="card space-y-3">
      <textarea className="input min-h-24" placeholder="Add note…" value={text} onChange={e => setText(e.target.value)} />
      <div className="flex justify-end">
        <button className="button" onClick={addNote} disabled={!canAdd}>Add</button>
      </div>
    </div>
  )
}

function NoteList({ spaceId, filter }: { spaceId: number; filter: FilterRecord | null }) {
  const notes = useLiveQuery(async () => {
    let coll = db.notes
      .where('spaceId')
      .equals(spaceId)
      .filter(n => !n.deletedAt)
    const arr = await coll.toArray()
    let result = arr
    if (filter?.params?.textContains) {
      const q = filter.params.textContains.toLowerCase()
      result = result.filter(n => n.text.toLowerCase().includes(q))
    }
    if (filter?.params?.includeTags?.length) {
      result = result.filter(n => filter!.params!.includeTags!.every(t => n.tags.includes(t)))}
    if (filter?.params?.excludeTags?.length) {
      result = result.filter(n => !filter!.params!.excludeTags!.some(t => n.tags.includes(t)))}
    const sort = filter?.params?.sort ?? 'createdat,DESC'
    result.sort((a, b) => {
      const aKey = sort.startsWith('createdat') ? a.createdAt : a.modifiedAt
      const bKey = sort.startsWith('createdat') ? b.createdAt : b.modifiedAt
      return sort.endsWith('ASC') ? aKey.localeCompare(bKey) : bKey.localeCompare(aKey)
    })
    return result
  }, [spaceId, JSON.stringify(filter?.params ?? {})]) ?? []

  async function removeNote(id: number) {
    await deleteNote(id)
    window.dispatchEvent(new Event('focuz:local-write'))
  }

  return (
    <ul className="space-y-3">
      {notes.map((n: NoteRecord) => (
        <li key={n.id} className="card">
          <div className="flex items-start gap-3">
            <div className="flex-1 whitespace-pre-wrap text-sm leading-6">{n.text}</div>
            <button className="button" onClick={() => removeNote(n.id!)}>Delete</button>
          </div>
          <div className="mt-2 text-xs text-neutral-400">{n.isDirty ? 'Not synced' : 'Synced'} • {new Date(n.modifiedAt).toLocaleString()}</div>
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

  useEffect(() => {
    const off = onAuthRequired(setNeedReauth)
    return () => { off() }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = (document.documentElement.dataset.theme || 'dark')
    if (authed) {
      ensureDefaultSpace().then(async () => {
        const id = await getCurrentSpaceId()
        setCurrentSpaceId(id)
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
      <NoteList spaceId={currentSpaceId} filter={selectedFilter} />
    </div>
  ) : null

  return (
    <div className="container space-y-4">
      <TopBar onOpenSpaces={() => setDrawerOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onLogout={() => { logout(); setAuthed(false) }} />
      <div className="flex gap-4">
        {left}
        {center}
        <QuickFiltersPanel />
      </div>

      {drawerOpen && <SpaceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} currentId={currentSpaceId} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {needReauth && <ReauthOverlay onDone={() => setNeedReauth(false)} />}
    </div>
  )
}

export default App
