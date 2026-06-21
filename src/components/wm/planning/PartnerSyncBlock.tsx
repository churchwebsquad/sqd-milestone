/**
 * Partner-sync block — copy-to-clipboard one-liner the AM pastes
 * into Slack/email/ClickUp before a partner call.
 */
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Props {
  text: string
}

export function PartnerSyncBlock({ text }: Props) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text">
          Partner-sync one-liner
        </p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className="inline-flex items-center gap-1 rounded-full border border-wm-border bg-wm-bg px-2.5 py-0.5 text-[10.5px] font-semibold text-wm-text-muted hover:text-wm-text hover:border-wm-accent transition-colors"
        >
          {copied ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-[12px] text-wm-text leading-snug">
        {text}
      </p>
      <p className="text-[10px] text-wm-text-subtle italic">
        Strategist-language version of the current step. Paste into Slack / email / a ClickUp comment.
      </p>
    </div>
  )
}
