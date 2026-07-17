/**
 * SrpWorkflowContext — 12-step SRP workflow state.
 *
 * Architecture rules (carry over from the 4-step build):
 *   1. session_id comes from the URL ONLY. The context loads the row
 *      from `srp_pipeline.sessions` on mount, mirrors it into state,
 *      and autosaves changes back via a 1s debounced upsert.
 *   2. visibleSteps is derived from `selectedDeliverables`. The
 *      sidebar stepper renders only visible steps; goNext/goPrev walk
 *      that list, not the canonical 12.
 *   3. Per-step input bundles (guidance text + selections + tags) live
 *      in JSONB columns on sessions so they survive navigation +
 *      device switches. AI output stays in localStorage drafts only.
 *
 * The context does NOT mirror state to localStorage. session_id in
 * URL + autosave to DB is the single source of truth.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import {
  srpPipeline,
  updateSession,
} from '../lib/srpSessions'
import {
  SRP_MAX_REELS,
  SRP_REEL_DELIVERABLES,
  isSrpReelDeliverable,
  type SrpCarouselSlide,
  type SrpClipSelection,
  type SrpDeliverable,
  type SrpFacebookInput,
  type SrpPhotoRecapInput,
  type SrpPipelineSession,
  type SrpReelGuidanceMap,
  type SrpCarouselInput,
  type SrpSundayInviteInput,
  type SrpWorkflowStep,
  type SquadAccount,
  type SrpSermonSubmission,
} from '../types/database'

interface SrpWorkflowState {
  // Identity
  sessionId:    string                       // session_id slug (URL-canonical)
  sessionDbId:  string | null
  isResuming:   boolean
  error:        string | null

  // Account
  account:      SquadAccount | null
  setAccount:   (a: SquadAccount | null) => void
  sermonSubmission: SrpSermonSubmission | null
  setSermonSubmission: (s: SrpSermonSubmission | null) => void

  // Step
  currentStep: SrpWorkflowStep
  setCurrentStep: (s: SrpWorkflowStep) => void
  savedStep: SrpWorkflowStep   // step persisted in DB when session loaded
  setSavedStep: (s: SrpWorkflowStep) => void
  visibleSteps: SrpWorkflowStep[]
  goToNextStep: () => void
  goToPrevStep: () => void

  // Deliverables
  selectedDeliverables: SrpDeliverable[]
  setSelectedDeliverables: (d: SrpDeliverable[]) => void

  // Sermon input
  videoUrl: string
  setVideoUrl: (s: string) => void
  videoSourceType: SrpPipelineSession['video_source_type']
  setVideoSourceType: (s: SrpPipelineSession['video_source_type']) => void
  transcript: string
  setTranscript: (s: string) => void
  transcriptWords: unknown[] | null
  setTranscriptWords: (w: unknown[] | null) => void
  hasTimecodes: boolean
  setHasTimecodes: (v: boolean) => void
  transcriptJobId: string | null
  setTranscriptJobId: (id: string | null) => void

  // Overview
  keyInsights: string[]
  setKeyInsights: (v: string[]) => void

  // Pre-render edits
  outroLogoUrl: string | null
  setOutroLogoUrl: (url: string | null) => void

  // Clips
  clipSuggestions: SrpClipSelection[]
  setClipSuggestions: (c: SrpClipSelection[]) => void
  clipSelections: SrpClipSelection[]
  setClipSelections: (c: SrpClipSelection[]) => void

  // Approved deliverable text
  updateClipSocialCaption: (clipId: string, caption: string | null) => void
  facebookPost: string | null
  setFacebookPost: (v: string | null) => void
  sundayInvite: string | null
  setSundayInvite: (v: string | null) => void
  photoRecapCaption: string | null
  setPhotoRecapCaption: (v: string | null) => void
  carouselSlides: SrpCarouselSlide[] | null
  setCarouselSlides: (v: SrpCarouselSlide[] | null) => void
  carouselCaption: string | null
  setCarouselCaption: (v: string | null) => void

  // Creative Direction
  srpTemplate: string
  setSrpTemplate: (v: string) => void
  backgroundMusic: boolean
  setBackgroundMusic: (v: boolean) => void
  designerNotes: string
  setDesignerNotes: (v: string) => void

  // Clip processing
  clipcutterJobId: string | null
  setClipcutterJobId: (id: string | null) => void

  // ClickUp
  clickupTaskId: string | null
  setClickupTaskId: (v: string | null) => void
  srpTaskIdOverride: string | null
  setSrpTaskIdOverride: (v: string | null) => void

  // Brand voice (lives in srp_pipeline.clip_templates per CLAUDE.md)
  brandVoice: string
  setBrandVoice: (v: string) => void

  // Per-step input bundles
  reelGuidance: SrpReelGuidanceMap
  setReelGuidance: (m: SrpReelGuidanceMap) => void
  sundayInviteInput: SrpSundayInviteInput
  setSundayInviteInput: (i: SrpSundayInviteInput) => void
  facebookInput: SrpFacebookInput
  setFacebookInput: (i: SrpFacebookInput) => void
  carouselInput: SrpCarouselInput
  setCarouselInput: (i: SrpCarouselInput) => void
  photoRecapInput: SrpPhotoRecapInput
  setPhotoRecapInput: (i: SrpPhotoRecapInput) => void

  // Auto-generated drafts (pre-populated options for each step)
  autoDrafts: Record<string, any> | null
  setAutoDrafts: (drafts: Record<string, any>) => void

  // Imperative
  refresh: () => Promise<void>
  manualSave: () => Promise<void>
}

const SrpWorkflowContext = createContext<SrpWorkflowState | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useSrpWorkflow(): SrpWorkflowState {
  const ctx = useContext(SrpWorkflowContext)
  if (!ctx) throw new Error('useSrpWorkflow must be used inside <SrpWorkflowProvider>')
  return ctx
}

export interface SrpWorkflowProviderProps {
  sessionId:  string                  // URL-canonical session_id slug
  children:   ReactNode
}

/** Format a saved intel profile's brand voice into a text block for generation prompts. */
function formatIntelBrandVoice(p: any): string {
  const bv = p?.brand_voice
  const cp = p?.church_profile
  if (!bv) return ''
  const lines: string[] = []
  if (bv.tone_summary) lines.push(`Tone: ${bv.tone_summary}`)
  if (bv.casual_to_formal_spectrum) lines.push(`Voice spectrum: ${bv.casual_to_formal_spectrum}`)
  if (Array.isArray(bv.attributes) && bv.attributes.length > 0) {
    lines.push('\nVoice attributes:')
    for (const attr of bv.attributes) {
      lines.push(`- ${attr.name}: ${attr.definition ?? ''}`)
      if (attr.write_with_this_in_mind) lines.push(`  Write with this in mind: ${attr.write_with_this_in_mind}`)
      if (Array.isArray(attr.use) && attr.use.length)     lines.push(`  Use: ${attr.use.join(', ')}`)
      if (Array.isArray(attr.avoid) && attr.avoid.length) lines.push(`  Avoid: ${attr.avoid.join(', ')}`)
    }
  }
  if (cp?.service_times) lines.push(`\nService times: ${cp.service_times}`)
  if (cp?.location)      lines.push(`Location: ${cp.location}`)
  if (cp?.website)       lines.push(`Website: ${cp.website}`)
  return lines.join('\n').trim()
}

