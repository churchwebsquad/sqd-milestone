import { updateSession } from '../../../lib/srpSessions'
import type { SmsSrpGeneration } from '../../../types/database'
import { GeneratorShell } from './GeneratorShell'
import { useSrpGenerator } from './useSrpGenerator'

export function SundayInviteGenerator({ session, onChange }: {
  session: SmsSrpGeneration
  onChange: () => void
}) {
  const { busy, error, lastTook, call } = useSrpGenerator()

  return (
    <GeneratorShell
      title="Sunday invite"
      description="3 variants — warm, energetic, topical. Church name + service times go at the bottom as a sign-off."
      value={session.sunday_invite ?? ''}
      busy={busy}
      error={error}
      lastTook={lastTook}
      onGenerate={async () => {
        const result = await call<{ sunday_invite: string }>('generate-sunday-invite', {
          sessionId:   session.session_id,
          transcript:  session.transcript ?? '',
          sermonTitle: '',
          churchName:  session.church_name ?? '',
        })
        if (result) onChange()
      }}
      onSave={async next => {
        await updateSession(session.session_id, { sunday_invite: next })
        onChange()
      }}
    />
  )
}
