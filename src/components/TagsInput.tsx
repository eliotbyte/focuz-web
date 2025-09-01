import { useEffect, useMemo, useRef, useState } from 'react'

export default function TagsInput({ value, onChange, placeholder, className }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState<string>('')
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
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === ' ' || e.key === ';') {
      e.preventDefault()
      pushTag(draft)
      return
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
    if (draft.trim()) pushTag(draft)
  }

  function removeTag(idx: number) {
    const next = value.filter((_, i) => i !== idx)
    onChange(next)
  }

  const containerClasses = useMemo(() => {
    const base = 'input min-h-10 py-1 flex items-center gap-2 flex-wrap'
    return className ? `${base} ${className}` : base
  }, [className])

  return (
    <div className={containerClasses} onClick={() => inputRef.current?.focus()}>
      {value.map((tag, idx) => (
        <span key={`${tag}-${idx}`} className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-1 text-xs">
          <span>{tag}</span>
          <button type="button" className="text-neutral-400 hover:text-neutral-200" onClick={() => removeTag(idx)} aria-label={`Remove ${tag}`}>×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="bg-transparent outline-none flex-1 min-w-24 text-sm"
        value={draft}
        placeholder={value.length === 0 ? (placeholder || 'Add tags') : ''}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  )
} 