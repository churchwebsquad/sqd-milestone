// srp-hub-cache-refresh — Supabase Edge Function
//
// Fetches ClickUp sms-sermon-recap tasks + Notion SMM assignments and
// writes them into strategy_srp_hub_cache so the Social Hub reads from
// Supabase instead of hitting external APIs on every page load.
//
// Called by pg_cron 5× per day (see schema/v80_srp_hub_cache.sql).
// Can also be triggered manually from the Social Hub "Refresh" button.
//
// Secrets required (set in Supabase dashboard → Edge Functions → Secrets):
//   CLICKUP_API_TOKEN
//   NOTION_TOKEN          (optional — SMM assignments; skipped if missing)
//   NOTION_SMM_DB_ID      (optional — Notion database ID for SMM assignments)
// Built-in:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const CLICKUP_TEAM_ID = "1235435";

// ── ClickUp: fetch all sms-sermon-recap tasks ─────────────────────────────────

async function fetchSrpTasks(token: string) {
  const url = `https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/task?tags[]=sms-sermon-recap&page=0&order_by=updated&page_size=100&include_closed=true`;
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`ClickUp API error: ${res.status}`);
  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTasks: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const task of (data.tasks ?? []) as any[]) {
    const match = String(task.name ?? "").match(/^(\d+)\s*-/);
    if (!match) continue;
    const member = parseInt(match[1], 10);
    allTasks.push({
      member,
      id:           task.id,
      name:         task.name,
      status:       task.status?.status ?? "",
      date_created: task.date_created ?? "",
      assignees:    (task.assignees ?? []).map((a: any) => a.username ?? a.email ?? ""),
      url:          task.url ?? "",
      updatedAt:    new Date(Number(task.date_updated ?? 0)).toISOString(),
    });
  }

  // Most recent task per member
  const byMember = new Map<number, typeof allTasks[0]>();
  for (const t of allTasks) {
    const existing = byMember.get(t.member);
    if (!existing || t.updatedAt > existing.updatedAt) byMember.set(t.member, t);
  }

  const tasks = Array.from(byMember.entries()).map(([member, t]) => ({
    member,
    taskId:    t.id,
    taskName:  t.name,
    status:    t.status,
    createdAt: new Date(Number(t.date_created || 0)).toISOString(),
    updatedAt: t.updatedAt,
  }));

  return { tasks, allTasks };
}

// ── Notion: fetch SMM assignments ─────────────────────────────────────────────
// Source: All-In Members database (collection://1f2e83f7-31f6-80f0-b787-000b47cfcde6)
// Properties: "Member #" (number), "SMS Team Member" (select)

const ALL_IN_MEMBERS_DB = "1f2e83f7-31f6-80f0-b787-000b47cfcde6";

async function fetchSmmAssignments(notionToken: string) {
  let allResults: any[] = [];
  let startCursor: string | undefined;

  // Paginate through all results (Notion returns max 100 per page)
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${ALL_IN_MEMBERS_DB}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { assignments: [] };
    const data = await res.json();
    allResults = allResults.concat(data.results ?? []);
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignments = allResults.flatMap((page: any) => {
    const props  = page.properties ?? {};
    const member = props["Member #"]?.number;
    const smm    = props["SMS Team Member"]?.select?.name ?? null;
    if (!member || !smm || smm === "Cancelled") return [];
    return [{ member: Number(member), smm }];
  });
  return { assignments };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const clickupToken = Deno.env.get("CLICKUP_API_TOKEN");
  if (!clickupToken) return json({ error: "CLICKUP_API_TOKEN not set" }, 500);

  const results: Record<string, string> = {};

  // ── SRP tasks ────────────────────────────────────────────────────────────────
  try {
    const srpData = await fetchSrpTasks(clickupToken);
    await supabase.from("strategy_srp_hub_cache").upsert({
      cache_key:    "srp_tasks",
      data:         srpData,
      refreshed_at: new Date().toISOString(),
    }, { onConflict: "cache_key" });
    results.srp_tasks = `ok — ${srpData.tasks.length} churches`;
  } catch (e) {
    results.srp_tasks = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  // ── SMM assignments ───────────────────────────────────────────────────────────
  // DB ID is hardcoded (All-In Members). Only requires NOTION_TOKEN secret.
  const notionToken = Deno.env.get("NOTION_TOKEN");
  if (notionToken) {
    try {
      const smmData = await fetchSmmAssignments(notionToken);
      await supabase.from("strategy_srp_hub_cache").upsert({
        cache_key:    "smm_assignments",
        data:         smmData,
        refreshed_at: new Date().toISOString(),
      }, { onConflict: "cache_key" });
      results.smm_assignments = `ok — ${smmData.assignments.length} assignments`;
    } catch (e) {
      results.smm_assignments = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    results.smm_assignments = "skipped — NOTION_TOKEN not set";
  }

  return json({ ok: true, refreshed_at: new Date().toISOString(), results });
});
