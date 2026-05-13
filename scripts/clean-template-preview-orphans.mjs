// Cleans orphaned JPG previews in brand-assets/web-templates/ — any
// object whose filename stem doesn't match a current web_content_templates.id.
//
// Why: when the parser re-imports against a new variant numbering
// (e.g. after Brixies fixes export bugs), old preview JPGs uploaded
// against the prior ids become orphans. The Supabase storage API
// blocks raw `DELETE FROM storage.objects` so we have to go through
// supabase.storage.remove() for proper file cleanup.
//
// Idempotent: re-running with no orphans is a no-op.

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

for (const envFile of ['.env.local', '.env']) {
  const envPath = path.join(projectRoot, envFile)
  if (!fs.existsSync(envPath)) continue
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const { data: tpls, error: tErr } = await supabase
  .from('web_content_templates')
  .select('id')
if (tErr) { console.error(tErr); process.exit(1) }
const validIds = new Set(tpls.map(t => t.id))
console.log(`Current templates: ${validIds.size}`)

const { data: objs, error: lErr } = await supabase
  .storage.from('brand-assets').list('web-templates', { limit: 1000 })
if (lErr) { console.error(lErr); process.exit(1) }
console.log(`Storage objects in web-templates/: ${objs.length}`)

const orphans = objs
  .map(o => o.name)
  .filter(name => !validIds.has(path.basename(name, path.extname(name)).toLowerCase()))
console.log(`Orphans to delete: ${orphans.length}`)

if (orphans.length === 0) { console.log('Nothing to clean.'); process.exit(0) }

const paths = orphans.map(n => `web-templates/${n}`)
const { data: removed, error: rErr } = await supabase
  .storage.from('brand-assets').remove(paths)
if (rErr) { console.error(rErr); process.exit(1) }
console.log(`Deleted: ${removed.length}`)
