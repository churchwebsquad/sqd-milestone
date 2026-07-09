/**
 * Pre-render edits step — title screens, outro logo, and caption text fixes.
 *
 * Runs after clip selection. Coach can:
 *   1. Per-clip: toggle a title screen (text or uploaded image) and an outro.
 *   2. Church-level: upload/update the animated outro logo (saved to clip_templates).
 *   3. Per-clip: edit the verbatim caption segments before the clip is cut.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Upload, Loader2, ImageIcon, Type, Info, CheckCircle, Music2, Play, Pause, VolumeX } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { srpPipeline } from '../../../lib/srpSessions'
import { supabase } from '../../../lib/supabase'
import { MUSIC_LIBRARY, MUSIC_GENRES, type MusicTrack } from '../../../lib/musicLibrary'
import type { SrpClipSelection } from '../../../types/database'

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ── Outro Logo Section ───────────────────────────────────────────────────────

function OutroLogoSection() {
  const { outroLogoUrl, setOutroLogoUrl, account } = useSrpWorkflow()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file) return
    if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
      setUploadError('Upload a video (.mp4, .webm, .mov) or image (.png, .gif) file.')
      return
    }
    setUploadError(null)
    setUploading(true)
    try {
      const ext = file.name.split('.').pop() ?? 'mp4'
      const path = `outro-logos/${account?.member ?? 'unknown'}/outro_logo.${ext}`
      const { error: upErr } = await supabase.storage
        .from('srp-assets')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage
        .from('srp-assets')
        .getPublicUrl(path)

      setOutroLogoUrl(publicUrl)

      // Persist to clip_templates so it reloads next session
      if (account?.member) {
        await srpPipeline
          .from('clip_templates')
          .upsert({ member: account.member, outro_logo_url: publicUrl }, { onConflict: 'member' })
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
      <div className="flex items-start gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-primary-purple)]">
          Church outro logo
        </span>
        <span className="mt-px text-[11px] text-[var(--color-purple-gray)]">— applied to all clips</span>
      </div>

      {outroLogoUrl ? (
        <div className="flex items-center gap-3">
          <div className="h-10 w-16 rounded-md border border-[var(--color-lavender)] overflow-hidden bg-[var(--color-lavender-tint)] grid place-items-center">
            {outroLogoUrl.match(/\.(mp4|webm|mov)$/i) ? (
              <video src={outroLogoUrl} className="h-full w-full object-cover" muted />
            ) : (
              <img src={outroLogoUrl} alt="Outro logo" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-[var(--color-deep-plum)] font-medium flex items-center gap-1">
              <CheckCircle size={13} className="text-emerald-500" /> Logo on file
            </p>
            <p className="text-[11px] text-[var(--color-purple-gray)] truncate">{outroLogoUrl.split('/').pop()}</p>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="text-[11px] text-[var(--color-primary-purple)] hover:underline whitespace-nowrap"
          >
            Replace
          </button>
        </div>
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] py-6 cursor-pointer hover:border-[var(--color-primary-purple)] transition-colors"
        >
          {uploading ? (
            <Loader2 size={18} className="animate-spin text-[var(--color-primary-purple)]" />
          ) : (
            <>
              <Upload size={18} className="text-[var(--color-primary-purple)]" />
              <p className="text-[12px] text-[var(--color-deep-plum)]">Upload animated logo</p>
              <p className="text-[11px] text-[var(--color-purple-gray)]">.mp4 · .webm · .mov · .gif · .png</p>
            </>
          )}
        </div>
      )}

      {uploadError && (
        <p className="text-[11px] text-red-600">{uploadError}</p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="video/*,image/gif,image/png"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
      />

      <p className="text-[11px] text-[var(--color-purple-gray)] flex gap-1.5 items-start">
        <Info size={12} className="mt-0.5 shrink-0" />
        Once uploaded, this logo reloads automatically for future sessions. The animator plays it at the end of each clip.
      </p>
    </div>
  )
}

// ── Song Picker ──────────────────────────────────────────────────────────────

interface SongPickerProps {
  selected: MusicTrack | null | undefined
  onSelect: (track: MusicTrack | null) => void
}

function SongPicker({ selected, onSelect }: SongPickerProps) {
  const [activeGenre, setActiveGenre] = useState<string>(MUSIC_GENRES[0])
  const [playingId, setPlayingId]     = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const tracksForGenre = MUSIC_LIBRARY.filter(t => t.genre === activeGenre)

  function togglePreview(track: MusicTrack) {
    if (playingId === track.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.pause()
    }
    const audio = new Audio(track.url)
    audio.volume = 0.4
    audio.play().catch(() => {/* browser may block autoplay */})
    audio.onended = () => setPlayingId(null)
    audioRef.current = audio
    setPlayingId(track.id)
  }

  function handleSelect(track: MusicTrack) {
    audioRef.current?.pause()
    setPlayingId(null)
    onSelect(track)
  }

  function handleNoMusic() {
    audioRef.current?.pause()
    setPlayingId(null)
    onSelect(null)
  }

  return (
    <div className="space-y-3">
      {/* Genre tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {MUSIC_GENRES.map(genre => (
          <button
            key={genre}
            type="button"
            onClick={() => setActiveGenre(genre)}
            className={[
              'px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors',
              activeGenre === genre
                ? 'bg-[var(--color-deep-plum)] text-white border-[var(--color-deep-plum)]'
                : 'border-[var(--color-lavender)] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] bg-white',
            ].join(' ')}
          >
            {genre}
          </button>
        ))}
      </div>

      {/* Song list */}
      <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
        {/* No music option */}
        <button
          type="button"
          onClick={handleNoMusic}
          className={[
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors',
            selected === null
              ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
              : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]',
          ].join(' ')}
        >
          <VolumeX size={13} className="shrink-0 text-[var(--color-purple-gray)]" />
          <span className="text-[12px] font-medium text-[var(--color-deep-plum)]">No music</span>
          {selected === null && (
            <CheckCircle size={13} className="ml-auto text-[var(--color-primary-purple)] shrink-0" />
          )}
        </button>

        {tracksForGenre.map(track => {
          const isSelected = selected?.id === track.id
          const isPlaying  = playingId === track.id
          return (
            <div
              key={track.id}
              className={[
                'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                isSelected
                  ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                  : 'border-[var(--color-lavender)] bg-white hover:bg-[var(--color-lavender-tint)]',
              ].join(' ')}
            >
              {/* Preview button */}
              <button
                type="button"
                onClick={() => togglePreview(track)}
                className="shrink-0 w-7 h-7 rounded-full bg-[var(--color-lavender-tint)] border border-[var(--color-lavender)] flex items-center justify-center hover:bg-[var(--color-primary-purple)] hover:text-white hover:border-[var(--color-primary-purple)] transition-colors"
                title={isPlaying ? 'Pause preview' : 'Preview track'}
              >
                {isPlaying
                  ? <Pause size={10} className="fill-current" />
                  : <Play  size={10} className="fill-current" />
                }
              </button>

              {/* Track name */}
              <button
                type="button"
                onClick={() => handleSelect(track)}
                className="flex-1 text-left min-w-0"
              >
                <p className="text-[12px] font-medium text-[var(--color-deep-plum)] truncate">{track.name}</p>
                {track.artist && track.artist !== 'TBD' && (
                  <p className="text-[10px] text-[var(--color-purple-gray)]">{track.artist}</p>
                )}
              </button>

              {isSelected && (
                <CheckCircle size={13} className="shrink-0 text-[var(--color-primary-purple)]" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Caption Customizer ───────────────────────────────────────────────────────

const PRESET_FONTS = [
  'Montserrat', 'Oswald', 'Anton', 'Bebas Neue', 'Raleway',
  'Roboto Condensed', 'Impact', 'Playfair Display', 'Nunito', 'Poppins',
  'Bangers', 'Barlow', 'DM Sans', 'Inter', 'Lato',
]

const POSITION_OPTIONS = [
  { value: 'top',    label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
] as const

const COLOR_FIELDS: { key: keyof NonNullable<SrpClipSelection['caption_colors']>; label: string }[] = [
  { key: 'text',       label: 'Text' },
  { key: 'background', label: 'Background' },
  { key: 'outline',    label: 'Outline' },
  { key: 'highlight',  label: 'Highlight' },
]

interface CaptionCustomizerProps {
  clip: SrpClipSelection
  onUpdate: (patch: Partial<SrpClipSelection>) => void
}

function CaptionCustomizer({ clip, onUpdate }: CaptionCustomizerProps) {
  const fontFileRef = useRef<HTMLInputElement>(null)
  const [fontUploading, setFontUploading] = useState(false)
  const colors = clip.caption_colors ?? {}

  async function handleFontUpload(file: File) {
    if (!file) return
    setFontUploading(true)
    try {
      const ext  = file.name.split('.').pop() ?? 'ttf'
      const path = `caption-fonts/${Date.now()}_${file.name}`
      const { error } = await supabase.storage
        .from('srp-assets')
        .upload(path, file, { upsert: true, contentType: file.type || 'font/truetype' })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('srp-assets').getPublicUrl(path)
      onUpdate({ caption_font: file.name.replace(/\.[^.]+$/, ''), caption_font_url: publicUrl })
    } catch {
      // silently ignore; user can retry
    } finally {
      setFontUploading(false)
    }
  }

  function setColor(key: keyof NonNullable<SrpClipSelection['caption_colors']>, value: string) {
    onUpdate({ caption_colors: { ...colors, [key]: value } })
  }

  return (
    <div className="space-y-4">
      {/* Font */}
      <div className="space-y-1.5">
        <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Font</label>
        <div className="flex gap-2 flex-wrap items-center">
          <select
            value={clip.caption_font_url ? '__custom__' : (clip.caption_font ?? '')}
            onChange={e => {
              if (e.target.value === '__custom__') { fontFileRef.current?.click(); return }
              onUpdate({ caption_font: e.target.value || undefined, caption_font_url: undefined })
            }}
            className="flex-1 min-w-0 rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
          >
            <option value="">Default (style preset)</option>
            {PRESET_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            <option value="__custom__">Upload custom font…</option>
            {clip.caption_font_url && (
              <option value="__custom__">{clip.caption_font ?? 'Custom font'} (uploaded)</option>
            )}
          </select>
          <button
            type="button"
            onClick={() => fontFileRef.current?.click()}
            disabled={fontUploading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--color-lavender)] text-[11px] text-[var(--color-purple-gray)] hover:bg-[var(--color-lavender-tint)] transition-colors whitespace-nowrap"
          >
            {fontUploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            Upload .ttf / .otf
          </button>
          <input
            ref={fontFileRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFontUpload(f) }}
          />
        </div>
        {clip.caption_font_url && (
          <p className="text-[10px] text-[var(--color-primary-purple)]">Custom font on file: {clip.caption_font ?? 'uploaded'}</p>
        )}
      </div>

      {/* Font size + position */}
      <div className="flex gap-4 flex-wrap">
        <div className="space-y-1.5">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Font size (px)</label>
          <input
            type="number" min={16} max={120} step={2}
            value={clip.caption_font_size ?? ''}
            placeholder="e.g. 48"
            onChange={e => onUpdate({ caption_font_size: e.target.value ? Number(e.target.value) : undefined })}
            className="w-24 rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Position</label>
          <div className="flex gap-1.5">
            {POSITION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onUpdate({ caption_position: opt.value as SrpClipSelection['caption_position'] })}
                className={[
                  'px-3 py-1.5 rounded-full border text-[11px] font-medium transition-colors',
                  clip.caption_position === opt.value
                    ? 'bg-[var(--color-primary-purple)] text-white border-[var(--color-primary-purple)]'
                    : 'border-[var(--color-lavender)] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] bg-white',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Colors */}
      <div className="space-y-1.5">
        <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Colors</label>
        <div className="flex flex-wrap gap-4">
          {COLOR_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex flex-col items-center gap-1">
              <input
                type="color"
                value={colors[key] && colors[key] !== 'transparent' ? colors[key]! : '#ffffff'}
                onChange={e => setColor(key, e.target.value)}
                className="w-9 h-9 rounded-lg border-2 border-[var(--color-lavender)] cursor-pointer p-0.5 bg-white"
                title={label}
              />
              <span className="text-[9px] text-[var(--color-purple-gray)] uppercase tracking-wider">{label}</span>
              {colors[key] && <span className="text-[9px] font-mono text-[var(--color-deep-plum)]">{colors[key]}</span>}
            </div>
          ))}
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => setColor('background', colors.background === 'transparent' ? '#000000' : 'transparent')}
              className={[
                'w-9 h-9 rounded-lg border-2 text-[9px] font-bold transition-colors',
                colors.background === 'transparent'
                  ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]'
                  : 'border-[var(--color-lavender)] bg-white text-[var(--color-purple-gray)]',
              ].join(' ')}
              title="Toggle transparent background"
            >∅</button>
            <span className="text-[9px] text-[var(--color-purple-gray)] uppercase tracking-wider">BG None</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Per-clip Panel ───────────────────────────────────────────────────────────

interface ClipPanelProps {
  idx: number
  clip: any
  onChange: (updated: any) => void
}

function ClipPanel({ idx, clip, onChange }: ClipPanelProps) {
  const [open, setOpen] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const [imgUploading, setImgUploading] = useState(false)
  const { account } = useSrpWorkflow()

  const titleScreen = clip.title_screen ?? { enabled: false, type: 'text' as const }
  const outroEnabled = clip.outro_enabled ?? false

  function updateTitleScreen(patch: Partial<typeof titleScreen>) {
    onChange({ ...clip, title_screen: { ...titleScreen, ...patch } })
  }

  async function handleTitleImage(file: File) {
    if (!file.type.startsWith('image/')) return
    setImgUploading(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `title-screens/${account?.member ?? 'unknown'}/clip_${idx + 1}_title.${ext}`
      const { error } = await supabase.storage
        .from('srp-assets')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('srp-assets').getPublicUrl(path)
      updateTitleScreen({ image_url: publicUrl })
    } catch {
      // silently ignore — user can retry
    } finally {
      setImgUploading(false)
    }
  }

  const label = clip.clip_title
    ? clamp(clip.clip_title, 40)
    : `Clip ${idx + 1}`

  return (
    <div className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--color-lavender-tint)] transition-colors"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="text-[12px] font-semibold text-[var(--color-deep-plum)]">
          Clip {idx + 1} — {label}
        </span>
        {clip.startTime && (
          <span className="ml-auto text-[11px] text-[var(--color-purple-gray)]">
            {clip.startTime} → {clip.endTime}
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5 border-t border-[var(--color-lavender)]">

          {/* ── Title screen ── */}
          <div className="space-y-2 pt-3">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary-purple)]">
                Title screen
              </label>
              <button
                onClick={() => updateTitleScreen({ enabled: !titleScreen.enabled })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
                  titleScreen.enabled ? 'bg-[var(--color-primary-purple)]' : 'bg-[var(--color-lavender)]'
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ${
                  titleScreen.enabled ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </button>
              <span className="text-[11px] text-[var(--color-purple-gray)]">
                {titleScreen.enabled ? 'On' : 'Off'}
              </span>
            </div>

            {titleScreen.enabled && (
              <div className="space-y-3 pl-2">
                {/* Type picker */}
                <div className="flex gap-2">
                  {(['text', 'image'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => updateTitleScreen({ type: t })}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
                        titleScreen.type === t
                          ? 'bg-[var(--color-lavender-tint)] border-[var(--color-primary-purple)] text-[var(--color-primary-purple)]'
                          : 'border-[var(--color-lavender)] text-[var(--color-purple-gray)] hover:bg-[var(--color-lavender-tint)]'
                      }`}
                    >
                      {t === 'text' ? <Type size={11} /> : <ImageIcon size={11} />}
                      {t === 'text' ? 'Text overlay' : 'Image'}
                    </button>
                  ))}
                </div>

                {titleScreen.type === 'text' ? (
                  <input
                    type="text"
                    placeholder="Title text that appears on screen…"
                    value={titleScreen.text ?? ''}
                    onChange={e => updateTitleScreen({ text: e.target.value })}
                    className="w-full rounded-lg border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] px-3 py-2 text-[12px] text-[var(--color-deep-plum)] placeholder-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)]"
                  />
                ) : (
                  <div className="space-y-2">
                    {titleScreen.image_url ? (
                      <div className="flex items-center gap-3">
                        <img
                          src={titleScreen.image_url}
                          alt="Title"
                          className="h-10 w-16 rounded-md object-cover border border-[var(--color-lavender)]"
                        />
                        <button
                          onClick={() => fileRef.current?.click()}
                          className="text-[11px] text-[var(--color-primary-purple)] hover:underline"
                        >
                          Replace image
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => fileRef.current?.click()}
                        disabled={imgUploading}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--color-lavender)] hover:border-[var(--color-primary-purple)] text-[11px] text-[var(--color-purple-gray)] hover:text-[var(--color-primary-purple)] transition-colors"
                      >
                        {imgUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        Upload title image
                      </button>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) void handleTitleImage(f) }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Outro toggle ── */}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary-purple)]">
              Outro logo
            </label>
            <button
              onClick={() => onChange({ ...clip, outro_enabled: !outroEnabled })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
                outroEnabled ? 'bg-[var(--color-primary-purple)]' : 'bg-[var(--color-lavender)]'
              }`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ${
                outroEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
            <span className="text-[11px] text-[var(--color-purple-gray)]">
              {outroEnabled ? 'On' : 'Off'}
            </span>
          </div>

          {/* ── Background music ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Music2 size={12} className="text-[var(--color-primary-purple)]" />
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary-purple)]">
                Background music
              </label>
              {clip.background_track && (
                <span className="text-[11px] text-[var(--color-deep-plum)] font-medium truncate">
                  — {clip.background_track.name}
                </span>
              )}
              {clip.background_track === null && (
                <span className="text-[11px] text-[var(--color-purple-gray)]">— none</span>
              )}
            </div>
            <SongPicker
              selected={clip.background_track}
              onSelect={track => onChange({ ...clip, background_track: track })}
            />
          </div>

          {/* ── Caption text editor ── */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary-purple)]">
              Caption text
            </label>
            <p className="text-[11px] text-[var(--color-purple-gray)]">
              Edit the verbatim quote before it's burned into the clip. Fix typos, remove filler words, or break long sentences.
            </p>
            <textarea
              rows={5}
              value={clip.caption_text ?? clip.quote ?? ''}
              onChange={e => onChange({ ...clip, caption_text: e.target.value })}
              placeholder="Paste or edit the caption text for this clip…"
              className="w-full rounded-lg border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] px-3 py-2 text-[12px] text-[var(--color-deep-plum)] placeholder-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] resize-none"
            />
            <p className="text-[10px] text-[var(--color-purple-gray)] flex items-center gap-1">
              <Info size={10} />
              Caption timing (syncing to audio) requires video playback — handled in the post-render review step.
            </p>
          </div>

          {/* ── Caption styling (font, size, position, colors) ── */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary-purple)]">
              Caption styling
            </label>
            {clip.caption_slug ? (
              <p className="text-[11px] text-[var(--color-purple-gray)]">
                Style: <span className="font-semibold text-[var(--color-deep-plum)]">{clip.caption_slug}</span> — override font, size, position, or colors below.
              </p>
            ) : (
              <p className="text-[11px] text-[var(--color-purple-gray)]">
                No caption style selected yet — choose one in the Clip selection step, or set overrides here.
              </p>
            )}
            <CaptionCustomizer
              clip={clip as SrpClipSelection}
              onUpdate={patch => onChange({ ...clip, ...patch })}
            />
          </div>

        </div>
      )}
    </div>
  )
}

// ── Main Step ────────────────────────────────────────────────────────────────

export function PreRenderEditStep() {
  const {
    clipSelections,
    setClipSelections,
    goToNextStep,
    goToPrevStep,
  } = useSrpWorkflow()

  function updateClip(idx: number, updated: any) {
    const next = clipSelections.map((c, i) => (i === idx ? updated : c))
    setClipSelections(next)
  }

  const canContinue = clipSelections.length > 0

  return (
    <div className="space-y-6 max-w-2xl mx-auto pb-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-primary-purple)]">
          Pre-render edits
        </p>
        <h2 className="text-[22px] font-bold text-[var(--color-deep-plum)] mt-0.5">
          Title screens, outro &amp; captions
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          Make any final edits before the clips are cut and rendered.
        </p>
      </div>

      {/* Church outro logo */}
      <OutroLogoSection />

      {/* Per-clip panels */}
      {clipSelections.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] px-5 py-8 text-center">
          <p className="text-[13px] text-[var(--color-purple-gray)]">
            No clips selected — go back to Clip selection.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {clipSelections.map((clip, idx) => (
            <ClipPanel
              key={(clip as any).id ?? idx}
              idx={idx}
              clip={clip}
              onChange={updated => updateClip(idx, updated)}
            />
          ))}
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={goToPrevStep}
          className="px-4 py-2 rounded-full text-[12px] font-medium text-[var(--color-deep-plum)] border border-[var(--color-lavender)] hover:bg-[var(--color-lavender-tint)] transition-colors"
        >
          ← Back
        </button>
        <button
          disabled={!canContinue}
          onClick={goToNextStep}
          className="px-6 py-2 rounded-full text-[12px] font-semibold text-white bg-[var(--color-deep-plum)] hover:bg-[var(--color-primary-purple)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue →
        </button>
      </div>
    </div>
  )
}