export function SrpWorkflowProvider({ sessionId, children }: SrpWorkflowProviderProps) {
  // Identity
  const [sessionDbId, setSessionDbId] = useState<string | null>(null)
  const [isResuming, setIsResuming] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Account
  const [account, setAccount] = useState<SquadAccount | null>(null)
  const [sermonSubmission, setSermonSubmission] = useState<SrpSermonSubmission | null>(null)

  // Step
  const [savedStep, setSavedStep] = useState<SrpWorkflowStep>('account')
  const [currentStep, setCurrentStepRaw] = useState<SrpWorkflowStep>('account')

  // Session lifecycle status — preserved so autosave never downgrades 'background' to 'in_progress'
  const [sessionStatus, setSessionStatus] = useState<string>('in_progress')

  // Deliverables
  const [selectedDeliverables, setSelectedDeliverables] = useState<SrpDeliverable[]>([])

  // Sermon input
  const [videoUrl, setVideoUrl] = useState<string>('')
  const [videoSourceType, setVideoSourceType] = useState<SrpPipelineSession['video_source_type']>(null)
  const [transcript, setTranscript] = useState<string>('')
  const [transcriptWords, setTranscriptWords] = useState<unknown[] | null>(null)
  const [hasTimecodes, setHasTimecodes] = useState<boolean>(true)
  const [transcriptJobId, setTranscriptJobId] = useState<string | null>(null)

  // Clips
  const [keyInsights, setKeyInsights]     = useState<string[]>([])
  const [outroLogoUrl, setOutroLogoUrl]   = useState<string | null>(null)
  const [clipSuggestions, setClipSuggestions] = useState<SrpClipSelection[]>([])
  const [clipSelections, setClipSelections] = useState<SrpClipSelection[]>([])

  // Approved deliverable text
  const [facebookPost, setFacebookPost] = useState<string | null>(null)
  const [sundayInvite, setSundayInvite] = useState<string | null>(null)
  const [photoRecapCaption, setPhotoRecapCaption] = useState<string | null>(null)
  const [carouselSlides, setCarouselSlides] = useState<SrpCarouselSlide[] | null>(null)
  const [carouselCaption, setCarouselCaption] = useState<string | null>(null)

  // Creative direction
  const [srpTemplate, setSrpTemplate] = useState<string>('SRPA')
  const [backgroundMusic, setBackgroundMusic] = useState<boolean>(false)
  const [designerNotes, setDesignerNotes] = useState<string>('')

  // Clip processing
  const [clipcutterJobId, setClipcutterJobId] = useState<string | null>(null)

  // ClickUp
  const [clickupTaskId, setClickupTaskId] = useState<string | null>(null)
  const [srpTaskIdOverride, setSrpTaskIdOverride] = useState<string | null>(null)

  // Brand voice
  const [brandVoice, setBrandVoice] = useState<string>('')

  // Per-step input bundles
  const [reelGuidance, setReelGuidance] = useState<SrpReelGuidanceMap>({})
  const [sundayInviteInput, setSundayInviteInput] = useState<SrpSundayInviteInput>({})
  const [facebookInput, setFacebookInput] = useState<SrpFacebookInput>({})
  const [carouselInput, setCarouselInput] = useState<SrpCarouselInput>({})
  const [photoRecapInput, setPhotoRecapInput] = useState<SrpPhotoRecapInput>({})

  // Auto-generated drafts — pre-populated options for each deliverable step
  const [autoDrafts, setAutoDrafts] = useState<Record<string, any> | null>(null)

  // Refs
  const isLoadingRef = useRef<boolean>(true)   // skip autosave during load
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoGeneratingRef = useRef<boolean>(false)

  // ── Convenience setters ─────────────────────────────────────────────
  const setCurrentStep = useCallback((s: SrpWorkflowStep) => setCurrentStepRaw(s), [])

  const updateClipSocialCaption = useCallback((clipId: string, caption: string | null) => {
    setClipSelections(prev => prev.map(c => c.clip_id === clipId ? { ...c, social_caption: caption } : c))
  }, [])

  // ── visibleSteps: conditional on selectedDeliverables ───────────────
  const visibleSteps = useMemo<SrpWorkflowStep[]>(() => {
    const steps: SrpWorkflowStep[] = ['account', 'deliverables']
    const hasReels = selectedDeliverables.some(isSrpReelDeliverable)
    if (selectedDeliverables.length > 0) {
      steps.push('sermon', 'overview')
      if (hasReels) steps.push('clips', 'preRenderEdit', 'reelCaptions')
      if (selectedDeliverables.includes('carousel'))     steps.push('carousel')
      if (selectedDeliverables.includes('facebook'))     steps.push('facebook')
      if (selectedDeliverables.includes('photoRecap'))   steps.push('photoRecap')
      if (selectedDeliverables.includes('sundayInvite')) steps.push('sundayInvite')
      if (hasReels)                                      steps.push('clipProcessing')
    }
    steps.push('approved')
    return steps
  }, [selectedDeliverables])

  const goToNextStep = useCallback(() => {
    const idx = visibleSteps.indexOf(currentStep)
    if (idx >= 0 && idx < visibleSteps.length - 1) setCurrentStepRaw(visibleSteps[idx + 1])
  }, [visibleSteps, currentStep])

  const goToPrevStep = useCallback(() => {
    const idx = visibleSteps.indexOf(currentStep)
    if (idx > 0) setCurrentStepRaw(visibleSteps[idx - 1])
  }, [visibleSteps, currentStep])

  // ── Load session by URL slug ───────────────────────────────────────
  const loadFromRow = useCallback((row: SrpPipelineSession) => {
    isLoadingRef.current = true
    setSessionDbId(row.id)
    setSessionStatus(row.status ?? 'in_progress')
    const dbStep = (row.current_step as SrpWorkflowStep) ?? 'account'
    setSavedStep(dbStep)
    setCurrentStepRaw('account')
    setSelectedDeliverables(
      Array.isArray(row.selected_deliverables) ? row.selected_deliverables.filter(d => typeof d === 'string') as SrpDeliverable[] : [],
    )
    setVideoUrl(row.video_url ?? '')
    setVideoSourceType(row.video_source_type ?? null)
    setTranscript(row.transcript ?? '')
    setTranscriptWords(Array.isArray(row.transcript_words) ? row.transcript_words : null)
    setHasTimecodes(row.has_timecodes ?? true)
    setTranscriptJobId(row.transcript_job_id ?? null)

    setClipSuggestions(Array.isArray(row.clip_suggestions) ? row.clip_suggestions : [])
    setClipSelections(Array.isArray(row.clip_selections) ? row.clip_selections : [])

    setFacebookPost(row.facebook_post ?? null)
    setSundayInvite(row.sunday_invite ?? null)
    setPhotoRecapCaption(row.photo_recap_caption ?? null)
    setCarouselSlides(Array.isArray(row.carousel_slides) ? row.carousel_slides : null)
    setCarouselCaption(row.carousel_caption ?? null)

    setSrpTemplate(row.srp_template ?? 'SRPA')
    setBackgroundMusic(row.background_music ?? false)
    setDesignerNotes(row.designer_notes ?? '')

    setClipcutterJobId(row.clipcutter_job_id ?? null)

    setClickupTaskId(row.clickup_task_id ?? null)
    setSrpTaskIdOverride(row.srp_task_id_override ?? null)

    setReelGuidance(row.reel_guidance ?? {})
    setSundayInviteInput(row.sunday_invite_input ?? {})
    setFacebookInput(row.facebook_input ?? {})
    setCarouselInput(row.carousel_input ?? {})
    setPhotoRecapInput(row.photo_recap_input ?? {})
    setAutoDrafts((row as any).auto_drafts ?? null)
    setKeyInsights(Array.isArray((row as any).key_insights) ? (row as any).key_insights : [])

    if (row.member != null && row.church_name) {
      // Seed minimal account object so child components have church_name/member
      // available before the full SquadAccount lookup completes.
      setAccount(prev => prev ?? ({
        member:        row.member!,
        church_name:   row.church_name!,
        instagram:                            null,
        instagram_link:                       null,
        facebook:                             null,
        facebook_link:                        null,
        youtube:                              null,
        church_website:                       null,
        strategy_brief:                       null,
        photos_link:                          null,
        photos_from_all_in_discovery_form:    null,
        custom_gpt:                           null,
        brand_guide_url:                      null,
        carousel_templates:                   null,
        speak_to_audience_as_from_discovery:  null,
        preferred_bible_translation:          null,
        which_social_media_platforms_do_you_want_us_to_post_to_from_all: null,
        sms_notes:                            null,
        plan:                                 null,
        time_zone:                            null,
        recent_series_srp:                    null,
        notion_dashboard:                     null,
        brand_voice_guidelines:               null,
      }) as SquadAccount)
    }

    if (row.clickup_task_id) {
      setSermonSubmission(prev => prev ?? ({
        account: row.member ?? 0,
        created_at: row.created_at ?? new Date().toISOString(),
        series_title: row.series_title,
        series_description: row.series_description,
        sermon_title: row.sermon_title,
        sermon_description: row.sermon_description,
        srp_info_selection: null,
        clickup_task_id: row.clickup_task_id!,
        video_url: row.video_url,
        external_link: null,
      } as SrpSermonSubmission))
    }

    // Allow autosave to fire again after a tick.
    setTimeout(() => { isLoadingRef.current = false }, 500)
  }, [])

  const refresh = useCallback(async () => {
    if (!sessionId) return
    try {
      const { data, error: e } = await srpPipeline
        .from('sessions')
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle()
      if (e) throw e
      if (!data) {
        setError(`Session ${sessionId} not found`)
        setIsResuming(false)
        return
      }
      loadFromRow(data as SrpPipelineSession)
      setError(null)
      setIsResuming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
      setIsResuming(false)
    }
  }, [sessionId, loadFromRow])

  // Initial load
  useEffect(() => {
    setIsResuming(true)
    void refresh()
  }, [refresh])

  // Fire auto-generation when transcript becomes ready and drafts not yet generated
  useEffect(() => {
    if (isResuming) return
    if (!transcript || transcript.trim().length < 200) return
    if (autoDrafts !== null) return            // already generated
    if (autoGeneratingRef.current) return
    autoGeneratingRef.current = true
    ;(async () => {
      try {
        await fetch('/api/srp/auto-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        })
        await refresh()
      } catch { /* non-fatal — coach can generate manually */ }
    })()
  }, [isResuming, transcript, autoDrafts, sessionId, refresh])

  // Auto-load brand voice from church intel if not already set
  useEffect(() => {
    if (isResuming) return              // wait until session is fully loaded
    if (brandVoice) return              // already has a voice — don't overwrite
    const memberNum = account?.member
    if (!memberNum) return
    ;(async () => {
      const { data } = await (supabase as any)
        .from('strategy_church_intel')
        .select('intel_profile')
        .eq('member', memberNum)
        .eq('status', 'live')
        .maybeSingle()
      if (!data?.intel_profile) return
      const formatted = formatIntelBrandVoice(data.intel_profile)
      if (formatted) setBrandVoice(formatted)
    })()
  }, [isResuming, brandVoice, account?.member])

  // Auto-load outro logo URL from clip_templates
  useEffect(() => {
    if (isResuming) return
    if (outroLogoUrl) return            // already loaded
    const memberNum = account?.member
    if (!memberNum) return
    ;(async () => {
      const { data } = await srpPipeline
        .from('clip_templates')
        .select('outro_logo_url')
        .eq('member', memberNum)
        .maybeSingle()
      if (data?.outro_logo_url) setOutroLogoUrl(data.outro_logo_url as string)
    })()
  }, [isResuming, outroLogoUrl, account?.member])

  // ── Autosave ────────────────────────────────────────────────────────
  // Build only the dirty subset so a fresh-mount autosave doesn't clobber
  // values that haven't been touched yet by the coach.
  const buildPayload = useCallback((): Partial<SrpPipelineSession> => {
    const reelGuidanceDirty = Object.values(reelGuidance).some(v => v && v.trim().length > 0)
    const sundayInviteDirty = sundayInviteInput.guidance
      || sundayInviteInput.selectedIdx != null
      || sundayInviteInput.selectedCitation
      || (sundayInviteInput.selectedTags?.length ?? 0) > 0
    const facebookDirty = facebookInput.guidance
      || facebookInput.selectedIdx != null
      || facebookInput.selectedCitation
      || (facebookInput.selectedTags?.length ?? 0) > 0
    const carouselInputDirty = carouselInput.slidesGuidance
      || carouselInput.captionGuidance
      || carouselInput.selectedIdx != null
      || (carouselInput.selectedCitations?.length ?? 0) > 0
      || (carouselInput.selectedTags?.length ?? 0) > 0
    const photoRecapDirty = photoRecapInput.category
      || photoRecapInput.guidance
      || photoRecapInput.selectedIdx != null
      || (photoRecapInput.selectedTags?.length ?? 0) > 0

    return {
      current_step:           currentStep,
      status:                 currentStep === 'approved' ? 'completed' : sessionStatus === 'background' ? 'background' : 'in_progress',
      selected_deliverables:  selectedDeliverables.length > 0 ? selectedDeliverables : null,
      video_url:              videoUrl || null,
      video_source_type:      videoSourceType,
      transcript:             transcript || null,
      transcript_words:       transcriptWords && transcriptWords.length > 0 ? transcriptWords : null,
      has_timecodes:          hasTimecodes,
      transcript_job_id:      transcriptJobId,
      clip_suggestions:       clipSuggestions.length > 0 ? clipSuggestions : null,
      clip_selections:        clipSelections.length > 0 ? clipSelections : null,
      facebook_post:          facebookPost,
      sunday_invite:          sundayInvite,
      photo_recap_caption:    photoRecapCaption,
      carousel_slides:        carouselSlides,
      carousel_caption:       carouselCaption,
      srp_template:           srpTemplate || null,
      background_music:       backgroundMusic,
      designer_notes:         designerNotes || null,
      clipcutter_job_id:      clipcutterJobId,
      clickup_task_id:        clickupTaskId,
      srp_task_id_override:   srpTaskIdOverride,
      reel_guidance:          reelGuidanceDirty ? reelGuidance : null,
      sunday_invite_input:    sundayInviteDirty ? sundayInviteInput : null,
      facebook_input:         facebookDirty ? facebookInput : null,
      carousel_input:         carouselInputDirty ? carouselInput : null,
      photo_recap_input:      photoRecapDirty ? photoRecapInput : null,
    }
  }, [
    currentStep, selectedDeliverables,
    videoUrl, videoSourceType, transcript, transcriptWords, hasTimecodes, transcriptJobId,
    clipSuggestions, clipSelections,
    facebookPost, sundayInvite, photoRecapCaption,
    carouselSlides, carouselCaption,
    srpTemplate, backgroundMusic, designerNotes,
    clipcutterJobId, clickupTaskId, srpTaskIdOverride,
    reelGuidance, sundayInviteInput, facebookInput, carouselInput, photoRecapInput,
  ])

  const manualSave = useCallback(async () => {
    if (!sessionDbId || !sessionId) return
    try { await updateSession(sessionId, buildPayload()) }
    catch (e) { console.error('SRP manual save failed:', e) }
  }, [sessionDbId, sessionId, buildPayload])

  useEffect(() => {
    if (isLoadingRef.current) return
    if (!sessionDbId) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      try { await updateSession(sessionId, buildPayload()) }
      catch (e) { console.error('SRP autosave failed:', e) }
    }, 1000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [sessionDbId, sessionId, buildPayload])

  const value: SrpWorkflowState = {
    sessionId, sessionDbId, isResuming, error,
    account, setAccount, sermonSubmission, setSermonSubmission,
    currentStep, setCurrentStep, savedStep, setSavedStep, visibleSteps, goToNextStep, goToPrevStep,
    selectedDeliverables, setSelectedDeliverables,
    videoUrl, setVideoUrl,
    videoSourceType, setVideoSourceType,
    transcript, setTranscript,
    transcriptWords, setTranscriptWords,
    hasTimecodes, setHasTimecodes,
    transcriptJobId, setTranscriptJobId,
    keyInsights, setKeyInsights,
    outroLogoUrl, setOutroLogoUrl,
    clipSuggestions, setClipSuggestions,
    clipSelections, setClipSelections,
    updateClipSocialCaption,
    facebookPost, setFacebookPost,
    sundayInvite, setSundayInvite,
    photoRecapCaption, setPhotoRecapCaption,
    carouselSlides, setCarouselSlides,
    carouselCaption, setCarouselCaption,
    srpTemplate, setSrpTemplate,
    backgroundMusic, setBackgroundMusic,
    designerNotes, setDesignerNotes,
    clipcutterJobId, setClipcutterJobId,
    clickupTaskId, setClickupTaskId,
    srpTaskIdOverride, setSrpTaskIdOverride,
    brandVoice, setBrandVoice,
    reelGuidance, setReelGuidance,
    sundayInviteInput, setSundayInviteInput,
    facebookInput, setFacebookInput,
    carouselInput, setCarouselInput,
    photoRecapInput, setPhotoRecapInput,
    autoDrafts, setAutoDrafts,
    refresh, manualSave,
  }

  return <SrpWorkflowContext.Provider value={value}>{children}</SrpWorkflowContext.Provider>
}

/** Helper: set selectedDeliverables so exactly N reel slots are selected.
 *  Preserves non-reel deliverables in their current state. */
// eslint-disable-next-line react-refresh/only-export-components
export function withReelsCount(current: readonly SrpDeliverable[], count: number): SrpDeliverable[] {
  const clamped = Math.max(0, Math.min(SRP_MAX_REELS, count))
  const nonReels = current.filter(d => !isSrpReelDeliverable(d))
  const reels = SRP_REEL_DELIVERABLES.slice(0, clamped)
  return [...reels, ...nonReels]
}
