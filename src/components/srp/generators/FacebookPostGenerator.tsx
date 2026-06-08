import { updateSession } from '../../../lib/srpSessions'
import type { SmsSrpGeneration } from '../../../types/database'
import { GeneratorShell } from './GeneratorShell'
import { useSrpGenerator } from './useSrpGenerator'

export function FacebookPostGenerator({ session, onChange }: {
  session: SmsSrpGeneration
  onChange: () => void
}) {
  const { busy, error, lastTook, call } = useSrpGenerator()

  return (
    <GeneratorShell
      title="Facebook post"
      description="Long-form text post with paragraph breaks at natural beats. Hook → body → CTA."
      value={session.facebook_post ?? ''}
      busy={busy}
      error={error}
      lastTook={lastTook}
      onGenerate={async () => {
        const result = await call<{ facebook_post: string }>('generate-facebook-post', {
          sessionId:  session.session_id,
          transcript: session.transcript ?? '',
          sermonTitle: '',
          churchName: session.church_name ?? '',
        })
        if (result) onChange()
      }}
      onSave={async next => {
        await updateSession(session.session_id, { facebook_post: next })
        onChange()
      }}
    />
  )
}
