import { useState } from 'react'
import type { StepProps } from './types'
import StepNav from './StepNav'

export default function Step6Contact({ formData, updateForm, onNext, onBack }: StepProps) {
  const [useCustom, setUseCustom] = useState(
    formData.partnerContactName !== '' && formData.partnerContactClickupId === null
  )

  const handleSelectContact = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val === '__custom__') {
      setUseCustom(true)
      updateForm({ partnerContactName: '', partnerContactClickupId: null })
    } else if (val === '') {
      setUseCustom(false)
      updateForm({ partnerContactName: '', partnerContactClickupId: null })
    } else {
      const contact = formData.contacts.find(c => String(c.clickup_id) === val)
      if (contact) {
        setUseCustom(false)
        // ClickUp chat API resolves @username strings into live mentions.
        // Usernames in the DB may already carry a leading @, strip then re-add
        // to avoid doubling up.
        const username = contact.username?.replace(/^@/, '')
        const mention = username ? `@${username}` : (contact.email ?? '')
        updateForm({
          partnerContactName: mention,
          partnerContactClickupId: contact.clickup_id,
        })
      }
    }
  }

  const selectedValue = useCustom
    ? '__custom__'
    : formData.partnerContactClickupId
    ? String(formData.partnerContactClickupId)
    : ''

  const canContinue = formData.partnerContactName.trim() !== ''

  return (
    <div className="bg-white border border-lavender rounded-2xl p-6 md:p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-deep-plum">Step 4 — Select Partner Contact</h2>
      <p className="text-sm text-purple-gray mt-0.5 mb-6">
        Choose the contact to tag in the message. Their ClickUp mention will replace{' '}
        <code className="text-xs bg-lavender-tint text-primary-purple px-1 py-0.5 rounded">
          {'{{partner_contact_name}}'}
        </code>{' '}
        when the message is drafted.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-deep-plum mb-1.5">Contact</label>
          {formData.contacts.length > 0 ? (
            <select
              value={selectedValue}
              onChange={handleSelectContact}
              className="w-full rounded-lg border border-lavender px-3 py-2.5 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            >
              <option value="">— Select a contact —</option>
              {formData.contacts.map(c => (
                <option key={c.clickup_id} value={String(c.clickup_id)}>
                  {c.username?.replace(/^@/, '') ?? c.email ?? `ID: ${c.clickup_id}`}
                </option>
              ))}
              <option value="__custom__">Other — type a name…</option>
            </select>
          ) : (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No ClickUp contacts found for this account. Enter a name below.
            </p>
          )}
        </div>

        {(useCustom || formData.contacts.length === 0) && (
          <div>
            <label className="block text-sm font-medium text-deep-plum mb-1.5">Contact name</label>
            <input
              type="text"
              value={formData.partnerContactName}
              onChange={e => updateForm({ partnerContactName: e.target.value })}
              placeholder="e.g. Pastor Mike"
              className="w-full rounded-lg border border-lavender px-3 py-2.5 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            />
          </div>
        )}

        {formData.partnerContactName && (
          <div className="rounded-xl bg-lavender-tint border border-lavender px-4 py-3 space-y-1">
            {formData.partnerContactClickupId && (
              <p className="text-xs text-purple-gray">
                Contact:{' '}
                <span className="font-medium text-deep-plum">
                  {formData.contacts.find(c => c.clickup_id === formData.partnerContactClickupId)?.username?.replace(/^@/, '')
                    ?? formData.contacts.find(c => c.clickup_id === formData.partnerContactClickupId)?.email
                    ?? `ID ${formData.partnerContactClickupId}`}
                </span>
              </p>
            )}
            <p className="text-xs text-purple-gray">
              Will appear as:{' '}
              <code className="font-semibold text-primary-purple text-xs bg-white px-1.5 py-0.5 rounded border border-lavender">
                {formData.partnerContactName}
              </code>
            </p>
          </div>
        )}
      </div>

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!canContinue} />
    </div>
  )
}
