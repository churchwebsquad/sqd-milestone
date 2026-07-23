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
      job_id,
      callback_secret,
      status,
      status_message,
      progress_percent,
      clip_results,
      clips,
      error_message,
    } = body;

    // Accept secret from either Authorization: Bearer header or callback_secret body field
    const expectedSecret = Deno.env.get("SRP_TOOL_N8N_CALLBACK_SECRET");
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const providedSecret = bearerSecret || callback_secret;
    if (!expectedSecret || providedSecret !== expectedSecret) {
      console.error("Invalid callback_secret (header or body)");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate job_id
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: "Missing required field: job_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate status
    if (!status) {
      return new Response(
        JSON.stringify({ error: "Missing required field: status" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up the clipcutter_jobs row — include stored clips so we can
    // reverse-map clip_name → clip_id for processed_clips updates.
    const { data: job, error: lookupError } = await supabase
      .schema("srp_pipeline")
      .from("clipcutter_jobs")
      .select("id, session_id, status, clips")
      .eq("id", job_id)
      .single();

    if (lookupError || !job) {
      console.error("Job not found:", job_id, lookupError);
      return new Response(
        JSON.stringify({ error: `Job not found: ${job_id}` }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build update object for clipcutter_jobs with only provided fields
    const jobUpdate: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status_message !== undefined) jobUpdate.status_message = status_message;
    if (progress_percent !== undefined) jobUpdate.progress_percent = progress_percent;
    // Accept either clip_results or clips as the field name
    const resolvedClips = clip_results !== undefined ? clip_results : clips;
    if (resolvedClips !== undefined) jobUpdate.clip_results = resolvedClips;
    if (error_message !== undefined) jobUpdate.error_message = error_message;

    // Set completed_at and progress if terminal status
    if (status === "completed" || status === "failed") {
      jobUpdate.completed_at = new Date().toISOString();
      if (status === "completed") {
        jobUpdate.progress_percent = 100;
      }
    }

    // Update clipcutter_jobs row
    const { error: updateError } = await supabase
      .schema("srp_pipeline")
      .from("clipcutter_jobs")
      .update(jobUpdate)
      .eq("id", job_id);

    if (updateError) {
      console.error("Failed to update clipcutter_jobs:", updateError);
      return new Response(
        JSON.stringify({
          error: "Failed to update job",
          details: updateError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Updated clipcutter job ${job_id} to status: ${status}`);

    // Update processed_clips rows for each clip in the result.
    // n8n identifies clips by clip_name (not clip_id). We stored the mapping
    // in clipcutter_jobs.clips when the job was created — use that to resolve
    // the clip_id for each result, falling back to array order if clip_name
    // is missing from the response.
    // The clipcutter never transcribes — no transcript/srt in results.
    const storedClips: Array<{ clip_id?: string; clip_name?: string }> =
      Array.isArray(job?.clips) ? job.clips : [];

    if (status === "completed" && resolvedClips?.length > 0) {
      for (let i = 0; i < resolvedClips.length; i++) {
        const result = resolvedClips[i];
        if (!result?.video_url) continue;

        // Resolve clip_id: match by clip_name first, then fall back to order.
        const matchedStored = result.clip_name
          ? storedClips.find((sc) => sc.clip_name === result.clip_name)
          : storedClips[i];
        const clipId = matchedStored?.clip_id;

        const pcUpdate = {
          status: "ready",
          video_url: result.video_url,
          transcript: null, // clipcutter does not transcribe
          duration_ms: result.duration_ms ?? null,
          error_message: null,
          updated_at: new Date().toISOString(),
        };

        let pcError;
        if (clipId) {
          // Prefer clip_id match — most precise
          ({ error: pcError } = await supabase
            .schema("srp_pipeline")
            .from("processed_clips")
            .update(pcUpdate)
            .eq("session_id", job.session_id)
            .eq("clip_id", clipId));
        } else {
          // Fall back to job-level match (single-clip renders)
          ({ error: pcError } = await supabase
            .schema("srp_pipeline")
            .from("processed_clips")
            .update(pcUpdate)
            .eq("clipcutter_job_id", job_id));
        }

        if (pcError) {
          console.error(`Failed to update processed_clips for clip ${clipId ?? i}:`, pcError);
        } else {
          console.log(`processed_clips ready: clip_id=${clipId ?? "order-" + i} job=${job_id}`);
        }
      }
    } else if (status === "failed") {
      await supabase
        .schema("srp_pipeline")
        .from("processed_clips")
        .update({
          status: "error",
          error_message: error_message ?? "Render failed",
          updated_at: new Date().toISOString(),
        })
        .eq("clipcutter_job_id", job_id);
    }

    // On terminal statuses, update the parent session's clip_processing_status
    if ((status === "completed" || status === "failed") && job.session_id) {
      const { error: sessionError } = await supabase
        .schema("srp_pipeline")
        .from("sessions")
        .update({
          clip_processing_status: status,
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", job.session_id);

      if (sessionError) {
        console.error("Failed to update session clip_processing_status:", sessionError);
        // Non-fatal — the job update already succeeded
      } else {
        console.log(`Updated session ${job.session_id} clip_processing_status to ${status}`);
      }
    }

    // When render completes, fire the n8n ClickUp webhook so the SRP Video task
    // gets a "reels are ready" message automatically (mirrors VidDrop's caption-render-callback).
    if (status === "completed" && job.session_id && resolvedClips?.length > 0) {
      try {
        // Fetch session for clickup_task_id, member, church_name, srp_task_id_override
        const { data: sess } = await supabase
          .schema("srp_pipeline")
          .from("sessions")
          .select("clickup_task_id, member, church_name, srp_task_id_override")
          .eq("session_id", job.session_id)
          .maybeSingle();

        if (sess?.clickup_task_id) {
          const storedClipsForNotify: Array<{ clip_id?: string; clip_name?: string }> =
            Array.isArray(job?.clips) ? job.clips : [];

          // Build clip list for n8n — match clip_name from stored job clips
          const notifyClips = resolvedClips
            .filter((r: { video_url?: string }) => r?.video_url)
            .map((r: { clip_id?: string; clip_name?: string; video_url?: string; duration_ms?: number }, i: number) => {
              const matchedStored = r.clip_name
                ? storedClipsForNotify.find((sc) => sc.clip_name === r.clip_name)
                : storedClipsForNotify[i];
              return {
                clip_name: matchedStored?.clip_name ?? r.clip_name ?? `Reel ${i + 1}`,
                video_url: r.video_url!,
                transcript: "",
                srt_transcript: null,
                duration_seconds: r.duration_ms ? Math.round(r.duration_ms / 1000) : null,
              };
            });

          if (notifyClips.length > 0) {
            const n8nWebhookUrl =
              "https://vid2.thesqd.com/webhook/38a7fb68-d23f-4711-b903-ede558e45332/clip_to_clickup";
            const callbackSecret = Deno.env.get("SRP_TOOL_N8N_CALLBACK_SECRET") || "";
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

            await fetch(n8nWebhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                job_id: crypto.randomUUID(),
                clickup_id: sess.clickup_task_id,
                action: "render_complete",
                clips: notifyClips,
                session_id: job.session_id,
                member: sess.member ?? null,
                church_name: sess.church_name ?? null,
                srp_task_id_override: sess.srp_task_id_override ?? null,
                callback_url: `${supabaseUrl}/functions/v1/srp-clickup-callback`,
                callback_secret: callbackSecret,
              }),
            });
            console.log(`Fired n8n ClickUp webhook for session ${job.session_id} with ${notifyClips.length} clips`);
          }
        }
      } catch (notifyErr) {
        // Non-fatal — render is already complete; ClickUp message is best-effort
        console.error("Failed to fire ClickUp render-complete webhook:", notifyErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, job_id, status }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("srp-clipcutter-callback error:", err);
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
