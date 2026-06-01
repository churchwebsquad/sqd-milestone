/**
 * PartnerHubPage — /portal/:token/hub
 *
 * Token-gated partner dashboard. Lists outstanding asks (currently:
 * open content-collection sessions). Greenfield route; does NOT touch
 * the existing /portal/:token milestone page until we decide to flip.
 *
 * Lookup chain:
 *   strategy_account_progress.portal_token → member, church_name, css_rep
 *   strategy_web_projects (latest, by member)
 *   strategy_content_collection_sessions (open ones, by web_project_id)
 *   clickup_users (employee=AM by name → channel link)
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Calendar, FileText, ArrowRight, Loader2, AlertCircle, MessageCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface PartnerInfo {
  member:        number
  church_name:   string | null
  css_rep:       string | null
  first_name_of_primary: string | null
}

interface OpenSession {
  id:        string
  status:    'open' | 'submitted' | 'closed'
  due_at:    string | null
  created_at: string
}

interface AMContact {
  name:       string
  email:      string | null
  channel_id: string | null
}

function formatDue(iso: string | null): { label: string; tone: 'normal' | 'soon' | 'overdue' } {
  if (!iso) return { label: 'No due date', tone: 'normal' }
  const due = new Date(iso)
  const now = new Date()
  const days = Math.floor((due.getTime() - now.getTime()) / 86400000)
  if (days < 0)   return { label: `Overdue (${-days} ${-days === 1 ? 'day' : 'days'})`, tone: 'overdue' }
  if (days === 0) return { label: 'Due today', tone: 'soon' }
  if (days <= 3)  return { label: `Due in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'soon' }
  return { label: `Due in ${days} days · ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone: 'normal' }
}

export default function PartnerHubPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [partner, setPartner]   = useState<PartnerInfo | null>(null)
  const [webProjectId, setWebProjectId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<OpenSession[]>([])
  const [am, setAm] = useState<AMContact | null>(null)

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    let cancelled = false

    const load = async () => {
      try {
        // 1. Partner lookup
        const { data: p } = await supabase
          .from('strategy_account_progress')
          .select('member, church_name, css_rep, first_name_of_primary')
          .eq('portal_token', token)
          .maybeSingle()
        if (!p) { if (!cancelled) { setNotFound(true) } return }
        if (cancelled) return
        setPartner(p as PartnerInfo)

        // 2. Latest web project for this partner
        const { data: proj } = await supabase
          .from('strategy_web_projects')
          .select('id')
          .eq('member', p.member)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const pid = proj?.id ?? null
        if (cancelled) return
        setWebProjectId(pid)

        // 3. Open content-collection sessions
        if (pid) {
          const { data: s } = await supabase
            .from('strategy_content_collection_sessions')
            .select('id, status, due_at, created_at')
            .eq('web_project_id', pid)
            .neq('status', 'closed')
            .order('created_at', { ascending: false })
          if (cancelled) return
          setSessions((s ?? []) as OpenSession[])
        }

        // 4. AM contact (css_rep is a name; we look up their channel)
        if (p.css_rep) {
          const { data: amRow } = await supabase
            .from('clickup_users')
            .select('username, email, account_id')
            .ilike('username', p.css_rep.trim())
            .not('employee', 'is', null)
            .limit(1)
            .maybeSingle()
          // Look up channel by member (the AM's channel for THIS partner is keyed on member)
          const { data: chan } = await supabase
            .from('clickup_chat_channels')
            .select('id')
            .eq('memberid', p.member)
            .limit(1)
            .maybeSingle()
          if (cancelled) return
          if (amRow) setAm({
            name: amRow.username ?? p.css_rep,
            email: amRow.email ?? null,
            channel_id: chan?.id ?? null,
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen bg-cream grid place-items-center">
        <Loader2 className="animate-spin text-primary-purple" size={28} />
      </div>
    )
  }
  if (notFound || !partner) {
    return (
      <div className="min-h-screen bg-cream grid place-items-center px-6">
        <div className="text-center max-w-md">
          <AlertCircle className="mx-auto text-primary-purple mb-3" size={32} />
          <h1 className="font-serif italic text-2xl text-deep-plum mb-2">We couldn't find this hub</h1>
          <p className="text-purple-gray text-sm">The link may have expired. Please reach out to your account manager.</p>
        </div>
      </div>
    )
  }

  const inventorySession = sessions[0] ?? null

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      {/* Hero */}
      <header className="bg-hero-gradient text-cream px-6 py-10 md:py-14">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-lavender mb-2">Partner Hub</p>
          <h1 className="font-serif italic text-3xl md:text-4xl mb-1">{partner.church_name ?? 'Welcome'}</h1>
          {partner.first_name_of_primary && (
            <p className="text-cream/80 text-sm">
              Hi {partner.first_name_of_primary} — your action items live here.
            </p>
          )}
        </div>
      </header>

      <main className="flex-1 px-6 py-10">
        <div className="max-w-3xl mx-auto space-y-8">

          {/* Outstanding asks */}
          <section>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-primary-purple mb-3">
              Outstanding from you
            </h2>
            {sessions.length === 0 && (
              <div className="bg-white border border-lavender rounded-2xl p-6 text-center">
                <p className="text-deep-plum font-medium mb-1">You're all caught up.</p>
                <p className="text-purple-gray text-sm">Nothing waiting on you right now.</p>
              </div>
            )}

            {inventorySession && (
              <ContentCollectionCard
                session={inventorySession}
                token={token!}
              />
            )}
          </section>

          {/* Have questions */}
          {am && (
            <section className="bg-lavender-tint border border-lavender rounded-2xl p-5 md:p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-full bg-primary-purple/10 p-2.5 shrink-0">
                  <MessageCircle className="text-primary-purple" size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-deep-plum font-semibold">Have questions? We're here to help!</p>
                  <p className="text-purple-gray text-sm mt-0.5">
                    {am.name} is your account manager.
                  </p>
                </div>
                {am.channel_id ? (
                  <a
                    href={`https://app.clickup.com/chat/c/${am.channel_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-cream text-sm font-semibold px-4 py-2 hover:bg-purple-mid transition-colors"
                  >
                    Contact {am.name.split(' ')[0]}
                    <ArrowRight size={14} />
                  </a>
                ) : am.email ? (
                  <a
                    href={`mailto:${am.email}`}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-cream text-sm font-semibold px-4 py-2 hover:bg-purple-mid transition-colors"
                  >
                    Email {am.name.split(' ')[0]}
                    <ArrowRight size={14} />
                  </a>
                ) : null}
              </div>
            </section>
          )}

          {/* Footer note for the milestone timeline (the existing /portal/:token page) */}
          {webProjectId && (
            <p className="text-center text-xs text-purple-gray">
              Looking for your milestone timeline?{' '}
              <Link to={`/portal/${token}`} className="text-primary-purple underline">View it here</Link>.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

// ── Outstanding-ask card ─────────────────────────────────────────────

function ContentCollectionCard({ session, token }: { session: OpenSession; token: string }) {
  const due = formatDue(session.due_at)
  return (
    <Link
      to={`/portal/${token}/hub/content-collection/${session.id}`}
      className="block bg-white border border-lavender rounded-2xl p-5 md:p-6 hover:border-primary-purple transition-colors group"
    >
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-primary-purple/10 p-2.5 shrink-0 group-hover:bg-primary-purple/15 transition-colors">
          <FileText className="text-primary-purple" size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-deep-plum font-semibold">Content Collection</p>
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              due.tone === 'overdue' ? 'bg-red-100 text-red-700' :
              due.tone === 'soon'    ? 'bg-amber-100 text-amber-800' :
                                       'bg-lavender-tint text-primary-purple'
            }`}>
              <Calendar size={10} />
              {due.label}
            </span>
          </div>
          <p className="text-purple-gray text-sm mt-1">
            Review what we found on your current site, tell us what to update or leave alone,
            and answer a few questions about how you'd like the new site to work.
          </p>
          <p className="text-primary-purple text-sm font-semibold mt-3 inline-flex items-center gap-1">
            Start review <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </p>
        </div>
      </div>
    </Link>
  )
}
