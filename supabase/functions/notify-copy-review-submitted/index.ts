// notify-copy-review-submitted — posts to the #am-pm-web Slack
// channel when a partner submits a copywriting review. Fire-and-forget
// from CopyReviewPortalPage.onSubmit after the submit_copy_review RPC
// succeeds. Mirrors notify-content-collection-submitted in shape so
// the staff team gets a consistent submission feed in the same channel.
//
// Reuses the existing Slack bot setup (SLACK_BOT_TOKEN). The bot must
// already be a member of #am-pm-web — without that, chat.postMessage
// returns "not_in_channel" and the function logs but does not block.
//
// Channel override: set SLACK_AM_PM_WEB_CHANNEL (channel ID like
// "C0XXXXXX" preferred; "#am-pm-web" works for public channels too).
// Defaults to "#am-pm-web".
//
// Body params (POST JSON):
//   { review_id: string }   required
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReviewRow {
  id:            string;
  member:        number;
  title:         string | null;
  status:        string;
  submitted_at:  string | null;
  parsed:        { pages?: Array<unknown> } | null;
}

interface AccountRow {
  member:      number;
  church_name: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let review_id: string | undefined;
  try {
    const body = await req.json();
    review_id = body?.review_id;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!review_id || typeof review_id !== "string") {
    return new Response(JSON.stringify({ error: "review_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
  if (!slackToken) {
    console.warn("[notify-copy-review-submitted] SLACK_BOT_TOKEN unset — skipping post");
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

  // Resolve review → account + counts in parallel.
  const { data: review, error: reviewErr } = await supabase
    .from("strategy_copy_reviews")
    .select("id, member, title, status, submitted_at, parsed")
    .eq("id", review_id)
    .maybeSingle<ReviewRow>();
  if (reviewErr || !review) {
    return new Response(
      JSON.stringify({ error: reviewErr?.message ?? "Review not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const [accountRes, decisionsRes, commentsRes] = await Promise.all([
    supabase
      .from("strategy_account_progress")
      .select("member, church_name")
      .eq("member", review.member)
      .maybeSingle<AccountRow>(),
    supabase
      .from("strategy_copy_review_decisions")
      .select("decision")
      .eq("review_id", review_id),
    supabase
      .from("strategy_copy_review_comments")
      .select("author_kind, body")
      .eq("review_id", review_id),
  ]);

  const churchName = accountRes.data?.church_name ?? `Member ${review.member}`;
  const reviewTitle = review.title?.trim() || "Untitled review";
  const totalPages = Array.isArray(review.parsed?.pages) ? review.parsed!.pages!.length : 0;

  const decisions = decisionsRes.data ?? [];
  const approvedCount     = decisions.filter((d) => d.decision === "approved").length;
  const editRequestCount  = decisions.filter((d) => d.decision === "edit_requested").length;

  const comments = commentsRes.data ?? [];
  const partnerComments = comments.filter((c) => c.author_kind === "partner" && (c.body ?? "").trim().length > 0).length;

  // Staff app deep-link to the review.
  const appOrigin = Deno.env.get("APP_ORIGIN") ?? "https://strategy.thesqd.com";
  const reviewUrl = `${appOrigin}/churches/${review.member}/copy-review/${review.id}`;
  const submittedAt = review.submitted_at
    ? new Date(review.submitted_at).toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" })
    : "just now";

  const text = `${churchName} (#${review.member}) submitted their copywriting review "${reviewTitle}" — ${editRequestCount} edits requested, ${partnerComments} comments`;

  const slackResponse = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,                       // fallback for notifications/screen readers
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Copywriting review submitted", emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Church:*\n${churchName}` },
            { type: "mrkdwn", text: `*Member:*\n#${review.member}` },
            { type: "mrkdwn", text: `*Review:*\n${reviewTitle}` },
            { type: "mrkdwn", text: `*Submitted:*\n${submittedAt}` },
            { type: "mrkdwn", text: `*Pages:*\n${totalPages}` },
            { type: "mrkdwn", text: `*Approved blocks:*\n${approvedCount}` },
            { type: "mrkdwn", text: `*Edits requested:*\n${editRequestCount}` },
            { type: "mrkdwn", text: `*Partner comments:*\n${partnerComments}` },
          ],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open review", emoji: true },
              url: reviewUrl,
              style: "primary",
            },
          ],
        },
      ],
    }),
  });

  const slackData = await slackResponse.json().catch(() => ({ ok: false, error: "non_json_response" }));
  if (!slackData.ok) {
    console.error("[notify-copy-review-submitted] slack api error:", slackData.error);
    // Common failures:
    //   - "not_in_channel" → invite the bot to #am-pm-web
    //   - "channel_not_found" → channel doesn't exist or bot can't see it
    //   - "invalid_auth" / "token_revoked" → SLACK_BOT_TOKEN needs refresh
    return new Response(
      JSON.stringify({ ok: false, posted: false, slack_error: slackData.error ?? "unknown" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      posted: true,
      channel,
      edits_requested: editRequestCount,
      approved_blocks: approvedCount,
      partner_comments: partnerComments,
      total_pages: totalPages,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
