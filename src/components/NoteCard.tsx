import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { NoteRecord } from '../lib/types'
import { db } from '../lib/db'
// import HighlightedText from './HighlightedText'
import ParagraphText from './ParagraphText'
import NoteImages from './NoteImages'
import { formatExactDateTime, formatRelativeShort, formatDurationShort, parseDurationToMs } from '../lib/time'

export default function NoteCard({
  note,
  onEdit,
  onDelete,
  onOpenThread,
  childrenRight,
  showParentPreview = false,
  onTagClick,
  onActivityClick,
  hiddenTags,
}: {
  note: NoteRecord
  onEdit?: () => void
  onDelete?: () => void
  onOpenThread?: (nid: number) => void
  childrenRight?: React.ReactNode
  showParentPreview?: boolean
  onTagClick?: (tag: string) => void
  onActivityClick?: (name: string) => void
  hiddenTags?: Set<string>
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (!menuContainerRef.current) return
      if (!menuContainerRef.current.contains(target)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [menuOpen])
  const parentNote = useLiveQuery(() => showParentPreview && note.parentId ? db.notes.get(note.parentId) : Promise.resolve(undefined), [showParentPreview, note.parentId]) as NoteRecord | undefined
  const activities = useLiveQuery(async () => {
    const list = await db.activities.where('noteId').equals(note.id!).toArray()
    const filtered = list.filter(a => !a.deletedAt)
    // Deduplicate per typeId: prefer server-backed; fallback to most recent modifiedAt
    const bestByType = new Map<number, typeof filtered[number]>()
    for (const a of filtered) {
      const prev = bestByType.get(a.typeId)
      if (!prev) { bestByType.set(a.typeId, a); continue }
      const score = (Number(!!a.serverId) - Number(!!prev.serverId)) || ((a.modifiedAt || '').localeCompare(prev.modifiedAt || ''))
      if (score > 0) bestByType.set(a.typeId, a)
    }
    const deduped = Array.from(bestByType.values())
    // join names and valueTypes
    const types = await db.activityTypes.toArray()
    const byId = new Map(types.map(t => [t.serverId!, t]))
    return deduped.map(a => ({
      ...a,
      _name: byId.get(a.typeId)?.name || `#${a.typeId}`,
      _valueType: byId.get(a.typeId)?.valueType || 'text',
    }))
  }, [note.id]) as Array<any> || []

  return (
    <div className="card-nopad">
      <div className="h-[30px] relative">
        <div ref={menuContainerRef} className="absolute right-4 top-0 h-[30px] flex items-center">
          {(onEdit || onDelete) && (
            <div className="relative">
              <button className="px-1 text-neutral-400 hover:text-neutral-100 h-[30px]" onClick={() => setMenuOpen(s => !s)} aria-label="Open menu">⋯</button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 z-10 rounded border border-neutral-800 bg-neutral-900 shadow-lg">
                  {onEdit && <button className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => { setMenuOpen(false); onEdit() }}>Edit</button>}
                  {onDelete && <button className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => { setMenuOpen(false); onDelete() }}>Delete</button>}
                </div>
              )}
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
        {/* Render note text as paragraphs with spacing; keep highlight infra ready if needed later */}
        <ParagraphText className="text-primary" text={note.text} />
        {activities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {activities.map((a, i) => (
              <button
                key={`${a.serverId ?? a.id}-${i}`}
                type="button"
                className="inline-flex items-center rounded-full bg-neutral-800 px-2 py-1 text-xs text-secondary hover:bg-neutral-700 select-none"
                onClick={() => onActivityClick ? onActivityClick(a._name) : (onTagClick && onTagClick(a._name))}
                title={`${a._name}: ${a.valueRaw}`}
              >
                <span className="mr-1 text-neutral-300">{a._name}:</span>
                <span className="text-neutral-200">{(() => {
                  if (a?._valueType === 'time') {
                    const numMs = Number(a.valueRaw)
                    if (Number.isFinite(numMs)) return formatDurationShort(numMs)
                    const parsed = parseDurationToMs(String(a.valueRaw))
                    if (Number.isFinite(parsed)) return formatDurationShort(parsed)
                  }
                  return a.valueRaw
                })()}</span>
              </button>
            ))}
          </div>
        )}
        <NoteImages noteId={note.id!} />
        {note.tags?.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {note.tags.filter(t => !(hiddenTags?.has(t))).map((t, i) => (
              <button
                key={`${t}-${i}`}
                type="button"
                className="inline-flex items-center rounded-full bg-neutral-800 px-2 py-1 text-xs text-secondary hover:bg-neutral-700 select-none"
                onClick={() => onTagClick && onTagClick(t)}
                title={t}
              >
                {t}
              </button>
            ))}
          </div>
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


