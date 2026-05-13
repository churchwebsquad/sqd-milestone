import { Code2 } from 'lucide-react'
import { WebToolStub } from './WebToolStub'

export default function WebDevManagerPage() {
  return (
    <WebToolStub
      toolKey="dev"
      toolLabel="Dev Manager"
      icon={Code2}
      purpose="Generates the WordPress / Bricks-ready import package once Design Manager is signed off — no more re-keying the design into the dev environment."
      shipsIn="Phase 4"
      groups={[
        {
          title: 'Outputs',
          items: [
            'ACF field group JSON auto-generated from each Brixies content template\'s field schema.',
            'Church Settings options page schema, derived from the partner\'s snippet bank — every snippet becomes a single-source ACF field for post-launch edits.',
            'Bricks / Novamira import package wired against ACF dynamic data.',
            'Page-level content manifest the WP MCP can ingest.',
          ],
        },
        {
          title: 'Inputs',
          items: [
            'Approved Content Manager pages (provides the page sequence + field values).',
            'Design Manager handoff (provides the visual contract — token usage + polish moments).',
          ],
        },
        {
          title: 'Reviews flow',
          items: [
            'Dev review uses Markup links, same as Design.',
            'Pre-launch QA + ACSS / ACF export gates here.',
          ],
        },
      ]}
    />
  )
}
