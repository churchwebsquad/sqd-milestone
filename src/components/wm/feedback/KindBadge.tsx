/**
 * Small Internal / Partner tag for the card tags row. Mounts at the
 * top of every FeedbackCard so the reader knows at a glance whether
 * the comment came from staff or from the partner portal.
 */
import { WMStatusPill, type WMStatusTone } from '../StatusPill'

const TONES: Record<'internal' | 'partner', WMStatusTone> = {
  internal: 'blue',
  partner:  'pink',
}

const LABELS: Record<'internal' | 'partner', string> = {
  internal: 'Internal',
  partner:  'Partner',
}

export function KindBadge({ kind }: { kind: 'internal' | 'partner' }) {
  return (
    <WMStatusPill tone={TONES[kind]} size="sm">
      {LABELS[kind]}
    </WMStatusPill>
  )
}
