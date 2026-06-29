/* eslint-disable */
// Backfill Initial Site Access + hosting/domain fields from the
// "All-In Discovery" Airtable CSV exports into Supabase.
//
// Scope (locked):
//   - 5 booleans on strategy_account_progress (web_squad_* checkboxes)
//   - 4 fields on strategy_content_collection_sessions (current_host,
//     domain_registrar_url, domain_credential_method, domain_invite_confirmed)
//
// NOT in scope (intentionally excluded):
//   - Hosting / domain USERNAMES + PASSWORDS — not stored in Supabase,
//     live in 1Password. We don't write them anywhere.
//   - Discovery questionnaire fields beyond what's listed above.
//
// Slack-notification safety:
//   - The only Slack post in this flow fires from the React UI when a
//     user clicks `web_squad_ready_for_evaluation` to true. SQL writes
//     bypass that handler entirely. No DB triggers post to Slack.
//   - This script writes via the service role + direct UPDATE statements;
//     no edge functions are called.
//
// Run with: npx tsx scripts/backfill/initial-site-access.ts [--apply]
//   Default is DRY RUN — prints proposed changes, makes no writes.

import { createClient } from '@supabase/supabase-js'
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

const APPLY = process.argv.includes('--apply')

// ── Source data: CSV → typed rows ────────────────────────────────────
// Only safe-to-store values. Booleans derived from "checked" cells.
// Credentials intentionally omitted.

interface BackfillRow {
  member:                       number
  church_name:                  string
  // strategy_account_progress booleans:
  site_access_provided?:        boolean
  ga_access_shared?:            boolean
  ready_for_evaluation?:        boolean
  hosting_details_provided?:    boolean
  domain_registrar_provided?:   boolean
  // strategy_content_collection_sessions text/boolean:
  current_host?:                string   // platform name, e.g. "Wordpress"
  domain_registrar_url?:        string
  domain_credential_method?:    string
  domain_invite_confirmed?:     boolean
}

