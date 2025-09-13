import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'

export default function TagsInput({ value, onChange, placeholder, className, spaceId }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string; className?: string; spaceId?: number }) {
  const [draft, setDraft] = useState<string>('')
  const [queryKey, setQueryKey] = useState<string>('')
  const [focused, setFocused] = useState<boolean>(false)
  const [selectedIdx, setSelectedIdx] = useState<number>(-1)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // Keep draft trimmed of delimiter-only strings
    if (draft.trim() === '' && draft.length > 0) setDraft('')
  }, [draft])

  function pushTag(tagText: string) {
    const token = tagText.trim()
    if (!token) return
    const next = Array.from(new Set([...value, token]))
    onChange(next)
    setDraft('')
    setQueryKey('')
    setSelectedIdx(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === ' ' || e.key === ';') {
      e.preventDefault()
      pushTag(draft)
      return
    }
    if (e.key === 'ArrowDown') {
      const list = suggestions
      if (!list.length) return
      e.preventDefault()
      const nextIdx = selectedIdx < 0 ? 0 : Math.min(selectedIdx + 1, list.length - 1)
      setSelectedIdx(nextIdx)
      setDraft(list[nextIdx])
      return
    }
    if (e.key === 'ArrowUp') {
      const list = suggestions
      if (!list.length) return
      e.preventDefault()
      const nextIdx = selectedIdx <= 0 ? 0 : selectedIdx - 1
      setSelectedIdx(nextIdx)
      setDraft(list[nextIdx])
      return
    }
    if (e.key === 'Enter') {
      if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
        e.preventDefault()
        pushTag(suggestions[selectedIdx])
        return
      }
    }
    if (e.key === 'Backspace' && draft === '') {
      const last = value[value.length - 1]
      if (last) {
        e.preventDefault()
        onChange(value.slice(0, -1))
        setDraft(last)
        // focus stays on input
      }
    }
  }

  function handleBlur() {
    setFocused(false)
    if (draft.trim()) pushTag(draft)
  }

  function clickTagToEdit(idx: number) {
    const tag = value[idx]
    const current = draft.trim()
    let next = value.filter((_, i) => i !== idx)
    if (current) next = Array.from(new Set([...next, current]))
    onChange(next)
    setDraft(tag)
    inputRef.current?.focus()
  }

  const containerClasses = useMemo(() => {
    const base = 'input min-h-10 py-1 flex items-center gap-2 flex-wrap'
    return className ? `${base} ${className}` : base
  }, [className])

  // Build last-used map from recent notes and compute suggestions from tags directory
  const suggestions = useLiveQuery(async () => {
    if (!spaceId) return [] as string[]
    const selected = new Set(value.map(v => v.toLowerCase()))
    const q = queryKey.trim().toLowerCase()

    // Build last used map from recent notes for ordering
    const lastUsed = new Map<string, string>() // tagLower -> ISO modifiedAt
    const recentNotes = await db.notes.orderBy('modifiedAt').reverse().limit(500).toArray()
    for (const n of recentNotes) {
      if (n.spaceId !== spaceId || n.deletedAt) continue
      for (const t of (n.tags || [])) {
        const low = (t || '').toLowerCase()
        const prev = lastUsed.get(low)
        if (!prev || n.modifiedAt > prev) lastUsed.set(low, n.modifiedAt)
      }
    }

    let candidates: string[] = []
    if (q) {
      const all = await db.tags.where('spaceId').equals(spaceId).filter(t => !t.deletedAt && (t.name || '').toLowerCase().startsWith(q)).toArray()
      candidates = all.map(t => t.name).filter(Boolean) as string[]
    } else {
      // derive from notes used tags
      candidates = Array.from(new Set(Array.from(lastUsed.keys())))
    }
    // unique, exclude selected
    const unique: string[] = []
    for (const name of candidates) {
      const low = name.toLowerCase()
      if (!selected.has(low) && !unique.some(x => x.toLowerCase() === low)) unique.push(name)
    }
    // sort by last used desc, fallback alpha
    unique.sort((a, b) => {
      const ya = lastUsed.get(a.toLowerCase()) || ''
      const yb = lastUsed.get(b.toLowerCase()) || ''
      if (ya !== yb) return ya > yb ? -1 : 1
      return a.localeCompare(b)
    })
    return unique.slice(0, 10)
  }, [spaceId, queryKey, JSON.stringify(value)]) || []

  return (
    <div className="w-full relative">
      <div className={containerClasses} onClick={() => inputRef.current?.focus()}>
        {value.map((tag, idx) => (
          <button key={`${tag}-${idx}`} type="button" className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-1 text-xs text-secondary hover:bg-neutral-700" onClick={() => clickTagToEdit(idx)}>
            <span>{tag}</span>
            <span className="text-neutral-400 hover:text-neutral-200">×</span>
          </button>
        ))}
        <input
          ref={inputRef}
          className="bg-transparent outline-none flex-1 min-w-24 text-primary"
          value={draft}
          placeholder={value.length === 0 ? (placeholder || 'Add tags') : ''}
          onChange={e => { setDraft(e.target.value); setQueryKey(e.target.value); setSelectedIdx(-1) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
        />
      </div>
      {focused && !!spaceId && suggestions.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full max-h-60 overflow-auto rounded border border-neutral-800 bg-neutral-900 py-1">
          {suggestions.map((s, i) => (
            <button
              key={`${s}-${i}`}
              type="button"
              className={`block w-full text-left px-3 py-2 text-sm ${i === selectedIdx ? 'bg-neutral-800 text-neutral-100' : 'text-secondary hover:bg-neutral-800'}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pushTag(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
} 