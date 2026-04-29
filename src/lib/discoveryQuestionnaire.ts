/**
 * Read helpers for the Discovery Questionnaire surface.
 *
 * Ingestion is owned by an n8n workflow (see "Discovery Questionnaire
 * — n8n Migration" doc). The app is read-only for v1: the AccountLog
 * page surfaces the latest row + linked files; downstream tools
 * (Strategy Brief Generator, Style Finder, Web Wizard) call the same
 * helpers to seed their inputs.
 *
 * Files live in a private Supabase Storage bucket — `getQuestionnaireFileUrl`
 * returns a short-lived signed URL the browser can open in a new tab.
 */

import { supabase } from './supabase'
import type {
  StrategyDiscoveryQuestionnaire,
  StrategyDiscoveryQuestionnaireFile,
} from '../types/database'

const BUCKET = 'discovery-questionnaire'

/** Latest questionnaire row for a partner, or null if none on file. */
export async function getLatestQuestionnaireForMember(
  member: number,
): Promise<StrategyDiscoveryQuestionnaire | null> {
  const { data, error } = await supabase
    .from('strategy_discovery_questionnaire')
    .select('*')
    .eq('member', member)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as StrategyDiscoveryQuestionnaire | null) ?? null
}

/** All file rows attached to a questionnaire, grouped client-side by
 *  `file_kind` if the caller wants to bucket them. */
export async function listQuestionnaireFiles(
  questionnaireId: string,
): Promise<StrategyDiscoveryQuestionnaireFile[]> {
  const { data, error } = await supabase
    .from('strategy_discovery_questionnaire_files')
    .select('*')
    .eq('questionnaire_id', questionnaireId)
    .order('file_kind', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as StrategyDiscoveryQuestionnaireFile[]
}

/** Resolve a private storage path to a short-lived signed URL the
 *  browser can hit. Returns null if Supabase rejects the path (object
 *  missing, expired auth, etc.) so callers can degrade gracefully. */
export async function getQuestionnaireFileUrl(
  storagePath: string,
  expiresInSec = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSec)
  if (error) return null
  return data?.signedUrl ?? null
}
