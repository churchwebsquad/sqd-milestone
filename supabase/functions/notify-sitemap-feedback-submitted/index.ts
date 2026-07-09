// notify-sitemap-feedback-submitted — posts to the #am-pm-web Slack
// channel when a partner clicks "Share Sitemap Review Feedback" on
// their content strategy review portal. Fire-and-forget from
// SitemapReviewPortalPage.handleSubmitFeedback after the token-gated
// RPC save lands. Mirrors notify-content-collection-submitted /
// notify-copy-review-submitted so the staff team gets a consistent
// submission feed in the same channel.
//
// Reuses the existing Slack bot setup (SLACK_BOT_TOKEN). The bot must
// already be a member of #am-pm-web — otherwise chat.postMessage
// returns "not_in_channel" and we log but do not block.
//
// Channel override: set SLACK_AM_PM_WEB_CHANNEL (channel ID like
// "C0XXXXXX" preferred; "#am-pm-web" works for public channels too).
// Defaults to "#am-pm-web".
//
// Body params (POST JSON):
//   { token: string }   required   the sitemap review token
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReviewShape {
  status?:              string;
  partner_reviewed_at?: string | null;
  partner_reviewed_by?: string | null;
  partner_notes?:       string | null;
  partner_edit_requests?: Array<{ status?: string }>;
}

interface ProjectRow {
  id:            string;
  member:        number | null;
  name:          string | null;
  church_name:   string | null;
  roadmap_state: { sitemap_review?: ReviewShape } | null;
}

interface AccountRow {
  church_name: string | null;
  css_rep:     string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let token: string | undefined;
  try {
    const body = await req.json();
    token = body?.token;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!token || typeof token !== "string") {
    return new Response(JSON.stringify({ error: "token required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
  if (!slackToken) {
    console.warn("[notify-sitemap-feedback-submitted] SLACK_BOT_TOKEN unset — skipping post");
    return new Response(
      JSON.stringify({ ok: true, posted: false, reason: "slack_bot_token_unset" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const channel = Deno.env.get("SLACK_AM_PM_WEB_CHANNEL") ?? "#am-pm-web";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Locate the project by scanning roadmap_state.sitemap_review.token.
  // No index on the JSONB path today, but the row count is small
  // (one strategy_web_projects per member per project) so the linear
  // scan is fine for this fire-and-forget notification path.
  const { data: projects, error: projErr } = await supabase
    .from("strategy_web_projects")
    .select("id, member, name, church_name, roadmap_state")
    .filter("roadmap_state->sitemap_review->>token", "eq", token)
    .limit(1);
  if (projErr || !projects || projects.length === 0) {
    return new Response(
      JSON.stringify({ error: projErr?.message ?? "Review not found for token" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const project = projects[0] as ProjectRow;
  const review  = project.roadmap_state?.sitemap_review ?? {};

  const account = project.member != null
    ? (await supabase
        .from("strategy_account_progress")
        .select("church_name, css_rep")
        .eq("member", project.member)
        .maybeSingle<AccountRow>()).data
    : null;

  const churchName  = account?.church_name ?? project.church_name ?? `Member ${project.member ?? "?"}`;
  const projectName = project.name ?? "Content strategy";
  const cssRep      = account?.css_rep ?? null;
  const noteCount   = (review.partner_edit_requests ?? []).filter(r => r.status === "open").length;
  const hasOverall  = !!(review.partner_notes && review.partner_notes.trim());
  const submittedAt = review.partner_reviewed_at
    ? new Date(review.partner_reviewed_at).toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" })
    : "just now";
  const submittedBy = review.partner_reviewed_by ?? "Partner reviewer";

  const appOrigin = Deno.env.get("APP_ORIGIN") ?? "https://strategy.thesqd.com";
  const feedbackUrl = `${appOrigin}/web/${project.id}/sitemap-feedback`;
  const projectUrl  = `${appOrigin}/web/${project.id}?tab=cowork`;

  // Two paths land here:
  //   partner_reviewed → partner submitted feedback; staff has to
  //     execute the edits before downstream work starts.
  //   approved         → partner approved as-is; no edits requested,
  //     downstream drafting + low-fi layout can begin immediately.
  // The Slack message differentiates so the AM / strategist knows
  // exactly what to schedule next without opening the app first.
  const isApproved = review.status === "approved";
  const headerText   = isApproved
    ? "Content strategy approved as-is"
    : "Content strategy feedback submitted";
  const statusLabel  = isApproved ? "Approved as-is" : "Feedback submitted";
  const nextStepText = isApproved
    ? "*Next step:* Downstream work can begin. The strategist can schedule *page drafting* and the *low-fi layout* pass — no strategy edits required."
    : `*Next step:* Content strategy feedback has been scheduled. The strategist can schedule the *execute-edits* task now (${noteCount} section note${noteCount === 1 ? "" : "s"}${hasOverall ? " + overall notes" : ""}). Downstream page drafting waits until the edits land.`;
  const fallbackText = isApproved
    ? `${churchName} (#${project.member ?? "?"}) approved their content strategy as-is — downstream work can begin`
    : `${churchName} (#${project.member ?? "?"}) submitted content strategy feedback — ${noteCount} section note${noteCount === 1 ? "" : "s"}${hasOverall ? " + overall notes" : ""}`;

  const detailFields = [
    { type: "mrkdwn", text: `*Church:*\n${churchName}` },
    { type: "mrkdwn", text: `*Member:*\n#${project.member ?? "?"}` },
    { type: "mrkdwn", text: `*Project:*\n${projectName}` },
    { type: "mrkdwn", text: `*Account manager:*\n${cssRep ?? "—"}` },
    { type: "mrkdwn", text: `*Submitted by:*\n${submittedBy}` },
    { type: "mrkdwn", text: `*Submitted:*\n${submittedAt}` },
    { type: "mrkdwn", text: `*Status:*\n${statusLabel}` },
  ];
  // Only surface note counts when there's something to execute —
  // approved-as-is reviews have no open notes so listing zeros
  // reads as noise.
  if (!isApproved) {
    detailFields.push(
      { type: "mrkdwn", text: `*Section notes:*\n${noteCount}` },
      { type: "mrkdwn", text: `*Overall notes:*\n${hasOverall ? "Yes" : "None"}` },
    );
  }

  const actionElements = isApproved
    ? [
        {
          type: "button",
          text: { type: "plain_text", text: "Open Content Engine", emoji: true },
          url: projectUrl,
          style: "primary",
        },
      ]
    : [
        {
          type: "button",
          text: { type: "plain_text", text: "View partner feedback", emoji: true },
          url: feedbackUrl,
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Open Content Engine", emoji: true },
          url: projectUrl,
        },
      ];

  const slackResponse = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text: fallbackText,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: headerText, emoji: true },
        },
        {
          type: "section",
          fields: detailFields,
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: nextStepText },
        },
        {
          type: "actions",
          elements: actionElements,
        },
      ],
    }),
  });

  const slackData = await slackResponse.json().catch(() => ({ ok: false, error: "non_json_response" }));
  if (!slackData.ok) {
    console.error("[notify-sitemap-feedback-submitted] slack api error:", slackData.error);
    return new Response(
      JSON.stringify({ ok: false, posted: false, slack_error: slackData.error ?? "unknown" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, posted: true, channel, kind: isApproved ? "approved" : "feedback", section_notes: noteCount, has_overall: hasOverall }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
