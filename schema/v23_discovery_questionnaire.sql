-- v23_discovery_questionnaire.sql
--
-- Stores partner discovery questionnaire submissions (the form
-- partners fill out before kickoff — Airtable + FillOut today, the
-- Strategy Brief Generator and other downstream tools tomorrow).
--
-- Hybrid storage: typed columns for the answers downstream tools query
-- directly, plus a `raw_payload` JSONB column for everything else +
-- forward compatibility. New questions land in raw_payload first; we
-- promote them to typed columns when more than one tool reads them.
--
-- Ingestion is owned by an n8n workflow (companion doc: "Discovery
-- Questionnaire — n8n Migration"). The app is read-only for v1; the
-- AccountLogPage surfaces the latest row + linked files. Bible
-- translation IDs are resolved to names (`'ESV'`, `'NIV'`, etc.) in
-- n8n before insert — the app sees clean strings.
--
-- Files (logos, brand guides, generated submission PDFs) live in a
-- private Supabase Storage bucket. Airtable signed URLs expire so n8n
-- copies each file into Storage; the app reads via short-lived signed
-- URLs.
--
-- RLS: any authenticated user (i.e. signed-in staff) can read/write,
-- matching the rest of the strategy_* surface. The n8n service-role
-- key bypasses RLS for ingest.

-- ── Schema ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_discovery_questionnaire (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Partner key — matches strategy_account_progress.member (integer).
  member                            integer NOT NULL,
  -- The original FillOut/Airtable submission id; null on native rows.
  submission_id                     text,
  -- Legacy Airtable record id; null for non-legacy rows. Kept for
  -- traceability when migrated rows need to be reconciled with the
  -- Airtable export.
  airtable_record_id                text,
  -- 'airtable_legacy' | 'fillout_webhook' | 'native'. Lets downstream
  -- tools filter by ingest path if they need to.
  source                            text NOT NULL DEFAULT 'native',

  submitted_at                      timestamptz NOT NULL,
  cohort                            text,
  discovery_call_booking            timestamptz,

  primary_contact_name              text,
  primary_contact_email             text,
  primary_contact_role              text,
  primary_contact_phone             text,

  how_heard_about_us                text,

  -- Identity & vision
  church_name_meaning               text,
  mission_vision_statement          text,
  service_terminology               text,
  defining_milestones               text,
  identity_phrase_or_verse          text,

  next_12_months_success            text,

  -- Audience
  typical_audience_description      text,
  online_audience_difference        text,
  ideal_in_person_experience        text,
  ideal_website_experience          text,
  best_outreach_methods             text,

  -- Voice & messaging
  audience_voice_style              text,
  current_voice_assessment          text,
  one_key_message                   text,
  desired_emotions                  text,
  words_tones_to_avoid              text,
  communication_tone_consistency    text,
  recurring_message_theme           text,

  -- Visual style scales (1–5)
  visual_simple_to_elevated         smallint CHECK (visual_simple_to_elevated BETWEEN 1 AND 5),
  visual_traditional_to_modern      smallint CHECK (visual_traditional_to_modern BETWEEN 1 AND 5),
  visual_timeless_to_trendy         smallint CHECK (visual_timeless_to_trendy BETWEEN 1 AND 5),
  visual_function_to_form           smallint CHECK (visual_function_to_form BETWEEN 1 AND 5),
  storytelling_literal_to_abstract  smallint CHECK (storytelling_literal_to_abstract BETWEEN 1 AND 5),

  -- Brand specifics
  brand_redesign_needs              text,
  font_preferences                  text,
  symbols_or_imagery                text,
  inspirational_brands              text,
  brands_to_avoid                   text,
  inspirational_websites            text,
  exceptional_communicators         text,
  branding_additional_notes         text,

  -- Web specifics
  current_website_url               text,
  current_website_platforms         text[],
  software_in_use                   text,
  google_business_claimed           text,
  website_redesign_needs            text,
  parts_to_refresh                  text[],
  website_comments                  text,
  copy_approach                     text,
  current_platform_satisfaction     text,
  weekly_maintenance_hours          text,
  top_website_priority              text,
  top_3_website_goals               text,
  current_navigation_satisfaction   smallint CHECK (current_navigation_satisfaction BETWEEN 1 AND 10),
  initial_web_support_preferences   text[],

  -- Social
  social_platforms                  text[],
  speaking_pastor_reference         text,
  social_scheduling_email           text,

  -- Video
  current_video_use                 text,
  desired_video_formats             text,
  storytelling_approach             text,
  video_communication_avoidances    text,
  produced_vs_authentic_preference  text,
  exemplary_video_moment            text,

  internal_decision_makers          text,

  -- Bible
  bible_translations                text[],
  deviates_from_primary_translation text,

  -- Forward-compat: full original payload (keyed by original question
  -- text). New questions live here until promoted to a typed column.
  raw_payload                       jsonb NOT NULL,
  -- Form / submission view / report URLs from the Airtable export.
  -- Shape: { web_hosting_details_form: url, submission_view: url, ... }.
  legacy_links                      jsonb,

  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_questionnaire_member
  ON strategy_discovery_questionnaire (member);
CREATE INDEX IF NOT EXISTS idx_discovery_questionnaire_submitted_at
  ON strategy_discovery_questionnaire (submitted_at DESC);
-- Partial unique index: lets multiple null submission_ids coexist
-- (e.g. legacy Airtable rows missing the field) while still enforcing
-- uniqueness for rows that have one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_questionnaire_submission_id
  ON strategy_discovery_questionnaire (submission_id)
  WHERE submission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS strategy_discovery_questionnaire_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL
    REFERENCES strategy_discovery_questionnaire(id) ON DELETE CASCADE,
  -- 'logo' | 'brand_guide' | 'submission_pdf' | 'other'
  file_kind        text NOT NULL,
  filename         text,
  -- Path within the 'discovery-questionnaire' Storage bucket. Null for
  -- legacy rows that haven't yet had their file copied out of Airtable.
  storage_path     text,
  -- Original Airtable/FillOut URL — kept for traceability + as a
  -- fallback while a row is mid-migration. Airtable signed URLs expire,
  -- so don't treat this as canonical.
  source_url       text,
  mime_type        text,
  size_bytes       bigint,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_files_questionnaire
  ON strategy_discovery_questionnaire_files (questionnaire_id);
CREATE INDEX IF NOT EXISTS idx_discovery_files_kind
  ON strategy_discovery_questionnaire_files (file_kind);

-- ── Trigger ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_strategy_discovery_questionnaire_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS strategy_discovery_questionnaire_set_updated_at
  ON strategy_discovery_questionnaire;
CREATE TRIGGER strategy_discovery_questionnaire_set_updated_at
  BEFORE UPDATE ON strategy_discovery_questionnaire
  FOR EACH ROW EXECUTE FUNCTION update_strategy_discovery_questionnaire_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE strategy_discovery_questionnaire ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_discovery_questionnaire_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read discovery questionnaires"
  ON strategy_discovery_questionnaire FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert discovery questionnaires"
  ON strategy_discovery_questionnaire FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update discovery questionnaires"
  ON strategy_discovery_questionnaire FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete discovery questionnaires"
  ON strategy_discovery_questionnaire FOR DELETE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read discovery questionnaire files"
  ON strategy_discovery_questionnaire_files FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert discovery questionnaire files"
  ON strategy_discovery_questionnaire_files FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update discovery questionnaire files"
  ON strategy_discovery_questionnaire_files FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete discovery questionnaire files"
  ON strategy_discovery_questionnaire_files FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ── Storage bucket (private) ─────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'discovery-questionnaire',
  'discovery-questionnaire',
  false,
  52428800,  -- 50 MB; logos sometimes arrive zipped
  ARRAY[
    'image/png','image/jpeg','image/svg+xml','image/webp','image/gif',
    'application/pdf',
    'application/zip','application/x-zip-compressed',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS — same staff-only pattern, scoped to this bucket.
CREATE POLICY "Authenticated users can read discovery files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'discovery-questionnaire' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can upload discovery files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'discovery-questionnaire' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can replace discovery files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'discovery-questionnaire' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete discovery files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'discovery-questionnaire' AND auth.uid() IS NOT NULL);
