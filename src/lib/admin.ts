/**
 * Admin allowlists for tools that need tighter gating than the broad
 * AuthContext.isAdmin (which is true for any verified staff).
 *
 * isPromptAdmin gates the SRP Prompt Settings editor — the prompts
 * drive every text generator the Social Media Squad ships, so editing
 * is restricted to the two staff who own that work.
 */

const PROMPT_ADMIN_EMAILS = new Set<string>([
  'ashley@churchmediasquad.com',
  'amber@churchmediasquad.com',
])

export function isPromptAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  return PROMPT_ADMIN_EMAILS.has(email.toLowerCase().trim())
}
