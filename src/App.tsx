import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setKV, getKV } from './lib/db'
import type { NoteRecord, FilterRecord, SpaceRecord } from './lib/types'
import { ensureDefaultSpace, getCurrentSpaceId, runSync, scheduleAutoSync, login, register, isAuthenticated, logout, deleteNote, onAuthRequired, isAuthRequired, getLastUsername, addLocalAttachment, teardownSync, purgeAndLogout } from './lib/sync'
import { updateNoteLocal, createFilterLocal, updateFilterLocal } from './lib/sync'
import { searchNotes, ensureNoteIndexForSpace, initSearch } from './lib/search'
import Toasts from './components/Toasts'
import NoteEditor, { type NoteEditorValue } from './components/NoteEditor'
import NoteCard from './components/NoteCard'
import TagsInput from './components/TagsInput'
import ActivitiesPicker from './components/ActivitiesPicker'

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

function FiltersList({ spaceId, selectedId, onSelect }: { spaceId: number; selectedId?: number | null; onSelect: (f: FilterRecord | null) => void }) {
  const filters = useLiveQuery(() => db.filters.where('spaceId').equals(spaceId).filter(f => !f.deletedAt).toArray(), [spaceId]) ?? []
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  const [manage, setManage] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropOver, setDropOver] = useState<{ id: number; pos: 'before' | 'after' | 'inside' } | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!manage) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setManage(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [manage])

  type TreeNode = { rec: FilterRecord; id: number; serverId: number | null; clientId?: string | null; parentServerId: number | null; parentClientId?: string | null; depth: number; children: TreeNode[] }
  const treeRoots = useMemo(() => {
    const byLocal = new Map<number, FilterRecord>()
    const byServer = new Map<number, FilterRecord>()
    const byClient = new Map<string, FilterRecord>()
    for (const f of filters) {
      if (f.id) byLocal.set(f.id, f)
      if (typeof f.serverId === 'number') byServer.set(f.serverId!, f)
      if (f.clientId) byClient.set(f.clientId, f)
    }
    const nodesByLocal = new Map<number, TreeNode>()
    const roots: TreeNode[] = []
    function ensureNode(f: FilterRecord): TreeNode {
      const key = f.id!
      let n = nodesByLocal.get(key)
      if (n) return n
      n = { rec: f, id: f.id!, serverId: f.serverId ?? null, clientId: f.clientId ?? null, parentServerId: f.parentId ?? null, parentClientId: (f.params as any)?._parentClientId ?? null, depth: 0, children: [] }
      nodesByLocal.set(key, n)
      return n
    }
    for (const f of filters) ensureNode(f)
    for (const n of nodesByLocal.values()) n.children = []
    for (const n of nodesByLocal.values()) {
      let parent: TreeNode | null = null
      if (n.parentServerId != null) {
        const p = byServer.get(n.parentServerId)
        if (p?.id) parent = nodesByLocal.get(p.id) || null
      } else if (n.parentClientId) {
        const p = byClient.get(n.parentClientId)
        if (p?.id) parent = nodesByLocal.get(p.id) || null
      }
      if (parent) parent.children.push(n)
      else roots.push(n)
    }
    // sort helper by params._order then name then createdAt
    const cmp = (a: TreeNode, b: TreeNode) => {
      const ao = ((a.rec.params as any)?._order ?? 1e9) as number
      const bo = ((b.rec.params as any)?._order ?? 1e9) as number
      if (ao !== bo) return ao - bo
      const an = a.rec.name.toLowerCase()
      const bn = b.rec.name.toLowerCase()
      if (an !== bn) return an < bn ? -1 : 1
      return a.rec.createdAt.localeCompare(b.rec.createdAt)
    }
    function markDepth(node: TreeNode, d: number) {
      node.depth = d
      node.children.sort(cmp)
      for (const ch of node.children) markDepth(ch, d + 1)
    }
    roots.sort(cmp)
    for (const r of roots) markDepth(r, 0)
    return roots
  }, [JSON.stringify(filters)])

  const flat = useMemo(() => {
    const out: Array<{ node: TreeNode; hidden: boolean }> = []
    const walk = (n: TreeNode, hidden: boolean) => {
      out.push({ node: n, hidden })
      const isCollapsed = !!collapsed[n.id]
      for (const ch of n.children) walk(ch, hidden || isCollapsed)
    }
    for (const r of treeRoots) walk(r, false)
    return out
  }, [treeRoots, collapsed])

  async function toggleCollapse(id: number) {
    setCollapsed(s => ({ ...s, [id]: !s[id] }))
  }

  async function deleteWithChildren(localId: number) {
    // collect descendants
    const ids: number[] = []
    const byId = new Map<number, TreeNode>(flat.map(x => [x.node.id, x.node]))
    function collect(id: number) {
      ids.push(id)
      const n = byId.get(id)
      if (!n) return
      for (const ch of n.children) collect(ch.id)
    }
    collect(localId)
    const now = new Date().toISOString()
    await db.transaction('rw', db.filters, async () => {
      for (const id of ids) await db.filters.update(id, { deletedAt: now, modifiedAt: now, isDirty: 1 })
    })
    try {
      const { addToast } = await import('./lib/toast')
      addToast({ message: 'Filters deleted', action: { type: 'undo-delete-filters-bulk', label: 'Undo', payload: { filterIds: ids } } })
    } catch {}
    if (selectedId && ids.includes(selectedId)) onSelect(null)
  }

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const id = (e.detail?.id as number) || 0
      if (id) deleteWithChildren(id)
    }
    window.addEventListener('focuz:delete-filter-request', handler as any)
    return () => { window.removeEventListener('focuz:delete-filter-request', handler as any) }
  }, [flat, selectedId])

  async function applyReparentAndOrder(dragLocalId: number, targetLocalId: number, pos: 'before' | 'after' | 'inside') {
    const drag = flat.find(x => x.node.id === dragLocalId)?.node
    const target = flat.find(x => x.node.id === targetLocalId)?.node
    if (!drag || !target) return
    // Prevent dropping into own subtree
    if (dragLocalId === targetLocalId) return
    let ancestor: TreeNode | undefined = target
    while (ancestor) {
      if (ancestor.id === dragLocalId) return
      const parentServerOrClient: number | string | null = ancestor.parentServerId != null ? ancestor.parentServerId : (ancestor.parentClientId || null)
      if (parentServerOrClient == null) break
      ancestor = flat.find(x => (typeof parentServerOrClient === 'number' ? (x.node.serverId === parentServerOrClient) : (x.node.clientId === parentServerOrClient)))?.node
    }

    let newParentServerId: number | null = null
    let newParentClientId: string | null = null
    if (pos === 'inside') {
      newParentServerId = target.serverId ?? null
      newParentClientId = target.serverId ? null : (target.clientId || null)
    } else {
      // sibling of target → inherit its parent
      if (target.parentServerId != null) newParentServerId = target.parentServerId
      else if (target.parentClientId) newParentClientId = target.parentClientId
    }

    // Compute sibling list of destination parent for ordering
    const siblings = flat
      .filter(x => !x.hidden)
      .map(x => x.node)
      .filter(n => (pos === 'inside' ? (n.parentServerId === newParentServerId && (n.parentClientId || null) === (newParentClientId || null)) : (n.parentServerId === target.parentServerId && (n.parentClientId || null) === (target.parentClientId || null))))
      .filter(n => n.id !== dragLocalId)

    let insertIndex = siblings.findIndex(n => n.id === targetLocalId)
    if (pos === 'after') insertIndex++
    if (insertIndex < 0) insertIndex = siblings.length

    const ordered = [...siblings]
    ordered.splice(insertIndex, 0, drag)
    // Assign incremental _order
    const updates: Array<{ id: number; params: any }> = []
    for (let i = 0; i < ordered.length; i++) {
      const n = ordered[i]
      const p = { ...(n.rec.params as any), _order: (i + 1) * 10 }
      updates.push({ id: n.id, params: p })
    }
    const now = new Date().toISOString()
    await db.transaction('rw', db.filters, async () => {
      // update parent for dragged
      if (newParentServerId != null) await db.filters.update(dragLocalId, { parentId: newParentServerId, isDirty: 1, modifiedAt: now, params: { ...(drag.rec.params as any), _parentClientId: undefined } as any })
      else await db.filters.update(dragLocalId, { parentId: null, isDirty: 1, modifiedAt: now, params: { ...(drag.rec.params as any), _parentClientId: newParentClientId || undefined } as any })
      // update orders
      for (const u of updates) await db.filters.update(u.id, { params: u.params as any, isDirty: 1, modifiedAt: now })
    })
    try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
  }

  function onDragStart(e: React.DragEvent, id: number) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(e: React.DragEvent, id: number) {
    e.preventDefault()
    if (dragId == null) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const pos: 'before' | 'after' | 'inside' = y < rect.height * 0.25 ? 'before' : y > rect.height * 0.75 ? 'after' : 'inside'
    setDropOver({ id, pos })
  }
  function onDragLeave() { setDropOver(d => d) }
  async function onDrop(e: React.DragEvent, id: number) {
    e.preventDefault()
    const d = dropOver
    setDropOver(null)
    const drag = dragId
    setDragId(null)
    if (drag == null || !d || d.id !== id) return
    await applyReparentAndOrder(drag, id, d.pos)
  }

  return (
    <aside className="hidden md:block w-64 shrink-0">
      <div className="card" ref={ref}>
        <div className="mb-2 font-medium flex items-center justify-between">
          <span>Filters</span>
          <button className={`text-xs ${manage ? 'text-sky-400' : 'text-neutral-400 hover:text-neutral-200'}`} onClick={() => setManage(m => !m)}>Manage</button>
        </div>
        <ul className="space-y-1">
          <li>
            <div className={`relative flex items-center justify-between px-2 py-1 text-sm cursor-pointer ${(!selectedId ? 'text-neutral-100' : 'text-neutral-300')}`} onClick={() => onSelect(null)}>
              <span className="truncate">No filters</span>
            </div>
          </li>
          {flat.map(({ node, hidden }) => (
            hidden ? null : (
              <li key={node.id}
                draggable={manage}
                onDragStart={(e) => onDragStart(e, node.id)}
                onDragOver={(e) => onDragOver(e, node.id)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, node.id)}
              >
                <div className={`relative flex items-center justify-between px-2 py-1 text-sm cursor-pointer ${selectedId === node.id ? 'bg-neutral-800 text-neutral-100 rounded' : 'text-neutral-300 hover:text-neutral-100'}`}
                  onClick={() => onSelect(node.rec)}
                  style={{ paddingLeft: `${8 + node.depth * 14 + (node.children.length > 0 ? 14 : 0)}px` }}
                >
                  {/* collapse/expand icon positioned without affecting indent */}
                  {node.children.length > 0 && (
                    <button
                      className="absolute text-neutral-500 hover:text-neutral-200"
                      style={{ left: `${8 + node.depth * 14}px` }}
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(node.id) }}
                      title={collapsed[node.id] ? 'Expand' : 'Collapse'}
                    >
                      {collapsed[node.id] ? '+' : '−'}
                    </button>
                  )}
                  <span className="truncate">{node.rec.name}</span>
                  {manage && (
                    <button className="px-1 text-neutral-500 hover:text-neutral-200" title="Delete filter" onClick={(e) => { e.stopPropagation(); deleteWithChildren(node.id) }}>×</button>
                  )}
                </div>
                {dropOver && dropOver.id === node.id && (
                  <div className="px-2">
                    {dropOver.pos === 'before' && <div className="h-0.5 bg-sky-600 rounded" />}
                    {dropOver.pos === 'inside' && <div className="h-0.5 bg-transparent" />}
                    {dropOver.pos === 'after' && <div className="h-0.5 bg-sky-600 rounded" />}
                  </div>
                )}
              </li>
            )
          ))}
        </ul>
      </div>
    </aside>
  )
}