const ROWS: BackfillRow[] = [
  { member: 3549, church_name: 'Amplify Church',                              site_access_provided: true,  current_host: 'Subsplash' },
  { member: 1651, church_name: 'Mission Viejo Christian Church',              site_access_provided: true,  current_host: 'Subsplash' },
  { member: 1961, church_name: 'The MET Church',                              site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Church Co' },
  { member: 3211, church_name: 'Parkview Baptist Church',                     site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Subsplash' },
  { member: 3500, church_name: 'The Fields Church',                           current_host: 'Wordpress' },
  { member: 3061, church_name: 'Real Life Church',                            site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Wordpress' },
  { member: 2542, church_name: 'Transformation Church',                       site_access_provided: true,  ready_for_evaluation: true, hosting_details_provided: true, domain_registrar_provided: true, current_host: 'Wordpress', domain_registrar_url: 'NetworkSolutions.com', domain_credential_method: 'Directly share login credentials with TheSquad.' },
  { member: 3417, church_name: 'Greenhouse',                                  current_host: 'Wordpress' },
  { member: 2787, church_name: 'Church on the Rock',                          site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Subsplash' },
  { member: 3585, church_name: 'Awaken Las Vegas',                            site_access_provided: true,  ready_for_evaluation: true, current_host: 'Wordpress,Other' },
  { member: 1802, church_name: 'Mosaic',                                      site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, hosting_details_provided: true, current_host: 'Squarespace' },
  { member: 3602, church_name: 'The Axis Church',                             site_access_provided: true,  ready_for_evaluation: true, current_host: 'Squarespace' },
  { member: 3201, church_name: '360 Church',                                  site_access_provided: true,  ready_for_evaluation: true, current_host: 'Wordpress' },
  { member: 3604, church_name: 'Christ Community Church',                     site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Wordpress' },
  { member: 3271, church_name: 'One City Church',                             domain_registrar_provided: true, current_host: 'Church Co', domain_registrar_url: 'https://www.godaddy.com', domain_credential_method: 'Directly share login credentials with TheSquad.' },
  { member: 3620, church_name: 'Venture Church',                              site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Other' },
  { member: 3618, church_name: 'Friends Church Yorba Linda',                  site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Webflow' },
  { member: 3249, church_name: 'First Presbyterian Church of Charlotte',      site_access_provided: true,  hosting_details_provided: true, domain_registrar_provided: true, current_host: 'Wordpress,Other', domain_credential_method: 'Create a "limited access user account" for TheSquad through your domain registrar.', domain_invite_confirmed: true },
  { member: 1738, church_name: 'Resurrection Church',                         site_access_provided: true,  ready_for_evaluation: true, current_host: 'Squarespace' },
  { member: 3648, church_name: 'Breakaway',                                   site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Other' },
  { member: 3656, church_name: 'Lighthouse Church',                           site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Other' },
  { member: 3634, church_name: 'Valley Church',                               current_host: 'Wordpress' },
  { member: 2282, church_name: 'Real Life on the Palouse',                    site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Church Co' },
  { member: 2266, church_name: 'Lakeshore Community Church',                  site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Other' },
  { member: 3640, church_name: 'Triumph Lutheran Brethren Church',            site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Squarespace' },
  { member: 3668, church_name: 'Family Church',                               site_access_provided: true,  ready_for_evaluation: true, hosting_details_provided: true, current_host: 'Wordpress', domain_invite_confirmed: true },
  { member: 3660, church_name: 'Journey Church',                              site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Wix' },
  { member: 3482, church_name: 'Redeemer Church',                             site_access_provided: true,  ready_for_evaluation: true, current_host: 'Church Co' },
  { member: 3672, church_name: 'Canyon Del Oro Bible Church',                 site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Wordpress' },
  { member: 3529, church_name: 'Calvary Chapel Northside',                    current_host: 'Subsplash' },
  { member: 3706, church_name: 'Transformation Church (TLH)',                 site_access_provided: true,  ready_for_evaluation: true, current_host: 'Squarespace' },
  { member: 2395, church_name: 'The Hills Church',                            site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Wordpress,Other' },
  { member: 3752, church_name: 'FiveStone Community Church',                  site_access_provided: true,  ready_for_evaluation: true, current_host: 'Church Co' },
  { member: 3738, church_name: 'Faith Journey Church',                        site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Other' },
  { member: 3680, church_name: 'Lakeway Church',                              site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Wordpress' },
  { member: 2905, church_name: 'Trinity Church',                              site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Church Co' },
  { member: 3768, church_name: 'Calvary Christian Center',                    current_host: 'Wordpress' },
  { member: 3792, church_name: 'Shreveport Community Church',                 site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Church Co' },
  { member: 2846, church_name: 'Evangel Christian Churches',                  site_access_provided: true,  ready_for_evaluation: true, current_host: 'Squarespace' },
  { member: 3237, church_name: 'Mercy Hill Church',                           current_host: 'Wordpress' },
  { member: 3730, church_name: 'The Fellowship Church',                       site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Church Co' },
  { member: 2732, church_name: 'Believers Church',                            current_host: 'Subsplash' },
  { member: 3808, church_name: 'Lighthouse Christian Center',                 site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Squarespace' },
  { member: 1963, church_name: 'Doxology Bible Church',                       site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Webflow' },
  { member: 3782, church_name: 'Iglesia Betania',                             site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Squarespace' },
  { member: 3734, church_name: 'Arvada Vineyard',                             site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, hosting_details_provided: true, domain_registrar_provided: true, current_host: 'Wordpress', domain_registrar_url: 'www.squarespace.com', domain_credential_method: 'Directly share login credentials with TheSquad.' },
  { member: 3804, church_name: 'Timberline Church',                           ga_access_shared: true, current_host: 'Other' },
  { member: 3842, church_name: 'Faith Promise Church',                        current_host: 'Webflow' },
  { member: 3858, church_name: 'Mountain Life Church',                        site_access_provided: true,  ready_for_evaluation: true, current_host: 'Wordpress' },
  { member: 3726, church_name: 'Doxa Church',                                 site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Squarespace' },
  { member: 3886, church_name: 'Desert Springs Church',                       site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Wordpress' },
  { member: 3987, church_name: 'Citygate Church',                             site_access_provided: true,  current_host: 'Wordpress' },
  { member: 4003, church_name: 'Hillcrest Baptist Church',                    current_host: 'Other' },
  { member: 3894, church_name: 'Zion Church',                                 current_host: 'Squarespace' },
  { member: 2186, church_name: 'CityBridge Community Church',                 site_access_provided: true,  ready_for_evaluation: true, domain_registrar_provided: true, current_host: 'Squarespace', domain_registrar_url: 'godaddy.com', domain_credential_method: 'Create a "limited access user account" for TheSquad through your domain registrar.', domain_invite_confirmed: true },
  { member: 4017, church_name: 'Bayside Community Church',                    site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, current_host: 'Other' },
  { member: 4029, church_name: 'Calvary Christian Assembly of God',           current_host: 'Wix' },
  { member: 3005, church_name: 'Paradox Church',                              site_access_provided: true,  ready_for_evaluation: true, current_host: 'Squarespace' },
  { member: 4037, church_name: 'Coastal Church',                              current_host: 'Webflow' },
  { member: 4031, church_name: 'Sycamore Creek Church',                       current_host: 'Subsplash' },
  { member: 4045, church_name: "The Father's House SF",                       current_host: 'Squarespace' },
  { member: 2487, church_name: 'Suncrest Church',                             current_host: 'Subsplash' },
  { member: 4071, church_name: 'Woodcreek Church',                            site_access_provided: true,  ga_access_shared: true, ready_for_evaluation: true, hosting_details_provided: true, domain_registrar_provided: true, current_host: 'Wordpress', domain_registrar_url: 'https://sso.godaddy.com', domain_credential_method: 'Create a "limited access user account" for TheSquad through your domain registrar.' },
  { member: 4065, church_name: 'Element Church',                              current_host: 'Wordpress' },
  { member: 3132, church_name: 'Calvary Church',                              current_host: 'Squarespace' },
  { member: 2778, church_name: 'Providence Church',                           current_host: 'Wordpress' },
  { member: 4058, church_name: 'Village Chapel',                              current_host: 'Subsplash' },
  { member: 3979, church_name: 'New Life Church',                             current_host: 'Other' },
  { member: 4063, church_name: 'Eagles Nest Church',                          current_host: 'Wordpress' },
  { member: 4077, church_name: 'Friends Church',                              current_host: 'Squarespace' },
  { member: 3581, church_name: 'Impact Christian Church',                     current_host: 'Wordpress' },
]

// ── Run ──────────────────────────────────────────────────────────────

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

interface AccountRow {
  member: number
  web_squad_site_access_provided:      boolean | null
  web_squad_ga_access_shared:          boolean | null
  web_squad_ready_for_evaluation:      boolean | null
  web_squad_hosting_details_provided:  boolean | null
  web_squad_domain_registrar_provided: boolean | null
}

interface SessionRow {
  id: string
  web_project_id: string
  current_host:              string | null
  domain_registrar_url:      string | null
  domain_credential_method:  string | null
  domain_invite_confirmed:   boolean | null
  created_at: string
}

const members = ROWS.map(r => r.member)

const { data: accountRows, error: accErr } = await sb
  .from('strategy_account_progress')
  .select('member, web_squad_site_access_provided, web_squad_ga_access_shared, web_squad_ready_for_evaluation, web_squad_hosting_details_provided, web_squad_domain_registrar_provided')
  .in('member', members)
if (accErr) throw accErr
const accountByMember = new Map((accountRows as AccountRow[]).map(r => [r.member, r]))

// Sessions: need to map member → web_project_id → session.
const { data: projects, error: projErr } = await sb
  .from('strategy_web_projects')
  .select('id, member')
  .in('member', members)
if (projErr) throw projErr
const projectByMember = new Map((projects as Array<{ id: string; member: number }>).map(p => [p.member, p.id]))
const projectIds = (projects as Array<{ id: string; member: number }>).map(p => p.id)

const { data: sessions, error: sessErr } = projectIds.length === 0
  ? { data: [] as SessionRow[], error: null }
  : await sb
      .from('strategy_content_collection_sessions')
      .select('id, web_project_id, current_host, domain_registrar_url, domain_credential_method, domain_invite_confirmed, created_at')
      .in('web_project_id', projectIds)
      .order('created_at', { ascending: false })
if (sessErr) throw sessErr
// Take the latest session per project.
const latestSessionByProjectId = new Map<string, SessionRow>()
for (const s of (sessions as SessionRow[])) {
  if (!latestSessionByProjectId.has(s.web_project_id)) latestSessionByProjectId.set(s.web_project_id, s)
}

// ── Diff + plan ──────────────────────────────────────────────────────

interface AccountPatch {
  member: number
  church_name: string
  patch: Partial<Pick<AccountRow,
    'web_squad_site_access_provided' |
    'web_squad_ga_access_shared' |
    'web_squad_ready_for_evaluation' |
    'web_squad_hosting_details_provided' |
    'web_squad_domain_registrar_provided'
  >>
}

interface SessionPatch {
  member: number
  church_name: string
  session_id: string
  patch: Partial<Pick<SessionRow,
    'current_host' | 'domain_registrar_url' | 'domain_credential_method' | 'domain_invite_confirmed'
  >>
}

const accountPatches: AccountPatch[] = []
const sessionPatches: SessionPatch[] = []
const missingAccount: number[] = []
const missingProject: number[] = []
const missingSession: number[] = []

for (const row of ROWS) {
  // Account progress: only set fields where current is null AND CSV
  // says true. Never overwrite an existing value (the squad may have
  // updated it more recently than the CSV).
  const acc = accountByMember.get(row.member)
  if (!acc) {
    missingAccount.push(row.member)
  } else {
    const patch: AccountPatch['patch'] = {}
    const consider = (
      field: keyof AccountPatch['patch'],
      desired: boolean | undefined,
    ) => {
      if (desired === undefined) return
      if (acc[field] !== null && acc[field] !== undefined) return
      patch[field] = desired
    }
    consider('web_squad_site_access_provided',      row.site_access_provided)
    consider('web_squad_ga_access_shared',          row.ga_access_shared)
    consider('web_squad_ready_for_evaluation',      row.ready_for_evaluation)
    consider('web_squad_hosting_details_provided',  row.hosting_details_provided)
    consider('web_squad_domain_registrar_provided', row.domain_registrar_provided)
    if (Object.keys(patch).length > 0) {
      accountPatches.push({ member: row.member, church_name: row.church_name, patch })
    }
  }

  // Content collection session: same fill-empties-only rule.
  const projectId = projectByMember.get(row.member)
  if (!projectId) {
    missingProject.push(row.member)
    continue
  }
  const sess = latestSessionByProjectId.get(projectId)
  if (!sess) {
    missingSession.push(row.member)
    continue
  }
  const sPatch: SessionPatch['patch'] = {}
  const considerS = <K extends keyof SessionPatch['patch']>(
    field: K,
    desired: SessionPatch['patch'][K] | undefined,
  ) => {
    if (desired === undefined || desired === null || desired === '') return
    if (sess[field] !== null && sess[field] !== undefined && sess[field] !== '') return
    sPatch[field] = desired
  }
  considerS('current_host',             row.current_host)
  considerS('domain_registrar_url',     row.domain_registrar_url)
  considerS('domain_credential_method', row.domain_credential_method)
  considerS('domain_invite_confirmed',  row.domain_invite_confirmed)
  if (Object.keys(sPatch).length > 0) {
    sessionPatches.push({ member: row.member, church_name: row.church_name, session_id: sess.id, patch: sPatch })
  }
}

// ── Print plan ───────────────────────────────────────────────────────

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN — no writes'}\n`)
console.log(`CSV rows considered:                ${ROWS.length}`)
console.log(`Account-progress patches:           ${accountPatches.length}`)
console.log(`Content-collection session patches: ${sessionPatches.length}`)
console.log(`Missing strategy_account_progress:  ${missingAccount.length}${missingAccount.length ? ' → members: ' + missingAccount.slice(0, 10).join(', ') + (missingAccount.length > 10 ? ` (+${missingAccount.length - 10})` : '') : ''}`)
console.log(`Missing strategy_web_projects:      ${missingProject.length}${missingProject.length ? ' → members: ' + missingProject.slice(0, 10).join(', ') + (missingProject.length > 10 ? ` (+${missingProject.length - 10})` : '') : ''}`)
console.log(`Missing content-collection session: ${missingSession.length}${missingSession.length ? ' → members: ' + missingSession.slice(0, 10).join(', ') + (missingSession.length > 10 ? ` (+${missingSession.length - 10})` : '') : ''}`)
console.log('')

if (accountPatches.length > 0) {
  console.log(`── strategy_account_progress (${accountPatches.length}) ──`)
  for (const p of accountPatches) {
    const flagSummary = Object.entries(p.patch).map(([k, v]) => `${k.replace('web_squad_', '')}=${v}`).join('  ')
    console.log(`  ${p.member.toString().padEnd(6)} ${p.church_name.padEnd(45)} ${flagSummary}`)
  }
  console.log('')
}

if (sessionPatches.length > 0) {
  console.log(`── strategy_content_collection_sessions (${sessionPatches.length}) ──`)
  for (const p of sessionPatches) {
    const sum = Object.entries(p.patch).map(([k, v]) => {
      const vv = typeof v === 'string' && v.length > 40 ? v.slice(0, 37) + '…' : String(v)
      return `${k}="${vv}"`
    }).join('  ')
    console.log(`  ${p.member.toString().padEnd(6)} ${p.church_name.padEnd(45)} ${sum}`)
  }
  console.log('')
}

if (!APPLY) {
  console.log('(Run with --apply to write these changes.)\n')
  process.exit(0)
}

// ── Apply ────────────────────────────────────────────────────────────

console.log('Applying…')
let accDone = 0
for (const p of accountPatches) {
  const { error } = await sb
    .from('strategy_account_progress')
    .update(p.patch)
    .eq('member', p.member)
  if (error) {
    console.error(`  ✗ ${p.member} ${p.church_name}: ${error.message}`)
  } else {
    accDone++
  }
}
console.log(`✓ Wrote ${accDone}/${accountPatches.length} account-progress rows`)

let sessDone = 0
for (const p of sessionPatches) {
  const { error } = await sb
    .from('strategy_content_collection_sessions')
    .update(p.patch)
    .eq('id', p.session_id)
  if (error) {
    console.error(`  ✗ ${p.member} ${p.church_name}: ${error.message}`)
  } else {
    sessDone++
  }
}
console.log(`✓ Wrote ${sessDone}/${sessionPatches.length} content-collection session rows`)
console.log('Done.')
