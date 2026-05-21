/**
 * Lightweight context that surfaces the project's pages (id + name +
 * slug) to anything inside the Pages / Review workspace tree.
 *
 * Used by the CTA slot editor to render a slug dropdown when a CTA's
 * `kind` is `internal_route`. Avoids prop-drilling through every
 * nesting layer between the workspace and the per-field input.
 */
import { createContext, useContext } from 'react'

export interface ProjectPage {
  id:   string
  name: string
  slug: string
}

const Ctx = createContext<ReadonlyArray<ProjectPage>>([])

export function ProjectPagesProvider({
  pages, children,
}: {
  pages: ReadonlyArray<ProjectPage>
  children: React.ReactNode
}) {
  return <Ctx.Provider value={pages}>{children}</Ctx.Provider>
}

export function useProjectPages(): ReadonlyArray<ProjectPage> {
  return useContext(Ctx)
}
