/**
 * Partner-facing sitemap review · v2 visualization.
 *
 * Renders `SitemapReview` in the layout Ashley signed off on in the
 * Squad-palette design artifact. Each region is a clickable target
 * that opens the sibling drawer for a scoped edit request.
 *
 * Section-id convention (stable; partner_edit_requests keys off it):
 *   intro, nav-primary, nav-secondary, hubs, footer,
 *   page-<slug>, what-changed, why, general.
 *
 * Multi-campus (Doxology-style per-congregation persistent nav bars)
 * is deliberately not force-rendered here. Until the review's data
 * model carries a first-class `campuses` list, we render the site as
 * a single-tier structure. The secondary nav_layout region still
 * renders when the strategist declared one.
 */

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  ContentMigration,
  NavItem,
  PartnerEditRequest,
  ReviewPage,
  SitemapReview,
} from '../../../lib/sitemapReview'
import { NavPresentationPanel, type NavPresentation } from '../NavPresentationPanel'

// ── Styles (scoped to .dox · palette translated to Squad) ──────────

const scopedCss = `
.dox { --ink:#341756; --paper:#fff; --panel:#F9F5F1; --panel2:#EDE9FC; --line:#CFC9F8; --line2:#BEB6EE; --muted:#6B6180; --muted2:#8B84A0; --accent:#513DE5; --accent-soft:#EDE9FC; --ph:#CFC9F8; --good:#3f7d55; --dark:#341756;
  color:var(--ink); background:#F9F5F1; font-family:'Inter','Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;
  line-height:1.55; -webkit-font-smoothing:antialiased; letter-spacing:-0.01em; }
.dox *{box-sizing:border-box;}
.dox .wrap{max-width:1100px; margin:0 auto; padding:44px 24px 96px;}
.dox h1,.dox h2,.dox h3{text-wrap:balance; margin:0; font-weight:650; letter-spacing:-0.02em;}
.dox .eyebrow{font-size:12px; font-weight:650; letter-spacing:.14em; text-transform:uppercase; color:var(--accent);}
.dox em.brand-em{font-family:Georgia,'Times New Roman',serif; font-style:italic; font-weight:500; letter-spacing:-0.01em;}
.dox .hero{text-align:center; max-width:60ch; margin:0 auto; padding-bottom:6px;}
.dox .hero h1{font-size:38px; line-height:1.04; margin:10px 0 14px;}
.dox .hero p{color:var(--muted); font-size:16px; margin:0 auto; max-width:54ch; white-space:pre-wrap;}
.dox .rule{height:3px; width:64px; background:var(--accent); border-radius:2px; margin:26px auto 0;}
.dox .sec{margin-top:56px;}
.dox .sec-head{display:flex; align-items:baseline; gap:14px; margin-bottom:6px;}
.dox .sec-head h2{font-size:22px;}
.dox .sec-num{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size:12px; color:var(--muted2); font-weight:600;}
.dox .sec-note{color:var(--muted); font-size:14.5px; max-width:74ch; margin:0 0 22px;}
.dox .sec-note b{color:var(--ink);}
.dox .browser{border:1px solid var(--line); border-radius:14px; overflow:hidden; background:var(--paper); box-shadow:0 1px 0 rgba(52,23,86,.02), 0 20px 44px -30px rgba(52,23,86,.35);}
.dox .topnav{display:flex; align-items:center; gap:26px; background:var(--paper); padding:16px 22px; border-bottom:1px solid var(--line); flex-wrap:wrap;}
.dox .brand-mark{display:flex; align-items:center; gap:9px; font-weight:750; letter-spacing:-0.03em; font-size:16px;}
.dox .brand-mark .glyph{width:26px; height:26px; background:var(--ink); border-radius:6px; display:grid; place-items:center; color:#fff; font-size:13px;}
.dox .topnav .items{display:flex; align-items:center; gap:22px; font-size:14px; font-weight:550; color:var(--ink); flex-wrap:wrap;}
.dox .topnav .items .mega{font-weight:680;}
.dox .topnav .items .caret{color:var(--muted2); font-size:10px; margin-left:3px;}
.dox .topnav .spacer{flex:1;}
.dox .btn{font-size:13px; font-weight:620; padding:9px 18px; border-radius:999px; border:1.5px solid var(--ink); background:var(--ink); color:#fff; white-space:nowrap; cursor:pointer; display:inline-flex; align-items:center; gap:6px;}
.dox .btn.ghost{background:transparent; color:var(--ink);}
.dox .btn.accent{background:var(--accent); border-color:var(--accent);}
.dox .btn.pending{background:#FFB84D; border-color:#FFB84D; color:#341756;}
.dox .btn:disabled{opacity:.55; cursor:not-allowed;}
.dox .mega-panel{padding:26px 24px; border-top:1px dashed var(--line2); background:linear-gradient(180deg,#fff,#FBF9FE);}
.dox .mega-label{font-size:11px; font-weight:650; letter-spacing:.12em; text-transform:uppercase; color:var(--muted2); margin-bottom:16px;}
.dox .mega-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px 24px;}
.dox .mega-item{display:flex; gap:12px; align-items:flex-start;}
.dox .ph{background:var(--ph); border-radius:7px; flex:none; display:grid; place-items:center; color:#7A6DBE;}
.dox .ph.sq{width:38px; height:38px; font-size:14px;}
.dox .mega-item h4{font-size:14px; font-weight:640; margin:0 0 2px; color:var(--ink);}
.dox .mega-item p{font-size:12px; color:var(--muted); margin:0; line-height:1.4;}
.dox .cards3{display:grid; grid-template-columns:repeat(3,1fr); gap:16px;}
.dox .vcard{border:1px solid var(--line); border-radius:14px; overflow:hidden; background:#fff;}
.dox .vcard .vimg{background:var(--ph); height:82px; display:grid; place-items:center; color:#7A6DBE;}
.dox .vcard .vbody{padding:14px 15px 16px;}
.dox .vcard h4{font-size:16px; font-weight:680; margin:0 0 3px;}
.dox .vcard .vt{font-size:13px; font-weight:600; color:var(--accent); margin-bottom:2px;}
.dox .vcard .va{font-size:12.5px; color:var(--muted); margin-bottom:12px;}
.dox .legend{display:flex; gap:18px; flex-wrap:wrap; font-size:12px; color:var(--muted); margin:0 0 18px; padding:12px 16px; background:var(--panel2); border-radius:10px;}
.dox .legend span{display:flex; align-items:center; gap:6px;}
.dox .tag2{font-size:10px; font-weight:650; letter-spacing:.04em; text-transform:uppercase; padding:2px 8px; border-radius:999px;}
.dox .t-keep{background:#E4F1E9; color:#3f7d55;}
.dox .t-uni{background:#EDE9FC; color:#513DE5;}
.dox .t-cons{background:#F8ECFD; color:#8B3DE5;}
.dox .t-new{background:#FFE9D6; color:#B8590E;}
.dox .tiers{display:grid; gap:18px;}
.dox .tier{border:1px solid var(--line); border-radius:14px; background:#fff; overflow:hidden;}
.dox .tier-head{display:flex; align-items:center; gap:12px; padding:14px 18px; background:var(--panel2); border-bottom:1px solid var(--line);}
.dox .tier-head h3{font-size:15px;}
.dox .tier-head .meta{margin-left:auto; font-size:12px; color:var(--muted); font-weight:500;}
.dox .plist{list-style:none; margin:0; padding:6px 0;}
.dox .plist li{display:grid; grid-template-columns:220px 1fr; gap:18px; padding:11px 18px; border-top:1px solid var(--panel); align-items:baseline; cursor:pointer; transition:background .12s ease;}
.dox .plist li:hover{background:#FBF9FE;}
.dox .plist li:first-child{border-top:none;}
.dox .plist .pg{font-weight:600; font-size:14px; display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; color:var(--ink);}
.dox .plist .desc{font-size:12.5px; color:var(--muted); line-height:1.4;}
.dox .why{display:grid; grid-template-columns:1fr 1fr; gap:14px;}
.dox .wcard{background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px 18px;}
.dox .wcard .ic{width:30px;height:30px;border-radius:8px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-size:15px;margin-bottom:9px;}
.dox .wcard h4{font-size:14px; font-weight:660; margin:0 0 4px;}
.dox .wcard p{font-size:12.5px; color:var(--muted); margin:0; line-height:1.5;}
.dox .changed{display:grid; grid-template-columns:1fr 1fr; gap:14px;}
.dox .chcard{border:1px solid var(--line); border-radius:14px; padding:15px 17px; background:#fff;}
.dox .chcard p{font-size:12.5px; color:var(--muted); margin:0; line-height:1.5;}
.dox .chcard p b{color:var(--ink);}
.dox .turn{background:var(--dark); color:#EDE9FC; border-radius:16px; padding:32px; margin-top:20px; background-image:linear-gradient(135deg, #341756 0%, #513DE5 100%);}
.dox .turn h2{color:#fff; font-size:24px; margin-bottom:8px;}
.dox .turn > p{color:#D8CFF3; font-size:14.5px; max-width:62ch; margin:0 0 18px;}
.dox .turn ul{margin:0; padding:0; list-style:none; display:grid; gap:12px;}
.dox .turn li{display:flex; gap:11px; font-size:14px; color:#EDE9FC; line-height:1.5;}
.dox .turn li .n{flex:none; width:22px;height:22px;border-radius:50%;background:#fff;color:var(--accent);font-size:12px;font-weight:700;display:grid;place-items:center;margin-top:1px;}
.dox .turn .actions{margin-top:24px; padding-top:20px; border-top:1px solid rgba(255,255,255,0.15); display:flex; flex-wrap:wrap; gap:10px; align-items:center;}
.dox .turn .actions .approve{background:#fff; color:var(--ink); border-color:#fff;}
.dox .turn .actions .ghost{background:transparent; color:#fff; border-color:rgba(255,255,255,0.4);}
.dox .turn .note-count{color:#D8CFF3; font-size:13px;}
.dox .footer-preview{background:var(--dark); color:#EDE9FC; border-radius:14px; padding:24px; background-image:linear-gradient(135deg,#341756 0%, #513DE5 100%);}
.dox .footer-preview .fbrand{color:#fff; font-weight:750; font-size:16px; margin-bottom:8px;}
.dox .footer-preview .fmeta{font-size:12px; color:#D8CFF3; line-height:1.7;}
.dox .footer-preview a{color:#FFC98A; text-decoration:none;}
.dox .clickable{position:relative;}
.dox .clickable::after{content:"↗ leave a note"; position:absolute; top:8px; right:12px; font-size:10.5px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; color:var(--accent); background:#fff; border:1px solid var(--accent); padding:3px 8px; border-radius:999px; opacity:0; transition:opacity .12s ease; pointer-events:none;}
.dox .clickable:hover::after,.dox .clickable:focus-visible::after{opacity:1;}
.dox .clickable.has-note::after{content:"● note pending"; background:#FFB84D; color:#341756; border-color:#FFB84D; opacity:1;}
.dox .status-chip{display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase;}
.dox .exec-body{background:#fff; border:1px solid var(--line); border-radius:14px; padding:24px 26px; color:var(--ink); font-size:15px; line-height:1.65; white-space:pre-wrap;}
.dox .nav-strategy-body{background:var(--panel2); border-radius:12px; padding:18px 22px; color:var(--ink); font-size:14.5px; line-height:1.6; white-space:pre-wrap; margin-top:14px;}
/* Drawer */
.dox-drawer-scrim{position:fixed; inset:0; background:rgba(52,23,86,.35); z-index:80;}
.dox-drawer{position:fixed; right:0; top:0; bottom:0; width:min(420px,100vw); background:#fff; z-index:81; box-shadow:-24px 0 60px -30px rgba(52,23,86,.5); display:flex; flex-direction:column;}
.dox-drawer .dh{padding:20px 22px; border-bottom:1px solid #EDE9FC; background:#F9F5F1;}
.dox-drawer .dh .cx{background:none; border:none; float:right; font-size:22px; color:#6B6180; cursor:pointer;}
.dox-drawer .dh h3{font-size:16px; font-weight:660; color:#341756; margin:0 40px 4px 0;}
.dox-drawer .dh p{font-size:12.5px; color:#6B6180; margin:0;}
.dox-drawer .db{padding:20px 22px; flex:1; overflow-y:auto;}
.dox-drawer label{display:block; font-size:12px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; color:#6B6180; margin:14px 0 6px;}
.dox-drawer textarea{width:100%; min-height:100px; padding:12px 14px; border:1px solid #CFC9F8; border-radius:10px; font:inherit; font-size:14px; color:#341756; background:#fff; resize:vertical;}
.dox-drawer textarea:focus{outline:none; border-color:#513DE5; box-shadow:0 0 0 3px rgba(81,61,229,.15);}
.dox-drawer input[type="text"]{width:100%; padding:9px 13px; border:1px solid #CFC9F8; border-radius:999px; font:inherit; font-size:13px; color:#341756;}
.dox-drawer .df{padding:16px 22px; border-top:1px solid #EDE9FC; display:flex; gap:8px; background:#fff;}
.dox-drawer .df .save{background:#513DE5; border-color:#513DE5;}
.dox-drawer .existing{margin-top:20px; padding-top:16px; border-top:1px dashed #CFC9F8;}
.dox-drawer .existing .en{font-size:11px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; color:#8B84A0; margin-bottom:8px;}
.dox-drawer .existing .item{background:#F9F5F1; border-radius:10px; padding:12px 14px; margin-bottom:8px;}
.dox-drawer .existing .item .who{font-size:11px; color:#6B6180; margin-bottom:4px;}
.dox-drawer .existing .item .txt{font-size:13px; color:#341756; line-height:1.45;}
.dox-drawer .existing .item .sugg{margin-top:6px; padding-top:6px; border-top:1px dashed #CFC9F8; font-size:12.5px; color:#513DE5;}
.dox-drawer .existing .item .rm{float:right; background:none; border:none; color:#6B6180; font-size:11px; cursor:pointer; padding:0;}
.dox-drawer .existing .item .rm:hover{color:#B8590E;}
@media (max-width:860px){
  .dox .cards3,.dox .why,.dox .changed{grid-template-columns:1fr;}
  .dox .plist li{grid-template-columns:1fr;}
  .dox .topnav .items{display:none;}
}
`

