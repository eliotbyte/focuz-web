export interface MetaKV {
  key: string
  value: string
}

export interface SpaceRecord {
  id?: number
  serverId?: number | null
  name: string
  createdAt: string
  modifiedAt: string
  deletedAt?: string | null
  isDirty: 0 | 1
}

export interface NoteRecord {
  id?: number
  serverId?: number | null
  clientId?: string | null
  spaceId: number
  title?: string | null
  text: string
  tags: string[]
  createdAt: string
  modifiedAt: string
  date?: string
  parentId?: number | null
  deletedAt?: string | null
  isDirty: 0 | 1
}

export interface NoteConflictRecord {
  id?: number
  noteLocalId: number
  noteServerId: number
  reason: string
  // Local snapshot of the note at conflict time. Keep it JSON-friendly.
  local: {
    serverId?: number | null
    clientId?: string | null
    spaceId: number
    title?: string | null
    text: string
    tags: string[]
    createdAt: string
    modifiedAt: string
    date?: string
    parentId?: number | null
    deletedAt?: string | null
  }
  // Server snapshot returned by API (shape depends on backend response).
  server?: any
  createdAt: string
  isResolved: 0 | 1
  resolvedAt?: string | null
}

export interface AttachmentRecord {
  id?: number
  serverId?: string | null
  // Stable client-generated id used for idempotent uploads.
  // Prevents duplicate server attachments on retries/timeouts.
  clientId?: string | null
  noteId: number
  fileName: string
  fileType: string
  fileSize: number
  // locally cached transformed image data (WebP). May be absent until downloaded
  data?: Blob | null
  createdAt: string
  modifiedAt: string
  deletedAt?: string | null
  isDirty: 0 | 1
}

export type JobStatus = 'pending' | 'running' | 'failed'
export type JobKind = 'attachment-upload' | 'attachment-download'

export interface JobRecord {
  id?: number
  kind: JobKind
  attachmentId: number
  priority: number
  status: JobStatus
  attempts: number
  createdAt: string
  updatedAt: string
}

export interface TagRecord {
  id?: number
  serverId?: number | null
  spaceId: number
  name: string
  createdAt: string
  modifiedAt: string
  deletedAt?: string | null
  isDirty: 0 | 1
}

export interface FilterParams {
  textContains?: string
  includeTags?: string[]
  excludeTags?: string[]
  includeActivities?: string[]
  notReply?: boolean
  sort?:
    | 'date,ASC' | 'date,DESC'
    | 'createdat,ASC' | 'createdat,DESC'
    | 'modifiedat,ASC' | 'modifiedat,DESC'
}

export interface FilterRecord {
  id?: number
  serverId?: number | null
  clientId?: string | null
  spaceId: number
  parentId?: number | null
  name: string
  params: FilterParams
  createdAt: string
  modifiedAt: string
  deletedAt?: string | null
  isDirty: 0 | 1
}

export interface ActivityRecord {
  id?: number
  serverId?: number | null
  noteId: number
  typeId: number
  // Raw value as string normalized per type (e.g., "4532", "true", RFC3339 timestamp, or free text)
  valueRaw: string
  createdAt: string
  modifiedAt: string
  deletedAt?: string | null
  isDirty: 0 | 1
}

export interface ActivityTypeRecord {
  id?: number
  serverId?: number | null
  spaceId: number
  name: string
  valueType: 'integer' | 'float' | 'boolean' | 'text' | 'time'
  minValue?: number | null
  maxValue?: number | null
  aggregation?: string | null
  unit?: string | null
  categoryId?: number | null
  createdAt: string
  modifiedAt: string
  deletedAt?: string | null
}

export interface ChartRecord {
  id?: number
  serverId?: number | null
  noteId: number
  settings: Record<string, unknown>
  createdAt: string
  modifiedAt: string
  deletedAt?: string | null
  isDirty: 0 | 1
} 