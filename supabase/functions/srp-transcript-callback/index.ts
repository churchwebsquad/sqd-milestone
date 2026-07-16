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
      transcript,
      words,
      duration_seconds,
      engine,
      error_message,
    } = body;

    // Validate callback_secret. Accept the shared secret from EITHER the
    // Authorization: Bearer header OR the callback_secret body field — kept
    // in sync with srp-clipcutter-callback so n8n configs can use whichever
    // is more convenient without auth flip-flopping between the two pipelines.
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

    // Look up the transcript_jobs row
    const { data: job, error: lookupError } = await supabase
      .schema("srp_pipeline")
      .from("transcript_jobs")
      .select("id, session_id, status")
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

    // Build update object for transcript_jobs with only provided fields
    const jobUpdate: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status_message !== undefined) jobUpdate.status_message = status_message;
    if (progress_percent !== undefined) jobUpdate.progress_percent = progress_percent;
    if (transcript !== undefined) jobUpdate.transcript = transcript;
    if (words !== undefined) jobUpdate.words = words;
    if (duration_seconds !== undefined) jobUpdate.duration_seconds = duration_seconds;
    if (engine !== undefined) jobUpdate.transcription_engine = engine;
    if (error_message !== undefined) jobUpdate.error_message = error_message;

    // Set completed_at if terminal status
    if (status === "completed" || status === "failed") {
      jobUpdate.completed_at = new Date().toISOString();
      jobUpdate.progress_percent = status === "completed" ? 100 : jobUpdate.progress_percent;
    }

    // Update transcript_jobs row
    const { error: updateError } = await supabase
      .schema("srp_pipeline")
      .from("transcript_jobs")
      .update(jobUpdate)
      .eq("id", job_id);

    if (updateError) {
      console.error("Failed to update transcript_jobs:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update job", details: updateError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Updated job ${job_id} to status: ${status}`);

    // If completed, also update the parent session with transcript data
    if (status === "completed" && job.session_id) {
      const sessionUpdate: Record<string, unknown> = {
        has_timecodes: true,
        updated_at: new Date().toISOString(),
      };

      if (transcript !== undefined) sessionUpdate.transcript = transcript;
      if (words !== undefined) sessionUpdate.transcript_words = words;

      // Advance pipeline_status from 'pending' → 'transcribed' for background sessions
      sessionUpdate.pipeline_status = "transcribed";

      const { error: sessionError } = await supabase
        .schema("srp_pipeline")
        .from("sessions")
        .update(sessionUpdate)
        .eq("session_id", job.session_id);

      if (sessionError) {
        console.error("Failed to update session:", sessionError);
        // Non-fatal — the job update already succeeded
      } else {
        console.log(`Updated session ${job.session_id} with transcript data`);

        // Pre-generate overview + drafts on the background session so they're
        // ready before a coach ever opens it. Fire-and-forget.
        const appUrl = Deno.env.get("APP_URL") ?? "";
        if (appUrl) {
          const pregenWork = fetch(`${appUrl}/api/srp/auto-generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: job.session_id }),
          }).then(r => {
            if (!r.ok) console.error(`[srp-transcript-callback] auto-generate returned ${r.status}`);
            else console.log(`[srp-transcript-callback] auto-generate started for ${job.session_id}`);
          }).catch(e => console.error("[srp-transcript-callback] auto-generate failed:", e));

          try {
            // @ts-expect-error EdgeRuntime available in Supabase Edge Functions
            EdgeRuntime.waitUntil(pregenWork);
          } catch {
            await pregenWork;
          }
        }
      }
    }

    // If failed, mark pipeline as errored (only affects background sessions)
    if (status === "failed" && job.session_id) {
      await supabase
        .schema("srp_pipeline")
        .from("sessions")
        .update({
          pipeline_status: "error",
          pipeline_error:  error_message?.slice(0, 400) ?? "transcription_failed",
          updated_at:      new Date().toISOString(),
        })
        .eq("session_id", job.session_id)
        .eq("pipeline_status", "pending"); // only touch background sessions
    }

    return new Response(
      JSON.stringify({ success: true, job_id, status }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("srp-transcript-callback error:", err);
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