type SortField = 'date' | 'createdat' | 'modifiedat'

function QuickFiltersPanel({
  value,
  onChange,
  hideNoParents = false,
  spaceId,
}: {
  value: { text: string; tags: string[]; activities?: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }
  onChange: (v: { text: string; tags: string[]; activities?: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }) => void
  hideNoParents?: boolean
  spaceId?: number | null
}) {
  const [text, setText] = useState(value.text)
  const [tags, setTags] = useState<string[]>(Array.isArray((value as any).tags) ? (value as any).tags : [])
  const [activities, setActivities] = useState<string[]>(Array.isArray((value as any).activities) ? (value as any).activities : [])
  const [noParents, setNoParents] = useState(value.noParents)
  const [sortField, setSortField] = useState<SortField>(value.sort.split(',')[0] as SortField)
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>(value.sort.split(',')[1] as 'ASC' | 'DESC')

  useEffect(() => {
    setText(value.text)
    setTags(Array.isArray((value as any).tags) ? (value as any).tags : [])
    setActivities(Array.isArray((value as any).activities) ? (value as any).activities : [])
    setNoParents(value.noParents)
    setSortField(value.sort.split(',')[0] as SortField)
    setSortDir(value.sort.split(',')[1] as 'ASC' | 'DESC')
  }, [value])

  return (
    <aside className="hidden lg:block w-64 shrink-0">
      <div className="card space-y-3">
        <div className="mb-1 font-medium">Quick filters</div>
        <input className="input" placeholder="Search" value={text} onChange={e => { const v = e.target.value; setText(v); onChange({ text: v, tags, noParents, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }} />
        <div>
          <TagsInput
            value={tags}
            onChange={(next) => { setTags(next); onChange({ text, tags: next, activities, noParents, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }}
            placeholder="Tags"
            className="mt-1"
            spaceId={spaceId ?? undefined}
            invertible
          />
        </div>
        <ActivitiesPicker
          value={activities}
          onChange={(next) => { setActivities(next); onChange({ text, tags, activities: next, noParents, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }}
          spaceId={spaceId}
        />
        {!hideNoParents && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noParents} onChange={e => { setNoParents(e.target.checked); onChange({ text, tags, noParents: e.target.checked, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }} />
            No parents
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={sortField} onChange={e => { const f = e.target.value as SortField; setSortField(f); onChange({ text, tags, noParents, sort: `${f},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }}>
            <option value="modifiedat">modified_at</option>
            <option value="createdat">created_at</option>
            <option value="date">date</option>
          </select>
          <select className="input" value={sortDir} onChange={e => { const d = e.target.value as 'ASC' | 'DESC'; setSortDir(d); onChange({ text, tags, noParents, sort: `${sortField},${d}` as `${SortField},ASC` | `${SortField},DESC` }) }}>
            <option value="DESC">desc</option>
            <option value="ASC">asc</option>
          </select>
        </div>
        {!hideNoParents && spaceId && (
          <div className="flex justify-between pt-2">
            <button className="button" onClick={() => window.dispatchEvent(new CustomEvent('focuz:open-save-filter'))}>Save</button>
          </div>
        )}
      </div>
    </aside>
  )
}

function NoteComposer({ spaceId, positiveQuickTags = [] }: { spaceId: number; positiveQuickTags?: string[] }) {
  const [value, setValue] = useState<NoteEditorValue>({ text: '', tags: [] })
  const canAdd = useMemo(() => value.text.trim().length > 0, [value.text])

  async function addNote() {
    if (!canAdd) return
    const now = new Date().toISOString()
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId: null,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    }
    const noteId = await db.notes.add(payload)
    // Persist activities drafts (if any)
    if (Array.isArray((value as any).activities)) {
      const { createOrUpdateLocalActivity } = await import('./lib/sync')
      for (const a of (value as any).activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(noteId, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
    }
    window.dispatchEvent(new Event('focuz:local-write'))
    setValue({ text: '', tags: [] })
  }

  async function addNoteWithAttachments(extra: { attachments?: File[] }) {
    if (!canAdd) return
    const now = new Date().toISOString()
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const noteId = await db.notes.add({
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId: null,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    } as NoteRecord)
    if (Array.isArray((value as any).activities)) {
      const { createOrUpdateLocalActivity } = await import('./lib/sync')
      for (const a of (value as any).activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(noteId, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
    }

    const files = (extra.attachments ?? []).slice(0, 10)
    for (const f of files) {
      try {
        await addLocalAttachment(noteId, f)
      } catch {}
    }

    window.dispatchEvent(new Event('focuz:local-write'))
    setValue({ text: '', tags: [] })
  }

  return (
        <NoteEditor value={value} onChange={setValue} onSubmit={addNote} onSubmitWithExtra={addNoteWithAttachments} onCancel={() => setValue({ text: '', tags: [] })} mode="create" spaceId={spaceId} />
  )
}

function NoteList({ spaceId, filter, quick, parentId, onOpenThread, onAddQuickTag, onAddQuickActivity }: { spaceId: number; filter: FilterRecord | null; quick: { text: string; tags?: string[]; activities?: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }; parentId?: number | null; onOpenThread?: (noteId: number) => void; onAddQuickTag?: (tag: string) => void; onAddQuickActivity?: (name: string) => void }) {
  const [idsBySearch, setIdsBySearch] = useState<number[] | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState<{ text: string; tags: string[]; activities?: any[] }>({ text: '', tags: [], activities: [] })
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
    // Activities filter: include notes that have ALL selected activity type names
    const includeActivitiesNames = new Set<string>([...(((filter?.params as any)?.includeActivities as string[]) || []), ...(((quick as any).activities as string[]) || [])])
    if (includeActivitiesNames.size > 0) {
      // Build a map of noteId -> names present
      const acts = await db.activities.where('noteId').anyOf(result.map(n => n.id!)).toArray()
      const types = await db.activityTypes.toArray()
      const nameByTypeId = new Map(types.map(t => [t.serverId!, t.name]))
      const byNote = new Map<number, Set<string>>()
      for (const a of acts) {
        if (a.deletedAt) continue
        const n = nameByTypeId.get(a.typeId)
        if (!n) continue
        const set = byNote.get(a.noteId) || new Set<string>()
        set.add(n)
        byNote.set(a.noteId, set)
      }
      result = result.filter(n => {
        const set = byNote.get(n.id!) || new Set<string>()
        for (const name of includeActivitiesNames) if (!set.has(name)) return false
        return true
      })
    }
    const quickTags = (quick as any).tags as string[] | undefined
    if (quickTags && quickTags.length > 0) {
      const includeTags = quickTags.filter(t => !t.startsWith('!'))
      const excludeTags = quickTags.filter(t => t.startsWith('!')).map(t => t.slice(1))
      if (includeTags.length > 0) {
        result = result.filter(n => (n.tags || []).length > 0 && includeTags.every(t => n.tags.includes(t)))
      }
      if (excludeTags.length > 0) {
        result = result.filter(n => !excludeTags.some(t => (n.tags || []).includes(t)))
      }
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

  // Parent previews no longer preloaded here; NoteCard handles parent preview on demand
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

  async function saveEdit(id: number, value: { text: string; tags: string[]; activities?: any[] }) {
    await updateNoteLocal(id, { text: value.text.trim(), tags: value.tags })
    // Persist activities edits locally: upsert new/edited and mark removed as deleted
    if (Array.isArray(value.activities)) {
      const { createOrUpdateLocalActivity, deleteLocalActivity } = await import('./lib/sync')
      const existing = await db.activities.where('noteId').equals(id).toArray()
      const current = existing.filter(a => !a.deletedAt)
      const nextTypeIds = new Set<number>(value.activities.map(a => a?.typeId).filter((x: any) => typeof x === 'number'))
      // upsert current values
      for (const a of value.activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(id, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
      // delete removed
      for (const a of current) {
        if (!nextTypeIds.has(a.typeId)) {
          try { await deleteLocalActivity(id, a.typeId) } catch {}
        }
      }
    }
    window.dispatchEvent(new Event('focuz:local-write'))
    setEditingId(null)
  }

  async function saveEditWithAttachments(id: number, value: { text: string; tags: string[]; activities?: any[] }, extra?: { attachments?: File[] }) {
    await updateNoteLocal(id, { text: value.text.trim(), tags: value.tags })
    if (Array.isArray(value.activities)) {
      const { createOrUpdateLocalActivity, deleteLocalActivity } = await import('./lib/sync')
      const existing = await db.activities.where('noteId').equals(id).toArray()
      const current = existing.filter(a => !a.deletedAt)
      const nextTypeIds = new Set<number>(value.activities.map(a => a?.typeId).filter((x: any) => typeof x === 'number'))
      for (const a of value.activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(id, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
      for (const a of current) {
        if (!nextTypeIds.has(a.typeId)) {
          try { await deleteLocalActivity(id, a.typeId) } catch {}
        }
      }
    }
    const files = (extra?.attachments ?? []).slice(0, 10)
    for (const f of files) {
      try { await addLocalAttachment(id, f) } catch {}
    }
    window.dispatchEvent(new Event('focuz:local-write'))
    setEditingId(null)
  }

  const [replyValue, setReplyValue] = useState<{ text: string; tags: string[]; activities?: any[] }>({ text: '', tags: [] })

  async function addInlineReply(parent: NoteRecord, value: { text: string; tags: string[]; activities?: any[] }) {
    const canAdd = value.text.trim().length > 0
    if (!canAdd) return
    const now = new Date().toISOString()
    const positiveQuickTags = ((quick as any).tags || []).filter((t: string) => !t.startsWith('!')) as string[]
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId: parent.id!,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    }
    const newId = await db.notes.add(payload)
    if (Array.isArray(value.activities)) {
      const { createOrUpdateLocalActivity } = await import('./lib/sync')
      for (const a of value.activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(newId, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
    }
    window.dispatchEvent(new Event('focuz:local-write'))
    setReplyingForId(null)
    setReplyValue({ text: '', tags: [] })
  }

  return (
    <ul className="space-y-4">
      {notes.flatMap((n: NoteRecord) => {
        const items: ReactNode[] = []
        const positiveQuickTags = ((quick as any).tags || []).filter((t: string) => !t.startsWith('!')) as string[]
        const hiddenTagsSet = new Set(positiveQuickTags)
        // Note item (either editor replacing the note, or the note card)
        items.push(
          <li key={n.id}>
            {editingId === n.id ? (
              <NoteEditor
                value={editingValue}
                onChange={setEditingValue}
                onSubmit={() => saveEdit(n.id!, editingValue)}
                onSubmitWithExtra={(extra) => saveEditWithAttachments(n.id!, editingValue, extra)}
                onCancel={() => setEditingId(null)}
                mode="edit"
                autoCollapse={false}
                variant="card"
                spaceId={spaceId}
                noteId={n.id!}
              />
            ) : (
              <NoteCard
                note={n}
                onEdit={() => { setEditingId(n.id!); setEditingValue({ text: n.text, tags: n.tags || [] }) }}
                onDelete={() => { removeNote(n.id!) }}
                onOpenThread={onOpenThread}
                showParentPreview={parentId == null && (n.parentId ?? null) != null}
                hiddenTags={hiddenTagsSet}
                onTagClick={(tag) => { if (onAddQuickTag) onAddQuickTag(tag) }}
                onActivityClick={(name) => { if (onAddQuickActivity) onAddQuickActivity(name) }}
                childrenRight={
                  <>
                    {(repliesById.get(n.id!) || 0) > 0 && (
                      <button className="text-neutral-400 hover:text-neutral-100 transition" type="button" onClick={() => onOpenThread && onOpenThread(n.id!)}>
                        ({repliesById.get(n.id!)})
                      </button>
                    )}
                    <button className="text-neutral-400 hover:text-neutral-100 transition" type="button" onClick={() => setReplyingForId(replyingForId === n.id ? null : n.id!)}>
                      Reply
                    </button>
                  </>
                }
              />
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
                onSubmitWithExtra={async (extra) => {
                  const canAdd = replyValue.text.trim().length > 0
                  if (!canAdd) return
                  const now = new Date().toISOString()
                  const positiveQuickTags = ((quick as any).tags || []).filter((t: string) => !t.startsWith('!')) as string[]
                  const mergedTags = Array.from(new Set([...(replyValue.tags || []), ...positiveQuickTags]))
                  const noteId = await db.notes.add({
                    spaceId,
                    title: null,
                    text: replyValue.text.trim(),
                    tags: mergedTags,
                    createdAt: now,
                    modifiedAt: now,
                    date: now,
                    parentId: n.id!,
                    deletedAt: null,
                    isDirty: 1,
                    serverId: null,
                    clientId: crypto.randomUUID(),
                  } as NoteRecord)
                  if (Array.isArray(replyValue.activities)) {
                    const { createOrUpdateLocalActivity } = await import('./lib/sync')
                    for (const a of replyValue.activities) {
                      if (!a || typeof a.typeId !== 'number') continue
                      try { await createOrUpdateLocalActivity(noteId, a.typeId, String(a.valueRaw ?? '')) } catch {}
                    }
                  }
                  const files = (extra?.attachments ?? []).slice(0, 10)
                  for (const f of files) { try { await addLocalAttachment(noteId, f) } catch {} }
                  window.dispatchEvent(new Event('focuz:local-write'))
                  setReplyingForId(null)
                  setReplyValue({ text: '', tags: [] })
                }}
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
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  // In-memory back trail within tab. Oldest -> newest. Excludes current page. null represents feed (space root)
  const historyTrailRef = useRef<Array<number | null>>([])

  const [quickFeed, setQuickFeed] = useState<{ text: string; tags: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }>({ text: '', tags: [], noParents: false, sort: 'modifiedat,DESC' })
  const [quickThread, setQuickThread] = useState<{ text: string; tags: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }>({ text: '', tags: [], noParents: false, sort: 'modifiedat,DESC' })

  useEffect(() => {
    const off = onAuthRequired(setNeedReauth)
    return () => { off() }
  }, [])

  // URL helpers
  function parseQuery(): { space?: number; note?: number; filter?: number } {
    const p = new URLSearchParams(location.search)
    const space = p.get('space')
    const note = p.get('note')
    const filter = p.get('filter')
    return { space: space ? Number(space) : undefined, note: note ? Number(note) : undefined, filter: filter ? Number(filter) : undefined }
  }
  function pushQuery(next: { space: number; note?: number | null; filter?: number | null }, replace = false) {
    const params = new URLSearchParams()
    params.set('space', String(next.space))
    if (next.note != null) params.set('note', String(next.note))
    if (next.filter != null) params.set('filter', String(next.filter))
    const url = `${location.pathname}?${params.toString()}`
    if (replace) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = (document.documentElement.dataset.theme || 'dark')
    initSearch().catch(() => {})
    if (!authed) return

    // initial from URL
    const { space, note, filter } = parseQuery()
    ensureDefaultSpace().then(async () => {
      const id = space || await getCurrentSpaceId()
      setCurrentSpaceId(id)
      setCurrentNoteId(note ?? null)
      historyTrailRef.current = note ? [null] : []
      if (filter) {
        const foundLocal = await db.filters.get(filter)
        const foundServer = foundLocal ? null : await db.filters.where('serverId').equals(filter).first()
        const found = foundLocal || foundServer
        if (found && found.spaceId === id) setSelectedFilter(found)
      }
      // load persisted quick filters
      if (note) {
        const saved = await getKV<typeof quickThread>(`quick:space:${id}:note:${note}`)
        if (saved) setQuickThread((saved as any).tags ? saved : { ...(saved as any), tags: [] })
      } else {
        const saved = await getKV<typeof quickFeed>(`quick:space:${id}`)
        if (saved) setQuickFeed((saved as any).tags ? saved : { ...(saved as any), tags: [] })
      }
      await ensureNoteIndexForSpace(id)
      await runSync()
      setTimeout(() => { runSync() }, 1000)
      // normalize URL
      pushQuery({ space: id, note: note ?? null, filter: (filter ?? null) }, true)
    })

    const onPop = () => {
      const { space: s, note: n, filter: f } = parseQuery()
      if (s) setCurrentSpaceId(s)
      setCurrentNoteId(n ?? null)
      if (f == null) setSelectedFilter(null)
      else {
        void (async () => {
          const byLocal = await db.filters.get(f)
          const byServer = byLocal ? null : await db.filters.where('serverId').equals(f).first()
          const rec = byLocal || byServer || null
          setSelectedFilter(rec)
        })()
      }
    }
    window.addEventListener('popstate', onPop)

    const { kick, cleanup } = scheduleAutoSync()
    const onLocalWrite = () => kick()
    window.addEventListener('focuz:local-write', onLocalWrite)
    return () => {
      window.removeEventListener('focuz:local-write', onLocalWrite)
      window.removeEventListener('popstate', onPop)
      try { cleanup() } catch {}
    }
  }, [authed])

  useEffect(() => {
    const onOpenSave = () => setSaveOpen(true)
    window.addEventListener('focuz:open-save-filter', onOpenSave as any)
    return () => { window.removeEventListener('focuz:open-save-filter', onOpenSave as any) }
  }, [])

  const currentQuick = currentNoteId ? quickThread : quickFeed

  async function handleSaveOrUpdate(kind: 'save' | 'update' | 'save-as-new') {
    if (!currentSpaceId) return
    const params: any = {
      textContains: (currentQuick.text || '').trim() || undefined,
      includeTags: (currentQuick.tags || []).filter(t => !t.startsWith('!')),
      excludeTags: (currentQuick.tags || []).filter(t => t.startsWith('!')).map(t => t.slice(1)),
      includeActivities: (currentQuick as any).activities || undefined,
      notReply: currentQuick.noParents || undefined,
      sort: currentQuick.sort,
    }
    if (kind === 'update' && selectedFilter?.id) {
      await updateFilterLocal(selectedFilter.id, { name: (saveName.trim() ? saveName.trim() : undefined), params })
      const rec = await db.filters.get(selectedFilter.id)
      setSelectedFilter(rec || null)
      setSaveOpen(false)
      setSaveName('')
      if (currentSpaceId) pushQuery({ space: currentSpaceId, note: currentNoteId, filter: rec?.id ?? null })
      return
    }
    const parentServerId = (kind === 'save-as-new' ? (selectedFilter?.serverId ?? null) : null) ?? null
    const localId = await createFilterLocal(currentSpaceId, (saveName.trim() || (selectedFilter?.name ?? '')), params, parentServerId)
    const rec = await db.filters.get(localId)
    setSelectedFilter(rec || null)
    setSaveOpen(false)
    setSaveName('')
    if (currentSpaceId) pushQuery({ space: currentSpaceId, note: currentNoteId, filter: rec?.id ?? null })
  }

  // When a saved filter is selected on the feed, reflect it in Quick filters
  useEffect(() => {
    if (!currentSpaceId) return
    if (currentNoteId != null) return
    const applyFrom = async () => {
      if (selectedFilter) {
        const p: any = selectedFilter.params || {}
        const include = Array.isArray(p.includeTags) ? p.includeTags : []
        const exclude = Array.isArray(p.excludeTags) ? p.excludeTags.map((t: string) => `!${t}`) : []
        const text = typeof p.textContains === 'string' ? p.textContains : ''
        const noParents = !!p.notReply
        const sort = (typeof p.sort === 'string' ? p.sort : 'modifiedat,DESC') as `${SortField},ASC` | `${SortField},DESC`
        const next = { text, tags: [...include, ...exclude], noParents, sort }
        setQuickFeed(next)
        await setKV(`quick:space:${currentSpaceId}` , next)
      } else {
        const next = { text: '', tags: [], noParents: false, sort: 'modifiedat,DESC' as `${SortField},ASC` | `${SortField},DESC` }
        setQuickFeed(next)
        await setKV(`quick:space:${currentSpaceId}` , next)
      }
    }
    applyFrom().catch(() => {})
  // Only update Quick when the selected filter changes, not on quick edits
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilter, currentSpaceId, currentNoteId])

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
    pushQuery({ space: currentSpaceId, note: noteId, filter: selectedFilter?.id ?? null })
    // load thread quick
    void (async () => {
      const key = `quick:space:${currentSpaceId}:note:${noteId}`
      const saved = await getKV<typeof quickThread>(key)
      if (saved) setQuickThread((saved as any).tags ? saved : { ...(saved as any), tags: [] })
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
      if (saved) setQuickFeed((saved as any).tags ? saved : { ...(saved as any), tags: [] })
    })()
  }

  function goBack() {
    if (!currentSpaceId) return
    const prev = historyTrailRef.current
    if (prev.length === 0) {
      // back to feed
      setCurrentNoteId(null)
      pushQuery({ space: currentSpaceId, note: null, filter: selectedFilter?.id ?? null })
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
    pushQuery({ space: currentSpaceId, note: target ?? null, filter: selectedFilter?.id ?? null })
    // load respective quick
    void (async () => {
      if (target == null) {
        const saved = await getKV<typeof quickFeed>(`quick:space:${currentSpaceId}`)
        if (saved) setQuickFeed((saved as any).tags ? saved : { ...(saved as any), tags: [] })
      } else {
        const saved = await getKV<typeof quickThread>(`quick:space:${currentSpaceId}:note:${target}`)
        if (saved) setQuickThread((saved as any).tags ? saved : { ...(saved as any), tags: [] })
      }
    })()
  }

  if (!authed) return <AuthScreen onDone={() => setAuthed(true)} />

  const left = currentSpaceId ? (
    <FiltersList
      spaceId={currentSpaceId}
      selectedId={selectedFilter?.id ?? null}
      onSelect={(f) => {
        setSelectedFilter(f)
        if (currentSpaceId) pushQuery({ space: currentSpaceId, note: currentNoteId, filter: f?.id ?? null })
        if (currentNoteId) {
          setCurrentNoteId(null)
        }
      }}
    />
  ) : null
  let center: ReactNode = null
  if (currentSpaceId) {
    if (currentNoteId) {
      center = (
        <NoteThread
          spaceId={currentSpaceId}
          noteId={currentNoteId}
          onBack={goBack}
          onOpenThread={openThread}
          quick={quickThread}
          onAddQuickTag={(tag) => {
            const tags = quickThread.tags || []
            if (tags.includes(tag)) return
            const next = { ...quickThread, tags: [...tags, tag] }
            setQuickThread(next)
            if (currentSpaceId && currentNoteId) setKV(`quick:space:${currentSpaceId}:note:${currentNoteId}`, next)
          }}
        />
      )
    } else {
      center = (
        <div className="flex-1 min-w-0 space-y-[15px]">
          <NoteComposer spaceId={currentSpaceId} positiveQuickTags={(quickFeed.tags || []).filter(t => !t.startsWith('!'))} />
          <NoteList
            spaceId={currentSpaceId}
            filter={null}
            quick={quickFeed}
            onOpenThread={openThread}
            onAddQuickTag={(tag) => {
              if (!currentSpaceId) return
              const tags = quickFeed.tags || []
              if (tags.includes(tag)) return
              const next = { ...quickFeed, tags: [...tags, tag] }
              setQuickFeed(next)
              setKV(`quick:space:${currentSpaceId}`, next)
            }}
            onAddQuickActivity={(name) => {
              if (!currentSpaceId) return
              const acts = (quickFeed as any).activities || []
              if (acts.includes(name)) return
              const next = { ...quickFeed, activities: [...acts, name] }
              setQuickFeed(next as any)
              setKV(`quick:space:${currentSpaceId}`, next)
            }}
          />
        </div>
      )
    }
  }

  return (
    <div className="container space-y-4">
      <TopBar onOpenSpaces={() => setDrawerOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onLogout={() => { setAuthed(false); purgeAndLogout().catch(() => { teardownSync(); logout() }) }} isThread={!!currentNoteId} onBack={goBack} />
      <div className="flex gap-4">
        {left}
        {center}
        {currentNoteId
          ? <QuickFiltersPanel
              value={quickThread}
              onChange={(v) => { setQuickThread(v); if (currentSpaceId && currentNoteId) setKV(`quick:space:${currentSpaceId}:note:${currentNoteId}`, v) }}
              hideNoParents
              spaceId={currentSpaceId}
            />
          : <QuickFiltersPanel
              value={quickFeed}
              onChange={(v) => { setQuickFeed(v); if (currentSpaceId) setKV(`quick:space:${currentSpaceId}` , v) }}
              spaceId={currentSpaceId}
            />
        }
      </div>

      {drawerOpen && <SpaceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} currentId={currentSpaceId} onSelected={(id) => { openSpace(id) }} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {needReauth && <ReauthOverlay onDone={() => setNeedReauth(false)} />}
      {saveOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50">
          <div className="w-full sm:max-w-md bg-neutral-900 border border-neutral-800 rounded-t-xl sm:rounded-xl p-4 space-y-3">
            <h2 className="text-lg font-medium">Save filter</h2>
            <input
              className="input"
              placeholder={selectedFilter ? (selectedFilter.name || 'enter filter name') : 'enter filter name'}
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
            />
            <div className="flex justify-between">
              <button className="button" onClick={() => handleSaveOrUpdate('save-as-new')}>Save as new</button>
              <div className="flex gap-2">
                <button className="button" onClick={() => { setSaveOpen(false); setSaveName('') }}>Cancel</button>
                <button className="button" onClick={() => handleSaveOrUpdate((selectedFilter?.id ? 'update' : 'save'))}>{selectedFilter?.id ? 'Update' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  )
}

// Thread view components
function SingleNoteCard({ note, onEdit, onDelete, onOpenThread }: { note: NoteRecord; onEdit: () => void; onDelete: () => void; onOpenThread: (nid: number) => void }) {
  return (
    <NoteCard note={note} onEdit={onEdit} onDelete={onDelete} onOpenThread={onOpenThread} showParentPreview />
  )
}

function ReplyComposer({ spaceId, parentId, positiveQuickTags = [] }: { spaceId: number; parentId: number; positiveQuickTags?: string[] }) {
  const [value, setValue] = useState<NoteEditorValue>({ text: '', tags: [] })
  const canAdd = useMemo(() => value.text.trim().length > 0, [value.text])
  async function addNote() {
    if (!canAdd) return
    const now = new Date().toISOString()
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
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
  async function addReplyWithAttachments(extra: { attachments?: File[] }) {
    if (!canAdd) return
    const now = new Date().toISOString()
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const noteId = await db.notes.add({
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    } as NoteRecord)
    const files = (extra.attachments ?? []).slice(0, 10)
    for (const f of files) {
      try { await addLocalAttachment(noteId, f) } catch {}
    }
    window.dispatchEvent(new Event('focuz:local-write'))
    setValue({ text: '', tags: [] })
  }
  return (
    <NoteEditor value={value} onChange={setValue} onSubmit={addNote} onSubmitWithExtra={addReplyWithAttachments} onCancel={() => setValue({ text: '', tags: [] })} mode="reply" defaultExpanded={false} spaceId={spaceId} />
  )
}

function NoteThread({ spaceId, noteId, onBack, onOpenThread, quick, onAddQuickTag }: { spaceId: number; noteId: number; onBack: () => void; onOpenThread: (nid: number) => void; quick: { text: string; tags: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }; onAddQuickTag?: (tag: string) => void }) {
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
        <NoteEditor value={editValue} onChange={setEditValue} onSubmit={saveEdit} onCancel={() => setEditing(false)} mode="edit" autoCollapse={false} spaceId={spaceId} noteId={noteId} />
      ) : (
        <SingleNoteCard note={mainNote} onEdit={() => setEditing(true)} onDelete={removeMain} onOpenThread={onOpenThread} />
      )}
      <ReplyComposer spaceId={spaceId} parentId={noteId} positiveQuickTags={quick.tags.filter(t => !t.startsWith('!'))} />
      <div className="min-w-0">
        <NoteList spaceId={spaceId} filter={null} quick={quick} parentId={noteId} onOpenThread={onOpenThread} onAddQuickTag={onAddQuickTag} />
      </div>
    </div>
  )
}

export default App
