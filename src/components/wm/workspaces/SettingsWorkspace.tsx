/**
 * Web Manager — org-wide settings panel.
 *
 * Org-wide site-manager settings live here. First section: Crawl
 * settings — three toggles controlling which AM-handoff pathways
 * auto-fire a Firecrawl run, plus the redesign-discovery signal.
 *
 * Bound to the singleton `web_crawl_config` row (id=1). Updates are
 * immediate; the Postgres triggers read the live config row whenever
 * a signal lands.
 *
 * Rendered on `WebProjectsPage` (`/web`) since the toggles affect
 * every project, every church. Per-project tabs are intentionally
 * not the home for this UI.
 */
import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Globe } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

interface CrawlConfig {
  id:                number
  fire_on_redesign:  boolean
  fire_on_audit:     boolean
  fire_on_microsite: boolean
  max_pages:         number
  max_depth:         number
  exclude_paths:     string[]
  edge_fn_url:       string
  updated_at:        string
  updated_by:        string | null
}

export function SettingsWorkspace() {
  const [cfg, setCfg] = useState<CrawlConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('web_crawl_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (err) setError(err.message)
    setCfg(data as CrawlConfig | null)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const update = async (patch: Partial<CrawlConfig>) => {
    if (!cfg) return
    setSaving(true)
    setError(null)
    const optimistic = { ...cfg, ...patch }
    setCfg(optimistic)
    const { error: err } = await supabase
      .from('web_crawl_config')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (err) {
      setError(err.message)
      setCfg(cfg)   // revert on failure
    }
    setSaving(false)
  }

  if (loading || !cfg) {
    return (
      <div className="min-h-[200px] grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
          <p className="text-[12px] text-deep-plum">{error}</p>
        </div>
      )}

      <section className="rounded-xl border border-lavender bg-white">
        <header className="px-5 py-4 border-b border-lavender flex items-baseline gap-2">
          <Globe size={14} className="text-primary-purple" />
          <div>
            <h2 className="text-[14px] font-bold text-deep-plum">Crawl settings</h2>
            <p className="text-[12px] text-purple-gray mt-0.5">
              Auto-fire a Firecrawl run when any of these signals land
              on a church. One crawl per project — already-crawled
              projects are skipped automatically.
            </p>
          </div>
        </header>

        <div className="divide-y divide-lavender">
          <ToggleRow
            label="Fire on redesign"
            description={
              <>
                Fires when discovery answer is <em>Start Fresh</em> or
                {' '}<em>Make Significant Changes</em>, OR AM handoff
                {' '}<code className="font-mono text-[10px]">selectedPathways</code>
                {' '}contains <code className="font-mono text-[10px]">"redesign"</code>.
              </>
            }
            checked={cfg.fire_on_redesign}
            onChange={v => update({ fire_on_redesign: v })}
            disabled={saving}
          />
          <ToggleRow
            label="Fire on audit"
            description={
              <>
                Fires when AM handoff <code className="font-mono text-[10px]">selectedPathways</code>
                {' '}contains <code className="font-mono text-[10px]">"audit"</code>.
                {' '}Off by default — flip on when you start auditing
                websites you aren't redesigning.
              </>
            }
            checked={cfg.fire_on_audit}
            onChange={v => update({ fire_on_audit: v })}
            disabled={saving}
          />
          <ToggleRow
            label="Fire on microsite"
            description={
              <>
                Fires when AM handoff <code className="font-mono text-[10px]">selectedPathways</code>
                {' '}contains <code className="font-mono text-[10px]">"microsite"</code>.
                {' '}Off by default — microsites usually don't need a
                full crawl of the existing main site.
              </>
            }
            checked={cfg.fire_on_microsite}
            onChange={v => update({ fire_on_microsite: v })}
            disabled={saving}
          />
        </div>

        {/* Focus controls — keep the crawl off sermon archives, blog
            detail pages, WordPress taxonomy noise, etc. */}
        <div className="px-5 py-4 border-t border-lavender space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray mb-2">
              Focus the crawl
            </p>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Max pages"
                value={cfg.max_pages}
                min={5}
                max={500}
                onChange={v => update({ max_pages: v })}
                disabled={saving}
                hint="Per project. Detail pages get skipped via excludes below, so 25 covers the navigable structure on most church sites."
              />
              <NumberField
                label="Max depth"
                value={cfg.max_depth}
                min={1}
                max={5}
                onChange={v => update({ max_depth: v })}
                disabled={saving}
                hint="Levels deep from the homepage. 2 = home + nav children; 3 also catches third-level ministry pages."
              />
            </div>
          </div>
          <ExcludePathsField
            value={cfg.exclude_paths}
            onChange={v => update({ exclude_paths: v })}
            disabled={saving}
          />
        </div>

        <footer className="px-5 py-3 border-t border-lavender bg-lavender-tint/20 text-[10px] text-purple-gray flex items-baseline justify-between gap-3 flex-wrap">
          <span className="truncate">
            Edge fn:{' '}
            <code className="font-mono">{cfg.edge_fn_url}</code>
          </span>
          <span className="shrink-0">{cfg.exclude_paths.length} exclude patterns</span>
        </footer>
      </section>
    </div>
  )
}

