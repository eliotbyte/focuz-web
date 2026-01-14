import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { activityTypes } from '../data'

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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null)

  const types = useLiveQuery(async () => {
    return activityTypes.listForSpace(spaceId)
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

  const menuOpen = focused && suggestions.length > 0

  useEffect(() => {
    if (!menuOpen) { setMenuRect(null); return }
    if (typeof window === 'undefined') return

    const update = () => {
      const el = containerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setMenuRect({ left: r.left, top: r.bottom + 4, width: r.width })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [menuOpen, suggestions.length])

  return (
    <div className="w-full relative" ref={containerRef}>
      <div className="input min-h-10 py-1 flex items-center gap-2 flex-wrap" onClick={() => inputRef.current?.focus()}>
        {value.map((n, i) => (
          <span key={`${n}-${i}`} className="pill pill-tag gap-2">
            <span>{n}</span>
            <button
              type="button"
              className="text-secondary hover:text-primary"
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
      {menuOpen && menuRect && createPortal(
        <div
          className="dropdown-menu z-[200]"
          style={{ position: 'fixed', left: menuRect.left, top: menuRect.top, width: menuRect.width }}
        >
          <div className="max-h-60 overflow-auto">
            {suggestions.map((s, i) => (
              <button
                key={`${s}-${i}`}
                type="button"
                className={`dropdown-item ${i === selectedIdx ? 'text-primary' : ''}`}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pushActivity(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}


