// notify-site-evaluation-ready (v118)
//
// Fires when an AM flips "Ready for site evaluation" to true on the
// Church Details → Web Squad → Initial Site Access checklist.
// Posts to #am-pm-web with a summary of which migration prerequisites
// the partner has actually completed so the scheduler knows what's
// in hand.
//
// Reuses the existing SLACK_BOT_TOKEN setup (same bot as
// notify-content-collection-submitted). Channel: SLACK_AM_PM_WEB_CHANNEL
// env var, falls back to #am-pm-web.
//
// Body:
//   { member: number }   required
//
// Idempotent: called by the frontend after the optimistic flip. If the
// state isn't actually "ready" (or the row doesn't exist), returns
// 200 with `posted: false` so the caller doesn't have to interpret
// failure as a fatal error.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ChurchRow {
  member:                              number;
  church_name:                         string | null;
  web_squad_site_access_provided:      boolean | null;
  web_squad_hosting_details_provided:  boolean | null;
  web_squad_domain_registrar_provided: boolean | null;
  web_squad_login_in_1password:        boolean | null;
  web_squad_ga_access_shared:          boolean | null;
  web_squad_ready_for_evaluation:      boolean | null;
}

const yesNo = (v: boolean | null): string => v === true ? '✅' : v === false ? '⛔ Explicit no' : '⚪ Not yet';

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let member: number | undefined;
  try {
    const body = await req.json();
    member = typeof body?.member === "number" ? body.member : undefined;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!member) return json({ error: "member required" }, 400);

  const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
  if (!slackToken) return json({ ok: true, posted: false, reason: "slack_bot_token_unset" }, 200);
  const channel = Deno.env.get("SLACK_AM_PM_WEB_CHANNEL") ?? "#am-pm-web";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: church, error } = await supabase
    .from("strategy_account_progress")
    .select("member, church_name, web_squad_site_access_provided, web_squad_hosting_details_provided, web_squad_domain_registrar_provided, web_squad_login_in_1password, web_squad_ga_access_shared, web_squad_ready_for_evaluation")
    .eq("member", member)
    .maybeSingle<ChurchRow>();
  if (error || !church) {
    return json({ ok: true, posted: false, reason: "church_not_found", details: error?.message }, 200);
  }
  // Defensive: only fire when the row actually says "ready". The
  // frontend should only call us when it flipped to true, but a stale
  // tab could re-trigger; bail rather than spamming Slack.
  if (church.web_squad_ready_for_evaluation !== true) {
    return json({ ok: true, posted: false, reason: "not_ready_state" }, 200);
  }

  const churchLabel = church.church_name ?? `Member ${church.member}`;
  const lines = [
    `🟢 *Ready for site evaluation to be scheduled — ${churchLabel}*`,
    ``,
    `*Site access*`,
    `• CMS / admin login: ${yesNo(church.web_squad_site_access_provided)}`,
    `• GA access shared: ${yesNo(church.web_squad_ga_access_shared)}`,
    `• Login in 1Password: ${yesNo(church.web_squad_login_in_1password)}`,
    ``,
    `*Migration details provided*`,
    `• Hosting details: ${yesNo(church.web_squad_hosting_details_provided)}`,
    `• Domain registrar confirmation: ${yesNo(church.web_squad_domain_registrar_provided)}`,
    ``,
    `Member #${church.member}.`,
  ];
  const text = lines.join("\n");

  const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${slackToken}` },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
  });
  const slackBody = await slackRes.json().catch(() => null);
  if (!slackBody?.ok) {
    console.error("[notify-site-evaluation-ready] Slack post failed:", slackBody);
    return json({ ok: true, posted: false, reason: "slack_post_failed", slack: slackBody }, 200);
  }
  return json({ ok: true, posted: true, ts: slackBody.ts, channel }, 200);
});
