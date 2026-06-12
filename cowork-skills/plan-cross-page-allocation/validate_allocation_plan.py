#!/usr/bin/env python3
"""Deterministic validator for CoworkPageAllocationPlan output.

Encodes the SKILL.md hard rules + quality bar + FABLE-5-VALIDATION.md
acceptance checklist as code. Run after every generation; on failure,
feed the machine-readable failure list back to the model for ONE repair
pass (fix only named gaps, don't regenerate).

Usage:
    python3 validate_allocation_plan.py plan.json manifest.json

manifest.json (built by cowork-director from the same payload it sent):
{
  "pillars": [{"id": "<uuid>", "topic": "voice_rule", "verbatim": true}, ...],
  "facts":   ["<uuid>", ...],
  "crawl_topics": [{"topic_key": "kids", "coverage_status": "rich"}, ...],
  "content_collection_fields": ["sermon_archive_features", ...],
  "sitemap_slugs": ["home", "plan-a-visit", ...],
  "primary_pages": ["home", "plan-a-visit", "about", "donate"],
  "persona_entry_points": {"Lena": ["home", "plan-a-visit"], ...}
}

Exit code 0 = all checks pass. Non-zero = failures; a JSON failure list is
printed on the last line (after the human-readable report) for the repair
loop to consume.
"""
import json, sys

CONTENT_TOPICS = {'mission_statement','vision_statement','x_factor','ethos','value_statement',
                  'persona','story','denominational_signal'}
VERBATIM_CONTENT_TOPICS = CONTENT_TOPICS | {'prose_snippet'}
VOICE_TOPICS = {'voice_rule','voice_sample','tone_descriptor'}
DIRECTIVE_TOPICS = {'recommended_page'}
TREATMENTS = {'lift_verbatim','weave_into_paragraph','card_per_row','summarize',
              'surface_as_faq','reframe_for_persona','cta_attach','voice_anchor'}
UNRESOLVED_REASONS = {'crawl_noise_parking_lot','csv_routed_elsewhere',
    'structured_data_routed_to_facts','insufficient_items_for_template',
    'required_slots_unfilled','duplicate_of_placed_source',
    'internal_admin_contact_not_for_publication','insufficient_source_content'}
# Mirrors FLOW_ROLES in src/types/coworkBundle.ts. Both validators must
# accept identical vocabularies; the cross-vocab drift check enforces the
# same membership on the SKILL.md prose side.
FLOW_ROLES = {'hook','orient','reassure','inform','deepen','invite','close'}


