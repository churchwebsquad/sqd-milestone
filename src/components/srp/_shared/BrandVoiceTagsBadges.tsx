/**
 * Render the brand voice tags returned by every generate-* endpoint
 * as small color-coded badges.
 *
 * Tags arrive as labeled strings, e.g. "Guidelines: warm, real, and a
 * little bit funny" or "Speaks as: friend & teacher". The badge color
 * is derived from the prefix so the coach can scan at a glance which
 * source shaped the output.
 */

import type { ReactNode } from 'react'

const TAG_TONES: Array<{ prefix: string; cls: string; icon?: ReactNode }> = [
  { prefix: 'Guidelines:', cls: 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)]' },
  { prefix: 'Speaks as:',  cls: 'bg-[#FFF1D6] text-[#7A5A0F]' },
  { prefix: 'Bible:',      cls: 'bg-[#D6F0E6] text-[#0F5132]' },
  { prefix: 'Notes:',      cls: 'bg-[#FCE9E9] text-[#7A1F1F]' },
]
const DEFAULT_TONE = 'bg-[var(--color-lavender-tint)] text-[var(--color-purple-gray)]'

export function BrandVoiceTagsBadges({ tags }: { tags?: string[] | null }) {
  if (!tags || tags.length === 0) return null
  return (
    <ul className="flex items-center flex-wrap gap-1.5">
      {tags.map((tag, i) => {
        const tone = TAG_TONES.find(t => tag.startsWith(t.prefix))?.cls ?? DEFAULT_TONE
        return (
          <li
            key={i}
            className={[
              'text-[10px] font-medium rounded-full px-2 py-0.5 inline-flex items-center gap-1',
              tone,
            ].join(' ')}
          >
            {tag}
          </li>
        )
      })}
    </ul>
  )
}
