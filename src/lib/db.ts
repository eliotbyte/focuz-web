import Dexie, { type Table } from 'dexie'
import type {
  MetaKV,
  NoteRecord,
  SpaceRecord,
  TagRecord,
  FilterRecord,
  ActivityRecord,
  ChartRecord,
  AttachmentRecord,
  JobRecord,
} from './types'

class AppDatabase extends Dexie {
  spaces!: Table<SpaceRecord, number>
  notes!: Table<NoteRecord, number>
  tags!: Table<TagRecord, number>
  filters!: Table<FilterRecord, number>
  activities!: Table<ActivityRecord, number>
  charts!: Table<ChartRecord, number>
  meta!: Table<MetaKV, string>
  attachments!: Table<AttachmentRecord, number>
  jobs!: Table<JobRecord, number>

  constructor() {
    super('focuz-db')
    this.version(2).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, createdAt, modifiedAt, deletedAt, isDirty',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
    })
    this.version(3).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      // add indexes for parentId and date for efficient filter/sort
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
    })
    this.version(4).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, clientId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
      attachments: '++id, serverId, noteId, fileName, createdAt, modifiedAt, deletedAt, isDirty',
      jobs: '++id, kind, attachmentId, priority, status, attempts, createdAt, updatedAt',
    })
    // Bump version to add clientId to filters index without data loss
    this.version(5).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, clientId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
      attachments: '++id, serverId, noteId, fileName, createdAt, modifiedAt, deletedAt, isDirty',
      jobs: '++id, kind, attachmentId, priority, status, attempts, createdAt, updatedAt',
    })
    // Ensure the connection closes on external version changes (e.g., deleteDatabase in another tab)
    try { this.on('versionchange', () => { try { this.close() } catch {} }) } catch {}
  }
}

export let db = new AppDatabase()

export async function getKV<T = string>(key: string, fallback?: T): Promise<T | undefined> {
  const row = await db.meta.get(key)
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return (row.value as unknown as T) ?? fallback
  }
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value: JSON.stringify(value) })
}

export async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', [db.spaces, db.notes, db.tags, db.filters, db.activities, db.charts, db.meta, db.attachments, db.jobs], async () => {
    await Promise.all([
      db.spaces.clear(),
      db.notes.clear(),
      db.tags.clear(),
      db.filters.clear(),
      db.activities.clear(),
      db.charts.clear(),
      db.meta.clear(),
      db.attachments.clear(),
      db.jobs.clear(),
    ])
  })
} 

export async function deleteDatabase(): Promise<void> {
  try { db.close() } catch {}
  try {
    await Dexie.delete('focuz-db')
    return
  } catch {}
  // Native fallback in case Dexie.delete hangs due to stray connections
  await new Promise<void>((resolve, reject) => {
    try {
      const req = indexedDB.deleteDatabase('focuz-db')
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
      req.onblocked = () => {
        // Leave unresolved; caller should retry after closing blockers
      }
    } catch (e) {
      reject(e as any)
    }
  })
}

export async function deleteDatabaseWithRetry(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (true) {
    try { await deleteDatabase(); return } catch {}
    if (Date.now() - start > timeoutMs) throw new Error('Timed out deleting focuz-db')
    try { db.close() } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
}

export async function ensureDbOpen(): Promise<void> {
  try {
    // Dexie has isOpen(); guard for typings
    const isOpen = typeof (db as any).isOpen === 'function' ? (db as any).isOpen() : true
    if (isOpen) return
  } catch {}
  try {
    await db.open()
    return
  } catch {
    try { db.close() } catch {}
    db = new AppDatabase()
    await db.open()
  }
}