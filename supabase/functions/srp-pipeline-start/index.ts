// srp-pipeline-start — Supabase Edge Function
//
// Triggered by srp-hub-cache-refresh for each new this-week SRP task.
// Checks if a session already exists; if not, fetches the video URL
// from ClickUp, creates a background session, and starts transcription.
//
// POST { taskId: string, member: number, churchName: string }
// → { session_id, pipeline_status } or { skipped: true }
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//          CLICKUP_STRATEGY_MILESTONE_TOKEN (or CLICKUP_API_KEY)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Custom field names that likely contain the video URL
const VIDEO_FIELD_KEYS = ["publicly", "shared link", "video url", "video link"];

function detectSourceType(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "youtube.com" || host === "www.youtube.com" || host === "youtu.be" || host === "m.youtube.com") return "youtube";
    if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") return "vimeo";
    if (host === "dropbox.com" || host === "www.dropbox.com" || host.endsWith(".dropbox.com")) return "dropbox";
    if (host === "drive.google.com" || host === "docs.google.com") return "google_drive";
  } catch { /* ignore */ }
  return "unknown";
}

const VIDEO_URL_PATTERN =
  /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/|(?:www\.)?vimeo\.com\/(?:video\/)?\d|(?:www\.)?dropbox\.com\/|drive\.google\.com\/file\/)[^\s"'<>]*/gi;

async function fetchVideoUrl(taskId: string, clickupToken: string): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);

  let task: Record<string, unknown> | null = null;
  let comments: Array<{ comment_text?: string; comment?: unknown[] }> = [];

  try {
    const [taskRes, commentsRes] = await Promise.all([
      fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
        headers: { Authorization: clickupToken },
        signal: ac.signal,
      }),
      fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, {
        headers: { Authorization: clickupToken },
        signal: ac.signal,
      }),
    ]);
    if (taskRes.ok) task = await taskRes.json();
    if (commentsRes.ok) {
      const cd = await commentsRes.json();
      comments = cd.comments ?? [];
    }
  } finally {
    clearTimeout(timer);
  }

  if (!task) return null;

  // 1. Custom fields
  const customFields: Array<{ name?: string; value?: unknown }> = (task.custom_fields as typeof customFields) ?? [];
  for (const field of customFields) {
    const name = (field.name ?? "").toLowerCase();
    if (VIDEO_FIELD_KEYS.some(k => name.includes(k))) {
      const val = field.value;
      if (typeof val === "string" && val.trim()) return val.trim();
    }
  }

  // 2. Description
  const desc = (task.description as string) ?? "";
  VIDEO_URL_PATTERN.lastIndex = 0;
  const descMatch = VIDEO_URL_PATTERN.exec(desc);
  if (descMatch) return descMatch[0].replace(/[.,;)]+$/, "");

  // 3. Comments — upload-portal pattern first, then plain URL scan
  for (const comment of comments) {
    const text = comment.comment_text ?? "";
    if (text.includes("uploaded video file") || text.includes("🎥")) {
      const blocks: Array<{ attributes?: { link?: string }; items?: Array<{ attributes?: { link?: string } }> }> =
        (comment.comment as typeof blocks) ?? [];
      for (const block of blocks) {
        if (block.attributes?.link) return block.attributes.link;
        for (const item of (block.items ?? [])) {
          if (item.attributes?.link) return item.attributes.link;
        }
      }
    }
    VIDEO_URL_PATTERN.lastIndex = 0;
    const m = VIDEO_URL_PATTERN.exec(text);
    if (m) return m[0].replace(/[.,;)]+$/, "");
  }

  return null;
}

