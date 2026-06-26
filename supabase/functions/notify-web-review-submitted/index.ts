// notify-web-review-submitted — posts to #am-pm-web when a partner
// finishes a web_reviews row (the v39+ feedback system used by
// PortalReviewPage). Distinct from notify-copy-review-submitted,
// which serves the older strategy_copy_reviews / CopyReviewPortalPage
// path.
//
// Fired from PortalReviewPage.markFinished + approveSite handlers.
// Public surface — invoked with the anon key from a token-gated
// partner portal (no user JWT available). The function uses the
// service role internally to read the review + comments tables.
//
// Body:
//   { review_id: string }   required
//
// Headline text depends on edit count:
//   - 0 edits  → "Copy review complete — ready for design"
//   - 1+ edits → "Copywriting edits submitted — schedule revisions"
//
// Slack block fields: Church / Member # / Submitted by / Round # /
// Edits requested / Partner comments.
//
// Reuses SLACK_BOT_TOKEN + SLACK_AM_PM_WEB_CHANNEL env. Returns 200
// with posted:false on missing token so calling code doesn't surface
// an error in local-dev / unconfigured scenarios.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

interface WebReviewRow {
  id:              string
  web_project_id:  string
  kind:            string
  status:          string
  round_number:    number
  partner_name:    string | null
}

interface ProjectRow {
  id:     string
  member: number | null
  name:   string | null
}

interface AccountRow {
  member:      number
  church_name: string | null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405)

  let review_id: string | undefined
  try {
    const body = await req.json()
    review_id = typeof body?.review_id === "string" ? body.review_id : undefined
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }
  if (!review_id) return json({ error: "review_id required" }, 400)

  const slackToken = Deno.env.get("SLACK_BOT_TOKEN")
  if (!slackToken) {
    return json({ ok: true, posted: false, reason: "slack_bot_token_unset" }, 200)
  }
  const channel = Deno.env.get("SLACK_AM_PM_WEB_CHANNEL") ?? "#am-pm-web"

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // 1. Resolve the review row.
  const { data: review, error: reviewErr } = await supabase
    .from("web_reviews")
    .select("id, web_project_id, kind, status, round_number, partner_name")
    .eq("id", review_id)
    .maybeSingle<WebReviewRow>()
  if (reviewErr || !review) {
    return json({ error: reviewErr?.message ?? "Review not found" }, 404)
  }
  if (review.kind !== "partner") {
    return json({ ok: true, posted: false, reason: "non_partner_review" }, 200)
  }

  // 2. Project → member → church name.
  const { data: project } = await supabase
    .from("strategy_web_projects")
    .select("id, member, name")
    .eq("id", review.web_project_id)
    .maybeSingle<ProjectRow>()
  let churchName = project?.name ?? `Project ${review.web_project_id}`
  if (project?.member != null) {
    const { data: account } = await supabase
      .from("strategy_account_progress")
      .select("member, church_name")
      .eq("member", project.member)
      .maybeSingle<AccountRow>()
    if (account?.church_name) churchName = account.church_name
  }

  // 3. Count partner edit requests on this review. The edit count
  //    drives the headline: "ready for design" vs "schedule
  //    revisions." We count author_kind='partner' AND kind='requested'
  //    because that's the comment shape PortalReviewPage produces
  //    when a partner marks a section "Request changes" — see the
  //    requestedCount filter in PortalReviewPage.tsx.
  const { data: comments, error: commentsErr } = await supabase
    .from("web_review_comments")
    .select("kind, author_kind, author_external_name, created_at")
    .eq("review_id", review_id)
    .order("created_at", { ascending: false })
  if (commentsErr) {
    return json({ error: commentsErr.message }, 500)
  }
  const partnerComments = comments ?? []
  const editCount    = partnerComments.filter(c => c.author_kind === "partner" && c.kind === "requested").length
  const commentCount = partnerComments.filter(c => c.author_kind === "partner" && c.kind === "comment").length

  // Submitted-by fallback chain. web_reviews.partner_name isn't
  // written until the partner clicks finish (see the NameCaptureModal
  // comment in PortalReviewPage.tsx for the rationale — first visitor
  // shouldn't claim the review). Historical reviews + any race with
  // older clients can leave partner_name null, so fall through to the
  // most recent partner-authored comment's author_external_name, which
  // the partner DOES type before commenting.
  const reviewName = review.partner_name?.trim()
  const fallbackName = partnerComments
    .find(c => c.author_kind === "partner"
            && typeof c.author_external_name === "string"
            && (c.author_external_name as string).trim().length > 0)
    ?.author_external_name as string | undefined
  const submittedBy = reviewName || fallbackName?.trim() || "(unnamed partner)"

  // 4. Compose the message.
  const headerText = editCount >= 1
    ? "Copywriting edits submitted — schedule revisions"
    : "Copy review complete — ready for design"
  const memberLabel = project?.member != null ? `#${project.member}` : "(no member)"
  const fallback = `${churchName} (${memberLabel}) — ${headerText} (${editCount} edits, R${review.round_number})`

  const appOrigin = Deno.env.get("APP_ORIGIN") ?? "https://strategy.thesqd.com"
  const reviewUrl = project?.member != null
    ? `${appOrigin}/churches/${project.member}`
    : `${appOrigin}/`

  const blocks = [
    { type: "header", text: { type: "plain_text", text: headerText, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Church:*\n${churchName}` },
        { type: "mrkdwn", text: `*Member:*\n${memberLabel}` },
        { type: "mrkdwn", text: `*Submitted by:*\n${submittedBy}` },
        { type: "mrkdwn", text: `*Round:*\nR${review.round_number}` },
        { type: "mrkdwn", text: `*Edits requested:*\n${editCount}` },
        { type: "mrkdwn", text: `*Partner comments:*\n${commentCount}` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in Site Manager", emoji: true },
          url: reviewUrl,
          style: "primary",
        },
      ],
    },
  ]

  const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${slackToken}` },
    body: JSON.stringify({ channel, text: fallback, blocks, unfurl_links: false, unfurl_media: false }),
  })
  const slackBody = await slackRes.json().catch(() => null)
  if (!slackBody?.ok) {
    console.error("[notify-web-review-submitted] slack post failed:", slackBody)
    return json({ ok: false, posted: false, reason: "slack_post_failed", slack: slackBody }, 200)
  }

  return json({
    ok:              true,
    posted:          true,
    channel,
    review_id,
    edit_count:      editCount,
    comment_count:   commentCount,
    round_number:    review.round_number,
    member:          project?.member ?? null,
    headline:        headerText,
  }, 200)
})
