/**
 * Project id (strategy_web_projects.id) exposed to anything inside the
 * Pages workspace tree. Used by features that need to write project-
 * scoped rows (e.g. church_facts staff records via the staff link
 * toggle on Team Section 14) without prop-drilling through SlotEditor
 * / GroupEditor / etc.
 */
import { createContext, useContext } from 'react'

const Ctx = createContext<string | null>(null)

export function ProjectIdProvider({
  projectId, children,
}: {
  projectId: string
  children: React.ReactNode
}) {
  return <Ctx.Provider value={projectId}>{children}</Ctx.Provider>
}

export function useProjectId(): string | null {
  return useContext(Ctx)
}
