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
}: {
  value: NoteEditorValue
  onChange: (v: NoteEditorValue) => void
  onSubmit: () => void
  onCancel?: () => void
  mode?: NoteEditorMode
  autoCollapse?: boolean
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
      <div className="card">
        <textarea
          ref={textRef}
          className="input h-8 resize-none overflow-hidden"
          placeholder="Add note…"
          value=""
          onFocus={() => setExpanded(true)}
          readOnly
        />
      </div>
    )
  }

  return (
    <div className="card space-y-3">
      <textarea
        ref={textRef}
        className="input min-h-24"
        placeholder="Add note…"
        value={value.text}
        onChange={e => onChange({ ...value, text: e.target.value })}
      />
      <TagsInput value={value.tags} onChange={tags => onChange({ ...value, tags })} placeholder="Add tags" />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button className="button" onClick={() => { onCancel(); collapseIfNeeded() }}>Cancel</button>
        )}
        <button className="button" onClick={() => { onSubmit(); collapseIfNeeded() }} disabled={!canSubmit}>Add</button>
      </div>
    </div>
  )
} 