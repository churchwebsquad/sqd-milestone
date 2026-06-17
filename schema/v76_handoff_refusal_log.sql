-- v76 — Cowork→Pages handoff refusal log.
--
-- WHY
-- The cowork→pages handoff was rebuilt ground-zero (commit lineage in
-- /Users/ashleyfox/.claude/plans/moonlit-leaping-summit.md). The new
-- contract: the handoff ALWAYS pushes. Even when a section's binding
-- isn't `perfect` (every required slot populated, no lorem rendered,
-- no misplaced images), the section still lands in web_pages +
-- web_sections + the strategist works through it via the Rich Content
-- Companion side panel.
--
-- Refusals are a Claude-Code-side signal — diagnostics persist here +
-- in .claude/handoff-refusals.md so the assistant can read them on
-- the next session, identify the root cause (SKILL prompt drift,
-- mapping gap, missing template family, palette mismatch), and fix
-- the root so the next handoff produces `perfect` for the same shape.
-- The strategist is never notified.
--
-- COLUMN
--   handoff_refusal_log jsonb NULL — append-only array of refusal
--     entries. Schema per entry:
--       {
--         ran_at:                  ISO timestamp,
--         page_slug:               <slug>,
--         section_intent_id:       <id>,
--         template_key:            <key>,
--         gaps:                    [<reason>, ...],
--         root_cause_hypothesis:   <text>,
--         preserved_content:       <cowork_slot_values snapshot>
--       }
--
-- DEPENDENCY AUDIT (per CLAUDE.md)
-- strategy_web_projects has 2 triggers (already audited in v75 +
-- earlier — set_updated_at + intake notify), 0 functions reading
-- the column (additive), 0 views/MVs touch it, 16 FKs point AT
-- the table (children — unaffected). Additive nullable column is
-- safe.
--
-- ROLLBACK
--   ALTER TABLE strategy_web_projects DROP COLUMN IF EXISTS handoff_refusal_log;

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS handoff_refusal_log jsonb;

COMMENT ON COLUMN strategy_web_projects.handoff_refusal_log IS
  'Cowork→Pages handoff diagnostic log. Append-only jsonb array; each entry is a section that did not bind perfectly to its Brixies template. Read by Claude Code on subsequent sessions to fix root causes in the cowork SKILL or the canonical template mapping. Strategist is never notified; the section still pushes + they work through it via the Rich Content Companion.';
