import { useState, useEffect, useRef } from 'react'
import { Check, AlertCircle, Search, X, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { StepProps, SelectedContact, ContactRow } from './types'
import StepNav from './StepNav'

type LookupState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; clickupId: number; username: string | null }
  | { status: 'not_found' }

/** Format display name for a contact row (stripping leading @ if present). */
function contactDisplayName(c: ContactRow): string {
  const username = c.username?.replace(/^@/, '')
  return username ? `@${username}` : (c.email ?? `ID ${c.clickup_id}`)
}

/** Comma + "and" join for partner contact names in the rendered message body. */
function joinContactNames(contacts: SelectedContact[]): string {
  const names = contacts.map(c => c.name).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export default function Step6Contact({ formData, updateForm, onNext, onBack }: StepProps) {
  // Custom entry form state
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customEmail, setCustomEmail] = useState('')
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selected = formData.partnerContacts

  // Update derived fields (partnerContactName joined, partnerContactClickupId = first id)
  const syncDerived = (next: SelectedContact[]) => {
    updateForm({
      partnerContacts: next,
      partnerContactName: joinContactNames(next),
      partnerContactClickupId: next.find(c => c.clickupId)?.clickupId ?? null,
    })
  }

  const toggleContact = (c: ContactRow) => {
    const existing = selected.findIndex(s => s.clickupId === c.clickup_id)
    const next = existing >= 0
      ? selected.filter((_, i) => i !== existing)
      : [...selected, { name: contactDisplayName(c), clickupId: c.clickup_id }]
    syncDerived(next)
  }

  const removeAt = (i: number) => {
    syncDerived(selected.filter((_, idx) => idx !== i))
  }

  // Cross-workspace email lookup for custom contacts
  useEffect(() => {
    if (!customMode) return
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = customEmail.trim()
    if (!trimmed || !trimmed.includes('@')) {
      setLookup({ status: 'idle' })
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLookup({ status: 'searching' })
      const { data } = await supabase
        .from('clickup_users')
        .select('clickup_id, username, email')
        .ilike('email', trimmed)
        .limit(1)
        .maybeSingle()

      if (data && typeof (data as { clickup_id?: number }).clickup_id === 'number') {
        const row = data as { clickup_id: number; username: string | null }
        setLookup({ status: 'found', clickupId: row.clickup_id, username: row.username })
      } else {
        setLookup({ status: 'not_found' })
      }
    }, 400)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [customEmail, customMode])

  const addCustomContact = () => {
    if (!customName.trim()) return
    let name = customName.trim()
    let clickupId: number | null = null

    if (lookup.status === 'found') {
      clickupId = lookup.clickupId
      const username = lookup.username?.replace(/^@/, '')
      if (username) name = `@${username}`
    }

    syncDerived([...selected, { name, clickupId }])
    setCustomName('')
    setCustomEmail('')
    setLookup({ status: 'idle' })
    setCustomMode(false)
  }

  const availableContacts = formData.contacts.filter(
    c => !selected.some(s => s.clickupId === c.clickup_id)
  )

  const canContinue = selected.length > 0

  return (
    <div className="bg-white border border-lavender rounded-2xl p-6 md:p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-deep-plum">Step 4 — Select Partner Contact(s)</h2>
      <p className="text-sm text-purple-gray mt-0.5 mb-6">
        Pick one or more contacts to tag in the message. They'll replace{' '}
        <code className="text-xs bg-lavender-tint text-primary-purple px-1 py-0.5 rounded">
          {'{{partner_contact_name}}'}
        </code>{' '}
        when the message is drafted.
      </p>

      {/* Selected contacts as chips */}
      {selected.length > 0 && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-2">
            Selected ({selected.length})
          </label>
          <div className="flex flex-wrap gap-2">
            {selected.map((c, i) => (
              <span
                key={`${c.clickupId ?? 'custom'}-${i}`}
                className={`inline-flex items-center gap-1.5 rounded-full border text-sm px-3 py-1 ${
                  c.clickupId
                    ? 'border-primary-purple/30 bg-primary-purple/10 text-primary-purple'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                {c.clickupId ? <Check size={12} /> : <AlertCircle size={12} />}
                {c.name}
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="hover:bg-black/10 rounded-full p-0.5 transition-colors"
                  aria-label="Remove"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Available contacts from clickup_users for this account */}
      {availableContacts.length > 0 && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-2">
            Available Contacts
          </label>
          <div className="flex flex-wrap gap-2">
            {availableContacts.map(c => (
              <button
                key={c.clickup_id}
                type="button"
                onClick={() => toggleContact(c)}
                className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-sm text-deep-plum px-3 py-1 hover:border-primary-purple hover:bg-lavender-tint transition-colors"
              >
                <Plus size={12} />
                {contactDisplayName(c)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No contacts banner */}
      {formData.contacts.length === 0 && selected.length === 0 && !customMode && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          No ClickUp contacts found for this account. Add one manually below.
        </p>
      )}

      {/* Add custom contact */}
      {!customMode ? (
        <button
          type="button"
          onClick={() => setCustomMode(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-lavender bg-white text-xs text-purple-gray px-3 py-1.5 hover:border-primary-purple hover:text-primary-purple hover:bg-lavender-tint/50 transition-colors"
        >
          <Plus size={12} /> Add custom contact
        </button>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-primary-purple/40 bg-lavender-tint/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-deep-plum uppercase tracking-wide">Add Custom Contact</p>
            <button
              type="button"
              onClick={() => { setCustomMode(false); setCustomName(''); setCustomEmail(''); setLookup({ status: 'idle' }) }}
              className="text-purple-gray hover:text-deep-plum transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-deep-plum mb-1">Contact name</label>
            <input
              type="text"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              placeholder="e.g. Pastor Mike"
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-deep-plum mb-1">
              Contact email <span className="text-purple-gray/60 font-normal">(optional — enables real @tag)</span>
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-gray/50" />
              <input
                type="email"
                value={customEmail}
                onChange={e => setCustomEmail(e.target.value)}
                placeholder="contact@church.com"
                className="w-full rounded-lg border border-lavender pl-8 pr-3 py-2 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
              />
            </div>
            {lookup.status === 'searching' && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-purple-gray">
                <span className="h-3 w-3 animate-spin rounded-full border border-lavender border-t-primary-purple" />
                Searching ClickUp users…
              </p>
            )}
            {lookup.status === 'found' && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-green-700">
                <Check size={12} />
                Matched <span className="font-semibold">{lookup.username?.replace(/^@/, '') ?? `ID ${lookup.clickupId}`}</span> — will be tagged
              </p>
            )}
            {lookup.status === 'not_found' && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700">
                <AlertCircle size={12} />
                No ClickUp user found — will send as plain text
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={addCustomContact}
            disabled={!customName.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-4 py-1.5 hover:bg-primary-purple transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={12} /> Add Contact
          </button>
        </div>
      )}

      {/* Preview */}
      {selected.length > 0 && (
        <div className="mt-5 rounded-xl bg-lavender-tint border border-lavender px-4 py-3">
          <p className="text-xs text-purple-gray mb-1">
            <span className="font-semibold">{'{{partner_contact_name}}'}</span> will render as:
          </p>
          <code className="text-sm font-semibold text-primary-purple bg-white px-2 py-1 rounded border border-lavender block truncate">
            {joinContactNames(selected)}
          </code>
        </div>
      )}

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!canContinue} />
    </div>
  )
}
