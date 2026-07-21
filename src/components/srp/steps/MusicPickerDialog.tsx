import { useEffect, useRef, useState } from 'react'
import { X, Play, Pause } from 'lucide-react'
import { MUSIC_LIBRARY, MUSIC_GENRES, type MusicTrack } from '../../../lib/musicLibrary'
import { SrpButton } from '../_shared/SrpButton'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

interface Props {
  selectedTrackId: string | null
  onSelect:        (trackId: string) => void
  onClose:         () => void
}

export function MusicPickerDialog({ selectedTrackId, onSelect, onClose }: Props) {
  const [activeGenre, setActiveGenre] = useState<typeof MUSIC_GENRES[number]>(MUSIC_GENRES[0])
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [progress, setProgress] = useState<number>(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const tracks = MUSIC_LIBRARY.filter(t => t.genre === activeGenre)

  useEffect(() => {
    const audio = audioRef.current
    return () => { audio?.pause() }
  }, [])

  function togglePlay(track: MusicTrack) {
    const audio = audioRef.current
    if (!audio) return

    if (playingId === track.id) {
      audio.pause()
      setPlayingId(null)
      return
    }

    audio.src = track.url
    audio.currentTime = 0
    void audio.play().catch(() => undefined)
    setPlayingId(track.id)
  }

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    setProgress(audio.currentTime / audio.duration)
  }

  function handleEnded() {
    setPlayingId(null)
    setProgress(0)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--color-deep-plum)]/60 backdrop-blur-sm">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        preload="none"
      />

      <div className="bg-white rounded-2xl border border-[var(--color-lavender)] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-lavender)]">
          <h3 className="text-[16px] font-semibold text-[var(--color-deep-plum)]">Choose Track</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[var(--color-lavender-tint)] text-[var(--color-purple-gray)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Genre tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-0 overflow-x-auto shrink-0 border-b border-[var(--color-lavender)]">
          {MUSIC_GENRES.map(genre => (
            <button
              key={genre}
              type="button"
              onClick={() => setActiveGenre(genre)}
              className={[
                'px-3 py-1.5 rounded-t-lg text-[11px] font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px',
                activeGenre === genre
                  ? 'border-[var(--color-primary-purple)] text-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                  : 'border-transparent text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)]',
              ].join(' ')}
            >
              {genre}
            </button>
          ))}
        </div>

        {/* Track list */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-lavender)]">
          {tracks.map(track => {
            const isPlaying = playingId === track.id
            const isSelected = selectedTrackId === track.id
            return (
              <div
                key={track.id}
                className={[
                  'flex items-center gap-3 px-5 py-3 transition-colors',
                  isSelected ? 'bg-[var(--color-lavender-tint)]' : 'hover:bg-[var(--color-cream)]',
                ].join(' ')}
              >
                {/* Play/Pause */}
                <button
                  type="button"
                  onClick={() => togglePlay(track)}
                  className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-[var(--color-lavender-tint)] hover:bg-[var(--color-lavender)] text-[var(--color-deep-plum)] transition-colors"
                >
                  {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                </button>

                {/* Track info + progress */}
                <div className="flex-1 min-w-0">
                  <p className={[
                    'text-[13px] font-semibold truncate',
                    isSelected ? 'text-[var(--color-primary-purple)]' : 'text-[var(--color-deep-plum)]',
                  ].join(' ')}>
                    {track.name}
                  </p>
                  {isPlaying && (
                    <div className="mt-1 h-1 rounded-full bg-[var(--color-lavender)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-primary-purple)] transition-all"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Duration */}
                <span className="text-[11px] text-[var(--color-purple-gray)] font-mono shrink-0">
                  {formatDuration(track.duration_seconds)}
                </span>

                {/* Select button */}
                <SrpButton
                  size="sm"
                  variant={isSelected ? 'primary' : 'secondary'}
                  onClick={() => { onSelect(track.id); onClose() }}
                >
                  {isSelected ? 'Selected' : 'Select'}
                </SrpButton>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-lavender)] flex justify-end">
          <SrpButton variant="ghost" onClick={onClose}>Close</SrpButton>
        </div>
      </div>
    </div>
  )
}
