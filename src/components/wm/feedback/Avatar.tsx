/**
 * Gradient initials avatar — deterministic color per name.
 *
 * The feedback UI shows many small avatars in card stacks; we don't
 * have profile photos for partner authors, so a memorable color +
 * initials carries identity. Hashing the name into one of seven
 * gradients keeps the palette tight and consistent across the app —
 * "Bennett Rhodes" always renders with the same fill.
 */
import type { CSSProperties } from 'react'

const GRADIENTS: ReadonlyArray<{ from: string; to: string }> = [
  { from: '#FF6B6B', to: '#EE5A6F' },
  { from: '#4FACFE', to: '#00F2FE' },
  { from: '#43E97B', to: '#38F9D7' },
  { from: '#FA709A', to: '#FEE140' },
  { from: '#A18CD1', to: '#FBC2EB' },
  { from: '#FF9A9E', to: '#FAD0C4' },
  { from: '#667EEA', to: '#764BA2' },
]

const SIZE_PX: Record<AvatarSize, number> = { sm: 18, md: 22, lg: 28 }
const FONT_PX: Record<AvatarSize, number> = { sm: 9,  md: 10, lg: 12 }

export type AvatarSize = 'sm' | 'md' | 'lg'

export interface AvatarProps {
  /** Display name. Initials + gradient hash come from this. */
  name: string | null | undefined
  size?: AvatarSize
  /** Optional title override; otherwise the full name is used. */
  title?: string
  className?: string
}

export function Avatar({ name, size = 'md', title, className }: AvatarProps) {
  const safeName = (name ?? '').trim()
  const initials = computeInitials(safeName)
  const gradient = GRADIENTS[hashName(safeName) % GRADIENTS.length]
  const px = SIZE_PX[size]
  const style: CSSProperties = {
    width:  px,
    height: px,
    fontSize: FONT_PX[size],
    background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})`,
  }
  return (
    <span
      title={title ?? (safeName || undefined)}
      className={[
        'inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0 select-none',
        className ?? '',
      ].join(' ')}
      style={style}
    >
      {initials}
    </span>
  )
}

/** Compute up to 2 initials from a display name. Single-name partners
 *  ("Pastor") fall back to a single letter. Empty names render "?". */
function computeInitials(name: string): string {
  if (!name) return '?'
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/** Cheap deterministic hash — same gradient for the same name. */
function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0
  return Math.abs(h)
}