// ── Component ──────────────────────────────────────────────────────

export interface SitemapPartnerViewV2Props {
  review:      SitemapReview
  churchName?: string | null
  saving?:     boolean
  authorName?: string
  /** Read-only preview mode. Used by staff to see exactly what the
   *  partner sees without any interactive controls. Disables section
   *  click targets, hides the drawer, hides the "Your turn" CTA and
   *  the approve/submit buttons, and swaps in a staff-facing banner. */
  readOnly?:   boolean
  onAddEditRequest?:    (req: Omit<PartnerEditRequest, 'id' | 'created_at' | 'status'>) => Promise<void> | void
  onRemoveEditRequest?: (id: string) => Promise<void> | void
  onUpdatePartnerNotes?: (notes: string) => Promise<void> | void
  onApprove?:   () => Promise<void> | void
  onSubmitFeedback?: () => Promise<void> | void
}

export default function SitemapPartnerViewV2({
  review, churchName, saving, authorName, readOnly = false,
  onAddEditRequest, onRemoveEditRequest,
  onUpdatePartnerNotes, onApprove, onSubmitFeedback,
}: SitemapPartnerViewV2Props) {
  const [drawer, setDrawer] = useState<{ id: string; label: string } | null>(null)
  const [comment, setComment] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [notesDraft, setNotesDraft] = useState(review.partner_notes ?? '')

  const openReqs = useMemo(
    () => (review.partner_edit_requests ?? []).filter(r => r.status === 'open'),
    [review.partner_edit_requests],
  )
  const openBySection = useMemo(() => {
    const m = new Map<string, PartnerEditRequest[]>()
    for (const r of openReqs) {
      const cur = m.get(r.section_id) ?? []
      cur.push(r)
      m.set(r.section_id, cur)
    }
    return m
  }, [openReqs])

  const hasPendingEdits = openReqs.length > 0
  const hasNotes = notesDraft.trim().length > 0 && notesDraft.trim() !== (review.partner_notes ?? '').trim()
  const shareMode = hasPendingEdits || hasNotes

  const openDrawer = (id: string, label: string) => {
    if (readOnly) return
    setDrawer({ id, label })
    setComment('')
    setSuggestion('')
  }
  const closeDrawer = () => setDrawer(null)

  const submitDrawer = async () => {
    if (!drawer || !comment.trim() || !onAddEditRequest) return
    await onAddEditRequest({
      section_id:       drawer.id,
      section_label:    drawer.label,
      comment:          comment.trim(),
      suggested_change: suggestion.trim() || undefined,
      author_name:      authorName?.trim() || undefined,
    })
    setComment('')
    setSuggestion('')
    // Keep drawer open in case they want to add another; empty inputs signal "ready for next".
  }

  // Wrap the click handler so read-only mode makes sections
  // non-interactive without duplicating the JSX branch.
  const clickBind = (id: string, label: string) => readOnly
    ? {}
    : {
        role: 'button' as const,
        tabIndex: 0,
        onClick: () => openDrawer(id, label),
        onKeyDown: (e: ReactKeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') openDrawer(id, label)
        },
      }
  const clickable = (id: string) => readOnly
    ? ''
    : `clickable ${openBySection.has(id) ? 'has-note' : ''}`

  const church = churchName ?? review.footer_info?.church_name ?? 'Your church'
  const hero = review.intro
  const primaryNav = review.nav_layout.header ?? []
  const grouped = groupPagesForList(review.pages, primaryNav)

  return (
    <div className="dox">
      <style dangerouslySetInnerHTML={{ __html: scopedCss }} />
      <div className="wrap">

        {readOnly && (
          <div style={{ background: '#EDE9FC', color: '#341756', textAlign: 'center', padding: '10px 20px', fontSize: 12.5, fontWeight: 620, letterSpacing: '.04em', textTransform: 'uppercase', borderRadius: 999, margin: '0 auto 20px', maxWidth: 480 }}>
            Preview · this is what your partner sees
          </div>
        )}
        {hero && (
          <header className={clickable('intro')} {...clickBind('intro', 'Introduction')}>
            <div className="hero">
              <div className="eyebrow">Your New Website · Structure &amp; Navigation</div>
              <h1>{hero.headline}</h1>
              <p>{hero.body}</p>
              <div className="rule" />
            </div>
          </header>
        )}

        {review.executive_summary && (
          <section className="sec">
            <div className="sec-head"><span className="sec-num">01</span><h2>The heart behind your new site</h2></div>
            <div className="exec-body">{review.executive_summary}</div>
          </section>
        )}

        {/* Nav preview. Reuses the SAME NavPresentationPanel the
            strategist sees in the sitemap step, so partner and staff
            look at identical output. Wrapping div keeps the clickable
            + note-pending affordance around the shared component. */}
        <section className="sec">
          <div className="sec-head"><span className="sec-num">02</span><h2>Primary Navigation</h2></div>
          {review.navigation_strategy && (
            <p className="sec-note">{review.navigation_strategy}</p>
          )}
          {review.nav_presentation ? (
            <div className={clickable('nav-primary')} {...clickBind('nav-primary', 'Primary navigation')} style={{ background: '#fff', borderRadius: 14, padding: 16, border: '1px solid #CFC9F8' }}>
              <NavPresentationPanel presentation={review.nav_presentation as NavPresentation} />
            </div>
          ) : (
            <div className={`browser ${clickable('nav-primary')}`} {...clickBind('nav-primary', 'Primary navigation')} style={{ padding: 22, fontStyle: 'italic', color: '#6B6180' }}>
              The nav preview will appear here once the sitemap step finishes.
            </div>
          )}
        </section>

        <section className="sec">
          <div className="sec-head"><span className="sec-num">03</span><h2>Footer</h2></div>
          <p className="sec-note">Every page ends here, with your contact info, everyday links, and a place to stay in touch.</p>
          <div className={`footer-preview ${clickable('footer')}`} {...clickBind('footer', 'Footer')}>
            <div className="fbrand">◆ {review.footer_info?.church_name ?? church}</div>
            <div className="fmeta">
              {review.footer_info?.address && <div>{review.footer_info.address}</div>}
              {review.footer_info?.phone   && <div>{review.footer_info.phone}</div>}
              {review.footer_info?.email   && <div>{review.footer_info.email}</div>}
              {(!review.footer_info?.address && !review.footer_info?.phone && !review.footer_info?.email) && (
                <div style={{ opacity: 0.7, fontStyle: 'italic' }}>Address, phone, and email will appear here as they are confirmed with your team.</div>
              )}
              {(review.footer_info?.social_links ?? []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {(review.footer_info?.social_links ?? []).map((s, i) => (
                    <span key={i} style={{ marginRight: 14 }}>
                      {s.label ?? capitalize(s.platform)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {review.pages.length > 0 && <section className="sec">
          <div className="sec-head"><span className="sec-num">04</span><h2>Full Page List</h2></div>
          <p className="sec-note">{readOnly ? 'Every page in the sitemap, grouped by parent.' : 'Click any page to leave a note about it: rename, move, combine, or ask a question.'}</p>
          <div className="legend">
            <span><b className="tag2 t-keep">have today</b> already on your site</span>
            <span><b className="tag2 t-uni">now shared</b> was separate per congregation, now one page</span>
            <span><b className="tag2 t-cons">combined</b> a few of today's pages merged into one</span>
            <span><b className="tag2 t-new">new</b> new to the site</span>
          </div>
          <div className="tiers">
            {grouped.map(group => (
              <div key={group.id} className="tier">
                <div className="tier-head">
                  <h3>{group.label}</h3>
                  {group.meta && <span className="meta">{group.meta}</span>}
                </div>
                <ul className="plist">
                  {group.pages.map(p => {
                    const sectionId = `page-${p.slug}`
                    const hasNote = openBySection.has(sectionId)
                    return (
                      <li
                        key={p.id}
                        {...clickBind(sectionId, p.name)}
                        style={hasNote && !readOnly ? { background: '#FFF8EC' } : (readOnly ? { cursor: 'default' } : undefined)}
                      >
                        <span className="pg">
                          {p.name}
                          {tagFor(p, review.content_migrations) && (
                            <span className={`tag2 ${tagFor(p, review.content_migrations)!.className}`}>
                              {tagFor(p, review.content_migrations)!.label}
                            </span>
                          )}
                          {hasNote && <span className="tag2" style={{ background:'#FFB84D', color:'#341756' }}>note pending</span>}
                        </span>
                        <span className="desc">{p.purpose || p.what_changed || 'No description yet.'}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>}

        <section className="sec">
          <div className="sec-head"><span className="sec-num">05</span><h2>What's changing from your current site</h2></div>
          <p className="sec-note">Almost nothing is being thrown away; it's being <b>reorganized</b>. Here's the honest picture:</p>
          <div className={`changed ${clickable('what-changed')}`} {...clickBind('what-changed', "What's changing")}>
            {review.content_migrations.length > 0 ? (
              review.content_migrations.slice(0, 6).map(m => (
                <div key={m.id} className="chcard">
                  <p>
                    <b>{m.title}.</b>{' '}
                    {m.merged_from.length > 0 && <>Combining {m.merged_from.join(', ')} into {m.merged_to}. </>}
                    {m.rationale}
                  </p>
                </div>
              ))
            ) : (
              <>
                <div className="chcard"><span className="tag2 t-keep" style={{ display: 'inline-block', marginBottom: 7 }}>have today</span><p><b>Kept, just re-homed.</b> The pages you already have carry over into the new structure so nothing familiar goes missing.</p></div>
                <div className="chcard"><span className="tag2 t-cons" style={{ display: 'inline-block', marginBottom: 7 }}>combined</span><p><b>Tidied up.</b> Where several pages were doing similar work, they merge into one clearer home so visitors find what they need faster.</p></div>
              </>
            )}
          </div>
        </section>

        <section className="sec">
          <div className="sec-head"><span className="sec-num">06</span><h2>Why we shaped it this way</h2></div>
          <div className={`why ${clickable('why')}`} {...clickBind('why', "Why we shaped it this way")}>
            <div className="wcard"><div className="ic">◆</div><h4>Serves the people you're reaching</h4><p>Every page is shaped around a real person, not an org chart: first-time visitors, regular attenders, and everyone in between.</p></div>
            <div className="wcard"><div className="ic">◇</div><h4>Newcomers find their way</h4><p>Someone landing fresh can understand what {church} is about and take a next step in under a minute.</p></div>
            <div className="wcard"><div className="ic">✦</div><h4>One church, one story</h4><p>Shared story blocks stay shared so visitors and members experience the same voice everywhere.</p></div>
            <div className="wcard"><div className="ic">↗</div><h4>Built to grow</h4><p>As {church} grows, new pages slot into the same structure, no redesign needed.</p></div>
          </div>
        </section>

        {!readOnly && (
          <section className="sec">
            <div className="turn">
              <h2>Your turn, <em className="brand-em">tell us what you think</em></h2>
              <p>This is your site, and this is the moment to shape it. Click any section above to leave a note pinned to it, or drop overall thoughts here.</p>

              <label htmlFor="partner-notes" className="mega-label" style={{ color: '#D8CFF3', display: 'block', marginTop: 14, marginBottom: 8 }}>Overall notes</label>
              <textarea
                id="partner-notes"
                value={notesDraft}
                onChange={e => setNotesDraft(e.target.value)}
                onBlur={() => { if (onUpdatePartnerNotes && notesDraft !== (review.partner_notes ?? '')) void onUpdatePartnerNotes(notesDraft) }}
                placeholder="Anything overall: names, missing pages, tone, priorities…"
                style={{ width: '100%', minHeight: 80, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
              />

              <ul style={{ marginTop: 22 }}>
                <li><span className="n">1</span><span>Do the <b>page names</b> sound like {church}? We used your language, but you know your people best.</span></li>
                <li><span className="n">2</span><span>Is anything <b>in the wrong place</b>, or <b>missing</b> that your people need?</span></li>
                <li><span className="n">3</span><span>Anything you'd want to <b>add, combine, or rename</b> before we start writing?</span></li>
              </ul>

              <div className="actions">
                {shareMode && onSubmitFeedback ? (
                  <button
                    type="button" className="btn pending"
                    disabled={saving}
                    onClick={() => void onSubmitFeedback()}
                  >Share Sitemap Review Feedback →</button>
                ) : onApprove ? (
                  <button
                    type="button" className="btn approve"
                    disabled={saving}
                    onClick={() => void onApprove()}
                  >Approve as-is →</button>
                ) : null}
                {shareMode && onApprove && (
                  <button
                    type="button" className="btn ghost"
                    disabled={saving}
                    onClick={() => void onApprove()}
                  >Approve anyway</button>
                )}
                <span className="note-count">
                  {openReqs.length > 0 && `${openReqs.length} section note${openReqs.length === 1 ? '' : 's'} pending`}
                  {openReqs.length > 0 && hasNotes && ' · '}
                  {hasNotes && 'overall notes unsent'}
                  {!shareMode && 'No pending notes. Approve to lock as canonical.'}
                </span>
              </div>
            </div>
          </section>
        )}
      </div>

      {drawer && (
        <>
          <div className="dox-drawer-scrim" onClick={closeDrawer} />
          <aside className="dox-drawer" role="dialog" aria-modal="true">
            <div className="dh">
              <button className="cx" onClick={closeDrawer} aria-label="Close">×</button>
              <div className="status-chip">Section note</div>
              <h3 style={{ marginTop: 10 }}>{drawer.label}</h3>
              <p>Your note is pinned to this section and shared with the Church Media Squad team.</p>
            </div>
            <div className="db">
              {authorName && (
                <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6B6180' }}>
                  Signed in as <b style={{ color: '#341756' }}>{authorName}</b>
                </p>
              )}
              <label htmlFor="pn-comment">What's on your mind?</label>
              <textarea id="pn-comment" value={comment} onChange={e => setComment(e.target.value)} placeholder="Describe what feels off, or what you'd like to see changed…" />

              <label htmlFor="pn-suggestion">Suggested change (optional)</label>
              <textarea id="pn-suggestion" value={suggestion} onChange={e => setSuggestion(e.target.value)} placeholder="e.g. Rename “Family Life” to “Families”; move Care under Next Steps." style={{ minHeight: 70 }} />

              {(openBySection.get(drawer.id)?.length ?? 0) > 0 && (
                <div className="existing">
                  <div className="en">Notes on this section</div>
                  {(openBySection.get(drawer.id) ?? []).map(r => (
                    <div key={r.id} className="item">
                      {onRemoveEditRequest && (
                        <button type="button" className="rm" onClick={() => void onRemoveEditRequest(r.id)}>remove</button>
                      )}
                      <div className="who">{r.author_name || 'Guest'} · {new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric' })}</div>
                      <div className="txt">{r.comment}</div>
                      {r.suggested_change && <div className="sugg">Suggested: {r.suggested_change}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="df">
              <button type="button" className="btn ghost" onClick={closeDrawer} style={{ flex: 1 }}>Close</button>
              <button type="button" className="btn accent save" disabled={!comment.trim() || saving} onClick={() => void submitDrawer()} style={{ flex: 1 }}>Save note</button>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

function groupPagesForList(pages: ReviewPage[], primary: NavItem[]): Array<{ id: string; label: string; meta?: string; pages: ReviewPage[] }> {
  // Group by top-level nav parent when derivable; else by parent_slug; else lump into "All pages".
  const byParent = new Map<string, ReviewPage[]>()
  const orphaned: ReviewPage[] = []
  const primaryByLabel = new Map<string, NavItem>()
  for (const it of primary) primaryByLabel.set(it.label.toLowerCase(), it)

  for (const p of pages) {
    if (p.parent_slug) {
      const arr = byParent.get(p.parent_slug) ?? []
      arr.push(p)
      byParent.set(p.parent_slug, arr)
    } else {
      orphaned.push(p)
    }
  }
  if (byParent.size === 0) {
    return [{ id: 'all', label: 'All pages', pages: orphaned }]
  }
  const groups: Array<{ id: string; label: string; meta?: string; pages: ReviewPage[] }> = []
  if (orphaned.length > 0) groups.push({ id: 'top', label: 'Top-level pages', pages: orphaned.sort((a, b) => a.order - b.order) })
  for (const [parentSlug, children] of byParent.entries()) {
    const parentPage = pages.find(pp => pp.slug === parentSlug)
    groups.push({
      id: `parent-${parentSlug}`,
      label: parentPage?.name ?? capitalize(parentSlug.replace(/-/g, ' ')),
      meta: `${children.length} page${children.length === 1 ? '' : 's'}`,
      pages: children.sort((a, b) => a.order - b.order),
    })
  }
  return groups
}

function tagFor(p: ReviewPage, migrations: ContentMigration[]): { label: string; className: string } | null {
  // Explicit strategist-authored tag always wins. Vocabulary is
  // fixed in the schema so the pill colors and legend stay in sync.
  if (p.sitemap_tag) {
    switch (p.sitemap_tag) {
      case 'kept':         return { label: 'have today', className: 't-keep' }
      case 'unified':      return { label: 'now shared', className: 't-uni' }
      case 'consolidated': return { label: 'combined',   className: 't-cons' }
      case 'new':          return { label: 'new',        className: 't-new' }
    }
  }
  const isMergedTo = migrations.some(m =>
    m.merged_to_slug === p.slug ||
    (m.merged_to && m.merged_to.toLowerCase() === p.name.toLowerCase()),
  )
  if (isMergedTo) return { label: 'combined', className: 't-cons' }
  const wc = (p.what_changed ?? '').toLowerCase()
  if (wc.includes('share') || wc.includes('unified') || wc.includes('one page')) return { label: 'now shared', className: 't-uni' }
  if (wc.includes('new')) return { label: 'new', className: 't-new' }
  if (p.what_changed) return { label: 'have today', className: 't-keep' }
  return null
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}
