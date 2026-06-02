// refresh-snippets-from-content-collection — reconcile a project's
// snippet store with the most authoritative sources WITHOUT spending
// a Firecrawl token.
//
// Sources, in precedence order (later wins):
//   1. Crawl inventory items (web_project_topics) — canonical pastor
//      name from leadership.staff items, service times from sundays
//      detail items, main phone/email/address from location_contact
//      contact_block/location_info items.
//   2. Web-project globals (strategy_web_projects.social_*) — already
//      filled by fire-crawl-trigger; mirrored here as snippets so the
//      Inventory Snippets panel surfaces them.
//   3. Partner Content Collection answers — Step 1 marks
//      (answer:<bucket>/<field>) + Step 2 session fields. Partner
//      overrides the crawl, since their answer is the most current
//      and intentional source.
//
// Triggered:
//   • Automatically when a session transitions to status='submitted'
//     (called from the partner page's submit flow).
//   • Manually from the staff Intake & Crawl page via the "Refresh
//     snippets" button.
//
// Returns counts ({updated, created, skipped, globals_filled,
// considered}) so the caller can surface a status.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Map: answer:<bucket>/<field> → snippet token (or strategy_web_projects column).
 *  Keep this list small + curated — only fields where the partner's
 *  text is a clean, atomic value the snippet would carry. Multi-line
 *  HTML / freeform notes go into the session row, not snippets. */
const ANSWER_TO_TOKEN: Record<string, { token: string; label: string }> = {
  // Contact bucket → general church-wide contact
  "contact/phone":              { token: "phone",             label: "Main Phone" },
  "contact/email":              { token: "email",             label: "Main Email" },
  "contact/address":            { token: "address",           label: "Main Church Address" },
  "contact/parking":            { token: "parking_notes",     label: "Parking notes" },
  // Service / weekend details
  "service_details/service_times":  { token: "main_service_times", label: "Main Service Times" },
  "service_details/service_length": { token: "service_length",     label: "Service Length" },
  // Staff
  "staff/lead_pastor":          { token: "pastor_name",       label: "Lead Pastor" },
  // Social
  "social_newsletter/social_links": { token: "social_handles", label: "Social Handles" },
  // Photo library
  "branding_photos/photo_library":  { token: "photo_library_url", label: "Photo library URL" },
  // Groups
  "small_groups/group_name":    { token: "group_name",        label: "Group brand name" },
  "small_groups/contact":       { token: "groups_contact",    label: "Groups contact" },
  // Baptism
  "baptism/signup":             { token: "baptism_signup_url", label: "Baptism signup" },
};

/** Map: Step 2 session column → snippet token + value-extractor. */
const SESSION_FIELD_TO_TOKEN: Array<{
  col:      string;
  token:    string;
  label:    string;
  /** Optional extractor for non-string columns (booleans / arrays).
   *  Returns the snippet value or null to skip. */
  extract?: (v: unknown) => string | null;
}> = [
  { col: "events_external_url",        token: "events_url",          label: "Events URL" },
  { col: "sermons_external_url",       token: "sermons_url",         label: "Sermons channel URL" },
  { col: "groups_external_url",        token: "groups_url",          label: "Groups URL" },
  { col: "blog_existing_url",          token: "blog_url",            label: "Existing blog URL" },
  { col: "sermon_youtube_playlist_url",token: "sermon_playlist_url", label: "Sermon playlist URL" },
  { col: "domain_registrar_url",       token: "domain_registrar_url",label: "Domain registrar URL" },
];

/** Tokens that should sync to strategy_web_projects global columns
 *  instead of (or in addition to) the snippets table. Reuses the
 *  categorizer's global-routing convention. */
