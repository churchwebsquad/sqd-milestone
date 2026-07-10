/**
 * Standalone registrar / domain credentials intake form.
 * Mounted at /portal/:token/registrar-intake
 *
 * Use case: partners who want to migrate their CURRENT website (DNS
 * cutover, new hosting) BEFORE the full content collection is done.
 * We need registrar credentials early; everything else can wait.
 *
 * Bidirectional sync with ContentCollectionPage is automatic: this
 * page writes to the same columns on strategy_content_collection_sessions
 * that ContentCollectionPage's DomainSection writes to. Whichever
 * surface the partner uses first, the other reflects it on next load.
 *
 * Session discovery: this page does NOT create a content collection
 * session — those are provisioned by staff. We look up the latest
 * open session for the partner's web project. If none exists, we
 * surface a graceful "ask your AM" message rather than auto-creating
 * (so we don't accidentally orphan rows or skip a staff hand-off).
 *
 * Fields collected (mirror DomainSection in ContentCollectionPage.tsx):
 *   - domain_registrar_url
 *   - domain_credential_method ('invite_admin' | 'one_password')
 *   - domain_invite_confirmed
 *   - domain_one_password_invite_url
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface RegistrarFields {
  domain_registrar_url:           string | null
  domain_credential_method:       'invite_admin' | 'one_password' | null
  domain_invite_confirmed:        boolean
  domain_one_password_invite_url: string | null
  // v118 — current hosting provider for migration-only intake. Same
  // column the ContentCollectionPage migration section writes to, so
  // a partner who answered it on one surface sees it filled on the
  // other.
  current_host:                   string | null
}

interface PartnerCtx {
  member:        number
  church_name:   string | null
  first_name:    string | null
  session_id:    string
  status:        'open' | 'submitted' | 'closed'
}

export default function RegistrarIntakePage() {
  const { token } = useParams<{ token: string }>()
  const [partner, setPartner] = useState<PartnerCtx | null>(null)
  const [fields,  setFields]  = useState<RegistrarFields | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [noSession, setNoSession] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    let cancelled = false

    void (async () => {
      try {
        // 1. Token → partner identity
        const { data: p } = await supabase
          .from('strategy_account_progress')
          .select('member, church_name, first_name_of_primary')
          .eq('portal_token', token)
          .maybeSingle()
        if (!p) { if (!cancelled) setNotFound(true); return }
        const partnerMember = (p as { member: number }).member
        const partnerChurchName = (p as { church_name: string | null }).church_name

        // 2. Find the right content collection session for this
        // partner. Prefer an OPEN session; only fall back to the
        // latest (submitted/closed) when there's no open one.
        //
        // Migration-only intent: this link often arrives BEFORE the
        // partner enters the redesign pipeline (we share it with
        // migrate-only churches and pre-redesign partners). If no
        // session exists yet, lazily provision one so the migration
        // form works standalone — but skip all downstream automation
        // (no crawl, no AM Slack notif, no inventory snapshot). The
        // session is just a parking spot for the registrar/hosting
        // answers; staff can layer the full content collection on
        // top later without losing the migration data.
        const sessionCols = 'id, status, created_at, domain_registrar_url, domain_credential_method, domain_invite_confirmed, domain_one_password_invite_url, current_host'
        const { data: openS } = await supabase
          .from('strategy_content_collection_sessions')
          .select(sessionCols)
          .eq('member', partnerMember)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        let s = openS as (RegistrarFields & { id: string; status: 'open' | 'submitted' | 'closed' }) | null
        if (!s) {
          const { data: anyS } = await supabase
            .from('strategy_content_collection_sessions')
            .select(sessionCols)
            .eq('member', partnerMember)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          s = anyS as (RegistrarFields & { id: string; status: 'open' | 'submitted' | 'closed' }) | null
        }
        if (!s) {
          const provisioned = await provisionMigrationOnlySession(partnerMember, partnerChurchName)
          if (provisioned) s = provisioned
        }
        if (!s) { if (!cancelled) setNoSession(true); return }
        if (cancelled) return

        setPartner({
          member:      (p as { member: number }).member,
          church_name: (p as { church_name: string | null }).church_name,
          first_name:  (p as { first_name_of_primary: string | null }).first_name_of_primary,
          session_id:  s.id,
          status:      s.status,
        })
        setFields({
          domain_registrar_url:           s.domain_registrar_url,
          domain_credential_method:       s.domain_credential_method,
          domain_invite_confirmed:        s.domain_invite_confirmed ?? false,
          domain_one_password_invite_url: s.domain_one_password_invite_url,
          current_host:                   s.current_host,
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [token])

  /** Lazily provision a content-collection session for a partner who
   *  hits the migration link before any session exists. Steps:
   *
   *    1. Find-or-create a `strategy_web_projects` row for the member
   *       (kind='redesign' default works fine — we don't have a
   *       dedicated 'migration-only' kind, and forcing one would
   *       require schema changes). crawl_excluded=true so any
   *       downstream crawl-auto-fire logic skips this project.
   *    2. Insert a `strategy_content_collection_sessions` row tied to
   *       that project, status='open', empty inventory_snapshot.
   *
   *  No edge functions invoked, no Slack notifs, no crawl triggers —
   *  just two row inserts that mirror what staff would do manually.
   *  Returns the session in the same shape the loader expects, or
   *  null on failure (caller falls back to the "no session" message).
   */
  async function provisionMigrationOnlySession(
    member: number,
    churchName: string | null,
  ): Promise<(RegistrarFields & { id: string; status: 'open' | 'submitted' | 'closed' }) | null> {
    try {
      // Find an existing project for this member, archived or not.
      let projectId: string | null = null
      const { data: existingProj } = await supabase
        .from('strategy_web_projects')
        .select('id')
        .eq('member', member)
        .eq('archived', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      projectId = (existingProj as { id: string } | null)?.id ?? null

      if (!projectId) {
        const projectName = churchName ? `${churchName} — Migration` : `Member ${member} — Migration`
        const { data: newProj, error: projErr } = await supabase
          .from('strategy_web_projects')
          .insert({
            member,
            name:           projectName,
            kind:           'redesign',
            current_phase:  'intake',
            roadmap_stage:  'pre_intake',
            crawl_excluded: true,
          } as never)
          .select('id')
          .maybeSingle()
        if (projErr || !newProj) {
          console.error('[registrar-intake] auto-provision project failed', projErr)
          return null
        }
        projectId = (newProj as { id: string }).id
      }

      const { data: newSession, error: sessErr } = await supabase
        .from('strategy_content_collection_sessions')
        .insert({
          web_project_id:      projectId,
          member,
          status:              'open',
          inventory_snapshot:  {},
        } as never)
        .select('id, status, created_at, domain_registrar_url, domain_credential_method, domain_invite_confirmed, domain_one_password_invite_url, current_host')
        .maybeSingle()
      if (sessErr || !newSession) {
        console.error('[registrar-intake] auto-provision session failed', sessErr)
        return null
      }
      return newSession as RegistrarFields & { id: string; status: 'open' | 'submitted' | 'closed' }
    } catch (err) {
      console.error('[registrar-intake] auto-provision threw', err)
      return null
    }
  }

  /** Persist a single field. Writes go to the same row the main
   *  content collection writes to, so the two surfaces stay in sync
   *  by virtue of sharing storage. */
  const save = async <K extends keyof RegistrarFields>(field: K, value: RegistrarFields[K]) => {
    if (!partner || !fields) return
    setFields({ ...fields, [field]: value })
    setSaveState('saving')
    const { error } = await (supabase as any)
      .from('strategy_content_collection_sessions')
      .update({ [field]: value })
      .eq('id', partner.session_id)
    if (error) {
      console.error('[registrar-intake] save failed', field, error)
      setSaveState('idle')
      return
    }
    setSaveState('saved')
    setTimeout(() => setSaveState('idle'), 1500)
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-cream">
        <Loader2 size={28} className="animate-spin text-primary-purple" />
      </div>
    )
  }
  if (notFound) {
    return (
      <Centered>
        <h1 className="font-serif italic text-2xl text-deep-plum mb-2">Link not found</h1>
        <p className="text-purple-gray">We couldn't find your partner record. Double-check the link your account manager sent.</p>
      </Centered>
    )
  }
  if (noSession) {
    return (
      <Centered>
        <h1 className="font-serif italic text-2xl text-deep-plum mb-2">Your web project isn't open yet</h1>
        <p className="text-purple-gray mb-4">
          We don't have an active content collection session for your account yet. Your account manager will provision one and send you the link.
        </p>
        <p className="text-purple-gray text-sm">If you're trying to share domain access urgently, reply to the most recent email from your account manager and they can capture it directly.</p>
      </Centered>
    )
  }
  if (!partner || !fields) return null

  const submitted = partner.status === 'submitted' || partner.status === 'closed'

  return (
    <div className="min-h-screen bg-cream py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to={`/portal/${token}/hub`} className="inline-flex items-center gap-1.5 text-sm text-primary-purple hover:underline mb-4">
          <ArrowLeft size={14} /> Back to your hub
        </Link>

        <header className="mb-6">
          <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-1">Domain registrar intake</p>
          <h1 className="font-serif italic text-3xl text-deep-plum">
            {partner.first_name ? `${partner.first_name}, ` : ''}let's grab your domain details
          </h1>
        </header>

        {submitted && (
          <div className="mb-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <strong className="font-semibold">Already submitted.</strong> You can still update the fields below — changes save automatically.
          </div>
        )}

        <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="font-serif italic text-xl text-deep-plum mb-1">Where does your site live today?</h2>
          <p className="text-purple-gray text-sm mb-4">
            Tell us which hosting service your current website runs on (e.g. <em>Squarespace</em>, <em>Wix</em>, <em>WordPress.com</em>, <em>Bluehost</em>, <em>SiteGround</em>).
          </p>
          <FieldShort
            label="Current hosting provider"
            placeholder="Squarespace, Wix, WordPress.com, Bluehost, …"
            value={fields.current_host}
            onChange={v => void save('current_host', v)}
          />
        </section>

        <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="font-serif italic text-xl text-deep-plum mb-1">Your domain registrar</h2>
          <p className="text-purple-gray text-sm mb-4">
            This is where you bought your website name (domain) — e.g. <em>examplechurchname.com</em>. Common ones: GoDaddy, Google Domains, Namecheap, Cloudflare.
          </p>

          <FieldShort
            label="Registrar URL"
            placeholder="https://godaddy.com"
            value={fields.domain_registrar_url}
            onChange={v => void save('domain_registrar_url', v)}
            help="Paste the link to your registrar's homepage or your account dashboard."
            required
          />

          <div className="mt-5">
            <p className="text-sm font-semibold text-deep-plum mb-2">How would you like to share login credentials?</p>
            <div className="space-y-2">
              <RadioOption
                value="invite_admin"
                current={fields.domain_credential_method}
                label="Invite admin.websquad@churchmediasquad.com as a user"
                help="Recommended. Most registrars (GoDaddy, Cloudflare, etc.) let you add a limited-access admin."
                onChange={v => void save('domain_credential_method', v as RegistrarFields['domain_credential_method'])}
              />
              {fields.domain_credential_method === 'invite_admin' && (
                <label className="pl-7 mt-2 flex items-start gap-2 text-sm text-deep-plum cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fields.domain_invite_confirmed}
                    onChange={e => void save('domain_invite_confirmed', e.target.checked)}
                    className="mt-1 accent-primary-purple"
                  />
                  <span>I've added <strong>admin.websquad@churchmediasquad.com</strong> as a user on my registrar.</span>
                </label>
              )}
              <RadioOption
                value="one_password"
                current={fields.domain_credential_method}
                label="Send a 1Password share link"
                help="Create a shared item in 1Password and paste the share link. We never store raw passwords in our system."
                onChange={v => void save('domain_credential_method', v as RegistrarFields['domain_credential_method'])}
              />
              {fields.domain_credential_method === 'one_password' && (
                <div className="pl-7 mt-2">
                  <FieldShort
                    label="1Password share / invite URL"
                    placeholder="https://share.1password.com/..."
                    value={fields.domain_one_password_invite_url}
                    onChange={v => void save('domain_one_password_invite_url', v)}
                    required
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Readiness indicator — captures whether the partner has
            enough filled in for the Web Squad to act. Required for
            handoff: registrar URL + a credential method chosen + the
            method's confirmation (checkbox or 1Password URL). */}
        <ReadinessSummary fields={fields} />

        <div className="mt-4 text-right">
          {saveState === 'saving' && (
            <span className="text-[12px] text-purple-gray inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving…</span>
          )}
          {saveState === 'saved' && (
            <span className="text-[12px] text-green-700 inline-flex items-center gap-1"><Check size={11} /> Saved</span>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Small primitives (mirror the ones in ContentCollectionPage's
//    DomainSection but kept local so this page doesn't import internals) ──

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-cream px-4">
      <div className="max-w-md text-center bg-white border border-lavender rounded-2xl p-6 shadow-sm">{children}</div>
    </div>
  )
}

function FieldShort({
  label, value, onChange, placeholder, help, required,
}: {
  label:       string
  value:       string | null
  onChange:    (v: string) => void
  placeholder?: string
  help?:       string
  required?:   boolean
}) {
  // Defer commit to blur (matches ContentCollectionPage's pattern) so
  // every keystroke doesn't fire a Supabase update.
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <label className="block">
      <span className="text-sm font-semibold text-deep-plum">
        {label}
        {required && <span className="text-primary-purple ml-1">*</span>}
      </span>
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() !== (value ?? '').trim()) onChange(draft.trim()) }}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-lg border border-lavender bg-white px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/60 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
      />
      {help && <p className="text-[11px] text-purple-gray mt-1">{help}</p>}
    </label>
  )
}

