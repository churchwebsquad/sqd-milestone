import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

// Compute a build version once per build. Used by the in-app
// "Update available — Reload" check so staff who keep tabs open across
// deploys get prompted to refresh instead of running stale bundles.
//
// Resolution order:
//   1. VERCEL_GIT_COMMIT_SHA — set automatically by Vercel CI
//   2. `git rev-parse HEAD` — local git checkouts
//   3. Build timestamp — last-resort fallback (still strictly increasing)
function resolveAppVersion(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)
  }
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim().slice(0, 12)
  } catch {
    return `t${Date.now()}`
  }
}

const appVersion = resolveAppVersion()

/** Emits `dist/version.json` so the running client can poll it and
 *  detect when a new build has been deployed. Public, tiny, fetched
 *  with `cache: 'no-store'` from the client. */
function versionManifestPlugin(): Plugin {
  return {
    name: 'version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: appVersion, builtAt: new Date().toISOString() }) + '\n',
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    versionManifestPlugin(),
  ],
  define: {
    // Inlined into the bundle. Compared client-side against the
    // version.json the server is currently serving to detect deploys.
    __APP_VERSION__: JSON.stringify(appVersion),
  },
})
