import Dexie, { type Table } from 'dexie'
import type {
  MetaKV,
  NoteRecord,
  SpaceRecord,
  TagRecord,
  FilterRecord,
  ActivityRecord,
  ChartRecord,
} from './types'

class AppDatabase extends Dexie {
  spaces!: Table<SpaceRecord, number>
  notes!: Table<NoteRecord, number>
  tags!: Table<TagRecord, number>
  filters!: Table<FilterRecord, number>
  activities!: Table<ActivityRecord, number>
  charts!: Table<ChartRecord, number>
  meta!: Table<MetaKV, string>

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
  }
}

export const db = new AppDatabase()

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
  await db.transaction('rw', [db.spaces, db.notes, db.tags, db.filters, db.activities, db.charts, db.meta], async () => {
    await Promise.all([
      db.spaces.clear(),
      db.notes.clear(),
      db.tags.clear(),
      db.filters.clear(),
      db.activities.clear(),
      db.charts.clear(),
      db.meta.clear(),
    ])
  })
} 