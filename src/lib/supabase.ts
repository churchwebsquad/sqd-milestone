import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// Vite browser builds inject `import.meta.env.*`. Node/tsx scripts
// load env into `process.env` instead. Fall back so importing this
// module from a script doesn't blow up at module-eval time before the
// script even gets a chance to pass its own client into our APIs.
const importMetaEnv = (() => {
  try { return (import.meta as { env?: Record<string, string | undefined> }).env ?? {} }
  catch { return {} }
})()
// `process` may not exist in the browser; reach for it through
// globalThis to keep TS happy without pulling in @types/node.
const procEnv: Record<string, string | undefined> =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {}
const supabaseUrl     = importMetaEnv.VITE_SUPABASE_URL     ?? procEnv.VITE_SUPABASE_URL
const supabaseAnonKey = importMetaEnv.VITE_SUPABASE_ANON_KEY ?? procEnv.VITE_SUPABASE_ANON_KEY
                       ?? procEnv.SUPABASE_SERVICE_ROLE_KEY   // scripts often only have this

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
