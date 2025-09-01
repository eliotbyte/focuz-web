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
  notReply?: boolean
  sort?:
    | 'date,ASC' | 'date,DESC'
    | 'createdat,ASC' | 'createdat,DESC'
    | 'modifiedat,ASC' | 'modifiedat,DESC'
}

export interface FilterRecord {
  id?: number
  serverId?: number | null
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
  metricName: string
  value: number
  createdAt: string
  modifiedAt: string
  deletedAt?: string | null
  isDirty: 0 | 1
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