function makeSessionId(member: number, churchName: string): string {
  const slug = churchName.replace(/[^A-Za-z0-9]/g, "");
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${member}_${slug}_${ts}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const clickupToken = Deno.env.get("CLICKUP_STRATEGY_MILESTONE_TOKEN") ?? Deno.env.get("CLICKUP_API_KEY") ?? "";

  if (!clickupToken) return json({ error: "No ClickUp token configured" }, 500);

  let body: { taskId?: string; member?: number; churchName?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { taskId, member, churchName } = body;
  if (!taskId || !member || !churchName) {
    return json({ error: "Missing taskId, member, or churchName" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Verify task status directly from ClickUp before doing anything.
  // Only proceed for "dependent" or "received" — skip closed or any other status.
  const ELIGIBLE_STATUSES = new Set(["dependent", "received"]);
  try {
    const taskCheck = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
      headers: { Authorization: clickupToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (taskCheck.ok) {
      const taskData = await taskCheck.json();
      const taskStatus = (taskData.status?.status ?? "").toLowerCase().trim();
      if (!ELIGIBLE_STATUSES.has(taskStatus)) {
        return json({ skipped: true, reason: "ineligible_status", status: taskStatus });
      }
    }
  } catch { /* if the check fails, proceed cautiously — pipeline-start will surface any real errors */ }

  // Skip if a session for this task already exists (any non-archived status)
  const { data: existing } = await supabase
    .schema("srp_pipeline")
    .from("sessions")
    .select("session_id, pipeline_status, status")
    .eq("clickup_task_id", taskId)
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();

  if (existing) {
    return json({ skipped: true, reason: "session_exists", session_id: existing.session_id });
  }

  // Create session immediately (prevents duplicate creation from concurrent runs)
  const session_id = makeSessionId(member, churchName);
  const { error: createErr } = await supabase
    .schema("srp_pipeline")
    .from("sessions")
    .insert({
      session_id,
      member,
      church_name:     churchName,
      current_step:    "account",
      status:          "background",
      clickup_task_id: taskId,
      clickup_url:     `https://app.clickup.com/t/${taskId}`,
      pipeline_status: "pending",
    });

  if (createErr) {
    console.error("[srp-pipeline-start] create session failed:", createErr.message);
    return json({ error: createErr.message }, 500);
  }

  // Fetch video URL from ClickUp (async, doesn't block the response)
  const work = (async () => {
    let videoUrl: string | null = null;
    try {
      videoUrl = await fetchVideoUrl(taskId, clickupToken);
    } catch (e) {
      console.error("[srp-pipeline-start] fetchVideoUrl error:", e);
    }

    if (!videoUrl) {
      await supabase
        .schema("srp_pipeline")
        .from("sessions")
        .update({ pipeline_status: "error", pipeline_error: "no_video_url" })
        .eq("session_id", session_id);
      console.log(`[srp-pipeline-start] ${session_id}: no video URL found for task ${taskId}`);
      return;
    }

    await supabase
      .schema("srp_pipeline")
      .from("sessions")
      .update({ video_url: videoUrl })
      .eq("session_id", session_id);

    const sourceType = detectSourceType(videoUrl);

    // Kick off transcription
    const transcribeRes = await fetch(`${supabaseUrl}/functions/v1/srp-start-transcription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
      body: JSON.stringify({ session_id, source_url: videoUrl, source_type: sourceType }),
    });

    if (!transcribeRes.ok) {
      const errText = await transcribeRes.text().catch(() => "");
      console.error("[srp-pipeline-start] transcription start failed:", errText);
      await supabase
        .schema("srp_pipeline")
        .from("sessions")
        .update({
          pipeline_status: "error",
          pipeline_error:  `transcription_start_failed: ${errText.slice(0, 200)}`,
        })
        .eq("session_id", session_id);
    } else {
      console.log(`[srp-pipeline-start] ${session_id}: transcription started for task ${taskId}`);
    }
  })();

  try {
    // @ts-expect-error EdgeRuntime available in Supabase Edge Functions
    EdgeRuntime.waitUntil(work);
  } catch {
    await work; // local dev fallback
  }

  return json({ session_id, pipeline_status: "pending" });
});
