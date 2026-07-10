/* eslint-disable */
import { readFileSync, existsSync } from 'node:fs'
for (const envPath of ['.env.local', '.env']) {
  if (!existsSync(envPath)) continue
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[k] == null) process.env[k] = v
  }
}
const handler = (await import('../api/web/cowork/page-context-bundle.js')).default
const req: any = { method: 'GET', query: { project_id: '2eac7eb8-269d-4584-84a4-3dc9fdd6fcde' } }
let body: string | null = null
const res: any = {
  status(_: number) { return this },
  json(o: unknown) { body = JSON.stringify(o); return this },
  send(s: string) { body = s; return this },
  setHeader() {},
}
await handler(req, res)
const bundle = JSON.parse(body!)
console.log('bundle bytes:           ', body!.length)
console.log('site_strategy present:  ', bundle.site_strategy != null)
console.log('  .pages length:        ', bundle.site_strategy?.pages?.length ?? null)
console.log('  .persona_journeys?:   ', Array.isArray(bundle.site_strategy?.persona_journeys), '(len', bundle.site_strategy?.persona_journeys?.length ?? '-', ')')
console.log('  .page_elevations?:    ', Array.isArray(bundle.site_strategy?.page_elevations), '(len', bundle.site_strategy?.page_elevations?.length ?? '-', ')')
console.log('  .nav_change_level:    ', bundle.site_strategy?.nav_change_level ?? null)
console.log('acf_plan present:       ', bundle.acf_plan != null)
console.log('  .atom_routes length:  ', bundle.acf_plan?.atom_routes?.length ?? null)
console.log('  .fact_routes length:  ', bundle.acf_plan?.fact_routes?.length ?? null)
console.log('  .cell_density length: ', bundle.acf_plan?.cell_density?.length ?? null)
console.log('  .coverage_gaps length:', bundle.acf_plan?.coverage_gaps?.length ?? null)
