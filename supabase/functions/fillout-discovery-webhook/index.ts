// fillout-discovery-webhook — receives FillOut form submissions
// directly and writes them into strategy_discovery_questionnaire.
//
// Replaces the FillOut → Airtable → Supabase chain that was prone to
// schema drift. Now: FillOut → this function → Supabase, single hop.
// Airtable can keep operating in parallel for staff who still use it,
// but is no longer the source of truth.
//
// Auth: configure FillOut to send a shared secret in the
// `x-webhook-secret` header. Set FILLOUT_WEBHOOK_SECRET in this
// function's secrets to match.
//
// Payload handling: FillOut posts submissions as a JSON object. We
// accept two shapes:
//   1. Native FillOut webhook format — { submission: { submissionId,
//      questions: [{ name, value, type, ... }] } }
//   2. Pre-flattened { "Question Name": "value", ... } — same shape
//      that Airtable used to relay into raw_payload.
// Either shape gets normalized to a flat label→value map, then mapped
// to our typed columns.
//
// Member linkage:
//   1. Match primary_contact_email against clickup_users.email →
//      clickup_users.account_id (= member number).
//   2. Fallback: case-insensitive church name match against
//      strategy_account_progress.church_name.
//   3. If neither hits, insert with member=NULL and
//      source='fillout_webhook_unmatched'. Staff resolves later.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  try {
    const expectedSecret = Deno.env.get("FILLOUT_WEBHOOK_SECRET");
    if (!expectedSecret) {
      console.error("[FillOut Webhook] FILLOUT_WEBHOOK_SECRET not configured");
      return j({ error: "Webhook secret not configured" }, 500);
    }
    const providedSecret = req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("secret");
    if (providedSecret !== expectedSecret) {
      console.warn("[FillOut Webhook] Invalid or missing secret");
      return j({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const payload = await req.json();
    const flat = normalizePayload(payload);

    // Log unmapped keys to make schema drift visible. Anything not in
    // KEY_MAP lands in raw_payload but doesn't get a typed column.
    const mapped = mapToColumns(flat);
    const unmappedKeys = Object.keys(flat).filter(k => !(k in KEY_MAP) && !SKIP_KEYS.has(k));
    if (unmappedKeys.length > 0) {
      console.warn(`[FillOut Webhook] Unmapped keys (will land only in raw_payload):`, unmappedKeys);
    }

    // Try to link to a member.
    const memberId = await resolveMember(supabase, mapped.primary_contact_email, flat["Church Name"] || flat["Church name"]);
    const source = memberId === null ? "fillout_webhook_unmatched" : "fillout_webhook";

    // Build the row.
    const submissionId = String(mapped.submission_id ?? flat["Submission ID"] ?? crypto.randomUUID());
    const submittedAt = parseDate(mapped.submitted_at ?? flat["Submission time"] ?? flat["Submission Date"]) ?? new Date().toISOString();

    const row = {
      ...mapped,
      member: memberId,
      submission_id: submissionId,
      source,
      submitted_at: submittedAt,
      raw_payload: flat,
    };

    // Idempotent SELECT-then-INSERT-or-UPDATE. PostgREST upsert needs a
    // real unique constraint, but submission_id has only a partial
    // unique index (WHERE submission_id IS NOT NULL) which onConflict
    // can't always target — so we route manually.
    const { data: existing, error: selErr } = await supabase
      .from("strategy_discovery_questionnaire")
      .select("id")
      .eq("submission_id", submissionId)
      .maybeSingle();
    if (selErr) {
      console.error("[FillOut Webhook] Select failed:", selErr);
      return j({ error: "Select failed", details: selErr.message, code: selErr.code, hint: selErr.hint }, 500);
    }

    let result;
    if (existing?.id) {
      // Fill-if-empty merge: only overwrite columns that are currently
      // null/empty on the existing row. Re-submissions and Sheet
      // backfills shouldn't clobber data the partner already provided.
      const { data: current } = await supabase
        .from("strategy_discovery_questionnaire")
        .select("*")
        .eq("id", existing.id)
        .single();
      const merged: Record<string, unknown> = {
        raw_payload: row.raw_payload,
        source: row.source,
      };
      for (const [col, val] of Object.entries(row)) {
        if (col === "id" || col === "raw_payload" || col === "source") continue;
        if (val === null || val === undefined || val === "") continue;
        const cur = current?.[col];
        const isEmpty = cur === null || cur === undefined || (typeof cur === "string" && cur.trim() === "") || (Array.isArray(cur) && cur.length === 0);
        if (isEmpty) merged[col] = val;
      }
      const { data, error } = await supabase
        .from("strategy_discovery_questionnaire")
        .update(merged)
        .eq("id", existing.id)
        .select("id, member, source")
        .single();
      if (error) {
        console.error("[FillOut Webhook] Update failed:", error, "row keys:", Object.keys(merged));
        return j({ error: "Update failed", details: error.message, code: error.code, hint: error.hint, failed_fields: Object.keys(merged) }, 500);
      }
      result = data;
    } else {
      const { data, error } = await supabase
        .from("strategy_discovery_questionnaire")
        .insert(row)
        .select("id, member, source")
        .single();
      if (error) {
        console.error("[FillOut Webhook] Insert failed:", error, "row keys:", Object.keys(row));
        return j({ error: "Insert failed", details: error.message, code: error.code, hint: error.hint, failed_fields: Object.keys(row) }, 500);
      }
      result = data;
    }

    console.log(`[FillOut Webhook] Stored submission ${submissionId} (member=${memberId ?? "unmatched"}, source=${source})`);
    return j({ ok: true, id: result.id, member: result.member, source: result.source, unmapped_keys: unmappedKeys }, 200);
  } catch (err) {
    const e = err as Error;
    console.error("[FillOut Webhook] Unhandled error:", e?.stack ?? e);
    return j({ error: "Unexpected", details: e?.message ?? String(err), stack: e?.stack }, 500);
  }
});

