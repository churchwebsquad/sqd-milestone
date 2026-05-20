import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { markUpdateAvailable } from './hooks/useAppVersionCheck'

// Vite emits `vite:preloadError` when a dynamically imported chunk
// fails to load — almost always because the bundle was deployed and
// the hashed asset URL no longer exists. We trip the same "update
// available" prompt that the version-check hook uses so the user
// gets a chance to reload before losing in-progress work, instead
// of crashing on the failed import.
//
// `preventDefault()` keeps Vite from throwing the error to the
// console as an unhandled rejection — the toast surfaces it.
window.addEventListener('vite:preloadError', (event) => {
  console.warn('[preloadError] chunk load failed — prompting reload', event)
  markUpdateAvailable('chunk-load failure')
  event.preventDefault()
})

// Plain `error` events fire when a stylesheet or `<script>` tag fails
// to load (e.g. the index bundle's chunk that's been deleted post-
// deploy). Same handling: prompt for reload.
window.addEventListener('error', (event) => {
  const target = event.target as HTMLElement | null
  if (!target) return
  const tag = target.tagName
  if (tag === 'SCRIPT' || tag === 'LINK') {
    const src = (target as HTMLScriptElement).src ?? (target as HTMLLinkElement).href ?? ''
    if (src.includes('/assets/')) {
      console.warn('[asset load error] prompting reload', src)
      markUpdateAvailable('asset load failure')
    }
  }
}, /* useCapture */ true)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