const TOKEN_TO_GLOBAL_COLUMN: Record<string, string> = {
  phone:              "phone",
  email:              "email",
  address:            "address",
  pastor_name:        "pastor_name",
  church_name:        "church_name",
  all_service_times:  "all_service_times",
  facebook_url:       "social_facebook_url",
  instagram_url:      "social_instagram_url",
  youtube_url:        "social_youtube_url",
  tiktok_url:         "social_tiktok_url",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const payload = await req.json();
    if (!payload?.session_id) return j({ error: "session_id required" }, 400);

    // Load session + marks
    const { data: session, error: sErr } = await supabase
      .from("strategy_content_collection_sessions")
      .select("*")
      .eq("id", payload.session_id)
      .maybeSingle();
    if (sErr || !session) return j({ error: "session not found", details: sErr?.message }, 404);

    const projectId = session.web_project_id as string;

    // Load crawl-side authoritative sources in parallel:
    //   • Topics with items the canonical-value extractors care about.
    //   • Web-project globals (social URLs + already-curated phone /
    //     email / address / pastor_name when the categorizer routed
    //     them upstream).
    //   • The session's marks (Step 1 partner edits).
    const [topicsRes, projRes, marksRes] = await Promise.all([
      supabase.from("web_project_topics")
        .select("topic_key, items")
        .eq("web_project_id", projectId)
        .in("topic_key", ["leadership", "sundays", "location_contact", "sermons"]),
      supabase.from("strategy_web_projects")
        .select("member, social_youtube_url, social_facebook_url, social_instagram_url, social_tiktok_url")
        .eq("id", projectId)
        .maybeSingle(),
      supabase.from("strategy_content_collection_marks")
        .select("target_path, client_note")
        .eq("session_id", payload.session_id),
    ]);
    const topics: Record<string, { items: unknown[] }> = {};
    for (const t of (topicsRes.data ?? []) as { topic_key: string; items: unknown[] }[]) {
      topics[t.topic_key] = { items: Array.isArray(t.items) ? t.items : [] };
    }
    const proj = (projRes.data ?? null) as Record<string, string | number | null> | null;
    const marks = (marksRes.data ?? []) as { target_path: string; client_note: string | null }[];

    // Pull church_name + AM-curated social handles from
    // strategy_account_progress. These are the system of record for
    // partner-supplied identity values and the only place
    // FB/IG/handles live when fire-crawl-trigger's URL regex didn't
    // catch them. Joined via member, which lives on strategy_web_projects.
    let acct: Record<string, string | null> | null = null;
    if (proj?.member != null) {
      const { data: a } = await supabase.from("strategy_account_progress")
        .select("church_name, facebook, facebook_link, instagram, instagram_link, youtube")
        .eq("member", proj.member)
        .maybeSingle();
      acct = (a ?? null) as Record<string, string | null> | null;
    }

    // Build the to-upsert list of { token, label, value, isGlobal }.
    // Order matters — higher `order` wins same-token conflicts.
    //   0: Web-project non-social globals (phone / email / address /
    //      pastor_name). These come from the categorizer's LLM, which
    //      can hallucinate (Desert Springs had pastor_name "Brad
    //      Speaking"), so they're the lowest-priority fallback.
    //   1: Web-project social-URL globals. These come from
    //      fire-crawl-trigger's regex pattern match — high-confidence,
    //      not LLM-generated. Beats the non-social fallback.
    //   2: Crawl-inventory canonical values (extracted from
    //      web_project_topics items). Structured, post-merge,
    //      authoritative — beats both global flavors above.
    //   3: Partner Content Collection answers. Highest authority.
    type Pending = { token: string; label: string; value: string; isGlobal: boolean; order: number };
    const pending: Pending[] = [];

    const addPending = (token: string, label: string, value: string, order: number) => {
      const v = value.trim();
      if (!v) return;
      pending.push({
        token,
        label,
        value: v,
        isGlobal: Boolean(TOKEN_TO_GLOBAL_COLUMN[token]),
        order,
      });
    };

    // NOTE — we deliberately do NOT seed non-social globals from
    // strategy_web_projects at order 0. The categorizer's LLM can
    // hallucinate these (Desert Springs had pastor_name='Brad
    // Speaking', phone='17460572703' — both fabricated). If the crawl
    // inventory (source 2) doesn't surface a value, the global gets
    // NULLed at write time so the UI shows blank rather than bogus
    // data. Partners can re-fill via Content Collection if needed.

    // ── Source 1: Web-project social globals + AM-curated handles ──
    // Social URLs from fire-crawl-trigger's regex match are the most
    // reliable (no LLM hallucination). When those are absent, fall
    // back to the AM-curated strategy_account_progress.{facebook_link,
    // instagram_link, youtube} which the team filled in by hand.
    const social = {
      facebook:  (proj?.social_facebook_url  as string | null) ?? (acct?.facebook_link  ?? acct?.facebook  ?? null),
      instagram: (proj?.social_instagram_url as string | null) ?? (acct?.instagram_link ?? acct?.instagram ?? null),
      youtube:   (proj?.social_youtube_url   as string | null) ?? acct?.youtube ?? null,
      tiktok:    (proj?.social_tiktok_url    as string | null) ?? null,
    };
    if (social.youtube)   addPending("youtube_url",   "YouTube URL",   String(social.youtube),   1);
    if (social.facebook)  addPending("facebook_url",  "Facebook URL",  String(social.facebook),  1);
    if (social.instagram) addPending("instagram_url", "Instagram URL", String(social.instagram), 1);
    if (social.tiktok)    addPending("tiktok_url",    "TikTok URL",    String(social.tiktok),    1);
    // Sermon archive URL — when the categorizer didn't carry the
    // YouTube channel into the sermons topic, mirror the global so
    // the snippet surfaces in the inventory.
    if (social.youtube)   addPending("sermons_url",   "Sermons channel URL", String(social.youtube), 1);
    // Church name — system of record is strategy_account_progress
    // (partner-confirmed). Crawl items rarely surface the proper name
    // as a structured value, so this is the canonical source.
    if (acct?.church_name) addPending("church_name", "Church name", acct.church_name, 1);

    // ── Source 2: Crawl-inventory canonical values ────────────────
    extractCrawlCanonicals(topics, (token, label, value) => addPending(token, label, value, 2));

    // ── Source 3: Partner Step 1 answer marks ─────────────────────
    for (const m of marks) {
      if (!m.target_path.startsWith("answer:")) continue;
      const key = m.target_path.slice(7); // "<bucket>/<field>"
      const mapping = ANSWER_TO_TOKEN[key];
      if (!mapping) continue;
      const v = (m.client_note ?? "").trim();
      if (!v) continue;
      addPending(mapping.token, mapping.label, v, 3);
    }

    // ── Source 3: Partner Step 2 session fields ───────────────────
    for (const f of SESSION_FIELD_TO_TOKEN) {
      const raw = (session as Record<string, unknown>)[f.col];
      const v = f.extract ? f.extract(raw) : (typeof raw === "string" ? raw.trim() : null);
      if (!v) continue;
      addPending(f.token, f.label, v, 3);
    }

    // Dedup pending list by token. Higher `order` wins (partner
    // answers beat crawl). At equal order, the longer / more
    // detailed value wins.
    const byToken = new Map<string, Pending>();
    for (const p of pending) {
      const cur = byToken.get(p.token);
      if (!cur) { byToken.set(p.token, p); continue; }
      if (p.order > cur.order) { byToken.set(p.token, p); continue; }
      if (p.order === cur.order && p.value.length > cur.value.length) byToken.set(p.token, p);
    }
    const items = Array.from(byToken.values());

    if (items.length === 0) {
      return j({ ok: true, updated: 0, created: 0, skipped: 0, message: "No reconcilable values found" }, 200);
    }

    // Split globals from custom snippets. Globals get a complete
    // write set: every authoritative global column we know about,
    // set to either the pending value (when a crawl/partner/account
    // source supplied one) or NULL (to clear stale LLM-hallucinated
    // values). Social URLs are included too — when the regex pass
    // doesn't catch them, we'd rather wipe stale data than preserve
    // it (the partner can re-supply via Content Collection).
    const GLOBAL_COLS_TO_RESET = [
      "phone", "email", "address", "pastor_name", "church_name",
      "all_service_times",
      "social_facebook_url", "social_instagram_url", "social_youtube_url", "social_tiktok_url",
    ];
    const globalUpdates: Record<string, string | null> = {};
    for (const col of GLOBAL_COLS_TO_RESET) globalUpdates[col] = null;
    // Also wipe the deprecated primary_service_time column whenever
    // the function runs — consolidated into all_service_times.
    globalUpdates["primary_service_time"] = null;
    const customItems: Pending[] = [];
    for (const p of items) {
      const col = TOKEN_TO_GLOBAL_COLUMN[p.token];
      if (col) globalUpdates[col] = p.value;
      else customItems.push(p);
    }

    // Globals → strategy_web_projects. Writes the whole set every
    // time: tokens that crawl/partner supplied get the new value;
    // tokens with no source get NULLed so bogus LLM data doesn't
    // linger. This is the policy: "if the crawl has no phone,
    // leave it blank."
    let globalsTouched = 0;
    if (Object.keys(globalUpdates).length > 0) {
      const { error: gErr } = await supabase
        .from("strategy_web_projects")
        .update(globalUpdates)
        .eq("id", session.web_project_id);
      if (gErr) console.error("[refresh-snippets] globals update failed:", gErr);
      else globalsTouched = Object.keys(globalUpdates).length;
    }

    // Custom snippets → web_project_snippets
    let updated = 0;
    let created = 0;
    let skipped = 0;
    if (customItems.length > 0) {
      const tokens = customItems.map(p => p.token);
      const { data: existing } = await supabase
        .from("web_project_snippets")
        .select("id, token, expansion, archived")
        .eq("web_project_id", session.web_project_id)
        .in("token", tokens);

      const existingByToken = new Map<string, { id: string; expansion: string | null; archived: boolean }>();
      for (const r of (existing ?? []) as { id: string; token: string; expansion: string | null; archived: boolean }[]) {
        existingByToken.set(r.token, { id: r.id, expansion: r.expansion, archived: Boolean(r.archived) });
      }

      for (const p of customItems) {
        const e = existingByToken.get(p.token);
        if (e) {
          // Value-match path: when an existing row already carries the
          // correct value, we still UPDATE if it's archived — a stale
          // archive shouldn't hide a value we just re-confirmed. Only
          // truly nothing-to-do (matching value AND active) is skipped.
          const valueMatches = (e.expansion ?? "").trim() === p.value;
          if (valueMatches && !e.archived) { skipped++; continue; }
          const { error: uErr } = await supabase
            .from("web_project_snippets")
            .update({ expansion: p.value, label: p.label, archived: false, source: "content_collection" })
            .eq("id", e.id);
          if (uErr) console.error("[refresh-snippets] update failed:", p.token, uErr);
          else updated++;
        } else {
          const { error: iErr } = await supabase
            .from("web_project_snippets")
            .insert({
              web_project_id: session.web_project_id,
              token:          p.token,
              label:          p.label,
              expansion:      p.value,
              description:    "Partner-supplied via Content Collection.",
              tags:           ["content_collection", "partner"],
              source:         "content_collection",
              archived:       false,
              used_count:     0,
            });
          if (iErr) console.error("[refresh-snippets] insert failed:", p.token, iErr);
          else created++;
        }
      }
    }

    // Archive any redundant snippet tokens whose concept now lives
    // exclusively on a global column. Without this, the snippet
    // panel would show the global value AND a duplicate custom
    // snippet (e.g. `all_service_times` global + `main_service_times`
    // snippet). One canonical row per concept.
    const REDUNDANT_TOKENS = [
      "service_time", "service_times",
      "sunday_service_time", "sunday_service_times",
      "main_service_time", "main_service_times",
      "primary_service_time",
    ];
    let archived = 0;
    const { data: redundant } = await supabase
      .from("web_project_snippets")
      .select("id, token")
      .eq("web_project_id", projectId)
      .eq("archived", false)
      .in("token", REDUNDANT_TOKENS);
    if (redundant && redundant.length > 0) {
      const ids = (redundant as { id: string }[]).map(r => r.id);
      const { error: archErr } = await supabase
        .from("web_project_snippets")
        .update({ archived: true })
        .in("id", ids);
      if (!archErr) archived = ids.length;
    }

    return j({
      ok: true,
      updated, created, skipped, archived,
      globals_filled: globalsTouched,
      considered: items.length,
    }, 200);
  } catch (err) {
    return j({ error: "Unexpected", details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function j(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Crawl-inventory canonical-value extractors ───────────────────────
//
// Walks the crawl items the LLM categorizer wrote to web_project_topics
// and pulls out one canonical value per known concept. These flow into
// the pending snippet list at `order=1` so anything the partner later
// supplies via Content Collection cleanly overrides them.

/** Called once per canonical value the extractor finds. The caller
 *  decides the `order` (priority) so this helper doesn't need to
 *  know about the global precedence chain. */
interface AddFn { (token: string, label: string, value: string): void }

function extractCrawlCanonicals(
  topics: Record<string, { items: unknown[] }>,
  add: AddFn,
): void {
  // ── Lead pastor name ──
  // Leadership.staff items where role contains "Lead Pastor". Multiple
  // people often share the role (Brad + Becky); join them naturally.
  const lp = topics["leadership"];
  if (lp) {
    const leads: string[] = [];
    let combined: string | null = null;
    for (const raw of lp.items) {
      const it = raw as Record<string, unknown>;
      if (it.kind !== "staff") continue;
      const role = String(it.role ?? "").toLowerCase();
      const name = String(it.name ?? "").trim();
      if (!name) continue;
      if (/^lead pastors?$/.test(role) || /^senior pastors?$/.test(role) || /^pastors?$/.test(role)) {
        // "Brad & Becky Davis" (joint) → use as-is
        if (/&|\band\b|\+/.test(name)) combined = name;
        else leads.push(name);
      }
    }
    const pastorName = combined ?? joinNames(leads);
    if (pastorName) add("pastor_name", "Lead Pastor", pastorName);
  }

  // ── Main service times ──
  // Sundays.detail items with label matching "Service Times" /
  // "Main Service Times". Pick the most-detailed value (longest).
  const sun = topics["sundays"];
  if (sun) {
    let bestTimes: string | null = null;
    for (const raw of sun.items) {
      const it = raw as Record<string, unknown>;
      if (it.kind !== "detail") continue;
      const label = String(it.label ?? "").toLowerCase();
      const value = String(it.value ?? "").trim();
      if (!value) continue;
      if (/^(main\s+)?service\s+times?$/.test(label) || /^sunday\s+service\s+times?$/.test(label)) {
        if (!bestTimes || value.length > bestTimes.length) bestTimes = value;
      }
    }
    if (bestTimes) add("all_service_times", "Service times", bestTimes);
  }

  // ── Main church contact (phone / email / address) ──
  // location_contact bucket. Prefer contact_block.phone / email +
  // location_info.address. The categorizer routes these to globals
  // already, but mirroring as snippets means the Inventory Snippets
  // panel surfaces them too.
  const loc = topics["location_contact"];
  if (loc) {
    let phone: string | null = null;
    let email: string | null = null;
    let address: string | null = null;
    for (const raw of loc.items) {
      const it = raw as Record<string, unknown>;
      if (it.kind === "contact_block") {
        if (!phone && typeof it.phone === "string" && it.phone.trim()) phone = it.phone.trim();
        if (!email && typeof it.email === "string" && it.email.trim()) email = it.email.trim();
      } else if (it.kind === "location_info") {
        if (!address && typeof it.address === "string" && it.address.trim()) address = it.address.trim();
      }
    }
    if (phone)   add("phone",   "Main Phone",   phone);
    if (email)   add("email",   "Main Email",   email);
    if (address) add("address", "Main Address", address);
  }
}

/** Join lead-pastor names naturally — single name stays as-is, two
 *  joined with "&", three or more with commas + "&" before the last. */
function joinNames(names: string[]): string | null {
  const xs = names.filter(Boolean);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  // For couples like Brad Davis + Becky Davis, surface "Brad & Becky Davis"
  // by detecting shared surnames.
  if (xs.length === 2) {
    const [a, b] = xs;
    const aParts = a.split(/\s+/);
    const bParts = b.split(/\s+/);
    if (aParts.length >= 2 && bParts.length >= 2 && aParts[aParts.length - 1] === bParts[bParts.length - 1]) {
      const aFirst = aParts.slice(0, -1).join(" ");
      const bFirst = bParts.slice(0, -1).join(" ");
      return `${aFirst} & ${bFirst} ${aParts[aParts.length - 1]}`;
    }
    return `${a} & ${b}`;
  }
  return xs.slice(0, -1).join(", ") + " & " + xs[xs.length - 1];
}
