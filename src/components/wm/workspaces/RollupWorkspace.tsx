import { Layers } from 'lucide-react'
import { WorkspacePlaceholder } from './Placeholder'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

export function RollupWorkspace(_props: Props) {
  return (
    <WorkspacePlaceholder
      title="Rollup"
      subtitle="Everything we know about this church"
      icon={<Layers size={13} />}
      shipsOn="Day 5"
      whatThisWillBe={[
        "AI-extracted summary of intake content: service times, ministries (with details + leaders), staff list, events, mission/vision/values, beliefs, giving, social URLs.",
        "Editable — strategist corrects/amends. Updates feed AI when generating page content.",
        "Per-field source attribution: from intake / strategist-corrected / AI-generated-from-other-sources.",
        "Pulls from strategy_discovery_questionnaire + strategy_brand_guides + uploaded strategy brief + uploaded content collection.",
      ]}
    />
  )
}
