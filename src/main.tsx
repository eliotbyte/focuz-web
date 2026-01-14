import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/700.css'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { toast } from 'sonner'
import { applyStoredTheme } from './lib/theme'

applyStoredTheme()

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast('Доступно обновление', {
      id: 'pwa-update-available',
      description: 'Обновление будет применено автоматически.',
      duration: 3500,
      action: {
        label: 'Обновить',
        onClick: () => { void updateSW(true) },
      },
    })
    // Auto-apply updates so UI changes are not stuck behind SW cache during dev in Docker.
    setTimeout(() => { void updateSW(true) }, 400)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
