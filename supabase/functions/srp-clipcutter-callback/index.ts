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

    // Look up the clipcutter_jobs row
    const { data: job, error: lookupError } = await supabase
      .schema("srp_pipeline")
      .from("clipcutter_jobs")
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
