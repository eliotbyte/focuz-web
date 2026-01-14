import { Toaster } from 'sonner'
import { useThemeMode } from '../lib/theme'

export function AppToaster() {
  const themeMode = useThemeMode()
  const isLight = themeMode === 'light'
  return (
    <Toaster
      position="bottom-right"
      theme={themeMode}
      closeButton
      toastOptions={{
        classNames: {
          toast: isLight
            ? 'rounded-lg border border-neutral-200 bg-white/80 text-neutral-900 shadow-lg backdrop-blur'
            : 'rounded-lg border border-neutral-800 bg-neutral-900/80 text-neutral-100 shadow-lg backdrop-blur',
          title: 'text-sm',
          description: isLight ? 'text-xs text-neutral-600' : 'text-xs text-neutral-400',
          actionButton: 'button',
          closeButton: 'text-neutral-400 hover:text-neutral-100',
        },
      }}
    />
  )
}

