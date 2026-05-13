import { Eye } from 'lucide-react'
import { WebToolStub } from './WebToolStub'

export default function WebReviewConsolePage() {
  return (
    <WebToolStub
      toolKey="reviews"
      toolLabel="Review Console"
      icon={Eye}
      purpose="Centralizes review state across the project. For now, only Content Manager ships through the in-app review flow; Design and Dev reviews live on Markup."
      shipsIn="Phase 4"
      groups={[
        {
          title: 'Content reviews (in-app)',
          items: [
            'Per-page client review packets, generated when the strategist clicks "Send for review" inside Content Manager.',
            'Comment threads + Google-Docs-style suggest-edit, scoped per section.',
            'Approve / Request Changes per section. Page-level approve rolls up automatically.',
            'Threaded back into the strategist\'s queue with status badges.',
          ],
        },
        {
          title: 'Design + Dev reviews (Markup links)',
          items: [
            'Design Manager + Dev Manager each capture their own Markup link.',
            'This page surfaces the latest link per tool and the most recent activity timestamp from Markup.',
          ],
        },
        {
          title: 'Status pill rule',
          items: [
            'Aggregate of "open content reviews" + "pending markup responses". Tile turns green when nothing is awaiting the partner.',
          ],
        },
      ]}
    />
  )
}
