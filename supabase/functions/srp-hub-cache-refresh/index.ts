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
//   STRATEGY_SQUAD_API_KEY   Squad API gateway key. Authenticates against
//                            api.thesqd.com; the gateway then talks to
//                            ClickUp. Do NOT swap in a raw ClickUp personal
//                            token here — a raw token wouldn't reach the
//                            gateway, and the gateway key can't hit
//                            api.clickup.com directly.
//   NOTION_TOKEN             (optional — SMM assignments; skipped if missing)
//   NOTION_SMM_DB_ID         (optional — Notion database ID for SMM assignments)
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

const SQUAD_API_BASE = "https://api.thesqd.com";

// ── Squad API → ClickUp: fetch all sms-sermon-recap tasks ────────────────────
//
// STRATEGY_SQUAD_API_KEY is a Squad API GATEWAY key, not a raw ClickUp token.
// It authenticates against https://api.thesqd.com and the gateway calls
// ClickUp on our behalf. Sending it directly to api.clickup.com always 401s
// because ClickUp has no idea what key that is. Route through the gateway's
// /v1/tasks/list endpoint instead; it returns tasks with account/member
// numbers already attached, so we can drop the leading-number regex the
// old code used to sniff a member out of the task title.

interface SquadTaskRow {
  id?:            string;
  name?:          string;
  account?:       number | string;
  church_name?:   string;
  status?:        string;
  date_created?:  string | number;
  date_updated?:  string | number;
  due_date?:      string | number | null;
  url?:           string;
  assignees?:     Array<{ username?: string; email?: string }>;
}

