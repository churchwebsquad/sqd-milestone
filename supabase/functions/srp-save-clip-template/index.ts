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
    const {
      member,
      srp_template,
      background_music,
      designer_notes,
      template_name,
    } = await req.json();

    // Validate required field
    if (!member) {
      return new Response(
        JSON.stringify({ error: "Missing required field: member" }),
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

    // Build the upsert payload
    const upsertData: Record<string, unknown> = {
      member,
      template_name: template_name || "Default",
      updated_at: new Date().toISOString(),
    };

    if (srp_template !== undefined) upsertData.srp_template = srp_template;
    if (background_music !== undefined) upsertData.background_music = background_music;
    if (designer_notes !== undefined) upsertData.designer_notes = designer_notes;

    // Upsert into clip_templates — match on (member, template_name) unique constraint
    const { data, error: upsertError } = await supabase
      .schema("srp_pipeline")
      .from("clip_templates")
      .upsert(upsertData, {
        onConflict: "member,template_name",
      })
      .select()
      .single();

    if (upsertError) {
      console.error("Failed to upsert clip_templates:", upsertError);
      return new Response(
        JSON.stringify({
          error: "Failed to save clip template",
          details: upsertError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Saved clip template for member ${member}, template "${template_name || "Default"}"`);

    return new Response(
      JSON.stringify({ success: true, template: data }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("srp-save-clip-template error:", err);
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
