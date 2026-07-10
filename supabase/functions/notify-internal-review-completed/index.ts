// notify-internal-review-completed — posts to #am-pm-web when an
// account manager closes an internal review round on a web project.
// Signals to the strategist / dev team: the AM has left their edits
// on the internal review, someone needs to apply them, and once
// they're applied the partner review can be published.
//
// Fired from webReviews.closeReview after a successful update. The
// edge function early-returns 200 { posted: false } when the review's
// kind is 'partner' so the partner path stays on
// notify-web-review-submitted. Same #am-pm-web channel as every other
// web-review notif.
//
// Body:
//   { review_id: string }   required
//
// Uses SLACK_BOT_TOKEN + SLACK_AM_PM_WEB_CHANNEL. Returns 200 with
// posted:false when the token is unset so calling code doesn't
// surface an error in local-dev / unconfigured setups.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface WebReviewRow {
  id:              string;
  web_project_id:  string;
  kind:            string;
  status:          string;
  round_number:    number;
  started_by_name: string | null;
  closed_by_name:  string | null;
  closed_at:       string | null;
}

interface ProjectRow {
  id:     string;
  member: number | null;
  name:   string | null;
}

interface AccountRow {
  member:      number;
  church_name: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let review_id: string | undefined;
  try {
    const body = await req.json();
    review_id = typeof body?.review_id === "string" ? body.review_id : undefined;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!review_id) return json({ error: "review_id required" }, 400);

  const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
  if (!slackToken) {
    return json({ ok: true, posted: false, reason: "slack_bot_token_unset" }, 200);
  }
  const channel = Deno.env.get("SLACK_AM_PM_WEB_CHANNEL") ?? "#am-pm-web";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Resolve the review + guard on kind.
  const { data: review, error: reviewErr } = await supabase
    .from("web_reviews")
    .select("id, web_project_id, kind, status, round_number, started_by_name, closed_by_name, closed_at")
    .eq("id", review_id)
    .maybeSingle<WebReviewRow>();
  if (reviewErr || !review) {
    return json({ error: reviewErr?.message ?? "Review not found" }, 404);
  }
  if (review.kind !== "internal") {
    return json({ ok: true, posted: false, reason: "non_internal_review" }, 200);
  }

  // 2. Project → member → church name.
  const { data: project } = await supabase
    .from("strategy_web_projects")
    .select("id, member, name")
    .eq("id", review.web_project_id)
    .maybeSingle<ProjectRow>();
  let churchName = project?.name ?? `Project ${review.web_project_id}`;
  if (project?.member != null) {
    const { data: account } = await supabase
      .from("strategy_account_progress")
      .select("member, church_name")
      .eq("member", project.member)
      .maybeSingle<AccountRow>();
    if (account?.church_name) churchName = account.church_name;
  }

  // 3. Count staff comments on this review — signals volume of edits
  //    to schedule. Match the shape webReviews.ts uses: staff comments
  //    carry author_kind='staff'; kind='requested' = edits requested,
  //    kind='comment' = observation. Both matter for the recipient.
  const { data: comments, error: commentsErr } = await supabase
    .from("web_review_comments")
    .select("kind, author_kind")
    .eq("review_id", review_id);
  if (commentsErr) {
    return json({ error: commentsErr.message }, 500);
  }
  const staffComments = (comments ?? []).filter(c => c.author_kind === "staff");
  const editCount    = staffComments.filter(c => c.kind === "requested").length;
  const commentCount = staffComments.filter(c => c.kind === "comment").length;

  // 4. Compose the message.
  const closerName  = review.closed_by_name?.trim() || review.started_by_name?.trim() || "Staff reviewer";
  const memberLabel = project?.member != null ? `#${project.member}` : "(no member)";
  const headerText  = "Internal review complete — apply edits before publishing to partner";
  const nextStep    =
`*Next step:* ${editCount === 0
    ? "No edits requested — a strategist can publish the partner review now."
    : `Apply the ${editCount} internal edit${editCount === 1 ? "" : "s"} to the drafted pages, then publish the partner review from the Review tab.`}`;
  const fallback    = `${churchName} (${memberLabel}) — internal review R${review.round_number} complete · ${editCount} edits, ${commentCount} comments`;

  const appOrigin  = Deno.env.get("APP_ORIGIN") ?? "https://strategy.thesqd.com";
  const reviewUrl  = `${appOrigin}/web/${review.web_project_id}?tab=review`;

  const blocks = [
    { type: "header", text: { type: "plain_text", text: headerText, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Church:*\n${churchName}` },
        { type: "mrkdwn", text: `*Member:*\n${memberLabel}` },
        { type: "mrkdwn", text: `*Closed by:*\n${closerName}` },
        { type: "mrkdwn", text: `*Round:*\nR${review.round_number}` },
        { type: "mrkdwn", text: `*Edits requested:*\n${editCount}` },
        { type: "mrkdwn", text: `*Staff comments:*\n${commentCount}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: nextStep },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open internal review", emoji: true },
          url: reviewUrl,
          style: "primary",
        },
      ],
    },
  ];

  const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${slackToken}` },
    body: JSON.stringify({ channel, text: fallback, blocks, unfurl_links: false, unfurl_media: false }),
  });
  const slackBody = await slackRes.json().catch(() => null);
  if (!slackBody?.ok) {
    console.error("[notify-internal-review-completed] slack post failed:", slackBody);
    return json({ ok: false, posted: false, reason: "slack_post_failed", slack: slackBody }, 200);
  }

  return json({
    ok:            true,
    posted:        true,
    channel,
    review_id,
    edit_count:    editCount,
    comment_count: commentCount,
    round_number:  review.round_number,
    member:        project?.member ?? null,
  }, 200);
});
