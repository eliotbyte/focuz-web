import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { NoteRecord } from '../lib/types'
import { db } from '../lib/db'
import HighlightedText from './HighlightedText'
import NoteImages from './NoteImages'
import { formatExactDateTime, formatRelativeShort } from '../lib/time'

export default function NoteCard({
  note,
  onEdit,
  onDelete,
  onOpenThread,
  childrenRight,
  showParentPreview = false,
}: {
  note: NoteRecord
  onEdit?: () => void
  onDelete?: () => void
  onOpenThread?: (nid: number) => void
  childrenRight?: React.ReactNode
  showParentPreview?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const parentNote = useLiveQuery(() => showParentPreview && note.parentId ? db.notes.get(note.parentId) : Promise.resolve(undefined), [showParentPreview, note.parentId]) as NoteRecord | undefined

  return (
    <div className="card-nopad">
      <div className="h-[30px] relative">
        <div className="absolute right-4 top-0 h-[30px] flex items-center">
          {(onEdit || onDelete) && (
            <button className="px-1 text-neutral-400 hover:text-neutral-100 h-[30px]" onClick={() => setMenuOpen(s => !s)} aria-label="Open menu">⋯</button>
          )}
          {menuOpen && (
            <div className="absolute right-0 mt-1 z-10 rounded border border-neutral-800 bg-neutral-900 shadow-lg">
              {onEdit && <button className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => { setMenuOpen(false); onEdit() }}>Edit</button>}
              {onDelete && <button className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => { setMenuOpen(false); onDelete() }}>Delete</button>}
            </div>
          )}
        </div>
      </div>
      <div className="px-4 min-w-0">
        {showParentPreview && note.parentId != null && parentNote && !parentNote.deletedAt && (
          <div className="mb-2 min-w-0 max-w-full">
            <button
              className="block w-full max-w-full min-w-0 box-border rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-secondary hover:bg-neutral-800 select-none overflow-hidden text-left"
              type="button"
              onClick={() => onOpenThread && onOpenThread(parentNote.id!)}
              title={parentNote.text}
            >
              <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{parentNote.text}</span>
            </button>
          </div>
        )}
        <HighlightedText className="block whitespace-pre-wrap leading-6 text-primary" text={note.text} query={''} />
        <NoteImages noteId={note.id!} />
        {note.tags?.length ? (
          <div className="mt-2 text-secondary">{note.tags.join(', ')}</div>
        ) : null}
      </div>
      <div className="px-4 py-2 text-secondary flex items-center justify-between">
        {onOpenThread ? (
          <button className="flex items-center gap-2 text-neutral-400 hover:text-neutral-100" title={formatExactDateTime(note.createdAt)} onClick={() => onOpenThread(note.id!)}>
            <span>{note.isDirty ? '✔' : '✔✔'}</span>
            <span>{formatRelativeShort(note.createdAt)}</span>
          </button>
        ) : (
          <div className="flex items-center gap-2" title={formatExactDateTime(note.createdAt)}>
            <span>{note.isDirty ? '✔' : '✔✔'}</span>
            <span>{formatRelativeShort(note.createdAt)}</span>
          </div>
        )}
        <div className="flex items-center gap-3">{childrenRight}</div>
      </div>
    </div>
  )
}


