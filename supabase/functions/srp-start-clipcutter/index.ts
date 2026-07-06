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
    const {
      session_id: requestedSessionId,
      session_db_id,
      user_id,
      clickup_id,
      source_url,
      source_type,
      member,
      clips,
      creative_direction,
    } = await req.json();

    // Create Supabase client early so we can do session lookup
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve session_id — prefer the provided slug; fall back to DB id lookup
    let session_id = requestedSessionId;
    if (!session_id && session_db_id !== undefined && session_db_id !== null) {
      const { data: sess, error: sessErr } = await supabase
        .schema("srp_pipeline")
        .from("sessions")
        .select("session_id")
        .eq("id", session_db_id)
        .maybeSingle();
      if (!sessErr && sess?.session_id) session_id = sess.session_id;
    }

    // Validate required fields
    const missing: string[] = [];
    if (!session_id) missing.push("session_id (or session_db_id pointing to a saved session)");
    if (!source_url) missing.push("source_url");
    if (!source_type) missing.push("source_type");
    if (!clips || !Array.isArray(clips) || clips.length === 0) missing.push("clips");

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

    // Run the full URL validator — last-line defense against direct API
    // hits with bad sources (Dropbox folders, ZIPs, images, expired hosts).
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
        JSON.stringify({
          error: `Invalid source_type: ${source_type}. Must be one of: ${validSourceTypes.join(", ")}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Generate job_id
    const job_id = crypto.randomUUID();

    // Insert clipcutter_jobs row with status "pending"
    const { error: insertError } = await supabase
      .schema("srp_pipeline")
      .from("clipcutter_jobs")
      .insert({
        id: job_id,
        session_id,
        source_url,
        source_type,
        clips,
        creative_direction: creative_direction || null,
        status: "pending",
        progress_percent: 0,
      });

    if (insertError) {
      console.error("Failed to insert clipcutter_jobs row:", insertError);
      return new Response(
        JSON.stringify({
          error: "Failed to create clipcutter job",
          details: insertError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update the parent session with clipcutter_job_id and clip_processing_status
    const { error: sessionUpdateError } = await supabase
      .schema("srp_pipeline")
      .from("sessions")
      .update({
        clipcutter_job_id: job_id,
        clip_processing_status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", session_id);

    if (sessionUpdateError) {
      console.error("Failed to update session with clipcutter_job_id:", sessionUpdateError);
      // Non-fatal — the job was still created
    }

    // Build the callback URL
    const callbackUrl = `${supabaseUrl}/functions/v1/srp-clipcutter-callback`;
    const callbackSecret = Deno.env.get("SRP_TOOL_N8N_CALLBACK_SECRET") || "";

    // Build webhook payload matching SRP clipcutter workflow contract
    const webhookPayload = {
      job_id,
      user_id: user_id || null,
      clickup_id: clickup_id || null,
      source_url,
      source_type,
      member: member || null,
      skip_transcription: true,
      clips,
      creative_direction: creative_direction || null,
      callback_url: callbackUrl,
      callback_secret: callbackSecret,
      supabase_url: supabaseUrl,
      supabase_service_key: supabaseServiceKey,
    };

    // Fire webhook to n8n clipcutter — but DO NOT await the response.
    // The clipcutter pipeline takes 3-7 minutes; awaiting blows past the
    // Supabase edge function 150s idle-timeout (IDLE_TIMEOUT) and the
    // frontend sees "Couldn't start clip processing" even though n8n
    // continues processing in the background and eventually completes.
    // Status is reported back via srp-clipcutter-callback, so we don't need
    // the response — just need the request to land at n8n.
    const n8nWebhookUrl = "https://vid2.thesqd.com/webhook/e255e326-7eed-430f-9ad2-1bb6bba5cd07";
    console.log(`Sending clipcutter webhook to n8n for job ${job_id} (fire-and-forget)`);

    // n8n's webhook is configured with responseMode: "lastNode", so this
    // fetch blocks for the FULL duration of the workflow (3-7 minutes for
    // a real clipcutter run). If anything in the network path (proxy, CDN,
    // Cloudflare, Supabase edge runtime) closes the connection before n8n
    // finishes, the fetch throws — but n8n is still running and its status
    // callbacks have likely already pushed the row through pending →
    // downloading → clipping → completed. Therefore: on fetch failure we
    // ONLY mark the job failed if the row is still in "pending" — past that
    // point n8n has acknowledged and is reporting its own status, and we
    // must not overwrite a successful callback with a stale "failed".
    const markFailedIfStillPending = async (errMsg: string) => {
      try {
        const { data: current } = await supabase
          .schema("srp_pipeline")
          .from("clipcutter_jobs")
          .select("status")
          .eq("id", job_id)
          .maybeSingle();
        if (current?.status !== "pending") {
          console.log(
            `Skipping failure mark for ${job_id} — row is already in '${current?.status}', n8n is handling it.`,
          );
          return;
        }
        await supabase
          .schema("srp_pipeline")
          .from("clipcutter_jobs")
          .update({
            status: "failed",
            error_message: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job_id)
          .eq("status", "pending");
        await supabase
          .schema("srp_pipeline")
          .from("sessions")
          .update({
            clip_processing_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("session_id", session_id);
      } catch (e) {
        console.error("markFailedIfStillPending error:", e);
      }
    };

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
          await markFailedIfStillPending(
            `n8n webhook returned ${webhookResponse.status}: ${errorText.slice(0, 500)}`,
          );
        } else {
          console.log(`n8n webhook accepted for clipcutter job ${job_id}`);
        }
      } catch (webhookError) {
        // This commonly fires AFTER n8n has already completed — see comment
        // on markFailedIfStillPending. The guard prevents overwriting a
        // completed row with a phantom "failed".
        console.error("n8n clipcutter webhook fetch failed:", webhookError);
        await markFailedIfStillPending(
          `webhook request failed: ${webhookError instanceof Error ? webhookError.message : String(webhookError)}`,
        );
      }
    })();

    // Keep the runtime alive long enough for the fetch to actually go out
    // (Supabase Edge Functions support EdgeRuntime.waitUntil for this).
    try {
      // @ts-ignore — EdgeRuntime is available in Supabase Edge Functions runtime
      EdgeRuntime.waitUntil(fireWebhook);
    } catch {
      // Local dev fallback — if EdgeRuntime isn't available, at least the
      // promise is still in the event loop.
    }

    // Success — return job_id immediately so the frontend can subscribe to
    // Realtime updates on clipcutter_jobs.id without waiting for n8n.
    return new Response(
      JSON.stringify({ job_id, status: "pending" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("srp-start-clipcutter error:", err);
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
