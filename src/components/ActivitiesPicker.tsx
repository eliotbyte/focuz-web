import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'

export default function ActivitiesPicker({
  value,
  onChange,
  spaceId,
  placeholder = 'Activities',
}: {
  value: string[]
  onChange: (next: string[]) => void
  spaceId?: number | null
  placeholder?: string
}) {
  const [draft, setDraft] = useState<string>('')
  const [focused, setFocused] = useState<boolean>(false)
  const [selectedIdx, setSelectedIdx] = useState<number>(-1)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const types = useLiveQuery(async () => {
    const all = await db.activityTypes.toArray()
    const list = (spaceId != null)
      ? all.filter(t => (t.spaceId === spaceId || t.spaceId === 0 || t.spaceId == null) && !t.deletedAt)
      : all.filter(t => !t.deletedAt)
    list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [spaceId]) || []
  const names = useMemo(() => types.map(t => t.name), [types])

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase()
    const selected = new Set(value.map(v => v.toLowerCase()))
    const filtered = names.filter(n => !selected.has(n.toLowerCase()) && (!q || n.toLowerCase().startsWith(q)))
    return filtered.slice(0, 10)
  }, [names, draft, JSON.stringify(value)])

  useEffect(() => {
    // reset highlight when input text changes
    setSelectedIdx(-1)
  }, [draft])

  function pushActivity(name: string) {
    if (!name) return
    const exists = value.some(v => v.toLowerCase() === name.toLowerCase())
    if (exists) { setDraft(''); return }
    onChange([...value, name])
    setDraft('')
    setSelectedIdx(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (!suggestions.length) return
      e.preventDefault()
      const nextIdx = selectedIdx < 0 ? 0 : Math.min(selectedIdx + 1, suggestions.length - 1)
      setSelectedIdx(nextIdx)
      setDraft(suggestions[nextIdx])
      return
    }
    if (e.key === 'ArrowUp') {
      if (!suggestions.length) return
      e.preventDefault()
      const nextIdx = selectedIdx <= 0 ? 0 : selectedIdx - 1
      setSelectedIdx(nextIdx)
      setDraft(suggestions[nextIdx])
      return
    }
    if (e.key === 'Enter') {
      if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
        e.preventDefault()
        pushActivity(suggestions[selectedIdx])
        return
      }
      const exact = names.find(n => n.toLowerCase() === draft.trim().toLowerCase())
      if (exact) {
        e.preventDefault()
        pushActivity(exact)
      }
      return
    }
    if (e.key === 'Backspace' && draft === '') {
      const last = value[value.length - 1]
      if (last) {
        e.preventDefault()
        onChange(value.slice(0, -1))
      }
    }
  }

  function handleBlur() {
    setFocused(false)
    const exact = names.find(n => n.toLowerCase() === draft.trim().toLowerCase())
    if (exact) pushActivity(exact)
    else setDraft('')
  }

  return (
    <div className="w-full relative">
      <div className="input min-h-10 py-1 flex items-center gap-2 flex-wrap" onClick={() => inputRef.current?.focus()}>
        {value.map((n, i) => (
          <span key={`${n}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-1 text-xs text-secondary">
            <span>{n}</span>
            <button
              type="button"
              className="text-neutral-400 hover:text-neutral-200"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(value.filter(x => x !== n)) }}
              aria-label="Remove activity filter"
              title="Remove"
            >×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="bg-transparent outline-none flex-1 min-w-24 text-primary"
          value={draft}
          placeholder={value.length === 0 ? (placeholder || 'Activities') : ''}
          onChange={e => { setDraft(e.target.value) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
        />
      </div>
      {focused && suggestions.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full max-h-60 overflow-auto rounded border border-neutral-800 bg-neutral-900 py-1">
          {suggestions.map((s, i) => (
            <button
              key={`${s}-${i}`}
              type="button"
              className={`block w-full text-left px-3 py-2 text-sm ${i === selectedIdx ? 'bg-neutral-800 text-neutral-100' : 'text-secondary hover:bg-neutral-800'}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pushActivity(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}