// ── Payload normalization ────────────────────────────────────────────

// FillOut native payload → flat { "Question Name": "value" } map.
// Handles both shapes (native and pre-flattened).
function normalizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;

  // Native FillOut shape: { submission: { questions: [{ name, value, ... }] } } or { submissionId, questions: [...] }
  const submission = (p.submission ?? p) as Record<string, unknown>;
  const questions = submission.questions as Array<Record<string, unknown>> | undefined;

  if (Array.isArray(questions)) {
    const out: Record<string, unknown> = {};
    if (submission.submissionId) out["Submission ID"] = submission.submissionId;
    if (submission.submissionTime) out["Submission time"] = submission.submissionTime;
    for (const q of questions) {
      const name = String(q.name ?? q.label ?? "").trim();
      if (!name) continue;
      out[name] = q.value ?? q.answer ?? null;
    }
    return out;
  }

  // Already flat — return as-is.
  return p;
}

// ── Column mapping ───────────────────────────────────────────────────

// Map FillOut question labels (as they appear in the form) to typed
// column names. New questions land in raw_payload only until added here.
const KEY_MAP: Record<string, string> = {
  // Identification
  "Submission ID":                 "submission_id",
  "Submission time":               "submitted_at",
  "Submission Date":               "submitted_at",
  // Contact
  "Primary Contact Name":          "primary_contact_name",
  "Primary Contact Role":          "primary_contact_role",
  "Best Email":                    "primary_contact_email",
  "Primary Contact Email":         "primary_contact_email",
  "Best Phone Number":             "primary_contact_phone",
  "Primary Contact Phone":         "primary_contact_phone",
  "How did you hear about Church Media Squad?": "how_heard_about_us",
  // Identity
  "What does your church’s name mean or reference?": "church_name_meaning",
  "Paste or write your church's current Mission/Vision statement.": "mission_vision_statement",
  "Paste or write your current Mission / Vision statement.": "mission_vision_statement",
  "How does your church refer to your services?": "service_terminology",
  "How do you refer to your services?": "service_terminology",
  "Name one or two milestones that helped define your church today.": "defining_milestones",
  "What three results would make the next 12 months a success?": "next_12_months_success",
  "Share a phrase, verse, or slogan that captures your church identity.": "identity_phrase_or_verse",
  "Share a phrase, verse, or slogan that captures your identity.": "identity_phrase_or_verse",
  // Website strategy
  "Website URL":                   "current_website_url",
  "What are you currently using to manage your website?": "current_website_platforms",
  "Please share what are you currently using to manage your website.": "software_in_use",
  "List the other tools to manage your website.": "software_in_use",
  "How do you feel about  ?":      "current_platform_satisfaction",
  "How do you feel about your current website platform?": "current_platform_satisfaction",
  "How much time does your team currently spend maintaining your website each week?": "weekly_maintenance_hours",
  " What pages or systems require the most frequent maintenance from your staff?": "high_maintenance_pages",
  "What pages or systems require the most frequent maintenance from your staff?": "high_maintenance_pages",
  "Whether you're keeping your website or redesigning it, your All-In plan includes several ways to support your church's current website. Let us know which options you’d like us to move forward with:": "initial_web_support_preferences",
  "Initial Web Support Preferences": "initial_web_support_preferences",
  "If you had to choose one priority for your website project, which is most important to you?": "top_website_priority",
  "What are the top 3 goals you want to accomplish with your website?": "top_3_website_goals",
  "Name a measurable win you’d like to see six months after launch.": "six_month_measurable_win",
  "How would you like us to approach the copy (written content) for your site?": "copy_approach",
  "If we use your current website content as a starting point, what areas need the most improvement? (Select all that apply)": "parts_to_refresh",
  "What parts of your current site would you like to refresh?": "parts_to_refresh",
  "On a scale of 1-10, how satisfied are you with your current website's overall structure and navigation?": "current_navigation_satisfaction",
  "List any software used for managing your events, small groups, or giving.": "software_in_use",
  "List the software you use for groups, giving, events, or communication.": "software_in_use",
  "Have you claimed your church's profile on Google (also called “Google My Business”)?": "google_business_claimed",
  "Does your church currently have your church claimed on Google My Business?": "google_business_claimed",
  "Any additional comments or context you'd like to share regarding your website?": "website_comments",
  "Website Comments":              "website_comments",
  "Church Website Redesign Needs": "website_redesign_needs",
  "Which of the following best describes what you want to accomplish with your website?": "website_redesign_needs",
  // Audience
  "Who is the typical person or family your church serves?": "typical_audience_description",
  "Who is the typical person or family you serve?": "typical_audience_description",
  "Does your online audience differ from the in-person crowd? How?": "online_audience_difference",
  "Describe the ideal experience newcomers should have (in person).": "ideal_in_person_experience",
  "Describe the ideal experience you want newcomers to have (in person).": "ideal_in_person_experience",
  "Describe the ideal experience new website visitors should have.": "ideal_website_experience",
  "Describe the ideal experience you want website visitors to have.": "ideal_website_experience",
  "Which outreach methods or events already connect best with your church community?": "best_outreach_methods",
  "Which outreach methods or events already connect best with your community?": "best_outreach_methods",
  "Do you speak to your audience like a friend, teacher, coach, or something else?": "audience_voice_style",
  // Inspiration
  "Link 1-3 brands/churches whose visual style or branding inspires you.": "inspirational_brands",
  "List any churches or brands you’d prefer not to resemble.": "brands_to_avoid",
  "Link 2 or more websites you really like. What do you like about them?": "inspirational_websites",
  "Link 2 or more websites you really like.": "inspirational_websites",
  "List 1-2 brands/churches you think do an exceptional job communicating their message.": "exceptional_communicators",
  "Please list any fonts or typography combinations you prefer.": "font_preferences",
  // Voice
  "How successful is your church's current voice, messaging, and position within your community?": "current_voice_assessment",
  "How do you feel about your current voice, messaging, and position within your community?": "current_voice_assessment",
  "If someone could remember one key message after encountering your church, what would it be?": "one_key_message",
  "What 2-3 emotions should someone feel after interacting with your church?": "desired_emotions",
  "If you could pick 2-3 emotions you would like to evoke from people when they interact with your church, what would it be?": "desired_emotions",
  "Are there words, tones, or topics your church intentionally avoids? Why?": "words_tones_to_avoid",
  "Are there words, tones, or topics you intentionally avoid? Why?": "words_tones_to_avoid",
  "How do you want your church to sound when communicating online, on stage, and on camera? How should each one be similar or different?": "communication_tone_consistency",
  "How do you want your church to sound and feel when communicating—online, on stage, and on camera? How should each one be similar or different?": "communication_tone_consistency",
  "Is there a recurring message or theme in your ministry that should shape how we approach storytelling, visually and emotionally?": "recurring_message_theme",
  "Is there a recurring message or theme in your ministry that should shape how we approach storytelling visually and emotionally?": "recurring_message_theme",
  // Social
  "Which social media platforms do you want us to post to?": "social_platforms",
  "List the other social media platform to post to.": "other_social_platforms",
  "List the other social media platforms to post to.": "other_social_platforms",
  "How does your church refer to the speaking pastor?": "speaking_pastor_reference",
  "How do you refer to the speaking pastor?": "speaking_pastor_reference",
  "What email should we use to connect your social media accounts to our scheduling platform?": "social_scheduling_email",
  "What email address do you want to use to connect your social media accounts to our scheduling platform?": "social_scheduling_email",
  "Does your church ever deviate to other translations as it fits?": "deviates_from_primary_translation",
  "Do you ever deviate to other translations as it fits?": "deviates_from_primary_translation",
  "Bible Translation":             "bible_translations",
  // Branding
  "Tell us about your branding redesign needs.": "brand_redesign_needs",
  "Brand Redesign Needs":          "brand_redesign_needs",
  "Please upload your current logo.": "logo_upload_url",
  "Logo":                          "logo_upload_url",
  "Please upload your current brand guide.": "brand_guide_upload_url",
  "Brand Guide":                   "brand_guide_upload_url",
  "Are there any ministries you’d like us to create branding for?": "ministry_subbrand_needs",
  "Will you need any ministry / sub-brand logos? Please list them.": "ministry_subbrand_needs",
  "Please list any symbols or imagery that feel uniquely “you.”": "symbols_or_imagery",
  "Provide a link to your photo library.": "photo_library_url",
  "Please leave any additional notes or feedback you have regarding your branding.": "branding_additional_notes",
  // Video
  "How does your church currently use video? What works well?": "current_video_use",
  "How do you currently use video? What works well?": "current_video_use",
  "What video project types would add the most value to your upcoming year?": "desired_video_formats",
  "Which video formats would add the most value this year?": "desired_video_formats",
  "What’s your approach to storytelling?": "storytelling_approach",
  "Are there communication habits or visual clichés your church tries to avoid in video? Why?": "video_communication_avoidances",
  "Are there communication habits or visual clichés you try to avoid in video? Why?": "video_communication_avoidances",
  "Does your church prefer your video style to feel “produced” or “authentic/raw”?": "produced_vs_authentic_preference",
  "Do you prefer your video style to feel “produced” or “authentic/raw”?": "produced_vs_authentic_preference",
  "What’s one moment from a past video or Sunday experience that felt exactly right for your church? What made it work?": "exemplary_video_moment",
  "What’s one moment from a past video or Sunday experience that felt exactly right to you? What made it work?": "exemplary_video_moment",
  // Style sliders
  "How simple vs. intricate should your visuals feel (Simple ⇄ Intricate)?": "visual_simple_to_intricate",
  "How elevated vs. simple should your visuals feel (Simple ⇄ Elevated)?":   "visual_simple_to_intricate",
  "Where do you sit between Classic ⇄ Modern?":           "visual_classic_to_modern",
  "Where do you sit between Traditional ⇄ Modern?":       "visual_classic_to_modern",
  "Where do you sit between Timeless ⇄ Trendy?":          "visual_timeless_to_trendy",
  "Do you lean toward Function-First ⇄ Form-First?":      "visual_function_to_form",
  "Storytelling style: Literal ⇄ Abstract / Conceptual":  "storytelling_literal_to_abstract",
  "Is there any additional creative style direction that would be helpful for your Creative Director to know?": "additional_creative_direction",
  "Add additional creative style direction helpful for Creative Director.": "additional_creative_direction",
  // Decision makers + timing
  "Internal Decision Makers":      "internal_decision_makers",
  "List all internal decision makers (1)": "internal_decision_makers",
  "Are there any upcoming events, seasons, or ideal timeframes you’re hoping to align any projects with?": "timeframe_alignment",
  "Are there any key events or recurring days when your team is unavailable?": "blackout_dates",
  "Discovery Call Booking":        "discovery_call_booking",
  "Cohort":                        "cohort",
};