function NumberField({
  label, value, min, max, onChange, disabled, hint,
}: {
  label:    string
  value:    number
  min:      number
  max:      number
  onChange: (v: number) => void
  disabled?: boolean
  hint?:    string
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-deep-plum mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => {
          const next = parseInt(e.target.value, 10)
          if (Number.isFinite(next) && next >= min && next <= max) onChange(next)
        }}
        disabled={disabled}
        className="w-full rounded-md border border-lavender bg-white px-3 py-1.5 text-[13px] text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/15 disabled:opacity-60"
      />
      {hint && <p className="text-[10px] text-purple-gray mt-1 leading-snug">{hint}</p>}
    </div>
  )
}

function ExcludePathsField({
  value, onChange, disabled,
}: {
  value:    string[]
  onChange: (v: string[]) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(value.join('\n'))
  // Sync local editor when the row reloads (e.g. another tab saved).
  useEffect(() => { setText(value.join('\n')) }, [value])

  const commit = () => {
    const next = text
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)
    if (JSON.stringify(next) !== JSON.stringify(value)) onChange(next)
  }
  return (
    <div>
      <label className="block text-[11px] font-semibold text-deep-plum mb-1">
        Exclude paths
        <span className="ml-2 font-normal text-purple-gray">(one regex per line, matched against URL path)</span>
      </label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        disabled={disabled}
        rows={8}
        spellCheck={false}
        className="w-full rounded-md border border-lavender bg-white px-3 py-2 text-[11px] font-mono text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/15 disabled:opacity-60"
      />
      <p className="text-[10px] text-purple-gray mt-1 leading-snug">
        Each line is a regex applied to the URL path (no domain). The
        defaults skip individual sermons, blog posts, events, WordPress
        admin paths, pagination, and media files. Changes save on
        blur (click outside the box).
      </p>
    </div>
  )
}

function ToggleRow({
  label, description, checked, onChange, disabled,
}: {
  label:       string
  description: React.ReactNode
  checked:     boolean
  onChange:    (v: boolean) => void
  disabled?:   boolean
}) {
  // Switch geometry mirrors AutoCrawlSwitch in CrawlWorkspace so all
  // toggles across the WM surface read at the same scale. Flex-based
  // thumb positioning (instead of absolute + translate) keeps the on/
  // off offsets symmetrical so the thumb sits centered in both states.
  return (
    <label className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-lavender-tint/30 transition-colors">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`shrink-0 relative inline-flex items-center h-6 w-11 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-purple focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
          checked ? 'bg-primary-purple' : 'bg-lavender'
        }`}
      >
        <span
          className={`inline-block w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-deep-plum">{label}</p>
        <p className="text-[11px] text-purple-gray mt-0.5 leading-snug">{description}</p>
      </div>
    </label>
  )
}

