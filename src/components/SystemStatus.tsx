import { useEffect, useRef } from 'react'
import { useAppState } from '../lib/app-state'
import { appEnv, isTest } from '../lib/app-env'
import { notify } from '../ui/notify'
import { formatRelativeShort } from '../lib/time'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export function SystemStatusInline() {
  const online = useAppState(s => s.online)
  const syncing = useAppState(s => s.syncing)
  const lastSyncAt = useAppState(s => s.lastSyncAt)
  const syncError = useAppState(s => s.syncError)
  const authRequired = useAppState(s => s.authRequired)
  const jobsFailedCount = useAppState(s => s.jobsFailedCount)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="pill !px-4 !py-3"
          aria-label="System status"
        >
          <span className="text-primary">{online ? 'online' : 'offline'}</span>
          {syncing ? <span className="text-primary">syncing…</span> : null}
          {!syncing && lastSyncAt ? <span className="text-secondary" title={lastSyncAt}>synced</span> : null}
          {syncError ? <span className="text-primary" title={syncError}>sync error</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="p-3 w-72">
        <div className="text-title text-muted mb-3">Status</div>
        <div className="space-y-3 text-secondary">
          <div className="flex items-center justify-between">
            <span>Network</span>
            <span className="text-primary">{online ? 'Online' : 'Offline'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Sync</span>
            <span className="text-primary">{syncing ? 'Syncing…' : 'Idle'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Last sync</span>
            <span className="text-primary" title={lastSyncAt || ''}>
              {lastSyncAt ? formatRelativeShort(lastSyncAt) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Attachments</span>
            <span className="text-primary">
              {jobsFailedCount > 0 ? `${jobsFailedCount} failed` : 'OK'}
            </span>
          </div>
          {isTest ? (
            <div className="flex items-center justify-between">
              <span>Env</span>
              <span className="text-primary">{appEnv}</span>
            </div>
          ) : null}
          {syncError ? (
            <div className="pt-3 border-t border-transparent">
              <div className="text-primary">Sync error</div>
              <div className="text-secondary break-words">{syncError}</div>
            </div>
          ) : null}
          {authRequired ? (
            <div className="pt-3 border-t border-transparent">
              <div className="text-primary">Auth required</div>
              <div className="text-secondary">Please sign in again.</div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Centralized UI layer for system statuses.
// Important: this module does NOT import sync logic. It reacts to app-state only.
export function SystemStatusLayer() {
  const online = useAppState(s => s.online)
  const authRequired = useAppState(s => s.authRequired)
  const syncError = useAppState(s => s.syncError)
  const lastConflictAt = useAppState(s => s.lastConflictAt)
  const lastConflictCount = useAppState(s => s.lastConflictCount)
  const lastJobFailureAt = useAppState(s => s.lastJobFailureAt)
  const lastJobFailureKind = useAppState(s => s.lastJobFailureKind)
  const lastJobFailureMessage = useAppState(s => s.lastJobFailureMessage)

  const prevOnlineRef = useRef<boolean | null>(null)
  const lastErrorShownRef = useRef<string | null>(null)
  const lastConflictShownAtRef = useRef<string | null>(null)
  const lastAuthToastAtMsRef = useRef<number>(0)
  const lastJobToastAtRef = useRef<string | null>(null)

  useEffect(() => {
    const prev = prevOnlineRef.current
    prevOnlineRef.current = online
    if (prev == null) return
    if (!online) notify('Offline mode', 'warning', { durationMs: 4000, id: 'sys-offline' })
    if (online && prev === false) notify('Back online', 'success', { durationMs: 2500, id: 'sys-online' })
  }, [online])

  useEffect(() => {
    if (!syncError) { lastErrorShownRef.current = null; return }
    if (lastErrorShownRef.current === syncError) return
    lastErrorShownRef.current = syncError
    notify('Sync error', 'error', { durationMs: 6000 })
  }, [syncError])

  useEffect(() => {
    if (!lastConflictAt) return
    if (lastConflictShownAtRef.current === lastConflictAt) return
    lastConflictShownAtRef.current = lastConflictAt
    notify(
      lastConflictCount > 1 ? `Обнаружены конфликты данных (${lastConflictCount})` : 'Обнаружен конфликт данных',
      'warning',
      { durationMs: 8000 },
    )
  }, [lastConflictAt, lastConflictCount])

  useEffect(() => {
    if (!authRequired) return
    const now = Date.now()
    if (now - lastAuthToastAtMsRef.current < 30000) return
    lastAuthToastAtMsRef.current = now
    notify('Session expired — please sign in again', 'warning', { durationMs: 8000, id: 'sys-auth-required' })
  }, [authRequired])

  useEffect(() => {
    if (!lastJobFailureAt) return
    if (lastJobToastAtRef.current === lastJobFailureAt) return
    lastJobToastAtRef.current = lastJobFailureAt
    const label = lastJobFailureKind === 'attachment-download'
      ? 'Attachment download failed'
      : 'Attachment upload failed'
    const extra = lastJobFailureMessage ? `: ${lastJobFailureMessage}` : ''
    notify(`${label}${extra}`, 'error', { durationMs: 8000 })
  }, [lastJobFailureAt, lastJobFailureKind, lastJobFailureMessage])

  return null
}

