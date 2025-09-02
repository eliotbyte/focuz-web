import { useEffect, useMemo, useRef, useState } from 'react'
import TagsInput from './TagsInput'

export type NoteEditorMode = 'create' | 'edit' | 'reply'

export interface NoteEditorValue {
  text: string
  tags: string[]
}

export default function NoteEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
  mode = 'create',
  autoCollapse = true,
  variant = 'card',
}: {
  value: NoteEditorValue
  onChange: (v: NoteEditorValue) => void
  onSubmit: () => void
  onCancel?: () => void
  mode?: NoteEditorMode
  autoCollapse?: boolean
  variant?: 'card' | 'embedded'
}) {
  const [expanded, setExpanded] = useState<boolean>(mode !== 'create' ? true : false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  const canSubmit = useMemo(() => value.text.trim().length > 0, [value.text])

  useEffect(() => {
    if (expanded) textRef.current?.focus()
  }, [expanded])

  function collapseIfNeeded() {
    if (autoCollapse && mode === 'create') setExpanded(false)
  }

  if (!expanded) {
    return (
      <div className="card p-2">
        <button
          type="button"
          className="w-full text-left text-sm text-neutral-400 rounded px-1 py-1 hover:text-neutral-200"
          onClick={() => setExpanded(true)}
        >
          Add note…
        </button>
      </div>
    )
  }

  const containerClass = variant === 'card' ? 'card space-y-3' : 'space-y-3'

  return (
    <div className={containerClass}>
      <textarea
        ref={textRef}
        className="input min-h-24 text-primary"
        placeholder="Add note…"
        value={value.text}
        onChange={e => onChange({ ...value, text: e.target.value })}
      />
      <TagsInput value={value.tags} onChange={tags => onChange({ ...value, tags })} placeholder="Add tags" />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button className="button" onClick={() => { onCancel(); collapseIfNeeded() }}>Cancel</button>
        )}
        <button className="button" onClick={() => { onSubmit(); collapseIfNeeded() }} disabled={!canSubmit}>{mode === 'edit' ? 'Update' : 'Add'}</button>
      </div>
    </div>
  )
} 