// Keys we deliberately ignore (admin/UI/internal — not survey data).
const SKIP_KEYS = new Set([
  "Account",
  "Account (for Automation)",
  " Account PT",
  "Account PT",
  "Church Name Rollup (from Account)",
  "Church name",
  "Church Name",
  "Created",
  "Member Number",
  "Record ID",
  "Submission Link",
  "Submission View",
  "Payload",
  "PDF",
  "Update Photos & Files",
  "Review Button",
  "🔑 Form Activity Log",
  "🟡 Initial Web Support Report 🟡",
  "🔵 Web Hosting Details Form 🔵",
  "id",
  "am",
  "editing",
  "Cover text",
  "Discovery Call Assignee",
  "Submit without discovery call",
  "Full Name (Discovery Call)",
  "Email (Discovery Call)",
  "Event Start Time - Calendly",
  "Event End Time - Calendly",
  "Event Uuid - Calendly",
]);

// Columns that store arrays — split string responses on common delimiters.
const ARRAY_COLUMNS = new Set([
  "current_website_platforms",
  "parts_to_refresh",
  "initial_web_support_preferences",
  "social_platforms",
  "bible_translations",
]);

// Columns that store small integers (1-10 scales).
const NUMERIC_COLUMNS = new Set([
  "visual_simple_to_intricate",
  "visual_classic_to_modern",
  "visual_timeless_to_trendy",
  "visual_function_to_form",
  "storytelling_literal_to_abstract",
  "current_navigation_satisfaction",
]);

