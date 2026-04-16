import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { StepProps, PartnerRow, ContactRow } from './types'
import StepNav from './StepNav'

export default function Step1Partner({ formData, updateForm, onNext }: StepProps) {
  const [memberInput, setMemberInput] = useState(formData.memberNumber || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [channelFoundInDb, setChannelFoundInDb] = useState(false)
  const [manualChannelId, setManualChannelId] = useState(formData.channelId ?? '')

  const handleLookup = async () => {
    const trimmed = memberInput.trim()
    if (!trimmed) { setError('Enter a member number.'); return }
    const memberNum = Number(trimmed)
    if (isNaN(memberNum)) { setError('Member number must be numeric.'); return }

    setLoading(true)
    setError('')
    setManualChannelId('')
    setChannelFoundInDb(false)

    try {
      const [partnerRes, channelRes, contactsRes] = await Promise.all([
        supabase
          .from('strategy_account_progress')
          .select('member, church_name, first_name_of_primary, css_rep, portal_token')
          .eq('member', memberNum)
          .maybeSingle(),
        supabase
          .from('clickup_chat_channels')
          .select('id')
          .eq('memberid', String(memberNum))
          .maybeSingle(),
        supabase
          .from('clickup_users')
          .select('clickup_id, email, username')
          .eq('account_id', memberNum)
          .is('employee', null),
      ])

      if (!partnerRes.data) {
        setError(`No partner found for member #${memberNum}.`)
        updateForm({ partner: null })
        return
      }

      const foundChannelId = (channelRes.data as { id: string } | null)?.id ?? null
      setChannelFoundInDb(!!foundChannelId)
      if (foundChannelId) setManualChannelId(foundChannelId)

      updateForm({
        memberNumber: trimmed,
        partner: partnerRes.data as unknown as PartnerRow,
        channelId: foundChannelId,
        contacts: ((contactsRes.data ?? []) as unknown as ContactRow[]),
        // Clear downstream state when partner changes
        selectedMilestone: null,
        messageBody: '',
        assets: [],
        partnerContactName: '',
        partnerContactClickupId: null,
      })
    } catch (err) {
      setError('Lookup failed. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleManualChannel = (value: string) => {
    setManualChannelId(value)
    updateForm({ channelId: value.trim() || null })
  }

  return (
    <div className="bg-white border border-lavender rounded-2xl p-6 md:p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-deep-plum">Step 1 — Identify the Partner</h2>
      <p className="text-sm text-purple-gray mt-0.5 mb-6">
        Enter the partner's member number to pull their account details.
      </p>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-deep-plum">Member Number</label>
        <div className="flex gap-3">
          <input
            type="number"
            value={memberInput}
            onChange={e => setMemberInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
            placeholder="e.g. 12345"
            className="flex-1 rounded-lg border border-lavender px-3 py-2.5 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 transition"
          />
          <button
            type="button"
            onClick={handleLookup}
            disabled={loading}
            className="rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2.5 hover:bg-primary-purple transition-colors disabled:opacity-60 shrink-0"
          >
            {loading ? 'Looking up…' : 'Look Up'}
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {formData.partner && (
        <div className="mt-5 space-y-3">
          <div className="rounded-xl bg-lavender-tint border border-lavender p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-deep-plum">
                  {formData.partner.church_name ?? '(No church name)'}
                </p>
                <p className="text-sm text-purple-gray mt-0.5">
                  Account Manager: <span className="font-medium text-deep-plum">{formData.partner.css_rep ?? 'Unknown'}</span>
                </p>
                <p className="text-sm text-purple-gray mt-0.5">
                  Primary Contact: <span className="font-medium text-deep-plum">{formData.partner.first_name_of_primary ?? 'Unknown'}</span>
                </p>
                {formData.contacts.length > 0 && (
                  <p className="text-xs text-purple-gray mt-2">
                    {formData.contacts.length} ClickUp contact{formData.contacts.length !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1">
                ✓ Found
              </span>
            </div>
          </div>

          <div className={`rounded-xl border p-4 ${channelFoundInDb ? 'border-lavender bg-lavender-tint/50' : 'border-amber-200 bg-amber-50'}`}>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${channelFoundInDb ? 'text-purple-gray' : 'text-amber-800'}`}>
              {channelFoundInDb ? 'ClickUp Channel ID' : 'No channel found — paste the ClickUp channel ID'}
            </label>
            <input
              type="text"
              value={manualChannelId}
              onChange={e => handleManualChannel(e.target.value)}
              placeholder="e.g. 9007219428123456"
              className={`w-full rounded-lg border px-3 py-2 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 transition ${channelFoundInDb ? 'border-lavender' : 'border-amber-300'}`}
            />
            {!channelFoundInDb && (
              <p className="text-xs text-amber-700 mt-1.5">
                You can proceed without one — the message won't send automatically.
              </p>
            )}
          </div>
        </div>
      )}

      <StepNav onNext={onNext} nextDisabled={!formData.partner} />
    </div>
  )
}