async function fetchSrpTasks(squadApiKey: string) {
  // Paginate through the full result set. Keep paging until a short
  // page returns; PER_PAGE (below) is intentionally small to stay
  // under the gateway's upstream query timeout.
  const allTasks: Array<{
    member:       number;
    id:           string;
    name:         string;
    status:       string;
    date_created: string;
    assignees:    string[];
    url:          string;
    updatedAt:    string;
  }> = [];

  // per_page is deliberately small: at 250 the gateway's upstream DB
  // query hit a statement timeout (502). 50 works most of the time,
  // and pages that time out are retried once before we fall back to
  // partial results.
  const PER_PAGE       = 50;
  const FETCH_TIMEOUT  = 25_000; // per-request abort (ms)
  const TOTAL_BUDGET   = 60_000; // total time budget for the fetch loop (ms)
  const started        = Date.now();

  let page = 1;
  while (true) {
    // Soft total-time budget. Bail with whatever we have if we're
    // about to blow past 60s — the edge function itself gets killed
    // at 150s idle, so we need to leave room for the Notion fetch
    // and the Supabase upserts.
    if (Date.now() - started > TOTAL_BUDGET) {
      console.warn(`[srp-hub-cache-refresh] page ${page} skipped: total-time budget exceeded; returning partial results`);
      break;
    }

    const url = new URL(`${SQUAD_API_BASE}/v1/tasks/list`);
    url.searchParams.set("tag",            "sms-sermon-recap");
    url.searchParams.set("include_closed", "true");
    url.searchParams.set("per_page",       String(PER_PAGE));
    url.searchParams.set("page",           String(page));

    // Per-page retry with abort. Each individual fetch is bounded so
    // a hung upstream can't burn the whole edge function budget.
    // Retry once on 5xx/timeout, bail with partial results after that.
    let res: Response | null = null;
    let lastErr: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 500));
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
      try {
        const r = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${squadApiKey}` },
          signal:  ac.signal,
        });
        if (r.ok) { res = r; break }
        const body = await r.text().catch(() => "");
        lastErr = `${r.status}: ${body.slice(0, 200)}`;
        if (r.status < 500 && r.status !== 429) break; // non-retriable
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!res) {
      if (page === 1) throw new Error(`Squad API error ${lastErr}`);
      console.warn(`[srp-hub-cache-refresh] page ${page} failed after retries (${lastErr}); returning partial results`);
      break;
    }

    const payload = await res.json();
    // The gateway wraps rows under `tasks` today; be defensive in case a
    // future version returns a bare array or a different envelope key.
    const rows: SquadTaskRow[] =
      (Array.isArray(payload?.tasks)   && payload.tasks)   ||
      (Array.isArray(payload?.data)    && payload.data)    ||
      (Array.isArray(payload?.results) && payload.results) ||
      (Array.isArray(payload)          && payload)         ||
      [];
    if (rows.length === 0) break;

    // Debug: log first row shape so we can see what fields Squad API returns
    for (const t of rows) {
      const memberRaw = t.account;
      const member = typeof memberRaw === "number" ? memberRaw : Number(memberRaw);
      if (!Number.isFinite(member) || member <= 0) continue;

      const updatedAtMs = Number(t.date_updated ?? 0);
      const createdAtMs = Number(t.date_created ?? 0);

      allTasks.push({
        member,
        id:           t.id ?? "",
        name:         t.name ?? "",
        status:       t.status ?? "",
        date_created: createdAtMs ? new Date(createdAtMs).toISOString() : "",
        assignees:    (t.assignees ?? []).map(a => a.username ?? a.email ?? ""),
        url:          t.url ?? "",
        updatedAt:    updatedAtMs ? new Date(updatedAtMs).toISOString() : "",
      });
    }

    // Break once we've clearly consumed the last page — a page shorter
    // than PER_PAGE is the tail.
    if (rows.length < PER_PAGE) break;
    page += 1;
    // Safety valve — shouldn't happen given the current data set, but
    // prevents a runaway loop if the API misbehaves.
    if (page > 20) break;
  }

  // Most recent task per member (same shape the frontend already reads).
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
    createdAt: t.date_created,
    updatedAt: t.updatedAt,
    url:       t.url,
  }));

  return { tasks, allTasks };
}

// ── ClickUp v2 direct: fetch timestamps for all sms-sermon-recap tasks ────────
// Squad API strips date_created/date_updated so we call ClickUp v2 directly
// for the last 90 days and return a map of taskId → { date_created, date_updated }.
async function fetchTaskTimestamps(clickupToken: string): Promise<Map<string, { date_created: string; updatedAt: string }>> {
  const since90 = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const result = new Map<string, { date_created: string; updatedAt: string }>();
  let page = 0;

  while (true) {
    const url = new URL(`https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/task`);
    url.searchParams.set("tags[]", "sms-sermon-recap");
    url.searchParams.set("include_closed", "true");
    url.searchParams.set("date_updated_gt", String(since90));
    url.searchParams.set("page", String(page));

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25_000);
    let res: Response | null = null;
    try {
      const r = await fetch(url.toString(), { headers: { Authorization: clickupToken }, signal: ac.signal });
      if (r.ok) res = r;
    } catch { /* ignore */ } finally { clearTimeout(timer); }
    if (!res) break;

    const payload = await res.json();
    const rows: Array<{ id?: string; date_created?: string | number; date_updated?: string | number }> =
      Array.isArray(payload?.tasks) ? payload.tasks : [];
    if (rows.length === 0) break;

    for (const t of rows) {
      if (!t.id) continue;
      const createdMs = Number(t.date_created ?? 0);
      const updatedMs = Number(t.date_updated ?? 0);
      result.set(t.id, {
        date_created: createdMs ? new Date(createdMs).toISOString() : "",
        updatedAt:    updatedMs ? new Date(updatedMs).toISOString() : "",
      });
    }

    if (payload?.last_page !== false) break;
    page += 1;
    if (page > 20) break;
  }

  return result;
}

// ── ClickUp v2 direct: this week's SRP tasks (Fri–Thu work week) ─────────────
// Calls ClickUp's v2 API directly (not Squad API gateway) because the gateway
// strips due_date. Uses due_date_gt to filter server-side so we only fetch
// ~50 tasks instead of 450+. Requires CLICKUP_API_TOKEN secret.
//
// Member number is extracted from the task name prefix (e.g. "4077 - ...").

const CLICKUP_TEAM_ID = "1235435";

function getWeekStartTimestamp(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  // getDay(): 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  const daysSinceFri = now.getDay() === 5 ? 0 : now.getDay() === 6 ? 1 : now.getDay() + 2;
  now.setDate(now.getDate() - daysSinceFri);
  return now.getTime();
}

function extractMemberFromTaskName(name: string): number | null {
  const m = name.match(/^(\d+)\s*-/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchSrpTasksThisWeek(clickupToken: string): Promise<{
  tasks: Array<{ member: number; taskId: string; taskName: string; status: string; dueDate: string }>;
  total: number;
}> {
  const weekStartMs = getWeekStartTimestamp();
  const allTasks: Array<{ member: number; taskId: string; taskName: string; status: string; dueDate: string }> = [];

  const FETCH_TIMEOUT = 25_000;
  let page = 0;

  while (true) {
    const url = new URL(`https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/task`);
    url.searchParams.set("tags[]",         "sms-sermon-recap");
    url.searchParams.set("include_closed", "true");
    url.searchParams.set("page",           String(page));
    url.searchParams.set("due_date_gt",    String(weekStartMs));

    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 500));
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
      try {
        const r = await fetch(url.toString(), {
          headers: { Authorization: clickupToken },
          signal:  ac.signal,
        });
        if (r.ok) { res = r; break; }
        if (r.status < 500 && r.status !== 429) break;
      } catch { /* retry */ } finally { clearTimeout(timer); }
    }
    if (!res) break;

    const payload = await res.json();
    const rows: Array<{ id?: string; name?: string; status?: { status?: string }; due_date?: string | number | null }> =
      Array.isArray(payload?.tasks) ? payload.tasks : [];

    if (rows.length === 0) break;

    for (const t of rows) {
      const member = extractMemberFromTaskName(t.name ?? "");
      if (!member) continue;
      const dueDateMs = Number(t.due_date ?? 0);
      allTasks.push({
        member,
        taskId:   t.id ?? "",
        taskName: t.name ?? "",
        status:   t.status?.status ?? "",
        dueDate:  dueDateMs ? new Date(dueDateMs).toISOString() : "",
      });
    }

    if (payload?.last_page !== false) break; // last_page=true or absent means done
    page += 1;
    if (page > 20) break;
  }

  return { tasks: allTasks, total: allTasks.length };
}

// ── Notion: fetch SMM assignments ─────────────────────────────────────────────
// Source: All-In Members database (collection://1f2e83f7-31f6-80f0-b787-000b47cfcde6)
// Properties: "Member #" (number), "SMS Team Member" (select)

// All-In Members database in the Church Media Squad workspace.
// The branch's original constant (1f2e83f7-31f6-80f0-b787-000b47cfcde6)
// was a different UUID entirely and never returned rows — this is
// the id parsed from the actual database URL and it matches the
// "All-In Members" view Ashley pointed us at.
const ALL_IN_MEMBERS_DB = "1f2e83f7-31f6-80e7-a10f-e7b9ea728a44";

async function fetchSmmAssignments(notionToken: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // Squad API gateway key. This is NOT a ClickUp token — it authenticates
  // against api.thesqd.com, which then calls ClickUp on our behalf. See
  // fetchSrpTasks above for the endpoint contract.
  const squadApiKey = Deno.env.get("STRATEGY_SQUAD_API_KEY");
  if (!squadApiKey) {
    return json({ error: "STRATEGY_SQUAD_API_KEY not set" }, 500);
  }

  const results: Record<string, string> = {};

  // ── SRP tasks (all) + this week's tasks ─────────────────────────────────────
  // srp_tasks_this_week uses CLICKUP_API_TOKEN directly (v2 API) because the
  // Squad API gateway strips due_date — without it we can't filter by week.
  const clickupToken = Deno.env.get("CLICKUP_STRATEGY_MILESTONE_TOKEN") ?? Deno.env.get("CLICKUP_API_KEY") ?? "";
  try {
    const [srpData, srpWeekData, timestamps] = await Promise.all([
      fetchSrpTasks(squadApiKey),
      clickupToken
        ? fetchSrpTasksThisWeek(clickupToken)
        : Promise.resolve({ tasks: [], total: 0 }),
      clickupToken
        ? fetchTaskTimestamps(clickupToken)
        : Promise.resolve(new Map<string, { date_created: string; updatedAt: string }>()),
    ]);

    // Merge real timestamps from ClickUp v2 into allTasks (Squad API strips them)
    for (const t of srpData.allTasks) {
      const ts = timestamps.get(t.id);
      if (ts) {
        if (ts.date_created) t.date_created = ts.date_created;
        if (ts.updatedAt)    t.updatedAt    = ts.updatedAt;
      }
    }
    // Also patch the per-member summary tasks
    for (const t of srpData.tasks) {
      const ts = timestamps.get(t.taskId);
      if (ts) {
        if (ts.date_created) t.createdAt = ts.date_created;
        if (ts.updatedAt)    t.updatedAt = ts.updatedAt;
      }
    }
    await Promise.all([
      supabase.from("strategy_srp_hub_cache").upsert({
        cache_key:    "srp_tasks",
        data:         srpData,
        refreshed_at: new Date().toISOString(),
      }, { onConflict: "cache_key" }),
      supabase.from("strategy_srp_hub_cache").upsert({
        cache_key:    "srp_tasks_this_week",
        data:         srpWeekData,
        refreshed_at: new Date().toISOString(),
      }, { onConflict: "cache_key" }),
    ]);
    results.srp_tasks = `ok — ${srpData.tasks.length} churches, ${srpWeekData.total} this week`;
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

  // ── Background pipeline: kick off transcript pre-generation for new tasks ────
  // For each task in srp_tasks_this_week that doesn't already have a session,
  // fire srp-pipeline-start (fire-and-forget). This runs after the cache
  // upserts so the result json returns promptly.
  const pipelineWork = (async () => {
    const clickupT = clickupToken;
    if (!clickupT) return;

    // Only run the pipeline for tasks in these ClickUp statuses.
    // Closed tasks and any other status are skipped.
    const PIPELINE_STATUSES = new Set(["dependent", "received"]);

    let weekTasks: Array<{ member: number; taskId: string; taskName: string; status?: string }> = [];
    try {
      const cacheRow = await supabase
        .from("strategy_srp_hub_cache")
        .select("data")
        .eq("cache_key", "srp_tasks_this_week")
        .maybeSingle();
      weekTasks = (cacheRow.data?.data as typeof weekTasks)?.tasks ?? [];
    } catch { /* non-fatal */ }

    if (weekTasks.length === 0) return;

    // Find which task IDs already have sessions
    const taskIds = weekTasks.map(t => t.taskId).filter(Boolean);
    const { data: existingSessions } = await supabase
      .schema("srp_pipeline")
      .from("sessions")
      .select("clickup_task_id")
      .in("clickup_task_id", taskIds)
      .neq("status", "archived");

    const alreadyHasSession = new Set(
      (existingSessions ?? []).map((s: { clickup_task_id: string | null }) => s.clickup_task_id).filter(Boolean)
    );

    // Also need church names — look up from strategy_srp_hub_cache srp_tasks
    const allTasksCache = await supabase
      .from("strategy_srp_hub_cache")
      .select("data")
      .eq("cache_key", "srp_tasks")
      .maybeSingle();
    const churchNameMap = new Map<number, string>();
    for (const t of (allTasksCache.data?.data as { tasks?: Array<{ member: number; taskName?: string }> } | null)?.tasks ?? []) {
      if (t.member && !churchNameMap.has(t.member)) {
        // taskName format: "4077 - Church Name July 5 Sermon Recap Posts"
        const nameMatch = t.taskName?.match(/^\d+\s*-\s*(.+?)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)/i);
        churchNameMap.set(t.member, nameMatch?.[1]?.trim() ?? `Member ${t.member}`);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    for (const task of weekTasks) {
      if (alreadyHasSession.has(task.taskId)) continue;
      // Skip tasks that aren't in the eligible statuses, or are closed
      const taskStatus = (task.status ?? "").toLowerCase().trim();
      if (!PIPELINE_STATUSES.has(taskStatus)) continue;
      const churchName = churchNameMap.get(task.member) ?? `Member ${task.member}`;
      fetch(`${supabaseUrl}/functions/v1/srp-pipeline-start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
        },
        body: JSON.stringify({ taskId: task.taskId, member: task.member, churchName }),
      }).catch(e => console.warn("[srp-hub-cache-refresh] pipeline-start failed:", e));
    }

    results.pipeline = `fired for ${weekTasks.filter(t => !alreadyHasSession.has(t.taskId)).length} new tasks`;
  })();

  try {
    // @ts-expect-error EdgeRuntime available in Supabase Edge Functions
    EdgeRuntime.waitUntil(pipelineWork);
  } catch {
    await pipelineWork;
  }

  return json({ ok: true, refreshed_at: new Date().toISOString(), results });
});
