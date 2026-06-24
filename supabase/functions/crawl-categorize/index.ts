// crawl-categorize v15 — service-time consolidation (over v13):
//
//   • Drop primary_service_time entirely. Every service-time concept
//     (primary / sunday / main / service / service_times / sundays_*)
//     now routes to one global column: all_service_times. The UI no
//     longer surfaces a "Primary" snippet vs "All" — just one row.
//
//   • Synonym map in routeSnippetsAndUpsert::conceptKey already
//     collapsed many of these; this version makes the GLOBAL_TOKEN_MAP
//     consistent so writes land in all_service_times regardless of
//     which token name the LLM picks.
//
// Carried forward from v13:
//   • Anti-hallucination / completeness / dedup rules in the prompt.
//   • reconcileSnippetConcepts safety net.
//
//   1. Anti-hallucination rule: only emit snippet values that appear
//      VERBATIM in the page text. Stops fabricated phone numbers /
//      emails / shortcodes (Desert Springs got "620-322-2390" invented
//      when the real shortcode was 55678).
//
//   2. Completeness rule: when a fact has multiple readings on a page
//      (e.g. "9 AM and 11 AM"), the snippet value MUST include every
//      one of them. Desert Springs lost the 9 AM service because the
//      LLM emitted `sunday_service_time: "11 AM"`.
//
//   3. Dedup rule: one canonical token per concept. Pick the most
//      specific (`main_service_times` over `service_time`,
//      `youth_text_keyword` over `dsy_text_keyword`).
//
//   4. Per-run snippet reconciliation: when the LLM ALSO returns the
//      same value under multiple tokens despite rule #3, the route
//      pass keeps the most-detailed value and drops shorter variants.
//
// Carried forward from v12:
//   - Dedup staff / event / sermon / testimony items by name.
//   - Programs merged across pages by content-overlap fallback.
//   - Prefer canonical proper names over role titles.
//
// Item kinds emitted by the LLM:
//   - detail        — labeled fact at TOPIC level ({label, value})
//   - key_phrase    — distinctive slogan / mantra / hashtag ({phrase, context})
//   - program       — named instance ({name, description, items[], passages[]})
//   - meeting_time  — program-level when+where+audience ({when, location, audience})
//   - location_info — program-level address ({address, label})
//   - contact_block — program-level contact ({label, email, phone})
//
// Goal: partners (and staff) see each topic as a dossier —
// Voice → Details → Programs (each as nested dossier) → FAQs →
// Key Phrases → CTAs → Scripture — not as a flat dump of passages.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const TAXONOMY = [
  { key:'about',           label:'Who We Are',           group:'identity',  inventory_kind:'voice_rich', url_patterns:[/^\/(about|who-we-are|our-story|story|history)\/?$/i,/^\/about\//i], description:'Identity narrative.' },
  { key:'beliefs',         label:'Beliefs & Values',     group:'identity',  inventory_kind:'voice_rich', url_patterns:[/^\/(beliefs|what-we-believe|values|doctrine|statement-of-faith)\/?/i], description:'Statement of faith + values.' },
  { key:'testimonies',     label:'Testimonies & Stories', group:'identity', inventory_kind:'voice_rich', url_patterns:[/^\/(stories|testimonies|testimony|baptism-stories|life-change|impact-stories|my-story)\/?/i,/^\/stories\//i,/^\/testimon/i], description:'Verbatim partner testimonies and life-change stories.' },
  // Word-boundary anchor: don't sweep /leadership-summit or /pastors-retreat
  // into staff. Prior /^\/leadership\/?/i incorrectly matched any URL
  // STARTING with /leadership.
  { key:'leadership',      label:'Leadership & Staff',   group:'identity',  inventory_kind:'fact_rich',  url_patterns:[/^\/(staff|team|leadership|elders|pastors|our-team)(?:\/|$)/i], item_fields:['name','role','bio','photo_url','email'], description:'Staff + leadership (people who lead — names, roles, bios). DO NOT include event/summit/conference/retreat/camp/register pages even if their URL contains "leadership" or "pastors" — those belong under events.' },
  { key:'kids',            label:'Kids Ministry',        group:'ministry',  inventory_kind:'voice_rich', url_patterns:[/^\/(kids|kids-ministry|children|childrens-ministry|kidmin)\/?/i], description:'Kids ministry narrative.' },
  { key:'students',        label:'Students / Youth',     group:'ministry',  inventory_kind:'voice_rich', url_patterns:[/^\/(students|youth|teens|student-ministry|youth-ministry|middle-school|high-school)\/?/i], description:'Middle + high school.' },
  { key:'college',         label:'College / Young Adults', group:'ministry', inventory_kind:'voice_rich', url_patterns:[/^\/(college|young-adults|20s|twenties|college-ministry)\/?/i], description:'College + young adults.' },
  { key:'adults',          label:'Adult Ministry',       group:'ministry',  inventory_kind:'voice_rich', url_patterns:[/^\/(adults|adult-ministry|men|women|seniors)\/?/i], description:'Adult ministries.' },
  { key:'worship_music',   label:'Worship & Music',      group:'ministry',  inventory_kind:'voice_rich', url_patterns:[/^\/(worship|music|worship-arts|worship-team|choir|band)\/?/i], description:'Worship arts.' },
  { key:'missions',        label:'Missions & Outreach',  group:'ministry',  inventory_kind:'voice_rich', url_patterns:[/^\/(missions|outreach|global|local-outreach|partners)\/?/i], description:'Local + global outreach. Programs MUST include scope:"local" or scope:"global".' },
  { key:'care',            label:'Care',                 group:'ministry',  inventory_kind:'voice_rich', url_patterns:[/^\/(care|prayer|grief|funerals|hospital)\/?/i], description:'Pastoral care.' },
  { key:'counseling',      label:'Counseling',           group:'ministry',  inventory_kind:'voice_rich', url_patterns:[/^\/(counseling|biblical-counseling|therapy)\/?/i], description:'Counseling ministry.' },
  { key:'special_needs',   label:'Special Needs',        group:'ministry',  inventory_kind:'voice_rich', url_patterns:[/^\/(special-needs|access|inclusion|disability)\/?/i], description:'Inclusion ministry.' },
  { key:'new_here',        label:'New Here / First-Time', group:'path',     inventory_kind:'voice_rich', url_patterns:[/^\/(new|new-here|first-time|im-new|welcome)\/?/i], description:'First-time visitor.' },
  { key:'plan_visit',      label:'Plan a Visit',         group:'path',      inventory_kind:'voice_rich', url_patterns:[/^\/(plan-a-visit|plan-your-visit|visit)\/?/i], description:'Pre-visit pathway.' },
  { key:'connect_groups',  label:'Connect / Groups',     group:'path',      inventory_kind:'voice_rich', url_patterns:[/^\/(connect|groups|life-groups|small-groups|community|get-connected)\/?/i], description:'Groups + discipleship.' },
  { key:'serve',           label:'Serve / Volunteer',    group:'path',      inventory_kind:'voice_rich', url_patterns:[/^\/(serve|volunteer|get-involved|teams|ministry-teams)\/?/i], description:'Serve pathway.' },
  { key:'membership',      label:'Membership',           group:'path',      inventory_kind:'voice_rich', url_patterns:[/^\/(membership|become-a-member|covenant-membership|partnership)\/?/i], description:'Membership pathway.' },
  { key:'baptism',         label:'Baptism',              group:'path',      inventory_kind:'voice_rich', url_patterns:[/^\/(baptism|baptisms|get-baptized)\/?/i], description:'Baptism path.' },
  { key:'next_steps',      label:'Next Steps',           group:'path',      inventory_kind:'voice_rich', url_patterns:[/^\/(next-steps|next-step|grow|discipleship)\/?/i], description:'Discipleship journey.' },
  { key:'sundays',         label:'Sundays / Services',   group:'activity',  inventory_kind:'voice_rich', url_patterns:[/^\/(sundays|sunday|services|sunday-services|gathering)\/?/i], description:'Sunday narrative.' },
  { key:'sermons',         label:'Sermons / Messages',   group:'activity',  inventory_kind:'fact_rich',  url_patterns:[/^\/(sermons?|messages|teaching|preaching|watch)\/?/i,/^\/(sermons?|messages)\//i], item_fields:['title','speaker','date','series','video_url','audio_url','notes_url','description'], description:'Sermon archive.' },
  { key:'events',          label:'Events / Calendar',    group:'activity',  inventory_kind:'fact_rich',  url_patterns:[/^\/(events?|calendar|happenings)\/?/i,/^\/(events?|calendar)\//i], item_fields:['name','start_date','end_date','time','location','audience','register_url','description'], description:'Events.' },
  { key:'camps_retreats',  label:'Camps / Retreats',     group:'activity',  inventory_kind:'fact_rich',  url_patterns:[/^\/(camp|camps|retreat|retreats|conferences?)\/?/i], item_fields:['name','start_date','end_date','audience','cost','register_url'], description:'Camps + retreats.' },
  { key:'blog_news',       label:'Blog / News',          group:'activity',  inventory_kind:'fact_rich',  url_patterns:[/^\/(blog|news|articles|posts)\/?/i,/^\/(blog|news|articles)\//i], item_fields:['title','author','date','excerpt','url'], description:'Blog / news / articles.' },
  { key:'location_contact', label:'Location & Contact',  group:'logistics', inventory_kind:'voice_rich', url_patterns:[/^\/(contact|location|directions|where|find-us)\/?/i], description:'Address + contact.' },
  { key:'locations_multi', label:'Locations (multi-site)', group:'logistics', inventory_kind:'fact_rich', url_patterns:[/^\/(locations|campuses|sites)\/?/i,/^\/(locations|campuses|sites)\//i], item_fields:['name','address','service_times','campus_pastor','phone','website'], description:'Multi-site listings.' },
  { key:'school',          label:'School / Preschool',   group:'logistics', inventory_kind:'voice_rich', url_patterns:[/^\/(school|preschool|academy|christian-school)\/?/i], description:'School affiliated with church.' },
  { key:'newsletter_bulletin', label:'Newsletter & Bulletin', group:'logistics', inventory_kind:'fact_rich', url_patterns:[/^\/(newsletter|bulletin|weekly-update|enews|e-news)\/?/i,/^\/(newsletter|bulletin)\//i], item_fields:['title','date','link','excerpt'], description:'Newsletter / bulletin entries.' },
  { key:'giving',          label:'Giving',               group:'conversion',inventory_kind:'voice_rich', url_patterns:[/^\/(give|giving|donate|stewardship|tithe)\/?/i], description:'Giving + stewardship.' },
  { key:'capital_campaign', label:'Capital Campaign',    group:'conversion',inventory_kind:'voice_rich', url_patterns:[/^\/(campaign|capital-campaign|building|growth-campaign)\/?/i], description:'Capital campaigns.' },
  { key:'merch',           label:'Merch / Shop',         group:'logistics', inventory_kind:'fact_rich', url_patterns:[/^\/(merch|shop|store|apparel|swag|merchandise|gear)\/?/i,/^\/(merch|shop|store)\//i], item_fields:['name','url','description','price'], description:'External merch store (Shopify / Printful / etc.). Capture CTAs + the store URL only — we link out, we do not run ecommerce.' },
  { key:'other',           label:'Other / Unclassified', group:'other',     inventory_kind:'voice_rich', url_patterns:[], description:'Catch-all.' },
];

const GLOBAL_TOKEN_MAP = {
  church_name:'church_name', church_short_name:'church_short_name', short_name:'church_short_name',
  phone:'phone', church_phone:'phone', contact_phone:'phone',
  email:'email', church_email:'email', contact_email:'email', general_email:'email',
  address:'address', church_address:'address', street_address:'address',
  city_state:'city_state', denomination:'denomination',
  pastor_name:'pastor_name', pastor_names:'pastor_name', lead_pastor:'pastor_name', lead_pastors:'pastor_name', senior_pastor:'pastor_name',
  // primary_service_time dropped. Every service-time variant the LLM
  // might emit routes to the single all_service_times column.
  all_service_times:'all_service_times', service_times:'all_service_times', sunday_service_times:'all_service_times',
  service_time:'all_service_times', sunday_service_time:'all_service_times',
  main_service_times:'all_service_times', main_service_time:'all_service_times',
  primary_service_time:'all_service_times',
  facebook_url:'social_facebook_url', facebook:'social_facebook_url', social_facebook_url:'social_facebook_url',
  instagram_url:'social_instagram_url', instagram:'social_instagram_url', social_instagram_url:'social_instagram_url',
  youtube_url:'social_youtube_url', youtube_channel:'social_youtube_url', youtube:'social_youtube_url', social_youtube_url:'social_youtube_url',
  tiktok_url:'social_tiktok_url', tiktok:'social_tiktok_url', social_tiktok_url:'social_tiktok_url',
  twitter_url:'social_twitter_url', twitter:'social_twitter_url', x_url:'social_twitter_url', social_twitter_url:'social_twitter_url',
  linkedin_url:'social_linkedin_url', linkedin:'social_linkedin_url', social_linkedin_url:'social_linkedin_url',
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const payload = await req.json();
    if (!payload.project_id || !payload.crawl_job_id) return j({ error: "project_id and crawl_job_id required" }, 400);

    const { data: job, error: jobErr } = await supabase
      .schema("web-hub").from("crawl_jobs")
      .select("id, project_id, target_url, status, crawl_results")
      .eq("id", payload.crawl_job_id).maybeSingle();
    if (jobErr || !job) return j({ error: "Crawl job not found", details: jobErr?.message }, 404);
    if (job.status !== "complete") return j({ error: `Crawl not complete (${job.status})` }, 409);

    const pages = Array.isArray(job.crawl_results) ? job.crawl_results : [];
    console.log(`[Categorize v12] ${pages.length} pages, project ${payload.project_id}`);

    const buckets = {};
    for (const t of TAXONOMY) buckets[t.key] = { passages: [], snippets: [], items: [], source_urls: [], voice_signal: null, storage: null };

    const extractions = await Promise.all(pages.map(async (page) => {
      const urlHits = preClassifyUrl(page.url || "");
      if (anthropicKey) {
        const ex = await llmExtractPage(anthropicKey, page, urlHits);
        return { page, extracted: ex ?? degradeNoLlm(page, urlHits.length > 0 ? urlHits : ["other"]) };
      }
      return { page, extracted: degradeNoLlm(page, urlHits.length > 0 ? urlHits : ["other"]) };
    }));

    for (const { page, extracted } of extractions) {
      for (const tp of extracted.topics || []) {
        const target = buckets[tp.key] ?? buckets["other"];
        for (const p of tp.passages ?? []) {
          const txt = typeof p === "string" ? p : (p?.text ?? "");
          if (!txt) continue;
          target.passages.push({ url: page.url, title: page.title ?? "", text: txt });
        }
        for (const s of tp.snippets ?? []) {
          if (!isSafeSnippet(s)) continue;
          target.snippets.push(s);
        }
        for (const it of tp.items ?? []) {
          const clean = sanitizeItem(it);
          if (!clean) continue;
          target.items.push(stampSourceUrl(clean, page.url));
        }
        if (!target.source_urls.includes(page.url)) target.source_urls.push(page.url);
      }
    }

    for (const t of TAXONOMY) {
      buckets[t.key].items = mergeDuplicatePrograms(buckets[t.key].items);
      buckets[t.key].items = mergeDuplicateDetails(buckets[t.key].items);
      buckets[t.key].items = mergeDuplicateKeyPhrases(buckets[t.key].items);
      buckets[t.key].items = mergeNamedRecordsByName(buckets[t.key].items);
      buckets[t.key].items = mergeProgramsByContentOverlap(buckets[t.key].items);
    }

    if (anthropicKey) {
      const voiceTopics = TAXONOMY.filter(t => t.inventory_kind === "voice_rich" && buckets[t.key].passages.length > 0);
      await Promise.all(voiceTopics.map(async (t) => {
        const sig = await llmVoiceSignal(anthropicKey, t, buckets[t.key].passages);
        buckets[t.key].voice_signal = sig;
      }));
    }

    for (const t of TAXONOMY) {
      if (t.inventory_kind !== "fact_rich") continue;
      const b = buckets[t.key];
      if (b.items.length === 0) continue;
      b.storage = deriveStorage(t, b);
    }

    const allSnippetCandidates = [];
    for (const t of TAXONOMY) for (const s of buckets[t.key].snippets) allSnippetCandidates.push(s);
    const { customTokensAdded, globalsFilled } = await routeSnippetsAndUpsert(supabase, payload.project_id, allSnippetCandidates);

    let writtenTopics = 0;
    for (const t of TAXONOMY) {
      const b = buckets[t.key];
      const hasContent = b.passages.length > 0 || b.items.length > 0;
      if (!hasContent && t.key !== "other") continue;
      const topicTokens = new Set(b.snippets.map(s => s?.token).filter(Boolean));
      const myCustoms = customTokensAdded.filter(tok => topicTokens.has(tok));
      const row = {
        web_project_id: payload.project_id,
        topic_key: t.key,
        topic_label: t.label,
        topic_group: t.group,
        inventory_kind: t.inventory_kind,
        coverage_status: coverageFor(b),
        voice_signal: b.voice_signal,
        passages: b.passages,
        storage: b.storage,
        items: b.items,
        added_snippet_tokens: myCustoms,
        source_page_urls: b.source_urls,
        last_crawl_job_id: payload.crawl_job_id,
        llm_processed: Boolean(anthropicKey),
      };
      const { error: upErr } = await supabase
        .from("web_project_topics")
        .upsert(row, { onConflict: "web_project_id,topic_key" });
      if (upErr) console.error(`[Categorize] Upsert failed for ${t.key}:`, upErr);
      else writtenTopics++;
    }

    return j({ ok: true, topics_written: writtenTopics, snippets_added: customTokensAdded.length, globals_filled: globalsFilled, pages_processed: pages.length }, 200);
  } catch (err) {
    console.error("[Categorize] Error:", err);
    return j({ error: "Unexpected", details: err?.message ?? String(err) }, 500);
  }
});

function preClassifyUrl(url) {
  let path = url;
  try { path = new URL(url).pathname; } catch {}
  const hits = [];
  for (const t of TAXONOMY) {
    if (t.key === "other") continue;
    for (const re of t.url_patterns) if (re.test(path)) { hits.push(t.key); break; }
  }
  return hits;
}

function stampSourceUrl(item, url) {
  const stamped = { ...item, source_url: item.source_url ?? url };
  if (stamped.kind === "program") {
    if (Array.isArray(stamped.items)) stamped.items = stamped.items.map(c => stampSourceUrl(c, url));
    if (Array.isArray(stamped.passages)) {
      stamped.passages = stamped.passages.map(p => typeof p === "string"
        ? { url, text: p }
        : { url: p?.url ?? url, text: p?.text ?? "" });
    }
  }
  return stamped;
}

// Drop items / snippets / CTAs that describe a mechanism rather than data.
// The categorizer should NOT fabricate {{tokens}} for embedded widgets when
// the actual destination URL isn't on the page.
const BROKEN_VALUE_RE = /\b(typeform|mailchimp|calendly|javascript|widget|iframe)\b.*\b(embedded|embed)\b/i;
const BARE_BROKEN_RE  = /^(typeform|embedded|inline form|see below|widget)$/i;
const PLACEHOLDER_RE  = /\{\{\s*[\w.-]+\s*\}\}/;

function isMetaCountDetail(label, value) {
  const l = String(label ?? "").trim().toLowerCase();
  const v = String(value ?? "").trim().toLowerCase();
  if (!l || !v) return false;
  // Label is "<thing> count" / "number of <thing>" / "total <thing>"
  if (/\b(count|total)\b/.test(l) || /^number of\b/.test(l)) {
    // Value is just a number, "N items", "N values", "N programs", etc.
    if (/^\d+(\s+(items?|values?|programs?|tiers?|levels?|things?))?$/.test(v)) return true;
  }
  return false;
}

function looksBroken(value) {
  if (value == null) return true;
  const v = String(value).trim();
  if (!v) return true;
  if (PLACEHOLDER_RE.test(v)) return true;
  if (BROKEN_VALUE_RE.test(v)) return true;
  if (BARE_BROKEN_RE.test(v)) return true;
  return false;
}

function isSafeSnippet(s) {
  if (!s || typeof s !== "object") return false;
  if (!s.token || !s.value) return false;
  if (typeof s.token !== "string" || typeof s.value !== "string") return false;
  if (looksBroken(s.value)) return false;
  return true;
}

function sanitizeItem(it) {
  if (!it || typeof it !== "object") return null;
  // CTA / link must have a real http(s) URL
  if (it.kind === "cta" || it.kind === "link") {
    const url = typeof it.url === "string" ? it.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) return null;
    if (looksBroken(it.label)) return null;
  }
  // Detail / key_phrase / meeting_time / location_info / contact_block —
  // drop items whose primary text looks like a mechanism placeholder.
  if (it.kind === "detail") {
    if (looksBroken(it.value) || looksBroken(it.label)) return null;
    // Drop meta-count details ("Core Values Count: 7 values", "Programs Count: 5", etc.)
    if (isMetaCountDetail(it.label, it.value)) return null;
  }
  if (it.kind === "key_phrase") {
    if (looksBroken(it.phrase)) return null;
  }
  if (it.kind === "meeting_time") {
    if (!it.when || looksBroken(it.when)) return null;
  }
  if (it.kind === "location_info") {
    if (!it.address || looksBroken(it.address)) return null;
  }
  if (it.kind === "contact_block") {
    if (!it.email && !it.phone) return null;
    if (looksBroken(it.email) && looksBroken(it.phone)) return null;
  }
  // Programs — recursively sanitize their nested items
  if (it.kind === "program" && Array.isArray(it.items)) {
    it.items = it.items.map(sanitizeItem).filter(Boolean);
  }
  return it;
}

function normalizeProgramKey(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[.,;:!?—\-]+$/, "")
    .replace(/[-–—‑]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function prettyProgramName(name) {
  const t = String(name).trim();
  if (t === t.toUpperCase() && /[a-z]/i.test(t)) return t.toLowerCase().replace(/\b(\w)/g, (_, c) => c.toUpperCase());
  return t;
}

function mergeDuplicatePrograms(items) {
  const out = []; const idx = new Map();
  for (const it of items) {
    if (it.kind === "program" && typeof it.name === "string" && it.name.trim()) {
      const key = normalizeProgramKey(it.name);
      if (!key) { out.push(it); continue; }
      const existing = idx.get(key);
      if (existing !== undefined) {
        const cur = out[existing];
        if (cur.name && cur.name === cur.name.toUpperCase()) cur.name = prettyProgramName(it.name) || cur.name;
        cur.description = longerNonEmpty(cur.description, it.description);
        cur.audience    = firstNonEmpty(cur.audience,    it.audience);
        cur.duration    = firstNonEmpty(cur.duration,    it.duration);
        cur.tagline     = firstNonEmpty(cur.tagline,     it.tagline);
        cur.philosophy  = firstNonEmpty(cur.philosophy,  it.philosophy);
        cur.scope       = firstNonEmpty(cur.scope,       it.scope);
        cur.passages    = mergePassages(cur.passages,    it.passages);
        cur.items       = mergeChildItems(cur.items,     it.items);
        continue;
      }
      idx.set(key, out.length);
      out.push({ ...it, name: prettyProgramName(it.name), passages: Array.isArray(it.passages) ? it.passages : [], items: Array.isArray(it.items) ? it.items : [] });
    } else {
      out.push(it);
    }
  }
  return out;
}

function mergeDuplicateDetails(items) {
  const out = []; const idx = new Map();
  for (const it of items) {
    if (it.kind === "detail" && typeof it.label === "string" && it.label.trim()) {
      const key = it.label.trim().toLowerCase();
      const existing = idx.get(key);
      if (existing !== undefined) {
        const cur = out[existing];
        cur.value = longerNonEmpty(cur.value, it.value);
        continue;
      }
      idx.set(key, out.length);
      out.push(it);
    } else {
      out.push(it);
    }
  }
  return out;
}

function mergeDuplicateKeyPhrases(items) {
  const out = []; const idx = new Map();
  for (const it of items) {
    if (it.kind === "key_phrase" && typeof it.phrase === "string" && it.phrase.trim()) {
      const key = it.phrase.toLowerCase().trim().replace(/\s+/g, " ");
      const existing = idx.get(key);
      if (existing !== undefined) {
        const cur = out[existing];
        cur.context = longerNonEmpty(cur.context, it.context);
        continue;
      }
      idx.set(key, out.length);
      out.push(it);
    } else {
      out.push(it);
    }
  }
  return out;
}

// Merge staff / event / sermon / testimony / newsletter items that share a
// normalized identifying field (name / title / person / question). Keeps the
// entry with the most populated fields and fills in any missing fields from
// duplicates.
function mergeNamedRecordsByName(items) {
  const NAMED_KINDS = new Set(["staff","event","sermon","testimony","newsletter_issue"]);
  const idFieldFor = (it) => {
    if (it.kind === "testimony") return it.person ?? "";
    if (it.kind === "event")     return it.name ?? "";
    if (it.kind === "sermon" || it.kind === "newsletter_issue") return it.title ?? "";
    return it.name ?? "";
  };
  const out = []; const idx = new Map();
  for (const it of items) {
    if (!NAMED_KINDS.has(it.kind)) { out.push(it); continue; }
    const id = String(idFieldFor(it) || "").trim().toLowerCase();
    if (!id) { out.push(it); continue; }
    const key = it.kind + "|" + id;
    const existing = idx.get(key);
    if (existing !== undefined) {
      const cur = out[existing];
      const curScore = Object.values(cur).filter(v => v != null && v !== "").length;
      const itScore  = Object.values(it).filter(v => v != null && v !== "").length;
      const winner = itScore > curScore ? it : cur;
      const loser  = itScore > curScore ? cur : it;
      // Backfill blank fields on the winner from the loser
      for (const [k, v] of Object.entries(loser)) {
        if ((winner[k] == null || winner[k] === "") && v != null && v !== "") winner[k] = v;
      }
      out[existing] = winner;
      continue;
    }
    idx.set(key, out.length);
    out.push(it);
  }
  return out;
}

// Last-resort dedup: programs that weren't name-merged but share most of
// their content (e.g. "Lead Pastors" vs "Pastors Brad and Becky Davis").
// Keep the richer program and fold the thinner one's fields/passages into it.
function mergeProgramsByContentOverlap(items) {
  const fingerprint = (p) => {
    const chunks = [];
    if (p.description) chunks.push(String(p.description));
    if (Array.isArray(p.passages)) {
      for (const pp of p.passages) chunks.push(typeof pp === "string" ? pp : (pp?.text ?? ""));
    }
    const text = chunks.join(" ").toLowerCase();
    return new Set(text.split(/[^a-z0-9]+/).filter(w => w.length >= 4));
  };
  const programs = items.filter(i => i.kind === "program");
  if (programs.length < 2) return items;
  const fps = programs.map(fingerprint);
  const dropped = new Set();
  const programIndex = items.map((it, i) => ({ it, i, isProgram: it.kind === "program" })).filter(x => x.isProgram).map(x => x.i);
  // Compare each pair, drop the thinner program when its content is a
  // high-overlap subset of a richer program.
  for (let a = 0; a < programs.length; a++) {
    if (dropped.has(programIndex[a])) continue;
    if (fps[a].size < 8) continue;
    for (let b = 0; b < programs.length; b++) {
      if (b === a || dropped.has(programIndex[b])) continue;
      if (fps[b].size < 4) continue;
      let intersect = 0;
      for (const w of fps[b]) if (fps[a].has(w)) intersect++;
      const overlapRatio = intersect / fps[b].size;
      const sizeRatio    = fps[b].size / fps[a].size;
      if (overlapRatio >= 0.8 && sizeRatio < 0.7) {
        // Merge b into a (backfill missing fields, union nested items/passages)
        const winner = programs[a];
        const loser  = programs[b];
        for (const [k, v] of Object.entries(loser)) {
          if (k === "items" || k === "passages") continue;
          if ((winner[k] == null || winner[k] === "") && v != null && v !== "") winner[k] = v;
        }
        winner.passages = mergePassages(winner.passages, loser.passages);
        winner.items    = mergeChildItems(winner.items, loser.items);
        dropped.add(programIndex[b]);
      }
    }
  }
  return items.filter((_, i) => !dropped.has(i));
}

function mergePassages(a, b) {
  const out = Array.isArray(a) ? [...a] : [];
  const seen = new Set(out.map(p => (typeof p === "string" ? p : p?.text || "").trim().toLowerCase()));
  for (const p of Array.isArray(b) ? b : []) {
    const txt = (typeof p === "string" ? p : p?.text || "").trim();
    if (!txt || seen.has(txt.toLowerCase())) continue;
    seen.add(txt.toLowerCase());
    out.push(p);
  }
  return out;
}

function mergeChildItems(a, b) {
  const out = Array.isArray(a) ? [...a] : [];
  const sig = (it) => `${it.kind || ""}|${(it.name || it.title || it.question || it.label || it.reference || it.phrase || it.when || "").trim().toLowerCase()}`;
  const seen = new Set(out.map(sig));
  for (const it of Array.isArray(b) ? b : []) {
    const s = sig(it);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(it);
  }
  return out;
}

function firstNonEmpty(a, b)  { return (a && String(a).trim()) ? a : (b ?? null); }
function longerNonEmpty(a, b) {
  const sa = a ? String(a).trim() : "";
  const sb = b ? String(b).trim() : "";
  if (!sa) return sb || null;
  if (!sb) return sa || null;
  return sa.length >= sb.length ? sa : sb;
}

function coverageFor(b) {
  const total = b.passages.length + b.items.length;
  if (total === 0) return "empty";
  if (total < 3)   return "sparse";
  if (total < 10)  return "covered";
  return "rich";
}

function deriveStorage(t, b) {
  let listUrl = null;
  let shortest = Infinity;
  for (const u of b.source_urls) {
    try { const p = new URL(u).pathname; if (p.length < shortest) { shortest = p.length; listUrl = u; } } catch {}
  }
  const detailUrls = b.source_urls.filter(u => u !== listUrl);
  let itemUrlPattern = null;
  if (detailUrls.length > 0) {
    try { itemUrlPattern = new URL(detailUrls[0]).pathname.replace(/[^/]+$/, "{slug}"); } catch {}
  }
  const fieldsPresent = new Set();
  for (const it of b.items) for (const k of Object.keys(it)) fieldsPresent.add(k);
  return { list_url: listUrl, item_url_pattern: itemUrlPattern, item_fields: Array.from(fieldsPresent), canonical_fields: t.item_fields ?? [], item_count: b.items.length };
}

async function llmExtractPage(apiKey, page, urlHits) {
  const taxLines = [];
  for (const t of TAXONOMY) {
    const fields = t.item_fields ? ", fields: " + t.item_fields.join(",") : "";
    taxLines.push("  - " + t.key + " (" + t.inventory_kind + fields + "): " + t.description);
  }
  const taxonomyForPrompt = taxLines.join("\n");
  const hintLine = urlHits.length > 0
    ? "URL pre-classified into: " + urlHits.join(", ") + " — prefer these unless content clearly says otherwise."
    : "URL didn't pre-classify. Choose best fit(s) or assign to 'other'.";
  const content = page.markdown ?? page.content ?? "";

  const exampleJson = '{\n  "topics": [\n    {\n      "key":"location_contact",\n      "passages":["<verbatim prose about contact / location, if any>"],\n      "items":[\n        {"kind":"contact_block","label":"General inquiries","email":"info@church.org","phone":"(555) 123-4567"},\n        {"kind":"location_info","address":"716 Main Street, Lumberton, NJ 08048","label":"Main entrance off Route 38"},\n        {"kind":"detail","label":"Parking","value":"Free parking in lot behind building"}\n      ],\n      "snippets":[{"token":"general_email","label":"General Email","value":"info@church.org"},{"token":"main_phone","label":"Main Phone","value":"(555) 123-4567"}]\n    },\n    {\n      "key":"locations_multi",\n      "passages":["<topic-level intro to the campuses page, if any>"],\n      "items":[\n        {\n          "kind":"program",\n          "name":"Lumberton Campus",\n          "description":"Main campus in Lumberton, NJ.",\n          "passages":["<verbatim campus prose>"],\n          "items":[\n            {"kind":"meeting_time","when":"Sundays 9 AM & 11 AM"},\n            {"kind":"location_info","address":"716 Main Street, Lumberton, NJ 08048","label":"Across from Walther Elementary"},\n            {"kind":"contact_block","label":"Lumberton Campus","email":"lumberton@church.org","phone":"(555) 123-4567"},\n            {"kind":"detail","label":"Campus Pastor","value":"Pastor Jane Doe"}\n          ]\n        },\n        {\n          "kind":"program",\n          "name":"Mount Holly Campus",\n          "description":"Second campus in Mount Holly, NJ.",\n          "passages":["<verbatim campus prose>"],\n          "items":[\n            {"kind":"meeting_time","when":"Sundays 10 AM"},\n            {"kind":"location_info","address":"123 Pine Ave, Mount Holly, NJ 08060"},\n            {"kind":"contact_block","label":"Mount Holly Campus","email":"mountholly@church.org"},\n            {"kind":"detail","label":"Campus Pastor","value":"Pastor John Smith"}\n          ]\n        }\n      ],\n      "snippets":[]\n    },\n    {\n      "key": "kids",\n      "passages": ["<verbatim topic-level prose about kids ministry>"],\n      "items": [\n        {"kind":"detail","label":"Service Times","value":"9:00 AM and 11:00 AM Sunday"},\n        {"kind":"detail","label":"Age Groups","value":"Nursery (birth-2), Pre-K (3-4), K-2, 3-5"},\n        {"kind":"key_phrase","phrase":"build great kids","context":"LHT Kids mission statement"},\n        {\n          "kind":"program",\n          "name":"LHT Kids",\n          "description":"<one-paragraph about>",\n          "audience":"Pre-K through 5th grade",\n          "duration":"Sundays",\n          "tagline":"...",\n          "passages":["<verbatim quote belonging to THIS program>"],\n          "items":[\n            {"kind":"meeting_time","when":"Sundays 9 & 11 AM","location":"Kids wing","audience":"Pre-K through 5th"},\n            {"kind":"contact_block","label":"Kids inquiries","email":"kids@church.org"},\n            {"kind":"detail","label":"Check-in","value":"Arrive 10 minutes early"},\n            {"kind":"faq","question":"What if my child cries?","answer":"..."},\n            {"kind":"cta","label":"Pre-register your child","url":"https://example.com/preregister"}\n          ]\n        }\n      ],\n      "snippets":[{"token":"kids_check_in_email","label":"Kids check-in email","value":"kids@church.org"}]\n    },\n    {\n      "key":"events",\n      "passages":["<topic-level intro to the events page, if any>"],\n      "items":[\n        {\n          "kind":"program",\n          "name":"Christmas Experience",\n          "description":"Christmas Eve services at 2 PM and 4 PM with LHT Kids programming.",\n          "audience":"All ages",\n          "passages":["<verbatim christmas-experience prose>"],\n          "items":[\n            {"kind":"meeting_time","when":"Saturday December 24, 2 PM and 4 PM"},\n            {"kind":"location_info","address":"716 Main Street, Lumberton, NJ 08048"},\n            {"kind":"detail","label":"Kids Programming","value":"LHT Kids Experiences provided during both services"},\n            {"kind":"cta","label":"Plan your visit","url":"https://example.com/plan-a-visit"}\n          ]\n        }\n      ],\n      "snippets":[]\n    },\n    {\n      "key":"giving",\n      "passages":["<topic-level prose about giving>"],\n      "items":[\n        {"kind":"detail","label":"Online Giving","value":"Available via Pushpay"},\n        {\n          "kind":"program",\n          "name":"Faith Challenge",\n          "description":"40-day generosity challenge with structured tiers like Faith Builders, House Builders, Kingdom Builders.",\n          "passages":["<verbatim faith-challenge prose>"],\n          "items":[\n            {"kind":"tier","name":"Faith Builders","commitment":"$50/mo","description":"Beginner tier — build the habit of giving."},\n            {"kind":"tier","name":"House Builders","commitment":"$200/mo","description":"Growing tier — sustain the local church."},\n            {"kind":"tier","name":"Kingdom Builders","commitment":"$1000/mo","description":"Visionary tier — fuel kingdom expansion."},\n            {"kind":"cta","label":"Take the challenge","url":"https://example.com/faith-challenge"}\n          ]\n        }\n      ],\n      "snippets":[]\n    }\n  ]\n}';

  const userPrompt = [
    "You are categorizing one church-website page and extracting EVERYTHING a copywriter (or partner reviewer) needs. Be EXHAUSTIVE — verbatim quotes, every FAQ, every program, every CTA, every scripture, every tier. Do NOT summarize.",
    "",
    "ORGANIZE EXTRACTION INTO THESE BUCKETS (per topic):",
    "  • passages       — verbatim prose paragraphs (long-form narrative).",
    "  • items[kind=detail]      — LABELED FACTS that apply to the WHOLE topic. Examples: 'Service Times: 9 & 11 AM' for the kids topic. NOT instance-specific.",
    "  • items[kind=key_phrase]  — DISTINCTIVE language: slogans, mantras, hashtags, taglines used repeatedly.",
    "  • items[kind=program]     — NAMED instances with their OWN nested content. Each program is a dossier.",
    "  • items[kind=faq]         — Q&A pairs.",
    "  • items[kind=cta]         — distinct buttons/calls-to-action with real http(s) URLs.",
    "  • items[kind=scripture]   — Bible references with verbatim text.",
    "  • items[kind=tier]        — commitment levels / membership tiers.",
    "  • items[kind=testimony]   — personal stories. ROUTES BY KIND, NOT URL: a testimony belongs in the `testimonies` topic regardless of which page it came from. If you find a quote of life-change on a sermon-series page (/acts, /romans, /vision-2026), on an event page, on a campus page, on a campaign page — it's STILL a testimony and STILL goes into `testimonies`. The source page's URL goes in `source_url` and (when the page is about a specific series/ministry/campaign) ALSO in a `context` field with a human-readable label (e.g. `context: \"Acts Series\"`, `context: \"Baptism Stories\"`, `context: \"Vision 2026 Campaign\"`). The partner reviews testimonies as ONE bucket; if you split them across topics they become invisible. {person, role, story, scripture_ref, context, source_url}",
    "  • items[kind=newsletter_issue] — newsletter entries (only in newsletter_bulletin topic).",
    "  • items[kind=sermon/event/staff/link] — flat typed records for fact_rich LIST pages.",
    "",
    "INSIDE EACH PROGRAM, additionally use:",
    "  • items[kind=meeting_time]  — when this program meets + location/audience. {when, location, audience}",
    "  • items[kind=location_info] — where this program runs. {address, label}",
    "  • items[kind=contact_block] — who to contact about this program. {label, email, phone}",
    "  • items[kind=detail]        — labeled facts SPECIFIC TO THIS PROGRAM (cost, dates, age requirements, dress code, registration deadlines, etc.)",
    "  • plus the standard nested kinds: faq, cta, scripture, step, tier, link, key_phrase.",
    "",
    "WHY THIS SHAPE: the partner reviewer sees each topic as a profile — Voice / Details / Programs / FAQs / Key Phrases / CTAs / Scripture. Every meaningful fact should be reachable through one of those buckets.",
    "",
    "TAXONOMY (topic keys you can land in):",
    taxonomyForPrompt,
    "",
    "PAGE:",
    "URL: " + page.url,
    "Title: " + (page.title ?? "(none)"),
    hintLine,
    "",
    "CONTENT (markdown):",
    content.slice(0, 14000),
    "",
    "Return STRICT JSON (no prose, no markdown fences):",
    exampleJson,
    "",
    "RULES (read carefully — prior passes made these mistakes):",
    "1. passages = long-form verbatim prose. NOT atomic facts (those go in items[kind=detail]).",
    "2. items[kind=detail] at TOPIC LEVEL = facts about the WHOLE topic, not a specific named occurrence. 'Service Times: 9 & 11 AM' belongs at topic level on the kids page (every Sunday). 'Egg Hunt registration: 10:30 AM' belongs INSIDE the Egg Hunt program — NEVER at topic level.",
    "3. items[kind=key_phrase] = distinctive language the church uses (slogans, mantras, hashtags).",
    "4. NAMED INSTANCES — every named occurrence with its OWN details (a specific event like 'Christmas Experience' or 'Easter Egg Hunt', a specific ministry initiative like 'Faith Challenge' or 'LHT Kids', a specific class, a specific small group, a specific campus location, etc.) MUST be emitted as items[kind=program]. ALL of its details — meeting times, locations, contacts, registration info, dates, cost, tagline, age requirements — nest INSIDE that program via meeting_time / location_info / contact_block / cta / detail / key_phrase items. NEVER dump instance-specific fields at the topic level.",
    "4b. CANONICAL NAMES — when the same person, program, or event appears across pages with different labels (e.g. 'Lead Pastors' on one page, 'Pastors Brad and Becky Davis' on another), USE THE MOST SPECIFIC PROPER NAME as the program's `name`. Prefer the proper name ('Brad & Becky Davis', 'Pastor Tom Smith') over the role title ('Lead Pastors', 'Executive Pastor'). This keeps the post-processing merge from leaving two near-duplicate programs.",
    "4c. DON'T DOUBLE-EMIT PEOPLE — for the leadership topic, a single staff member should be ONE items[kind=staff] record. Don't emit a sparse record (just name + role) AND a full record (name + role + bio + photo_url) — emit one record with everything you can find. The merger will fold cross-page mentions, but only if you don't fabricate near-duplicates within the same page.",
    "5. TIERS / COMMITMENT LEVELS — if a parent program (challenge, campaign, membership pathway) lists sub-named LEVELS like 'Faith Builders / House Builders / Kingdom Builders' or 'Starter / Builder / Visionary' or 'Bronze / Silver / Gold', emit them as items[kind=tier] INSIDE the parent program. They are NOT separate programs — they only exist as commitment rungs of the parent. WRONG: three top-level kind=program entries for the tier names. RIGHT: one kind=program for the parent challenge with three nested kind=tier items inside its items[] array.",
    "6. CONTACT EXTRACTION — ONLY the church's GENERAL / MAIN contact info goes to the 'location_contact' topic. That includes the main church phone, main church email (info@…, hello@…, contact@…), main church physical address, parking/directions for the building. EVENT-SPECIFIC OR PROGRAM-SPECIFIC contacts must stay nested inside their event/program (e.g. the Egg Hunt's Village Green Park address stays inside the Egg Hunt program as location_info; the kids ministry email stays inside the LHT Kids program as contact_block). If a page (kids, events, baptism, etc.) yields a generic 'Have more questions? Contact info@church.com' callout, DO emit it under location_contact — but a venue address for a one-off event belongs nested in that event.",
    "7. CAMPUSES / MULTI-SITE — for the locations_multi topic, emit EACH campus as items[kind=program] with its own nested meeting_time / location_info / contact_block / detail (for campus pastor) items. Do not emit campus details as flat top-level fields in the locations_multi items list; nest them inside their campus program. Each campus should also include {name: 'Lumberton Campus'} etc.",
    "7b. ACCORDIONS / BELIEF STATEMENTS / EXPANDABLE SECTIONS — when a page renders multiple accordion-style sections (e.g. 'What we believe' with 'Scripture Inspired', 'One True God', 'Deity of Christ' as expandable items), emit EACH accordion entry as a separate item[kind=faq] using the title as `question` and the body text as `answer`. Don't summarize them into one passage. Same for the 'DNA of <church>' or 'Our Values' lists — emit each value as items[kind=key_phrase] with phrase=<value title>, context=<value description if any>.",
    "7c. DO NOT EMIT META-COUNT DETAIL ITEMS — never emit items[kind=detail] whose value is a count of other items ('Core Values Count: 7 values', 'Programs Count: 5', 'Tier Count: 3'). The reader can count for themselves; this is noise.",
    "8. For events / camps_retreats / sermons topics: if the page is a LIST PAGE showing many items with short summaries, emit each as a flat items[kind=event/sermon/etc] record. If the page is a DETAIL PAGE for ONE specific named occurrence, emit it as items[kind=program] with rich nested content INSTEAD of the flat shape.",
    "9. CTAs / links MUST have a real http(s) URL. NEVER emit cta/link with url='Typeform embedded', url='embedded form', url='form widget', url='' or any non-URL string. If the page embeds a Typeform / Mailchimp / Calendly widget without a discoverable destination URL on the page, OMIT the CTA entirely. Better to extract nothing than to fabricate a placeholder.",
    "10. SNIPPETS require literal usable values. NEVER emit a snippet whose value contains '{{', or whose value names a tool/mechanism ('Typeform embedded', 'Calendly widget', 'Mailchimp form', 'iframe widget'). Only emit snippets when the actual data is reusable (URL, phone, email, address, name). If unsure, OMIT the snippet.",
    "11. Use ONLY taxonomy keys. Use 'other' only if it really doesn't fit.",
    "12. snippets = reusable values referenced across pages (snake_case token).",
    "12a. SNIPPET DEDUP — ONE token per concept. Don't emit BOTH `service_time` AND `sunday_service_time` AND `main_service_times` for the same fact. Pick the most specific token name and use it exclusively. Same for any youth/student/kids text-keyword / phone / signup pairs. The reader only needs one canonical reference per concept.",
    "12b. COMPLETE VALUES — if the page lists multiple readings of the same fact (e.g. '9 AM and 11 AM' for service times, three campus phone numbers, two giving methods), the snippet `value` MUST contain ALL of them — joined naturally ('9:00 AM and 11:00 AM', 'AmEx, Visa, Mastercard'). Never truncate to just the first one. A snippet value `\"11 AM\"` is WRONG when the page also lists a 9 AM service.",
    "12c. NO HALLUCINATION — only emit snippets whose `value` appears VERBATIM somewhere in the page content provided above. Do not invent phone numbers, shortcodes, email addresses, names, dates, dollar amounts, or URLs. If the page says \"Text DSY to 55678\", you MAY emit `youth_text_keyword: \"DSY\"` and `youth_text_number: \"55678\"`, but you may NOT emit `youth_text_number: \"620-322-2390\"`. If a value isn't literally on the page, OMIT the snippet entirely.",
    "12d. SERVICE TIMES ARE THE CHURCH'S, NOT A MINISTRY'S — when you see Sunday service times listed (e.g. \"9:15 AM and 11:00 AM\"), they belong to the whole church and route to the `service_times` / `main_service_times` token. NEVER prefix them with a ministry name (`kids_service_times`, `youth_service_times`, `family_service_times`) just because nearby text mentions that ministry. The line \"9:15 & 11:00 AM Worship services. Children's programs are available...\" describes ONE pair of services that the church holds and a side-note that kids programs run alongside — emit `main_service_times: \"9:15 AM and 11:00 AM\"`, NOT `kids_service_times`. Reserve ministry-prefixed time tokens (e.g. `student_ministry_meeting_time`, `young_adults_meeting_time`) for events that ONLY that ministry attends, on a SEPARATE schedule from the main service.",
    "13. Output JSON only. No prose. No markdown fences.",
  ].join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-api-key": apiKey, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens: 8000, messages: [{ role:"user", content: userPrompt }] }),
    });
    if (!res.ok) { console.error("[LLM extract] failed:", res.status, await res.text()); return null; }
    const body = await res.json();
    const text = body?.content?.[0]?.text ?? "";
    return parseJsonObject(text);
  } catch (err) { console.error("[LLM extract] threw:", err); return null; }
}

async function llmVoiceSignal(apiKey, t, passages) {
  const sample = passages.slice(0, 12).map(p => "- " + p.text).join("\n");
  const userPrompt =
    "Summarize the church's distinctive voice for topic '" + t.label + "' from these passages. " +
    "STRICT: 2-3 sentences MAX, under 300 characters total. Plain prose only — NO markdown headers (no '#'), NO bullet points, NO bold, NO labels. " +
    "Focus on: addressing style (you/we/they), formality, emphasis, distinctive phrases, theological lean. Don't quote.\n\nPASSAGES:\n" +
    sample;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers: { "Content-Type":"application/json", "x-api-key": apiKey, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens: 250, messages: [{ role:"user", content: userPrompt }] }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return sanitizeVoiceSignal(body?.content?.[0]?.text ?? "");
  } catch { return null; }
}

function sanitizeVoiceSignal(raw) {
  let t = (raw ?? "").trim();
  if (!t) return null;
  // Strip leading markdown headers ("# Church Tone on …", "## Voice", etc.)
  t = t.replace(/^#+\s*[^\n]*\n+/g, "");
  // Strip leading "Voice:" / "Tone:" labels
  t = t.replace(/^(voice|tone|summary)\s*[:\-—]\s*/i, "");
  // Collapse whitespace + drop trailing newlines
  t = t.replace(/\s+/g, " ").trim();
  // Hard cap (defensive — the model rarely respects 300 chars)
  if (t.length > 360) {
    const cut = t.slice(0, 360);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    t = (lastStop > 200 ? cut.slice(0, lastStop + 1) : cut + "…").trim();
  }
  return t || null;
}

function degradeNoLlm(page, topicKeys) {
  const text = (page.markdown ?? page.content ?? "").slice(0, 500).trim();
  return { topics: topicKeys.map(key => ({ key, passages: text ? [text] : [], snippets: [], items: [] })) };
}
function parseJsonObject(s) {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/** Normalize a snippet token to its conceptual key — strips common
 *  qualifiers (`main_`, `sunday_`, `default_`, `primary_`) and
 *  per-day prefixes so `service_time`, `sunday_service_time`, and
 *  `main_service_times` all reduce to `service_times`. When the LLM
 *  emits multiple tokens that normalize to the same concept on a
 *  single run, the longest / most-detailed value wins and the rest
 *  are dropped. Token names that don't share a concept are returned
 *  unchanged so this never collapses unrelated snippets. */
function conceptKey(token) {
  let k = String(token || "").toLowerCase();
  // Strip leading qualifiers
  k = k.replace(/^(main|primary|default|sunday|weekend|weekly|current)_/, "");
  // Singular/plural normalize trailing _time(s)
  k = k.replace(/_times?$/, "_times");
  // Map known synonym roots — keeps `service_times` family together
  // without claiming every "time" snippet is the same.
  const synonymMap = {
    service_time:           "service_times",
    sunday_service_time:    "service_times",
    main_service_time:      "service_times",
    main_service_times:     "service_times",
    weekend_service_times:  "service_times",
    youth_text_number:      "youth_text_number",
    dsy_text_number:        "youth_text_number",
    text_to_connect_number: "youth_text_number",
    youth_text_keyword:     "youth_text_keyword",
    dsy_text_keyword:       "youth_text_keyword",
  };
  return synonymMap[k] ?? k;
}

/** Given the raw LLM-emitted snippet list, return a filtered list
 *  where any same-concept group is collapsed to the entry with the
 *  longest (most-detailed) value. Treats values as strings; ties keep
 *  the first occurrence to preserve LLM ordering. */
function reconcileSnippetConcepts(snippets) {
  const byConcept = new Map();
  for (const s of snippets) {
    if (!s || typeof s !== "object" || !s.token || !s.value) continue;
    const key = conceptKey(s.token);
    const prev = byConcept.get(key);
    if (!prev) { byConcept.set(key, s); continue; }
    const a = String(prev.value ?? "").trim().length;
    const b = String(s.value ?? "").trim().length;
    if (b > a) byConcept.set(key, s);
  }
  return Array.from(byConcept.values());
}

async function routeSnippetsAndUpsert(supabase, projectId, snippets) {
  if (!snippets || snippets.length === 0) return { customTokensAdded: [], globalsFilled: [] };
  // Per-run reconciliation: when the LLM emits multiple tokens whose
  // names normalize to the same concept (service_time vs
  // sunday_service_time vs main_service_times), keep the entry with
  // the most-detailed value. The prompt asks the LLM to dedup at
  // source; this is the safety net for when it still doesn't.
  const reconciled = reconcileSnippetConcepts(snippets);
  const seen = new Set();
  const globalFills = {};
  const customQueue = [];
  for (const s of reconciled) {
    if (!isSafeSnippet(s)) continue;
    if (!/^[a-z][a-z0-9_]*$/.test(s.token)) continue;
    if (seen.has(s.token)) continue;
    seen.add(s.token);
    const value = s.value.trim();
    if (!value) continue;
    const globalCol = GLOBAL_TOKEN_MAP[s.token];
    if (globalCol) { if (!(globalCol in globalFills)) globalFills[globalCol] = value; }
    else customQueue.push({ token: s.token, label: (s.label || s.token).trim(), value });
  }
  const globalsFilled = [];
  if (Object.keys(globalFills).length > 0) {
    const cols = Object.keys(globalFills);
    const { data: project } = await supabase.from("strategy_web_projects").select("id," + cols.join(",")).eq("id", projectId).maybeSingle();
    if (project) {
      const updates = {};
      for (const col of cols) {
        const cur = project[col];
        if (cur === null || cur === undefined || (typeof cur === "string" && cur.trim() === "")) { updates[col] = globalFills[col]; globalsFilled.push(col); }
      }
      if (Object.keys(updates).length > 0) await supabase.from("strategy_web_projects").update(updates).eq("id", projectId);
    }
  }

  // Mirror critical globals to a canonical snippet so the partner-
  // facing inventory has a labelled, scannable entry. The router
  // routes any *service*time* token (service_times, main_service_times,
  // sunday_service_times, etc.) to the all_service_times column, which
  // means no snippet gets created — and the inventory ends up
  // surfacing the LLM's secondary, often mis-labeled snippets
  // (e.g. "Kids Ministry Service Times") as the only thing the partner
  // sees about service times. Concrete example: baysidechurch.net's
  // crawl filled all_service_times="9:15 AM and 11:00 AM" but only
  // created a kids_service_times snippet with the same value. Partner
  // saw "Kids Ministry Service Times" as their service-times anchor.
  //
  // Mirroring fixes both gaps: a main_service_times snippet exists
  // for display, and it carries the global value, not whatever the
  // LLM secondary-named.
  const GLOBAL_TO_SNIPPET_MIRROR = {
    all_service_times: { token: "main_service_times", label: "Main Service Times" },
  };
  const mirrorRows = [];
  for (const col of Object.keys(globalFills)) {
    const m = GLOBAL_TO_SNIPPET_MIRROR[col];
    if (!m) continue;
    mirrorRows.push({
      token: m.token, label: m.label, value: globalFills[col],
    });
  }
  if (mirrorRows.length > 0) {
    const mirrorTokens = mirrorRows.map(r => r.token);
    const { data: existingMirrors } = await supabase.from("web_project_snippets")
      .select("token").eq("web_project_id", projectId).eq("archived", false).in("token", mirrorTokens);
    const existingMirrorSet = new Set((existingMirrors ?? []).map(r => r.token));
    const insertable = mirrorRows.filter(r => !existingMirrorSet.has(r.token));
    if (insertable.length > 0) {
      const { error: mirrorErr } = await supabase.from("web_project_snippets").insert(
        insertable.map(r => ({
          web_project_id: projectId, token: r.token, label: r.label, expansion: r.value,
          description: "Mirrored from global column for partner-facing inventory display.",
          tags: ["auto","categorizer","global_mirror"],
          source: "crawl_prefill", archived: false, used_count: 0,
        }))
      );
      if (!mirrorErr) console.log("[Categorize] Mirrored globals to snippets:", insertable.map(r => r.token).join(", "));
      else console.error("[Categorize] Global mirror insert failed:", mirrorErr);
    }
  }
  const customTokensAdded = [];
  if (customQueue.length > 0) {
    const tokens = customQueue.map(s => s.token);
    const { data: existing } = await supabase.from("web_project_snippets").select("token").eq("web_project_id", projectId).eq("archived", false).in("token", tokens);
    const existingSet = new Set((existing ?? []).map(r => r.token));
    const rows = customQueue.filter(s => !existingSet.has(s.token)).map(s => ({
      web_project_id: projectId, token: s.token, label: s.label, expansion: s.value,
      description: "Auto-extracted from crawl categorizer.", tags: ["auto","categorizer"],
      source:"crawl_prefill", archived: false, used_count: 0,
    }));
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("web_project_snippets").insert(rows);
      if (!insErr) for (const r of rows) customTokensAdded.push(r.token);
      else console.error("[Categorize] Snippet insert failed:", insErr);
    }
  }
  return { customTokensAdded, globalsFilled };
}

function j(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