function ReadinessSummary({ fields }: { fields: RegistrarFields }) {
  const hasUrl    = !!(fields.domain_registrar_url ?? '').trim()
  const hasMethod = fields.domain_credential_method === 'invite_admin' || fields.domain_credential_method === 'one_password'
  const methodConfirmed =
    (fields.domain_credential_method === 'invite_admin'  && fields.domain_invite_confirmed) ||
    (fields.domain_credential_method === 'one_password' && !!(fields.domain_one_password_invite_url ?? '').trim())
  const ready = hasUrl && hasMethod && methodConfirmed

  if (ready) {
    return (
      <div className="mt-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-start gap-2">
        <Check size={16} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">You're done — Web Squad has everything they need.</p>
          <p className="text-green-700/90 text-xs mt-0.5">Your account manager will follow up once we've confirmed access on our side.</p>
        </div>
      </div>
    )
  }
  const missing: string[] = []
  if (!hasUrl)             missing.push('the registrar URL')
  if (!hasMethod)          missing.push('how you\'ll share credentials')
  else if (!methodConfirmed) {
    missing.push(
      fields.domain_credential_method === 'invite_admin'
        ? 'the "I\'ve added admin.websquad..." confirmation'
        : 'the 1Password share URL',
    )
  }
  return (
    <div className="mt-5 rounded-xl border border-lavender bg-lavender-tint/30 px-4 py-3 text-sm text-deep-plum">
      <p className="font-semibold mb-0.5">A few more things to fill in:</p>
      <ul className="list-disc pl-5 text-xs text-purple-gray">
        {missing.map(m => <li key={m}>{m}</li>)}
      </ul>
    </div>
  )
}

function RadioOption({
  value, current, label, help, onChange,
}: {
  value:   string
  current: string | null
  label:   string
  help?:   string
  onChange: (v: string) => void
}) {
  const checked = current === value
  return (
    <label className={`block rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${checked ? 'border-primary-purple bg-lavender-tint/40' : 'border-lavender bg-white hover:border-primary-purple/60'}`}>
      <span className="flex items-start gap-2">
        <input
          type="radio"
          name="cred"
          checked={checked}
          onChange={() => onChange(value)}
          className="mt-1 accent-primary-purple"
        />
        <span className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-deep-plum block">{label}</span>
          {help && <span className="text-[11px] text-purple-gray block mt-0.5">{help}</span>}
        </span>
      </span>
    </label>
  )
}
