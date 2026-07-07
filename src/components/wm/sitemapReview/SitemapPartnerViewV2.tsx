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
  SitemapReviewNavPresentation,
} from '../../../lib/sitemapReview'

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
.dox .mega-item h4{font-size:13.5px; font-weight:640; margin:0 0 1px; color:var(--ink); line-height:1.25;}
.dox .mega-item p{font-size:11.5px; color:var(--muted); margin:0; line-height:1.4; font-weight:400;}
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
.dox .plist li.child{padding-left:44px; background:#FCFBFE;}
.dox .plist li.child:hover{background:#F5F1FD;}
.dox .plist li.child .pg{font-weight:520; color:#4a4239;}
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
.dox .feat-highlight{background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px 22px;}
.dox .feat-highlight .btn{padding:8px 16px;}
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
@media (max-width:640px){
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
  const pres = review.presentation
  const grouped = useMemo(
    () => pres?.tiers && pres.tiers.length > 0
      ? groupPagesByTiers(review.pages, pres.tiers)
      : groupPagesForList(review.pages, primaryNav),
    [review.pages, primaryNav, pres?.tiers],
  )

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
              <p>{renderWithEmPhrase(hero.body, pres?.hero_em_phrase)}</p>
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

        {/* Primary Navigation preview. Content sourced from
            nav_presentation (visible_top_level + megamenu_panels or
            standard_dropdowns or offcanvas_overlay). Visuals rendered
            in the Doxology-artifact style: browser topnav with pill
            chips, mega-panels with columns + descriptions + featured
            tile as image_cta card. */}
        <section className="sec">
          <div className="sec-head"><span className="sec-num">02</span><h2>Primary Navigation</h2></div>
          {review.navigation_strategy && (
            <p className="sec-note">{review.navigation_strategy}</p>
          )}
          <div className={`browser ${clickable('nav-primary')}`} {...clickBind('nav-primary', 'Primary navigation')}>
            {(() => {
              // nav_presentation is a legitimate render source only
              // when it has actual visible_top_level items. Older
              // sitemap-step runs (pre-nav_presentation feature) leave
              // a stub `{shell: 'megamenu'}` behind — that's not
              // enough to render, so fall through to the header-based
              // fallback which uses nav_layout.header. Woodcreek is
              // the canonical example: shell-only stub + full
              // 6-item nav_layout.header.
              const np = review.nav_presentation
              const hasPresentationContent = !!np && (np.visible_top_level?.length ?? 0) > 0
              return hasPresentationContent
                ? <PrimaryNavPreview np={np!} church={church} featured={pres?.featured_highlight} congregations={pres?.congregations} />
                : <PrimaryNavFallback header={review.nav_layout.header ?? []} church={church} />
            })()}
          </div>
        </section>

        {pres?.congregations && pres.congregations.length > 0 && (
          <section className="sec">
            <div className="sec-head"><span className="sec-num">02b</span><h2>Persistent Navigation</h2></div>
            <p className="sec-note">Step into a congregation and this bar stays with you. Its name, service time, address, and full menu always in reach.</p>
            <div className={clickable('nav-secondary')} {...clickBind('nav-secondary', 'Persistent navigation')} style={{ padding: '8px 0' }}>
              {pres.congregations.map(cg => {
                const allLinks = [...(cg.links_left ?? []), ...(cg.links_right ?? [])]
                const dropdowns = allLinks.filter(l => l.is_dropdown && (l.kids ?? '').trim())
                return (
                  <div key={cg.id} style={{ marginBottom: 12 }}>
                    <div className="cong-bar" style={{ background: '#341756', color: '#fff', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                      <div style={{ background: '#F9F5F1', color: '#341756', borderRadius: 999, padding: '10px 18px', display: 'flex', alignItems: 'baseline', gap: 12 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: '#513DE5', alignSelf: 'center' }}>{cg.label}</span>
                        {cg.service_time && <span style={{ fontSize: 14, fontWeight: 750, letterSpacing: '-.02em' }}>{cg.service_time}</span>}
                        {cg.address && <span style={{ fontSize: 12, color: '#6B6180' }}>{cg.address}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginLeft: 'auto', fontSize: 13, fontWeight: 530, color: '#CFC9F8', alignItems: 'center' }}>
                        {allLinks.map((it, i) => (
                          <span key={i}>
                            {it.label}
                            {it.is_dropdown && <span style={{ color: '#8A82AC', fontSize: 10, marginLeft: 4 }}>▾</span>}
                            {it.is_shared && <span style={{ color: '#8A82AC', fontSize: 10, marginLeft: 4 }}>↗ shared</span>}
                          </span>
                        ))}
                        <span style={{ color: '#fff', fontWeight: 640, border: '1px solid #6B5CE7', padding: '6px 14px', borderRadius: 999, marginLeft: 8 }}>
                          Visit {cg.label}
                        </span>
                      </div>
                      {cg.note && <div style={{ width: '100%', fontSize: 11, color: '#8B84A0', fontStyle: 'italic', marginTop: 4 }}>{cg.note}</div>}
                    </div>
                    {dropdowns.length > 0 && (
                      <div style={{
                        background: '#291247',
                        borderRadius: 10,
                        padding: '18px 22px',
                        margin: '10px 8px 0',
                        display: 'grid',
                        gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
                        gap: '20px 40px',
                        fontSize: 13,
                      }}>
                        {dropdowns.map((it, i) => (
                          <div key={i} style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            paddingLeft: i === 0 ? 0 : 14,
                            borderLeft: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.12)',
                          }}>
                            <span style={{
                              color: '#B8B0D2',
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: '.14em',
                              textTransform: 'uppercase',
                              marginBottom: 2,
                            }}>{it.label} ▾</span>
                            {(it.kids ?? '').split(',').map(k => k.trim()).filter(Boolean).map((child, j) => (
                              <span key={j} style={{
                                color: '#fff',
                                fontWeight: 550,
                                fontSize: 13.5,
                                lineHeight: 1.35,
                              }}>{child}</span>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Shared Hub Pages. One card per congregation with service
            time + address + Visit button. Populated from
            presentation.congregations; sites without multi-campus
            structure skip this section entirely. */}
        {pres?.congregations && pres.congregations.length > 0 && (
          <section className="sec">
            <div className="sec-head"><span className="sec-num">03</span><h2>{pres.shared_hubs_headline ?? 'Shared Hub Pages'}</h2></div>
            {pres.shared_hubs_body
              ? <p className="sec-note" style={{ whiteSpace: 'pre-wrap' }}>{pres.shared_hubs_body}</p>
              : <p className="sec-note"><b>Visit</b> is a warm welcome page for the whole church, with a card that leads to a dedicated page for each congregation. <b>Watch</b> works the same way.</p>}
            <div className={`cards3 ${clickable('hubs')}`} {...clickBind('hubs', 'Shared hub pages')} style={{ padding: '8px 0' }}>
              {pres.congregations.map(cg => (
                <div key={cg.id} className="vcard">
                  <div className="vimg">◇</div>
                  <div className="vbody">
                    <h4>{cg.label}</h4>
                    {cg.service_time && <div className="vt">{cg.service_time}</div>}
                    {cg.address && <div className="va">{cg.address}</div>}
                    <span className="btn accent" style={{ display: 'block', textAlign: 'center' }}>Visit {cg.label} →</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer preview. Four-column grid: brand + contact / by-
            congregation service times / footer_page_links (explore)
            / newsletter cta. Matches the artifact layout. */}
        <section className="sec">
          <div className="sec-head"><span className="sec-num">{pres?.congregations && pres.congregations.length > 0 ? '04' : '03'}</span><h2>Footer</h2></div>
          <p className="sec-note">Every page ends here: contact info, everyday links, and a place to stay in touch.</p>
          <div className={`footer-preview ${clickable('footer')}`} {...clickBind('footer', 'Footer')} style={{ padding: '28px 26px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: [
              '1.3fr',
              (pres?.congregations && pres.congregations.length > 0) ? '1.1fr' : null,
              '1fr',
              review.footer_info?.newsletter_signup_url ? '1fr' : null,
            ].filter(Boolean).join(' '), gap: 28 }}>
              <div>
                <div className="fbrand" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ width: 26, height: 26, background: '#fff', borderRadius: 6, display: 'grid', placeItems: 'center', color: '#341756', fontSize: 13 }}>◆</span>
                  {review.footer_info?.church_name ?? church}
                </div>
                <p style={{ fontSize: 12.5, color: '#D8CFF3', margin: '0 0 12px', lineHeight: 1.5 }}>
                  {review.executive_summary ? '' : `Contact ${church} and stay in touch.`}
                </p>
                <div style={{ fontSize: 12, color: '#D8CFF3', lineHeight: 1.8 }}>
                  {review.footer_info?.email   && <div>{review.footer_info.email}</div>}
                  {review.footer_info?.phone   && <div>{review.footer_info.phone}</div>}
                  {review.footer_info?.address && <div>{review.footer_info.address}</div>}
                  {(!review.footer_info?.address && !review.footer_info?.phone && !review.footer_info?.email) && (
                    <div style={{ opacity: 0.7, fontStyle: 'italic' }}>Contact info populates once your team confirms it.</div>
                  )}
                </div>
                {(review.footer_info?.social_links ?? []).length > 0 && (
                  <p style={{ fontSize: 11.5, color: '#B8B0D2', margin: '12px 0 0', letterSpacing: '.03em' }}>
                    {(review.footer_info?.social_links ?? []).map(s => s.label ?? capitalize(s.platform)).join(' · ')}
                  </p>
                )}
              </div>

              {pres?.congregations && pres.congregations.length > 0 && (
                <div>
                  <div className="mega-label" style={{ color: '#B8B0D2', marginBottom: 12 }}>Congregations</div>
                  {pres.congregations.map(cg => (
                    <p key={cg.id} style={{ fontSize: 12, color: '#EDE9FC', margin: '0 0 10px', lineHeight: 1.5 }}>
                      <b style={{ color: '#fff' }}>{cg.label}</b><br />
                      {cg.service_time}
                      {cg.address && <> · {cg.address}</>}
                      {' · '}<span style={{ color: '#FFC98A' }}>Visit →</span>
                    </p>
                  ))}
                </div>
              )}

              <div>
                <div className="mega-label" style={{ color: '#B8B0D2', marginBottom: 12 }}>Explore</div>
                <div style={{ fontSize: 12.5, color: '#EDE9FC', lineHeight: 2 }}>
                  {(review.footer_info?.footer_page_links ?? []).length > 0 ? (
                    (review.footer_info?.footer_page_links ?? []).map((l, i) => (<div key={i}>{l.label}</div>))
                  ) : (
                    <div style={{ opacity: 0.7, fontStyle: 'italic' }}>Add footer links in the Footer section of the Edit tab.</div>
                  )}
                </div>
              </div>

              {review.footer_info?.newsletter_signup_url && (
                <div>
                  <div className="mega-label" style={{ color: '#B8B0D2', marginBottom: 12 }}>Stay in the loop</div>
                  <p style={{ fontSize: 12, color: '#D8CFF3', margin: '0 0 10px', lineHeight: 1.5 }}>Weekend recaps and upcoming events.</p>
                  <a href={review.footer_info.newsletter_signup_url} target="_blank" rel="noreferrer" className="btn" style={{ background: '#FFC98A', borderColor: '#FFC98A', color: '#341756' }}>Sign up →</a>
                </div>
              )}
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: 22, paddingTop: 14, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 11, color: '#B8B0D2' }}>
              <span>© {new Date().getFullYear()} {review.footer_info?.church_name ?? church}</span>
              <span>Privacy · Terms</span>
            </div>
          </div>
        </section>

        {review.pages.length > 0 && <section className="sec">
          <div className="sec-head"><span className="sec-num">{pres?.congregations && pres.congregations.length > 0 ? '05' : '04'}</span><h2>Full Page List</h2></div>
          <p className="sec-note">{readOnly ? 'Every page in the sitemap, grouped by parent.' : 'Click any page to leave a note about it: rename, move, combine, or ask a question.'}</p>
          <div className="legend">
            <span><b className="tag2 t-keep">have today</b> already on your site</span>
            <span><b className="tag2 t-uni">now shared</b> was separate per congregation, now one page</span>
            <span><b className="tag2 t-cons">combined</b> a few of today's pages merged into one</span>
            <span><b className="tag2 t-new">new</b> new to the site</span>
          </div>
          <div className="tiers">
            {grouped.map(group => {
              const childSlugs  = 'childSlugs'  in group ? (group as PageGroup).childSlugs  : undefined
              const overrides   = 'overrides'   in group ? (group as PageGroup).overrides   : undefined
              return (
                <div key={group.id} className="tier">
                  <div className="tier-head">
                    <h3>{group.label}</h3>
                    {group.meta && <span className="meta">{group.meta}</span>}
                  </div>
                  <ul className="plist">
                    {group.pages.map(p => {
                      const sectionId = `page-${p.slug}`
                      const hasNote   = openBySection.has(sectionId)
                      const isChild   = childSlugs?.has(p.slug) ?? false
                      const desc      = overrides?.get(p.slug) ?? p.purpose ?? p.what_changed ?? 'No description yet.'
                      return (
                        <li
                          key={p.id}
                          className={isChild ? 'child' : undefined}
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
                          <span className="desc">{desc}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>}

        <section className="sec">
          <div className="sec-head"><span className="sec-num">{pres?.congregations && pres.congregations.length > 0 ? '06' : '05'}</span><h2>What's changing from your current site</h2></div>
          <p className="sec-note">Here is how the content you have today shows up in the new structure:</p>
          <div className={`changed ${clickable('what-changed')}`} {...clickBind('what-changed', "What's changing")}>
            {pres?.whats_changing_cards && pres.whats_changing_cards.length > 0 ? (
              pres.whats_changing_cards.map(c => (
                <div key={c.id} className="chcard">
                  {c.tag && <span className={`tag2 ${tagClassFor(c.tag)}`} style={{ display: 'inline-block', marginBottom: 7 }}>{tagLabelFor(c.tag)}</span>}
                  <p><b>{c.title}.</b> {c.body}</p>
                </div>
              ))
            ) : (
              // No authored cards -> show partner-friendly generic
              // defaults instead of raw content_migrations rationale
              // (which is strategist-facing sitemap step output and
              // often technical or context-heavy in ways partners
              // shouldn't be reading).
              <>
                <div className="chcard"><span className="tag2 t-keep" style={{ display: 'inline-block', marginBottom: 7 }}>have today</span><p><b>Kept, just re-homed.</b> Pages you already have carry over into the new structure with clearer names and better neighbors.</p></div>
                <div className="chcard"><span className="tag2 t-cons" style={{ display: 'inline-block', marginBottom: 7 }}>combined</span><p><b>Tidied up.</b> Where several pages were doing similar work, they merge into one clearer home so visitors find what they need faster.</p></div>
              </>
            )}
          </div>
        </section>

        <section className="sec">
          <div className="sec-head"><span className="sec-num">{pres?.congregations && pres.congregations.length > 0 ? '07' : '06'}</span><h2>Why we shaped it this way</h2></div>
          <div className={`why ${clickable('why')}`} {...clickBind('why', "Why we shaped it this way")}>
            {pres?.why_cards && pres.why_cards.length > 0 ? (
              pres.why_cards.map(c => (
                <div key={c.id} className="wcard">
                  <div className="ic">{c.icon ?? '◆'}</div>
                  <h4>{c.title}</h4>
                  <p>{c.body}</p>
                </div>
              ))
            ) : (
              <>
                <div className="wcard"><div className="ic">◆</div><h4>Serves the people you're reaching</h4><p>Every page is shaped around a real person, not an org chart: first-time visitors, regular attenders, and everyone in between.</p></div>
                <div className="wcard"><div className="ic">◇</div><h4>Newcomers find their way</h4><p>Someone landing fresh can understand what {church} is about and take a next step in under a minute.</p></div>
                <div className="wcard"><div className="ic">✦</div><h4>One church, one story</h4><p>Shared story blocks stay shared so visitors and members experience the same voice everywhere.</p></div>
                <div className="wcard"><div className="ic">↗</div><h4>Built to grow</h4><p>As {church} grows, new pages slot into the same structure, no redesign needed.</p></div>
              </>
            )}
          </div>
        </section>

        {review.persona_postures.length > 0 && (() => {
          const visiblePostures = review.persona_postures.filter(p =>
            (p.posture_summary ?? '').trim().length > 0 ||
            (p.goal ?? '').trim().length > 0 ||
            (p.key_page_slugs ?? []).length > 0 ||
            (p.drop_off_risk && ((p.drop_off_risk.mitigation ?? '').trim().length > 0)),
          )
          if (visiblePostures.length === 0) return null
          const pageBySlug = new Map(review.pages.map(p => [p.slug, p]))
          const congBase = pres?.congregations && pres.congregations.length > 0 ? 7 : 6
          return (
            <section className="sec">
              <div className="sec-head"><span className="sec-num">{String(congBase + 1).padStart(2, '0')}</span><h2>Who this site is built for</h2></div>
              <p className="sec-note">The people we designed the site around, and the pages that matter most for each one.</p>
              <div className={`personas ${clickable('personas')}`} {...clickBind('personas', 'Who this site is built for')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                {visiblePostures.map(p => (
                  <div key={p.persona_id} style={{ background: '#fff', border: '1px solid #CFC9F8', borderRadius: 14, padding: '18px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#513DE5', marginBottom: 4 }}>Meet</div>
                    <h3 style={{ fontSize: 20, fontWeight: 680, color: '#341756', margin: '0 0 10px', letterSpacing: '-0.02em' }}>{p.persona_name}</h3>
                    {p.posture_summary && (
                      <p style={{ fontSize: 13, color: '#6B6180', margin: '0 0 14px', lineHeight: 1.55 }}>{p.posture_summary}</p>
                    )}
                    {(p.goal ?? '').trim().length > 0 && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', margin: '0 0 14px', padding: '10px 12px', background: '#EDE9FC', borderRadius: 10, fontSize: 12.5, color: '#341756', lineHeight: 1.45 }}>
                        <span style={{ flex: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#513DE5' }}>Goal</span>
                        <span style={{ fontWeight: 600 }}>{p.goal}</span>
                      </div>
                    )}
                    {(() => {
                      const slugs = (p.key_page_slugs ?? []).slice(0, 3)
                      const pages = slugs.map(s => pageBySlug.get(s)).filter((pg): pg is (typeof review.pages)[number] => !!pg)
                      if (pages.length === 0) return null
                      return (
                        <div>
                          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8B84A0', marginBottom: 8 }}>Key pages</div>
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {pages.map((page) => (
                              <li key={page.slug} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                <span style={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: '#513DE5', marginTop: 7 }} />
                                <div style={{ fontSize: 13, color: '#341756', lineHeight: 1.4 }}>
                                  <div style={{ fontWeight: 620 }}>{page.name}</div>
                                  {(page.purpose ?? '').trim().length > 0 && (
                                    <div style={{ fontSize: 11.5, color: '#6B6180', marginTop: 2 }}>{page.purpose}</div>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })()}
                    {p.drop_off_risk && (p.drop_off_risk.mitigation ?? '').trim().length > 0 && (
                      <div style={{ marginTop: 14, padding: '10px 12px', background: '#F9F5F1', borderRadius: 10, borderLeft: '3px solid #513DE5' }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#513DE5', marginBottom: 4 }}>
                          How we&apos;re leaning in for {p.persona_name}
                        </div>
                        <div style={{ fontSize: 12.5, color: '#341756', lineHeight: 1.5 }}>{p.drop_off_risk.mitigation}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )
        })()}

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
                {(pres?.your_turn_prompts && pres.your_turn_prompts.length > 0
                  ? pres.your_turn_prompts
                  : [
                      `Do the page names sound like ${church}? We used your language, but you know your people best.`,
                      `Is anything in the wrong place, or missing that your people need?`,
                      `Anything you'd want to add, combine, or rename before we start writing?`,
                    ]
                ).map((prompt, i) => (
                  <li key={i}><span className="n">{i + 1}</span><span>{prompt}</span></li>
                ))}
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

// ── Nav preview components ────────────────────────────────────────

/** Artifact-style primary nav preview. Reads nav_presentation (from
 *  cowork sitemap step OR strategist-authored via presentation layer)
 *  and renders it in the browser-mock layout the design artifact
 *  established: topnav with pill chips + mega-panels with columns +
 *  featured tiles. Explicitly does NOT reuse NavPresentationPanel
 *  because that component's layout is different by design. */
function PrimaryNavPreview({
  np, church, featured, congregations,
}: {
  np:       SitemapReviewNavPresentation
  church:   string
  featured?: NonNullable<SitemapReview['presentation']>['featured_highlight']
  /** When present, mega panels whose columns look like the
   *  congregations list get rendered as per-congregation rows
   *  (chip + horizontal links + service card) instead of the
   *  standard columns-of-links layout. Matches the artifact's
   *  Get Connected mega for multi-campus partners. */
  congregations?: NonNullable<SitemapReview['presentation']>['congregations']
}) {
  const vtl = np.visible_top_level ?? []
  const items    = vtl.filter(i => i.kind !== 'button' && i.kind !== 'hamburger')
  const buttons  = vtl.filter(i => i.kind === 'button')
  const hasBurger = vtl.some(i => i.kind === 'hamburger')

  return (
    <>
      <nav className="topnav">
        <div className="brand-mark"><span className="glyph">◆</span> {church}</div>
        <div className="items">
          {items.map((it, i) => (
            <span key={i} className={it.kind === 'group' ? 'mega' : ''}>
              {it.label ?? it.group_label}
              {it.kind === 'group' && <span className="caret">▾</span>}
            </span>
          ))}
        </div>
        <span className="spacer" />
        {buttons.map((it, i) => (
          <span key={i} className={i === 0 ? 'btn accent' : 'btn ghost'}>{it.label}</span>
        ))}
        {hasBurger && <span style={{ fontSize: 20, color: '#341756', marginLeft: 8 }}>☰</span>}
      </nav>

      {(np.megamenu_panels ?? []).map((panel, pi) => {
        const cols = panel.columns ?? []
        const isFirstWithFeatured = pi === 0 && !!panel.featured_tile
        const externalFeatured = isFirstWithFeatured ? undefined : (pi === 0 ? featured : undefined)
        const featuredTile = panel.featured_tile
          ?? (externalFeatured ? { kind: 'image_cta' as const, heading: externalFeatured.label, body: externalFeatured.description, link_label: externalFeatured.cta_label ?? 'Learn more' } : undefined)
        const externalUrl       = featured?.url
        const externalCtaLabel  = featured?.cta_label
        const secondaryCta      = featured?.secondary_cta_label

        // Detect "congregation rows" shape: panel columns whose
        // headings match presentation.congregations labels. Switches
        // to the per-cong row layout the artifact uses for Doxology's
        // Get Connected mega (chip + horizontal links + service card).
        const congByLabel = new Map((congregations ?? []).map(c => [c.label.toLowerCase(), c]))
        const congRows = cols.length > 0 && cols.every(c => c.heading && congByLabel.has(c.heading.toLowerCase()))

        return (
          <div key={pi} className="mega-panel" style={pi > 0 ? { borderTop: '1px solid #CFC9F8' } : undefined}>
            <div className="mega-label">{panel.triggered_by ?? '…'}</div>

            {congRows ? (
              /* Per-congregation rows: chip + link list + svc card. */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {cols.map((col, ci) => {
                  const cong = congByLabel.get((col.heading ?? '').toLowerCase())
                  const isPrimary = !!cong?.is_primary
                  const links = col.links ?? []
                  return (
                    <div key={ci} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 240px', gap: 24, alignItems: 'start', padding: '18px 0', borderTop: ci === 0 ? undefined : '1px solid #CFC9F8' }}>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 9,
                        fontWeight: 640, fontSize: 14, padding: '11px 14px',
                        borderRadius: 999,
                        background: isPrimary ? '#341756' : '#fff',
                        color:      isPrimary ? '#fff'    : '#341756',
                        border: `1px solid ${isPrimary ? '#341756' : '#CFC9F8'}`,
                        justifySelf: 'start',
                      }}>◆ {cong?.label ?? col.heading}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 28px', paddingTop: 6 }}>
                        {links.map((l, li) => {
                          // Split comma-separated one_line_description
                          // ("Kids, Youth") into stacked sub-page rows.
                          // Sub-pages are the actual site pages, so they
                          // get full page-hierarchy typography; the parent
                          // label above them is treated as a small-caps
                          // dropdown header, not competing with the pages.
                          const kids = (l.one_line_description ?? '')
                            .split(',')
                            .map(s => s.trim())
                            .filter(Boolean)
                          const hasKids = kids.length > 0
                          return (
                            <div key={li}>
                              {hasKids ? (
                                <>
                                  <div style={{
                                    fontSize: 10.5,
                                    fontWeight: 700,
                                    letterSpacing: '.14em',
                                    textTransform: 'uppercase',
                                    color: '#8B84A0',
                                    marginBottom: 6,
                                  }}>{l.label}</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {kids.map((k, ki) => (
                                      <span key={ki} style={{
                                        fontSize: 14,
                                        fontWeight: 620,
                                        color: '#341756',
                                        lineHeight: 1.3,
                                      }}>{k}</span>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <div style={{
                                  fontSize: 14,
                                  fontWeight: 620,
                                  color: '#341756',
                                  lineHeight: 1.3,
                                }}>{l.label}</div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ background: '#F9F5F1', border: '1px solid #E2DDD4', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, justifySelf: 'stretch' }}>
                        {cong?.service_time && <div style={{ fontSize: 17, fontWeight: 700, color: '#341756', lineHeight: 1.2 }}>{cong.service_time}</div>}
                        {cong?.address && <div style={{ fontSize: 12.5, color: '#6F6558', lineHeight: 1.4 }}>{cong.address}</div>}
                        {cong?.note && <div style={{ fontSize: 11, color: '#8B84A0', fontStyle: 'italic' }}>{cong.note}</div>}
                        <span style={{ marginTop: 4, textAlign: 'center', background: '#341756', color: '#fff', padding: '8px 12px', borderRadius: 7, fontSize: 12, fontWeight: 620 }}>Visit {cong?.label ?? col.heading}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* Standard columns + optional featured tile. */
              <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {cols.map((col, ci) => {
                  const links = col.links ?? []
                  const twoCol = cols.length === 1 && links.length >= 4
                  return (
                    <div key={ci} style={{ flex: '1 1 240px', minWidth: 180 }}>
                      {col.heading && <h4 style={{ fontSize: 14, fontWeight: 680, margin: '0 0 6px', color: '#513DE5', letterSpacing: '-0.01em' }}>{col.heading}</h4>}
                      {col.description && <p style={{ fontSize: 12.5, color: '#6B6180', margin: '0 0 12px', lineHeight: 1.45 }}>{col.description}</p>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px' }}>
                        {links.map((link, li) => (
                          <div key={li} className="mega-item" style={twoCol ? { flex: '1 1 45%', minWidth: 140 } : { flex: '1 1 100%' }}>
                            <span className="ph sq">■</span>
                            <div>
                              <h4>{link.label}</h4>
                              {link.one_line_description && <p>{link.one_line_description}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {featuredTile && (
                  <div style={{ flex: '0 1 260px', minWidth: 220 }}>
                    <FeaturedTile
                      tile={featuredTile}
                      externalUrl={panel.featured_tile ? externalUrl : externalFeatured?.url}
                      externalCtaLabel={panel.featured_tile ? externalCtaLabel : externalFeatured?.cta_label}
                      secondaryCta={panel.featured_tile ? secondaryCta : externalFeatured?.secondary_cta_label}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {shell(np) === 'standard_dropdowns' && (np.standard_dropdowns?.groups ?? []).length > 0 && (
        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10, background: '#fff' }}>
          {np.standard_dropdowns!.groups!.map((g, gi) => (
            <div key={gi} style={{ background: '#341756', color: '#fff', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ background: '#F9F5F1', color: '#341756', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700 }}>
                {g.group_label ?? '…'}
              </div>
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginLeft: 'auto', fontSize: 13, fontWeight: 530, color: '#CFC9F8', alignItems: 'center' }}>
                {(g.children ?? []).map((c, ci) => (
                  <span key={ci}>{c.label}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {shell(np) === 'offcanvas' && np.offcanvas_overlay && (
        <div className="mega-panel" style={{ background: 'linear-gradient(180deg,#F9F5F1,#EDE9FC)' }}>
          {np.offcanvas_overlay.hero_message && (
            <p style={{ fontSize: 14, fontWeight: 640, fontStyle: 'italic', color: '#341756', margin: '0 0 14px' }}>
              &ldquo;{np.offcanvas_overlay.hero_message}&rdquo;
            </p>
          )}
          <div className="about-grid" style={{ gridTemplateColumns: `repeat(${Math.min((np.offcanvas_overlay.sections ?? []).length, 3)}, 1fr)` }}>
            {(np.offcanvas_overlay.sections ?? []).map((s, si) => (
              <div key={si} className="lcol" style={{ gridTemplateColumns: '1fr' }}>
                <h4 style={{ fontSize: 12, fontWeight: 680, margin: '0 0 8px', color: '#513DE5', textTransform: 'uppercase', letterSpacing: '.08em' }}>{s.section_label}</h4>
                {(s.links ?? []).map((l, li) => (
                  <div key={li} className="mega-item"><span className="ph sq" style={{ width: 24, height: 24 }}>■</span><div><h4>{l.label}</h4></div></div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function FeaturedTile({
  tile, externalUrl, externalCtaLabel, secondaryCta,
}: {
  tile:             NonNullable<NonNullable<SitemapReviewNavPresentation['megamenu_panels']>[number]['featured_tile']>
  externalUrl?:     string
  externalCtaLabel?: string
  secondaryCta?:    string
}) {
  const linksOut = !!externalUrl
  return (
    <div style={{
      background: '#F9F5F1',
      border: '1px solid #E2DDD4',
      borderRadius: 12,
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#6B6180' }}>
        Featured{linksOut && <span style={{ marginLeft: 6 }}>· links out ↗</span>}
      </div>
      <div style={{ background: '#D9D4CA', borderRadius: 8, height: 88, display: 'grid', placeItems: 'center', color: '#8A8073', fontSize: 22 }}>◇</div>
      {tile.heading && <h4 style={{ fontSize: 16, fontWeight: 680, margin: 0, color: '#341756', letterSpacing: '-0.02em', lineHeight: 1.2 }}>{tile.heading}</h4>}
      {tile.body && <p style={{ fontSize: 12, color: '#6F6558', margin: 0, lineHeight: 1.45 }}>{tile.body}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        {externalUrl ? (
          <a href={externalUrl} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: 'center', padding: '8px 12px', background: '#341756', border: '1.5px solid #341756', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 620, textDecoration: 'none' }}>
            {externalCtaLabel ?? tile.link_label ?? 'Learn more'} →
          </a>
        ) : (
          tile.link_label && <span style={{ flex: 1, textAlign: 'center', padding: '8px 12px', background: '#341756', border: '1.5px solid #341756', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 620 }}>{tile.link_label} →</span>
        )}
        {secondaryCta && <span style={{ flex: 1, textAlign: 'center', padding: '8px 12px', background: 'transparent', border: '1.5px solid #341756', borderRadius: 7, color: '#341756', fontSize: 12, fontWeight: 620 }}>{secondaryCta}</span>}
      </div>
    </div>
  )
}

function shell(np: SitemapReviewNavPresentation): SitemapReviewNavPresentation['shell'] {
  return np.shell ?? (np.megamenu_panels && np.megamenu_panels.length > 0 ? 'megamenu' : np.standard_dropdowns ? 'standard_dropdowns' : np.offcanvas_overlay ? 'offcanvas' : undefined)
}

/** Fallback preview when nav_presentation is absent. Renders a
 *  minimal browser topnav from nav_layout.header so partners still
 *  see something recognizable when the strategist has not authored
 *  a full nav_presentation. */
function PrimaryNavFallback({ header, church }: { header: NavItem[]; church: string }) {
  return (
    <>
      <nav className="topnav">
        <div className="brand-mark"><span className="glyph">◆</span> {church}</div>
        <div className="items">
          {header.slice(0, 6).map((it, i) => (
            <span key={i} className={it.children && it.children.length > 0 ? 'mega' : ''}>
              {it.label}
              {it.children && it.children.length > 0 && <span className="caret">▾</span>}
            </span>
          ))}
        </div>
        <span className="spacer" />
        <span className="btn accent">Visit</span>
      </nav>
      {header.some(it => it.children && it.children.length > 0) && (
        <div className="mega-panel">
          {header.filter(it => it.children && it.children.length > 0).slice(0, 2).map((parent, pi) => (
            <div key={pi} style={{ marginBottom: pi === 0 ? 20 : 0 }}>
              <div className="mega-label">{parent.label}</div>
              <div className="mega-grid">
                {(parent.children ?? []).slice(0, 6).map((c, ci) => (
                  <div key={ci} className="mega-item">
                    <span className="ph sq">■</span>
                    <div><h4>{c.label}</h4></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

/** Split a body string around a chosen emphasis phrase so it renders
 *  in the serif-italic brand voice. Returns the original body when
 *  the phrase isn't present so callers don't have to guard. */
function renderWithEmPhrase(body: string, phrase: string | undefined) {
  if (!phrase || !body.includes(phrase)) return body
  const idx = body.indexOf(phrase)
  return (
    <>
      {body.slice(0, idx)}
      <em className="brand-em">{phrase}</em>
      {body.slice(idx + phrase.length)}
    </>
  )
}

function tagClassFor(tag: 'kept' | 'unified' | 'consolidated' | 'new'): string {
  switch (tag) {
    case 'kept':         return 't-keep'
    case 'unified':      return 't-uni'
    case 'consolidated': return 't-cons'
    case 'new':          return 't-new'
  }
}
function tagLabelFor(tag: 'kept' | 'unified' | 'consolidated' | 'new'): string {
  switch (tag) {
    case 'kept':         return 'have today'
    case 'unified':      return 'now shared'
    case 'consolidated': return 'combined'
    case 'new':          return 'new'
  }
}

interface PageGroup { id: string; label: string; meta?: string; pages: ReviewPage[]; childSlugs?: Set<string>; overrides?: Map<string, string> }

/** Group pages according to strategist-authored tiers. Each tier's
 *  `page_slugs` (or `page_entries`) lists which review pages go in
 *  which tier, in what order. Any pages the strategist didn't
 *  assign land in a final "Other pages" tier so nothing is silently
 *  dropped. */
function groupPagesByTiers(
  pages: ReviewPage[],
  tiers: NonNullable<SitemapReview['presentation']>['tiers'] & object,
): PageGroup[] {
  const bySlug = new Map(pages.map(p => [p.slug, p]))
  const assigned = new Set<string>()
  const groups: PageGroup[] = []

  for (const tier of tiers ?? []) {
    const orderedPages: ReviewPage[] = []
    const childSlugs = new Set<string>()
    const overrides = new Map<string, string>()

    if (tier.page_entries && tier.page_entries.length > 0) {
      for (const entry of tier.page_entries) {
        const p = bySlug.get(entry.slug)
        if (!p) continue
        assigned.add(entry.slug)
        orderedPages.push(p)
        if (entry.is_child) childSlugs.add(entry.slug)
        if (entry.description_override) overrides.set(entry.slug, entry.description_override)
      }
    } else {
      for (const slug of tier.page_slugs ?? []) {
        const p = bySlug.get(slug)
        if (!p) continue
        assigned.add(slug)
        orderedPages.push(p)
      }
    }

    groups.push({
      id:     `tier-${tier.id}`,
      label:  tier.letter ? `${tier.letter}. ${tier.title}` : tier.title,
      meta:   tier.meta,
      pages:  orderedPages,
      childSlugs,
      overrides,
    })
  }

  const unassigned = pages.filter(p => !assigned.has(p.slug))
  if (unassigned.length > 0) {
    groups.push({
      id:    'tier-other',
      label: 'Other pages',
      meta:  `${unassigned.length} unassigned`,
      pages: unassigned,
    })
  }
  return groups
}

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
