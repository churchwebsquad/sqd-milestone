/**
 * Per-card status pill: "Open" (orange) vs "Completed" (green).
 * Mirrors the comment.status enum — `open` becomes Open; anything
 * else (applied / amended / dismissed) becomes Completed.
 */
import { WMStatusPill } from '../StatusPill'
import type { WebReviewCommentStatus } from '../../../types/database'

export function FeedbackStatusPill({ status }: { status: WebReviewCommentStatus }) {
  if (status === 'open') {
    return <WMStatusPill tone="orange" size="sm">Open</WMStatusPill>
  }
  return <WMStatusPill tone="green" size="sm">Completed</WMStatusPill>
}
