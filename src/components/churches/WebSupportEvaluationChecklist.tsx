/**
 * Web Support Evaluation checklist — staff-facing surface inside the
 * church dashboard's Website Squad section.
 *
 * Replaces the previous external "Web Support Evaluation" / "Fix
 * Website on Evaluation Tool" buttons with an inline checklist driven
 * by the rows of website_support_audit. Each row is a support type
 * (Web Text Updates, Weekly Sermon Upload, etc.).
 *
 * Behavior:
 *   - Items pre-checked when the member already appears in
 *     website_accounts CSV.
 *   - Clicking an unchecked item appends the member to BOTH the
 *     websites_allowed and website_accounts cells (append-only:
 *     existing CSV is preserved verbatim, dedup is enforced so the
 *     same member never gets added twice).
 *   - Checked items lock — append-only means we don't support
 *     removing a member from these cells through this UI.
 */
import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { SubSectionLabel } from './ChurchUI'

/** Display order. Items in this list render first. Any additional
 *  rows from website_support_audit not listed here append at the end
 *  alphabetically so legacy categories stay visible. */
const DESIRED_ORDER: string[] = [
  'Web Text Updates',
  'Web Image Updates',
  'New Web Page',
  'New Web Section',
  'Weekly Sermon Upload',
  'Campus Page Updates',
  'Event Page Updates',
  'Small Groups Page Updates',
  'Staff Page Updates',
  'Setup a New Blog',
  'New Blog Post',
  'New Website Feature',
  'Walkthrough/How-To',
  'Web Technical Support',
]

interface AuditRow {
  name:             string
  websites_allowed: string | null
  website_accounts: string | null
}

/** Membership check: the CSV uses ", " separators with member tokens
 *  that may carry a "_NN" suffix (legacy Airtable convention). Match
 *  on the bare number to avoid duplicate appends. */
function memberInCsv(csv: string | null | undefined, member: number): boolean {
  if (!csv) return false
  const target = String(member)
  return csv.split(/\s*,\s*/).some(token => {
    const bare = token.split('_')[0].trim()
    return bare === target
  })
}

/** Append "<member>" to a CSV cell while preserving every existing
 *  entry verbatim. Returns null if the member is already present so
 *  the caller can skip the write. */
function appendMember(csv: string | null | undefined, member: number): string | null {
  if (memberInCsv(csv, member)) return null
  const trimmed = (csv ?? '').trim()
  if (!trimmed) return String(member)
  return `${trimmed}, ${member}`
}

interface Props {
  memberId: number
}

export function WebSupportEvaluationChecklist({ memberId }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error: err } = await supabase
        .from('website_support_audit')
        .select('name, websites_allowed, website_accounts')
      if (cancelled) return
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setRows((data ?? []) as AuditRow[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [memberId])

  /** Toggle handler: idempotent add. If the member is already in the
   *  cell, no-op. Else read latest values, dedup-append, write back.
   *  Optimistically updates local state so the checkbox flips
   *  immediately even before the network round-trip. */
  const handleCheck = async (name: string) => {
    const row = rows.find(r => r.name === name)
    if (!row) return
    if (memberInCsv(row.website_accounts, memberId)) return
    setPending(p => new Set(p).add(name))
    try {
      // Re-read the row right before write to minimize the
      // read-modify-write race window. Not transactional, but the
      // dedup check inside appendMember() means a duplicate write
      // is a no-op against the database too.
      const { data: freshRow, error: readErr } = await supabase
        .from('website_support_audit')
        .select('websites_allowed, website_accounts')
        .eq('name', name)
        .single()
      if (readErr || !freshRow) throw new Error(readErr?.message ?? 'Failed to read current cell value')
      // Supabase's row typing returns `never` in this codebase's
      // generated types; cast to the shape we actually selected.
      const fresh = freshRow as { websites_allowed: string | null; website_accounts: string | null }

      const nextAllowed  = appendMember(fresh.websites_allowed, memberId)
      const nextAccounts = appendMember(fresh.website_accounts, memberId)
      // If both came back null, member was already there — just sync UI.
      if (nextAllowed === null && nextAccounts === null) {
        setRows(prev => prev.map(r => r.name === name
          ? { ...r, websites_allowed: fresh.websites_allowed, website_accounts: fresh.website_accounts }
          : r))
        return
      }

      const patch: Partial<AuditRow> = {}
      if (nextAllowed  !== null) patch.websites_allowed = nextAllowed
      if (nextAccounts !== null) patch.website_accounts = nextAccounts
      const { error: writeErr } = await supabase
        .from('website_support_audit')
        .update(patch as never)
        .eq('name', name)
      if (writeErr) throw new Error(writeErr.message)

      setRows(prev => prev.map(r => r.name === name
        ? { ...r,
            websites_allowed: nextAllowed  ?? r.websites_allowed,
            website_accounts: nextAccounts ?? r.website_accounts }
        : r))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setPending(p => { const n = new Set(p); n.delete(name); return n })
    }
  }

  // Sort: DESIRED_ORDER first (preserving listed order), then any
  // additional rows alphabetically. Items in DESIRED_ORDER that don't
  // exist in the table are silently dropped.
  const sorted = [...rows].sort((a, b) => {
    const ai = DESIRED_ORDER.indexOf(a.name)
    const bi = DESIRED_ORDER.indexOf(b.name)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="mb-4">
      <SubSectionLabel label="Web Support Evaluation" />
      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}
      {loading ? (
        <p className="text-xs text-purple-gray italic">Loading checklist…</p>
      ) : (
        <div className="rounded-xl border border-lavender bg-white">
          <ul className="divide-y divide-lavender/40">
            {sorted.map(row => {
              const isChecked = memberInCsv(row.website_accounts, memberId)
              const isPending = pending.has(row.name)
              const disabled  = isChecked || isPending
              return (
                <li key={row.name}>
                  <label
                    className={[
                      'flex items-center gap-3 px-3 py-2 text-sm',
                      isChecked
                        ? 'bg-lavender-tint/40 text-deep-plum cursor-default'
                        : 'hover:bg-lavender-tint/20 cursor-pointer',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'shrink-0 inline-flex items-center justify-center w-5 h-5 rounded border-2 transition-colors',
                        isChecked
                          ? 'border-primary-purple bg-primary-purple text-white'
                          : 'border-lavender bg-white text-transparent',
                      ].join(' ')}
                      aria-hidden="true"
                    >
                      {isPending
                        ? <Loader2 size={12} className="animate-spin text-primary-purple" />
                        : isChecked
                          ? <Check size={12} />
                          : null}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isChecked}
                      disabled={disabled}
                      onChange={() => { if (!disabled) void handleCheck(row.name) }}
                    />
                    <span className={isChecked ? 'font-medium' : ''}>{row.name}</span>
                    {isChecked && (
                      <span className="ml-auto text-[10px] uppercase tracking-wider font-bold text-primary-purple">
                        Added
                      </span>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <p className="text-[10px] text-purple-gray mt-1.5 italic">
        Append-only. Checking adds this member to the support type;
        existing entries stay untouched and items can&rsquo;t be un-checked here.
      </p>
    </div>
  )
}
