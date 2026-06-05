// notify-content-collection-submitted — posts a Slack notification to
// the am-pm-web channel when a partner submits their Content Collection
// portal. Fire-and-forget from ContentCollectionPage.submitFinal.
//
// Reads SLACK_WEBHOOK_AM_PM_WEB env var (Slack incoming webhook URL).
// If unset, logs a warning and returns 200 success without posting —
// so the submit flow never hard-fails on missing config.
//
// Message contents:
//   - Church name + member number
//   - Submitted-at timestamp
//   - Count of partner marks (revisions + additions)
//   - Direct link to the staff Intake workspace where responses render
//
// Body params (POST JSON):
//   { session_id: string }   required
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SessionRow {
  id:              string;
  member:          number;
  web_project_id:  string | null;
  status:          string;
  submitted_at:    string | null;
}

interface AccountRow {
  member:      number;
  church_name: string | null;
}

interface ProjectRow {
  id:   string;
  name: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let session_id: string | undefined;
  try {
    const body = await req.json();
    session_id = body?.session_id;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!session_id || typeof session_id !== "string") {
    return new Response(JSON.stringify({ error: "session_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const webhookUrl = Deno.env.get("SLACK_WEBHOOK_AM_PM_WEB");
  if (!webhookUrl) {
    console.warn("[notify-content-collection-submitted] SLACK_WEBHOOK_AM_PM_WEB unset — skipping post");
    return new Response(
      JSON.stringify({ ok: true, posted: false, reason: "webhook_url_unset" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve session → project → account in parallel where possible.
  const { data: session, error: sessionErr } = await supabase
    .from("strategy_content_collection_sessions")
    .select("id, member, web_project_id, status, submitted_at")
    .eq("id", session_id)
    .maybeSingle<SessionRow>();
  if (sessionErr || !session) {
    return new Response(
      JSON.stringify({ error: sessionErr?.message ?? "Session not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const [accountRes, projectRes, marksRes] = await Promise.all([
    supabase
      .from("strategy_account_progress")
      .select("member, church_name")
      .eq("member", session.member)
      .maybeSingle<AccountRow>(),
    session.web_project_id
      ? supabase
          .from("strategy_web_projects")
          .select("id, name")
          .eq("id", session.web_project_id)
          .maybeSingle<ProjectRow>()
      : Promise.resolve({ data: null as ProjectRow | null }),
    supabase
      .from("strategy_content_collection_marks")
      .select("id, target_path", { count: "exact" })
      .eq("session_id", session_id),
  ]);

  const churchName = accountRes.data?.church_name ?? `Member ${session.member}`;
  const projectName = projectRes.data?.name ?? `Project ${session.web_project_id ?? "—"}`;
  const marks = marksRes.data ?? [];
  const editCount = marks.filter((m) => (m.target_path ?? "").startsWith("answer:")).length;
  const addCount = marks.filter((m) => (m.target_path ?? "").startsWith("missing:")).length;

  // Compose a Slack Block Kit message. The app origin is supplied via
  // env (set on deploy) so the staff link points to the right host.
  const appOrigin = Deno.env.get("APP_ORIGIN") ?? "https://app.churchmediasquad.com";
  const intakeUrl = session.web_project_id
    ? `${appOrigin}/web/${session.web_project_id}?tab=intake`
    : appOrigin;
  const submittedAt = session.submitted_at
    ? new Date(session.submitted_at).toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" })
    : "just now";

  const text = `${churchName} (#${session.member}) submitted their Content Collection — ${editCount} edits, ${addCount} additions`;
  const slackPayload = {
    text,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Content Collection submitted", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Church:*\n${churchName}` },
          { type: "mrkdwn", text: `*Member:*\n#${session.member}` },
          { type: "mrkdwn", text: `*Project:*\n${projectName}` },
          { type: "mrkdwn", text: `*Submitted:*\n${submittedAt}` },
          { type: "mrkdwn", text: `*Edits:*\n${editCount}` },
          { type: "mrkdwn", text: `*Additions:*\n${addCount}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View partner responses", emoji: true },
            url: intakeUrl,
            style: "primary",
          },
        ],
      },
    ],
  };

  try {
    const slackRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload),
    });
    if (!slackRes.ok) {
      const body = await slackRes.text().catch(() => "");
      console.error("[notify-content-collection-submitted] slack error", slackRes.status, body.slice(0, 200));
      return new Response(
        JSON.stringify({ ok: false, posted: false, slack_status: slackRes.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[notify-content-collection-submitted] fetch threw", message);
    return new Response(
      JSON.stringify({ ok: false, posted: false, error: message }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, posted: true, edits: editCount, additions: addCount }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