function mapToColumns(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const col = KEY_MAP[key];
    if (!col) continue;
    if (value === null || value === undefined || value === "") continue;
    out[col] = coerceValue(col, value);
  }
  return out;
}

function coerceValue(col: string, raw: unknown): unknown {
  if (ARRAY_COLUMNS.has(col)) {
    if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
    if (typeof raw === "string") {
      return raw.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    }
    return null;
  }
  if (NUMERIC_COLUMNS.has(col)) {
    const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (col === "logo_upload_url" || col === "brand_guide_upload_url") {
    // FillOut may send "filename (url)" or an array of file objects.
    if (Array.isArray(raw)) {
      const first = raw[0];
      if (typeof first === "string") return extractUrl(first);
      if (first && typeof first === "object" && "url" in first) return String((first as Record<string, unknown>).url);
    }
    if (typeof raw === "string") return extractUrl(raw);
    return null;
  }
  if (col === "submitted_at" || col === "discovery_call_booking") {
    return parseDate(raw);
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return JSON.stringify(raw);
}

function extractUrl(s: string): string {
  const match = s.match(/\((https?:\/\/[^)]+)\)/);
  return match ? match[1] : s;
}

function parseDate(raw: unknown): string | null {
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Member linkage ───────────────────────────────────────────────────

async function resolveMember(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  email: unknown,
  churchName: unknown,
): Promise<number | null> {
  if (email && typeof email === "string") {
    const { data } = await supabase
      .from("clickup_users")
      .select("account_id")
      .ilike("email", email.trim())
      .not("account_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (data?.account_id) return Number(data.account_id);
  }
  if (churchName && typeof churchName === "string") {
    const { data } = await supabase
      .from("strategy_account_progress")
      .select("member")
      .ilike("church_name", churchName.trim())
      .limit(1)
      .maybeSingle();
    if (data?.member) return Number(data.member);
  }
  return null;
}

function j(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
