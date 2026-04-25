import { Link } from 'react-router-dom'
import type { Initiative } from '../../types/strategy'
import { departmentColor } from './StrategyUI'

/** Chip placed into a Roadmap cell (dept row × quarter column). Colored by
 *  the initiative's department, slightly tinted based on priority so high
 *  priority reads louder in the grid. */
export function RoadmapChip({ initiative }: { initiative: Initiative }) {
  const color = departmentColor(initiative.department)
  const tint = initiative.priority === 'high' ? '1' : initiative.priority === 'medium' ? '0.75' : '0.55'
  return (
    <Link
      to={`/strategy/initiatives/${initiative.id}`}
      className="block rounded-md px-2 py-1.5 text-[11px] font-medium text-white leading-snug truncate hover:opacity-90 transition-opacity"
      style={{ backgroundColor: color, opacity: Number(tint) }}
      title={initiative.name}
    >
      {initiative.name}
    </Link>
  )
}
