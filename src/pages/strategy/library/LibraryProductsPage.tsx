import { useMemo, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import {
  Compass, Globe, Palette, Megaphone, Box, type LucideIcon,
} from 'lucide-react'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, LibraryDrilldownHeader, DocTypeIcon, UnreadDot, VerifBadge,
} from '../../../components/library/LibraryShell'
import { StrategyEmptyCard, StrategyLoadingCard } from '../../../components/strategy/StrategyUI'
import type { Department, DocHubEntry } from '../../../types/strategy'

const DEPT_ORDER: Department[] = ['all-in', 'branding', 'web', 'social']
const DEPT_LABEL: Record<Department, string> = {
  'all-in': 'All In', branding: 'Brand', web: 'Web', social: 'Social',
}
/** Department-specific icons so each folder card has its own visual
 *  identity (instead of every card showing the same generic Box). */
const DEPT_ICON: Record<Department, LucideIcon> = {
  'all-in':  Compass,    // strategic / cross-cutting
  web:       Globe,
  branding:  Palette,
  social:    Megaphone,
}
/** Soft + ink color pairs for each dept's folder icon. Pulls from the
 *  app's existing dept palette so the visual stays in family. */
const DEPT_COLORS: Record<Department, { bg: string; fg: string }> = {
  'all-in':  { bg: 'var(--color-dept-allin-soft)',    fg: 'var(--color-dept-allin)' },
  branding:  { bg: 'var(--color-dept-branding-soft)', fg: 'var(--color-dept-branding)' },
  web:       { bg: 'var(--color-dept-web-soft)',      fg: 'var(--color-dept-web)' },
  social:    { bg: 'var(--color-dept-social-soft)',   fg: 'var(--color-dept-social)' },
}

const PRODUCT_TYPE_TAGS = ['Primary Product Offering', 'Product Milestone']

/** Library → Product Overviews. Renders each Strategy department as a
 *  folder card with its product-overview docs nested inside. Visible to
 *  everyone, independent of the viewer's own department — these are the
 *  "what we sell" docs and reading across departments is the point. */
export default function LibraryProductsPage() {
  const { loading, docs } = useLibraryData()

  const productDocs = useMemo(
    () => docs.filter(d => d.types.some(t => PRODUCT_TYPE_TAGS.includes(t))),
    [docs],
  )

  const grouped = useMemo(() => {
    const map = new Map<Department | 'unassigned', DocHubEntry[]>()
    for (const d of productDocs) {
      const key = d.department ?? 'unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(d)
    }
    // Preserve canonical dept order; trail with unassigned.
    const out: Array<{ dept: Department | 'unassigned'; docs: DocHubEntry[] }> = []
    for (const dept of DEPT_ORDER) {
      const list = map.get(dept)
      if (list?.length) out.push({ dept, docs: list.slice().sort(byTitle) })
    }
    if (map.has('unassigned')) out.push({ dept: 'unassigned', docs: map.get('unassigned')!.slice().sort(byTitle) })
    return out
  }, [productDocs])

  return (
    <>
      <LibraryNavBar
        crumbs={[
          { label: 'Library', to: '/strategy/library' },
          { label: 'Product Overviews' },
        ]}
      />
      <LibraryDrilldownHeader title="Product Overviews" />
      <p className="text-sm text-[var(--color-lib-text-muted)] mb-5">
        Documentation of every Strategy Division offering, organized by department.
        Visible to everyone — read across squads to see how we work end-to-end.
      </p>

      {loading && productDocs.length === 0 && <StrategyLoadingCard label="Loading product overviews…" />}

      {!loading && productDocs.length === 0 && (
        <StrategyEmptyCard>
          No product overviews yet. Tag a Doc Hub doc with{' '}
          <code className="bg-white px-1 rounded">Type = Primary Product Offering</code> to populate this page.
        </StrategyEmptyCard>
      )}

      {grouped.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {grouped.map(g => (
            <DeptFolder
              key={g.dept}
              dept={g.dept}
              docs={g.docs}
            />
          ))}
        </div>
      )}
    </>
  )
}

function DeptFolder({ dept, docs }: {
  dept: Department | 'unassigned'
  docs: DocHubEntry[]
}) {
  const label = dept === 'unassigned' ? 'Other' : DEPT_LABEL[dept]
  const colors = dept === 'unassigned'
    ? { bg: 'var(--color-lib-bg)', fg: 'var(--color-lib-text-muted)' }
    : DEPT_COLORS[dept]
  const Icon: ComponentType<{ size?: number }> = dept === 'unassigned'
    ? Box
    : DEPT_ICON[dept]

  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-5">
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-12 h-12 rounded-lg grid place-items-center shrink-0"
          style={{ backgroundColor: colors.bg, color: colors.fg }}
        >
          <Icon size={22} />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold tracking-tight text-[var(--color-lib-text)]">
            {label}
          </h2>
          <p className="text-[11px] text-[var(--color-lib-text-muted)] mt-0.5">
            {docs.length} product overview{docs.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {docs.map(d => <ProductDocRow key={d.id} doc={d} />)}
      </div>
    </div>
  )
}

function ProductDocRow({ doc }: { doc: DocHubEntry }) {
  const { myReads } = useLibraryData()
  const unread = !myReads.has(doc.id)
  return (
    <Link
      to={`/strategy/library/doc/${doc.id}`}
      className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-transparent hover:border-[var(--color-lib-border)] hover:bg-[var(--color-lib-bg)] transition-colors"
    >
      <DocTypeIcon type={doc.types[0]} size={14} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--color-lib-text)] truncate flex items-center gap-2">
          {doc.title}
          {unread && <UnreadDot />}
        </div>
        {doc.lastEditedTime && (
          <div className="text-[11px] text-[var(--color-lib-text-subtle)]">
            Updated {formatShort(doc.lastEditedTime)}
          </div>
        )}
      </div>
      <VerifBadge status={doc.verificationStatus} />
    </Link>
  )
}

function byTitle(a: DocHubEntry, b: DocHubEntry): number {
  return a.title.localeCompare(b.title)
}
function formatShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
