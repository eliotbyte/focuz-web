import { useEffect, useState } from 'react'
import { initToasts, getToasts, subscribe, dismissToast, invokeAction, type ToastItem } from '../lib/toast'

export default function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    initToasts().catch(() => {})
    const off = subscribe(() => setItems(getToasts()))
    setItems(getToasts())
    return () => { off() }
  }, [])

  return (
    <div className="fixed right-4 bottom-4 z-[70] flex flex-col gap-2">
      {items.filter(t => !t.dismissedAt).map(t => (
        <div key={t.id} className="min-w-[220px] max-w-sm rounded border border-neutral-800 bg-neutral-900 shadow-lg p-3 text-sm text-secondary">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              {t.message}
              {t.action && (
                <div className="mt-2">
                  <button className="button" onClick={() => invokeAction(t.id)}>Undo</button>
                </div>
              )}
            </div>
            <button className="px-1 text-neutral-400 hover:text-neutral-100" onClick={() => dismissToast(t.id)} aria-label="Dismiss">×</button>
          </div>
        </div>
      ))}
    </div>
  )
}


