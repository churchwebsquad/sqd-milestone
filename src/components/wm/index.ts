/**
 * Web Manager primitives — barrel export.
 *
 * All components share the `wm-` design tokens defined in src/index.css
 * (--color-wm-* prefix). They expect to be rendered inside a `wm-theme`
 * scoped surface (the WebManagerShell mounts this class automatically).
 */

export { WMButton } from './Button'
export type { WMButtonProps } from './Button'

export { WMIconButton } from './IconButton'
export type { WMIconButtonProps } from './IconButton'

export { WMCard } from './Card'
export type { WMCardProps } from './Card'

export { WMStatusPill } from './StatusPill'
export type { WMStatusPillProps, WMStatusTone } from './StatusPill'

export { WMTabs } from './Tabs'
export type { WMTabsProps, WMTabItem } from './Tabs'

export { WMSegmentedToggle } from './SegmentedToggle'
export type { WMSegmentedToggleProps, WMSegmentedOption } from './SegmentedToggle'

export { WMFlyoutPanel } from './FlyoutPanel'
export type { WMFlyoutPanelProps } from './FlyoutPanel'

export { WMAIAttribution } from './AIAttribution'
export type { WMAIAttributionProps } from './AIAttribution'

export { WMAIStatusBadge } from './AIStatusBadge'
export type { WMAIStatusBadgeProps, WMAIState } from './AIStatusBadge'

export { WebManagerShell } from './WebManagerShell'
export type { WMShellProps } from './WebManagerShell'

export { WMCatalogSidePanel } from './CatalogSidePanel'
export type { WMCatalogSidePanelProps } from './CatalogSidePanel'

export { WMRichTextEditor } from './RichTextEditor'
export type { WMRichTextEditorProps, WMSnippetOption } from './RichTextEditor'

export { SnippetNode } from './SnippetNode'
