/**
 * Quick Links panel — shows the church's external assets that the
 * coach needs while running the SRP workflow. Pulls from the
 * SquadAccount's link columns; only renders tiles for links that exist.
 *
 * Rendered in the SrpWorkflowShell sidebar footer.
 */

// lucide-react v1.x dropped branded icons (Instagram / Facebook / Youtube) for
// trademark reasons. Use generic stroke icons; the label next to each tile is
// the actual identifier, the glyph is decorative.
import { ExternalLink, Camera, Users, MonitorPlay, Globe, FileText, Image, MessageSquare, Palette } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SquadAccount } from '../../types/database'

interface LinkTile {
  label: string
  href:  string
  icon:  LucideIcon
}

function ensureUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // Plain handle or domain → prepend https://
  if (trimmed.startsWith('@')) return `https://www.instagram.com/${trimmed.slice(1)}`
  return `https://${trimmed.replace(/^\/+/, '')}`
}

export function SrpQuickLinks({ account }: { account: SquadAccount | null }) {
  if (!account) return null

  const tiles: LinkTile[] = []
  const ig = ensureUrl(account.instagram_link ?? account.instagram)
  if (ig) tiles.push({ label: 'Instagram', href: ig, icon: Camera })
  const fb = ensureUrl(account.facebook_link ?? account.facebook)
  if (fb) tiles.push({ label: 'Facebook', href: fb, icon: Users })
  const yt = ensureUrl(account.youtube)
  if (yt) tiles.push({ label: 'YouTube', href: yt, icon: MonitorPlay })
  const site = ensureUrl(account.church_website)
  if (site) tiles.push({ label: 'Website', href: site, icon: Globe })
  const brief = ensureUrl(account.strategy_brief)
  if (brief) tiles.push({ label: 'Strategy brief', href: brief, icon: FileText })
  const photos = ensureUrl(account.photos_link ?? account.photos_from_all_in_discovery_form)
  if (photos) tiles.push({ label: 'Photos', href: photos, icon: Image })
  const gpt = ensureUrl(account.custom_gpt)
  if (gpt) tiles.push({ label: 'Custom GPT', href: gpt, icon: MessageSquare })
  const brand = ensureUrl(account.brand_guide_url)
  if (brand) tiles.push({ label: 'Brand guide', href: brand, icon: Palette })

  if (tiles.length === 0) return null

  return (
    <section className="rounded-lg border border-[var(--color-lavender)] bg-white p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] px-1">
        Quick links
      </p>
      <ul className="grid grid-cols-2 gap-1.5">
        {tiles.map(t => {
          const Icon = t.icon
          return (
            <li key={t.label}>
              <a
                href={t.href}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 bg-[var(--color-lavender-tint)] text-[11px] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender)] transition-colors"
              >
                <Icon size={11} className="shrink-0 text-[var(--color-primary-purple)]" />
                <span className="truncate font-medium">{t.label}</span>
                <ExternalLink size={9} className="ml-auto shrink-0 opacity-50 group-hover:opacity-100" />
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