def validate(plan, mf):
    fails = []
    def fail(check, detail): fails.append({'check': check, 'detail': detail})

    allocs = plan.get('allocations', [])
    traces = plan.get('source_traces', [])
    unresolved = plan.get('unresolved_sources', [])
    directives = plan.get('build_directives', []) or []

    placed = {}   # (kind, ref) -> [placement,...]
    for t in traces:
        placed.setdefault((t['source_kind'], t['source_ref']), []).extend(t.get('placements', []))
    unresolved_refs = {(u['source_kind'], u['source_ref']) for u in unresolved}
    directive_refs = {(d['source_kind'], d['source_ref']) for d in directives}
    slugs = {a['page_slug'] for a in allocs}
    primary = set(mf.get('primary_pages', ['home', 'plan-a-visit', 'about', 'donate']))

    # --- cross-consistency: traces must mirror section sources, refs must exist in manifest
    known = {('pillar', p['id']) for p in mf['pillars']}
    known |= {('fact', fid) for fid in mf['facts']}
    known |= {('crawl_topic', t['topic_key']) for t in mf['crawl_topics']}
    known |= {('content_collection', k) for k in mf.get('content_collection_fields', [])}
    for a in allocs:
        for ix, s in enumerate(a.get('section_intents', [])):
            for src in s.get('sources', []):
                key = (src['kind'], src['ref'])
                if key not in known:
                    fail('unknown_ref', f"{a['page_slug']}[{ix}] references {key} not present in input manifest (hallucinated ref?)")
                if src['treatment'] not in TREATMENTS:
                    fail('bad_treatment', f"{a['page_slug']}[{ix}] {key}: '{src['treatment']}' not in treatment vocabulary")
                if key not in placed:
                    fail('trace_missing', f"{key} used in {a['page_slug']}[{ix}] but absent from source_traces")
    for key, pls in placed.items():
        if key not in known:
            fail('unknown_ref', f"source_traces references {key} not present in input manifest")
        for pl in pls:
            if pl['page_slug'] not in slugs:
                fail('bad_placement_page', f"{key} placed on unknown page '{pl['page_slug']}'")
            else:
                n = len(next(a for a in allocs if a['page_slug'] == pl['page_slug'])['section_intents'])
                if not (0 <= pl['section_ix'] < n):
                    fail('bad_section_ix', f"{key} -> {pl['page_slug']}[{pl['section_ix']}] out of range (page has {n} sections)")
            if not pl.get('rationale'):
                fail('missing_rationale', f"{key} -> {pl['page_slug']}[{pl.get('section_ix')}] has no rationale")

    # --- sitemap completeness
    for slug in mf.get('sitemap_slugs', []):
        if slug not in slugs:
            fail('missing_page', f"sitemap page '{slug}' has no allocation entry")

    # --- pillar coverage / routing / verbatim
    for p_ in mf['pillars']:
        key = ('pillar', p_['id']); topic = p_['topic']
        if topic in CONTENT_TOPICS and key not in placed and key not in unresolved_refs:
            fail('content_pillar_dropped', f"{topic} pillar {p_['id']} not in source_traces or unresolved_sources")
        if topic in VOICE_TOPICS:
            anchors = [pl for pl in placed.get(key, [])
                       if pl['treatment'] == 'voice_anchor' and pl['page_slug'] in primary]
            if not anchors:
                fail('voice_not_routed', f"{topic} pillar {p_['id']} has no voice_anchor placement on a primary page {sorted(primary)}")
        if topic in VERBATIM_CONTENT_TOPICS and p_.get('verbatim'):
            bad = [pl for pl in placed.get(key, [])
                   if pl['treatment'] in ('weave_into_paragraph', 'reframe_for_persona')]
            if bad:
                fail('verbatim_violated', f"verbatim {topic} pillar {p_['id']} placed with {[b['treatment'] for b in bad]}")
            if placed.get(key) and not any(pl['treatment'] == 'lift_verbatim' for pl in placed[key]):
                fail('verbatim_no_lift', f"verbatim {topic} pillar {p_['id']} placed but never lift_verbatim")
        if topic in DIRECTIVE_TOPICS and key not in directive_refs and key not in unresolved_refs and key not in placed:
            fail('directive_dropped', f"recommended_page pillar {p_['id']} not routed to build_directives")

    # --- crawl coverage
    noise_parked = {u['source_ref'] for u in unresolved
                    if u['source_kind'] == 'crawl_topic' and u.get('reason') == 'crawl_noise_parking_lot'}
    for t in mf['crawl_topics']:
        key = ('crawl_topic', t['topic_key'])
        if t.get('coverage_status') in ('rich', 'covered') and key not in placed \
                and t['topic_key'] not in noise_parked:
            fail('crawl_topic_dropped', f"{t['topic_key']} ({t.get('coverage_status')}) must be placed (or parked as crawl noise)")
        elif key not in placed and key not in unresolved_refs:
            fail('crawl_topic_dropped', f"{t['topic_key']} not placed or unresolved")

    # --- facts + content_collection coverage
    for fid in mf['facts']:
        key = ('fact', fid)
        if key not in placed and key not in unresolved_refs:
            fail('fact_dropped', f"fact {fid} not placed or unresolved")
    for k in mf.get('content_collection_fields', []):
        if ('content_collection', k) not in placed and ('content_collection', k) not in unresolved_refs:
            fail('cc_field_dropped', f"content_collection field '{k}' not placed or unresolved")

    # --- journey shape
    for a in allocs:
        flows = [s['flow_role'] for s in a.get('section_intents', [])]
        pg = a['page_slug']
        if len(flows) < 3: fail('journey_too_short', f"{pg}: {len(flows)} sections (<3)")
        if not flows or flows[0] != 'hook': fail('hook_not_first', f"{pg}: first flow_role is {flows[0] if flows else None}")
        if flows and flows[-1] not in ('invite', 'close'): fail('bad_ending', f"{pg}: ends in {flows[-1]}")
        if flows.count('invite') != 1: fail('invite_count', f"{pg}: {flows.count('invite')} invite sections (need exactly 1)")
        for ix, s in enumerate(a.get('section_intents', [])):
            if not s.get('section_job'): fail('missing_section_job', f"{pg}[{ix}]")
            if not s.get('sources'): fail('empty_section', f"{pg}[{ix}] ({s['flow_role']}) has no sources")
            # Per-section flow_role membership: previously only hook-first /
            # invite-count / ending were checked, so a middle section with
            # 'commitx' / 'evidence' / any typo passed silently.
            if s.get('flow_role') not in FLOW_ROLES:
                fail('bad_flow_role', f"{pg}[{ix}] flow_role='{s.get('flow_role')}' not in {'|'.join(sorted(FLOW_ROLES))}")

    # --- persona entry hooks
    flows_by_slug = {a['page_slug']: [s['flow_role'] for s in a['section_intents']] for a in allocs}
    for persona, pages in mf.get('persona_entry_points', {}).items():
        if not any(flows_by_slug.get(pg, [None])[0] == 'hook' for pg in pages if pg in flows_by_slug):
            fail('persona_no_hook', f"{persona}: no hook-first page among entry points {pages}")

    # --- unresolved hygiene
    for u in unresolved:
        if u.get('reason') not in UNRESOLVED_REASONS:
            fail('bad_unresolved_reason', f"{u['source_ref']}: reason '{u.get('reason')}' not in enum")
        if not u.get('detail'):
            fail('unresolved_no_detail', f"{u['source_ref']}: missing detail")
        if u.get('reason') == 'required_slots_unfilled' and not u.get('slot_gap'):
            fail('missing_slot_gap', f"{u['source_ref']}: required_slots_unfilled without slot_gap")

    return fails


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__); sys.exit(2)
    plan = json.load(open(sys.argv[1]))
    mf = json.load(open(sys.argv[2]))
    fails = validate(plan, mf)
    by = {}
    for f_ in fails: by.setdefault(f_['check'], []).append(f_['detail'])
    for check in sorted(by):
        print(f"FAIL {check} ({len(by[check])})")
        for d in by[check][:10]: print(f"   - {d}")
        if len(by[check]) > 10: print(f"   … +{len(by[check]) - 10} more")
    print(f"{'ALL CHECKS PASS' if not fails else str(len(fails)) + ' FAILURES'}")
    print(json.dumps(fails))
    sys.exit(0 if not fails else 1)
