import { Palette } from 'lucide-react'
import { WebToolStub } from './WebToolStub'

export default function WebDesignManagerPage() {
  return (
    <WebToolStub
      toolKey="design"
      toolLabel="Design Manager"
      icon={Palette}
      purpose="Hands the designer everything they need to apply the brand to the approved Brixies sections — and produces the build list for the style guide."
      shipsIn="Phase 4"
      groups={[
        {
          title: 'What it shows',
          items: [
            'Design system surface — typography, color, spacing, motion tokens — read from the partner\'s brand profile.',
            'Unique Brixies section roll-up: the deduped list of section types this project uses, derived from the approved Content Manager pages.',
            'Style-guide build instructions per section: which tokens apply, which fields surface, polish-moment notes.',
          ],
        },
        {
          title: 'Outputs',
          items: [
            'Design Handoff JSON — the contract the (now-generic) Frankenstein Figma plugin consumes to produce the branded composition.',
            'Designer-facing build doc — printable / shareable.',
          ],
        },
        {
          title: 'Reviews flow',
          items: [
            'Design review uses Markup links (not the in-app Review Console).',
            'Markup link is captured here and surfaced on the project hub tile.',
          ],
        },
      ]}
    />
  )
}
