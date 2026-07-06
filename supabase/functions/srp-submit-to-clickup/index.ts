import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      session_id,
      member,
      church_name,
      clickup_id: clickup_id_in,
      creative_direction: cd_in,
      creative_direction_name: cdn_in,
      designer_notes: dn_in,
      background_music: bgm_in,
      approved_content,
      srp_task_id_override,
    } = body;
    // Accept either `clips` (legacy) or `edited_clips` (new Step 7 editor)
    const clips = body.edited_clips || body.clips;

    // ── Supabase client (service role) ────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Backfill fields from clipcutter_jobs if the caller didn't supply them
    // (Step 7 editor only sends clip/session info; creative_direction,
    // designer_notes, background_music, and clickup_id live on the job row.)
    let clickup_id = clickup_id_in;
    let creative_direction = cd_in;
    let creative_direction_name = cdn_in;
    let designer_notes = dn_in;
    let background_music = bgm_in;
    if (session_id && (!clickup_id || !creative_direction)) {
      const { data: sess } = await supabase
        .schema("srp_pipeline")
        .from("sessions")
        .select("clickup_task_id, clipcutter_job_id")
        .eq("session_id", session_id)
        .maybeSingle();
      if (sess?.clickup_task_id && !clickup_id) clickup_id = sess.clickup_task_id;

      if (sess?.clipcutter_job_id) {
        const { data: job } = await supabase
          .schema("srp_pipeline")
          .from("clipcutter_jobs")
          .select("creative_direction")
          .eq("id", sess.clipcutter_job_id)
          .maybeSingle();
        const cd = (job?.creative_direction || {}) as Record<string, unknown>;
        if (!creative_direction) creative_direction = cd.srp_template || null;
        if (!creative_direction_name) creative_direction_name = cd.srp_template || null;
        if (designer_notes === undefined) designer_notes = cd.designer_notes ?? "";
        if (background_music === undefined) background_music = cd.background_music ?? false;
      }
    }

    // ── Validate required fields ──────────────────────────────────────
    const missing: string[] = [];
    if (!session_id) missing.push("session_id");
    if (!clickup_id) missing.push("clickup_id");
    if (!clips || !Array.isArray(clips) || clips.length === 0)
      missing.push("clips");

    if (missing.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Missing required fields: ${missing.join(", ")}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate each clip has at minimum clip_name and video_url
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if (!clip.clip_name || !clip.video_url) {
        return new Response(
          JSON.stringify({
            error: `clips[${i}] is missing required fields (clip_name, video_url)`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // ── Generate job_id ───────────────────────────────────────────────
    const job_id = crypto.randomUUID();

    // ── Build callback info for n8n ───────────────────────────────────
    const callbackUrl = `${supabaseUrl}/functions/v1/srp-clickup-callback`;
    const callbackSecret =
      Deno.env.get("SRP_TOOL_N8N_CALLBACK_SECRET") || "";

    // ── Build webhook payload ─────────────────────────────────────────
    // Matches the "Send Clips to ClickUp" n8n workflow format from VidDrop v1,
    // extended with srp_pipeline fields (session_id, member, church_name,
    // approved_content). See Docs/webhook-payload-examples.md section 3.
    const webhookPayload = {
      // Core fields the existing n8n ClickUp workflow expects
      job_id,
      clickup_id,
      action: "update_transcripts",
      creative_direction: creative_direction || null,
      creative_direction_name: creative_direction_name || null,
      designer_notes: (designer_notes || "").trim(),
      background_music: background_music ?? false,
      clips: clips.map(
        (c: {
          clip_name: string;
          transcript?: string;
          srt_transcript?: string;
          video_url: string;
          duration_seconds?: number;
        }) => ({
          clip_name: c.clip_name,
          transcript: c.transcript || "",
          srt_transcript: c.srt_transcript || null,
          video_url: c.video_url,
          duration_seconds: c.duration_seconds || null,
        })
      ),
      // srp_pipeline extensions
      session_id,
      member: member || null,
      church_name: church_name || null,
      approved_content: approved_content || null,
      // Manual override: if set, n8n skips the dependency lookup and posts
      // directly to this task ID (used when auto-resolve fails and the coach
      // pastes the SRP Video task ID).
      srp_task_id_override: srp_task_id_override || null,
      // Callback for n8n to report success/failure back to Supabase
      callback_url: callbackUrl,
      callback_secret: callbackSecret,
    };

    // ── Set session status to "submitting" ────────────────────────────
    const { error: submittingError } = await supabase
      .schema("srp_pipeline")
      .from("sessions")
      .update({
        status: "submitting",
        clickup_task_id: clickup_id,
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", session_id);

    if (submittingError) {
      console.error(
        "Failed to update session status to submitting:",
        submittingError
      );
      // Non-fatal — continue with the webhook
    }

    // ── Fire webhook to n8n "Send Clips to ClickUp" workflow ──────────
    // Webhook path from the VidDrop v1 "Send Clips to ClickUp" workflow
    // (webhookId: 38a7fb68-d23f-4711-b903-ede558e45332, path: clip_to_clickup)
    const n8nWebhookUrl =
      "https://vid2.thesqd.com/webhook/38a7fb68-d23f-4711-b903-ede558e45332/clip_to_clickup";

    console.log(
      `[srp-submit-to-clickup] Sending ClickUp submission for job ${job_id}, session ${session_id}, clickup ${clickup_id}`
    );

    // Hoisted so the success path (after the try/catch) can read them.
    let targetTaskId: string | null = null;
    let targetTaskUrl: string | null = null;
    let resolvedVia: string | null = null;

    try {
      const webhookResponse = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      });

      // Inspect the webhook body — n8n returns its lastNode JSON. The error
      // path emits { error_code: "no_blocker_dependency", ... } which we
      // surface to the frontend so it can prompt for a manual override.
      const responseText = await webhookResponse.text();
      let parsed: Record<string, unknown> | null = null;
      try { parsed = responseText ? JSON.parse(responseText) : null; } catch { /* not JSON */ }

      // Surface the resolved task info on success so the frontend can show
      // a clickable confirmation link.
      if (parsed && typeof parsed.target_task_id === "string") targetTaskId = parsed.target_task_id;
      if (parsed && typeof parsed.target_task_url === "string") targetTaskUrl = parsed.target_task_url;
      if (parsed && typeof parsed.resolved_via === "string") resolvedVia = parsed.resolved_via;

      const errorCode = parsed && typeof parsed.error_code === "string" ? parsed.error_code : null;
      if (errorCode === "no_blocker_dependency") {
        console.log(`[srp-submit-to-clickup] n8n could not resolve blocker for ${clickup_id}`);
        // Don't mark session as submit_failed — the coach is going to retry with an override
        await supabase
          .schema("srp_pipeline")
          .from("sessions")
          .update({ status: "in_progress", updated_at: new Date().toISOString() })
          .eq("session_id", session_id);
        return new Response(
          JSON.stringify({
            job_id,
            success: false,
            error_code: "no_blocker_dependency",
            error: "Could not auto-resolve the SRP Video task. Provide it manually.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!webhookResponse.ok) {
        console.error(
          `n8n ClickUp webhook failed: ${webhookResponse.status} — ${responseText}`
        );

        // Revert session status to indicate failure
        await supabase
          .schema("srp_pipeline")
          .from("sessions")
          .update({
            status: "submit_failed",
            updated_at: new Date().toISOString(),
          })
          .eq("session_id", session_id);

        return new Response(
          JSON.stringify({
            job_id,
            success: false,
            error: `n8n webhook failed with status ${webhookResponse.status}`,
          }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      console.log(
        `[srp-submit-to-clickup] n8n webhook accepted for job ${job_id}`
      );
    } catch (webhookError) {
      console.error("n8n ClickUp webhook request failed:", webhookError);

      // Revert session status to indicate failure
      await supabase
        .schema("srp_pipeline")
        .from("sessions")
        .update({
          status: "submit_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", session_id);

      return new Response(
        JSON.stringify({
          job_id,
          success: false,
          error: "Failed to reach n8n ClickUp submission service",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Mark session as completed + persist the resolved ClickUp URL ──
    const { error: completeError } = await supabase
      .schema("srp_pipeline")
      .from("sessions")
      .update({
        status: "completed",
        clickup_url: targetTaskUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", session_id);

    if (completeError) {
      console.error(
        "Failed to update session status to completed:",
        completeError
      );
      // Non-fatal — the webhook already fired successfully
    } else {
      console.log(
        `[srp-submit-to-clickup] Session ${session_id} marked as completed; target=${targetTaskId}`
      );
    }

    // ── Return success ────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        job_id,
        target_task_id: targetTaskId,
        target_task_url: targetTaskUrl,
        resolved_via: resolvedVia,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("srp-submit-to-clickup error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
