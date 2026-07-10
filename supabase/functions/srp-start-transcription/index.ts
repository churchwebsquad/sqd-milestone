import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Inline media URL validator (keep in sync with src/lib/mediaUrlValidator.ts) ──
const ARCHIVE_EXTS = [".zip", ".rar", ".7z", ".tar", ".tar.gz", ".tgz", ".gz"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".heic", ".heif", ".webp", ".bmp", ".tiff", ".tif", ".svg"];
const DOC_EXTS = [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".txt", ".rtf"];
const MEDIA_EXTS = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mp3", ".m4a", ".wav", ".ogg", ".flac", ".opus"];
const endsWithAny = (s: string, list: string[]) => list.some((ext) => s.endsWith(ext));

function validateMediaUrl(input: unknown) {
  if (typeof input !== "string" || input.trim() === "") return { ok: false, errorCode: "EMPTY_URL", userMessage: "Please paste a link." };
  const trimmed = input.trim();
  if (/^(file|about|chrome|chrome-extension|data|blob|javascript):/i.test(trimmed)) return { ok: false, errorCode: "LOCAL_URL", userMessage: "Local file paths can't be processed." };
  let url: URL;
  try { url = new URL(trimmed); } catch { return { ok: false, errorCode: "INVALID_URL", userMessage: "That doesn't look like a valid link." }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, errorCode: "NON_HTTP_PROTOCOL", userMessage: "Only https:// links are supported." };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.startsWith("127.") || host === "0.0.0.0" || host === "::1") return { ok: false, errorCode: "LOCAL_URL", userMessage: "Local file paths can't be processed." };
  if (host === "wetransfer.com" || host === "www.wetransfer.com" || host === "we.tl") return { ok: false, errorCode: "EXPIRING_HOST", userMessage: "WeTransfer links expire and can't be processed reliably." };
  if (host === "loom.com" || host === "www.loom.com") return { ok: false, errorCode: "UNSUPPORTED_HOST", userMessage: "Loom isn't currently supported." };
  const path = url.pathname.toLowerCase();
  const isDropbox = host === "dropbox.com" || host === "www.dropbox.com" || host.endsWith(".dropbox.com");
  if (isDropbox) {
    if (path.startsWith("/scl/fo/") || (path.startsWith("/sh/") && !path.includes("/file/"))) return { ok: false, errorCode: "DROPBOX_FOLDER_URL", userMessage: "This is a Dropbox folder link. Right-click the specific video file and choose Share → Copy link." };
    if (path.startsWith("/scl/fi/") || path.startsWith("/s/") || (path.startsWith("/sh/") && path.includes("/file/"))) {
      url.searchParams.delete("st"); url.searchParams.set("dl", "1");
      if (endsWithAny(path, ARCHIVE_EXTS)) return { ok: false, errorCode: "ARCHIVE_FILE", userMessage: "ZIP/archive files aren't supported." };
      if (endsWithAny(path, IMAGE_EXTS)) return { ok: false, errorCode: "IMAGE_FILE", userMessage: "This is an image, not a video." };
      if (endsWithAny(path, DOC_EXTS)) return { ok: false, errorCode: "DOCUMENT_FILE", userMessage: "This is a document, not a video." };
      return { ok: true, sourceType: "dropbox", normalizedUrl: url.toString() };
    }
  }
  const isYouTube = host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  if (isYouTube) {
    const v = url.searchParams.get("v");
    const list = url.searchParams.get("list");
    const isShorts = path.startsWith("/shorts/");
    const isLive = path.startsWith("/live/");
    const isWatch = path === "/watch";
    const isPlaylistPage = path === "/playlist";
    const isShortLink = host === "youtu.be" && path.length > 1;
    if ((isPlaylistPage || (isWatch && !v)) && list) return { ok: false, errorCode: "YOUTUBE_PLAYLIST", userMessage: "This is a YouTube playlist, not a single video." };
    if ((isWatch && v) || isShorts || isLive || isShortLink) {
      if (list) { url.searchParams.delete("list"); url.searchParams.delete("index"); url.searchParams.delete("pp"); url.searchParams.delete("t"); }
      return { ok: true, sourceType: "youtube", normalizedUrl: url.toString() };
    }
  }
  if ((host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") && /^\/(?:video\/|channels\/[^/]+\/)?\d+/.test(url.pathname)) {
    return { ok: true, sourceType: "vimeo", normalizedUrl: url.toString() };
  }
  if (host === "drive.google.com" || host === "docs.google.com") {
    if (/^\/file\/d\//.test(url.pathname) || (url.pathname === "/open" && url.searchParams.get("id"))) return { ok: true, sourceType: "google_drive", normalizedUrl: url.toString() };
    if (/^\/drive\/folders\//.test(url.pathname)) return { ok: false, errorCode: "GOOGLE_DRIVE_FOLDER", userMessage: "This is a Google Drive folder. Share a link to the specific file." };
  }
  if (endsWithAny(path, MEDIA_EXTS)) return { ok: true, sourceType: "direct", normalizedUrl: url.toString() };
  if (endsWithAny(path, ARCHIVE_EXTS)) return { ok: false, errorCode: "ARCHIVE_FILE", userMessage: "ZIP/archive files aren't supported." };
  if (endsWithAny(path, IMAGE_EXTS)) return { ok: false, errorCode: "IMAGE_FILE", userMessage: "This is an image, not a video." };
  if (endsWithAny(path, DOC_EXTS)) return { ok: false, errorCode: "DOCUMENT_FILE", userMessage: "This is a document, not a video." };
  return { ok: true, sourceType: "unknown", normalizedUrl: url.toString() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id, source_url, source_type } = await req.json();

    // Validate required inputs
    if (!session_id || !source_url || !source_type) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: session_id, source_url, source_type",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Run the full validator. Catches Dropbox folder URLs, image cover
    // photos, archives, expiring hosts, etc. Frontend already filters
    // these but this is the last-line defense for direct API hits.
    const validation = validateMediaUrl(source_url);
    if (!validation.ok) {
      return new Response(
        JSON.stringify({ error: validation.userMessage || "source_url is not valid", error_code: validation.errorCode }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Whitelist source_type — accept everything the validator can produce.
    const validSourceTypes = ["youtube", "dropbox", "vimeo", "direct", "google_drive", "unknown"];
    if (!validSourceTypes.includes(source_type)) {
      return new Response(
        JSON.stringify({ error: `Invalid source_type: ${source_type}. Must be one of: ${validSourceTypes.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate job_id via crypto.randomUUID
    const job_id = crypto.randomUUID();

    // Insert transcript_jobs row with status "pending"
    const { error: insertError } = await supabase
      .schema("srp_pipeline")
      .from("transcript_jobs")
      .insert({
        id: job_id,
        session_id,
        source_url,
        source_type,
        status: "pending",
        progress_percent: 0,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Failed to insert transcript_jobs row:", JSON.stringify(insertError));
      return new Response(
        JSON.stringify({ error: `DB insert failed: ${insertError.message} [code: ${insertError.code}, hint: ${insertError.hint || 'none'}]` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Also update the session with the transcript_job_id
    const { error: sessionUpdateError } = await supabase
      .schema("srp_pipeline")
      .from("sessions")
      .update({ transcript_job_id: job_id })
      .eq("session_id", session_id);

    if (sessionUpdateError) {
      console.error("Failed to update session with transcript_job_id:", sessionUpdateError);
      // Non-fatal — the job was still created
    }

    // Build the callback URL
    const callbackUrl = `${supabaseUrl}/functions/v1/srp-transcript-callback`;
    const callbackSecret = Deno.env.get("SRP_TOOL_N8N_CALLBACK_SECRET") || "";

    // Build webhook payload matching the n8n SRP Tool transcription pipeline format
    const webhookPayload = {
      job_id,
      session_id,
      source_url,
      source_type,
      callback_url: callbackUrl,
      callback_secret: callbackSecret,
      // n8n uses these to PATCH status updates directly back to Supabase
      supabase_url: supabaseUrl,
      supabase_service_key: supabaseServiceKey,
    };

    // Fire webhook to n8n — fire-and-forget so the Supabase 150s edge
    // function timeout (IDLE_TIMEOUT) doesn't kill us while n8n is still
    // working. Status updates flow back via srp-transcript-callback.
    const n8nWebhookUrl = "https://vid2.thesqd.com/webhook/6f9594b4-6b15-4bef-b64e-e488c706fd1f";
    console.log(`Sending transcription webhook to n8n for job ${job_id} (fire-and-forget)`);

    const fireWebhook = (async () => {
      try {
        const webhookResponse = await fetch(n8nWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(webhookPayload),
        });
        if (!webhookResponse.ok) {
          const errorText = await webhookResponse.text();
          console.error(`n8n webhook returned ${webhookResponse.status} — ${errorText}`);
          await supabase
            .schema("srp_pipeline")
            .from("transcript_jobs")
            .update({
              status: "failed",
              error_message: `n8n webhook returned ${webhookResponse.status}: ${errorText.slice(0, 500)}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job_id);
        } else {
          console.log(`n8n webhook accepted for transcription job ${job_id}`);
        }
      } catch (webhookError) {
        console.error("n8n transcription webhook fetch failed:", webhookError);
        await supabase
          .schema("srp_pipeline")
          .from("transcript_jobs")
          .update({
            status: "failed",
            error_message: `webhook request failed: ${webhookError instanceof Error ? webhookError.message : String(webhookError)}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job_id);
      }
    })();

    try {
      // @ts-expect-error — EdgeRuntime is available in Supabase Edge Functions runtime
      EdgeRuntime.waitUntil(fireWebhook);
    } catch {
      // Local dev fallback
    }

    // Return job_id immediately so the frontend can subscribe to Realtime
    // updates on transcript_jobs without waiting on n8n.
    return new Response(
      JSON.stringify({ job_id, status: "pending" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("srp-start-transcription error:", err);
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
