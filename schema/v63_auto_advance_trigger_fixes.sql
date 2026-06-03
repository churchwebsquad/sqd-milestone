-- ============================================================================
-- v63_auto_advance_trigger_fixes.sql
-- The auto-advance trigger from v58 has been silent since landing because of
-- two mismatches:
--
--   1. phase_map.pathway used title-case labels ('Web Redesign','Web Audit')
--      while strategy_milestone_definitions.pathway carries the lowercase
--      form the rest of the app sends ('redesign','audit'). The JOIN never
--      matched.
--   2. Trigger only fired on `milestone_status = 'sent'`. In practice the
--      team flips a row straight to 'approved' or 'partner_replied' without
--      a separate 'sent' write, so the filter swallowed every advancement.
--
-- This migration realigns the pathway labels, broadens the trigger's status
-- filter to every "delivered or past delivered" value, and backfills
-- current_phase from existing submission history so every active project
-- snaps to its true position.
-- ============================================================================

UPDATE strategy_web_phase_map SET pathway = 'redesign' WHERE pathway = 'Web Redesign';
UPDATE strategy_web_phase_map SET pathway = 'audit'    WHERE pathway = 'Web Audit';

CREATE OR REPLACE FUNCTION public.fn_web_project_phase_from_submission()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_pathway    text;
  v_step       integer;
  v_target     text;
  v_project_id uuid;
  v_current    text;
BEGIN
  IF NEW.milestone_status IS NULL
     OR NEW.milestone_status NOT IN ('sent','partner_replied','approved','in_revision') THEN
    RETURN NEW;
  END IF;

  SELECT d.pathway, d.step_number
    INTO v_pathway, v_step
    FROM strategy_milestone_definitions d
   WHERE d.id = NEW.milestone_id;
  IF v_pathway IS NULL THEN RETURN NEW; END IF;

  SELECT m.phase INTO v_target
    FROM strategy_web_phase_map m
   WHERE m.pathway = v_pathway AND m.step_number = v_step;
  IF v_target IS NULL THEN RETURN NEW; END IF;

  SELECT id, current_phase
    INTO v_project_id, v_current
    FROM strategy_web_projects
   WHERE member = NEW.member AND archived = false
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_project_id IS NULL THEN RETURN NEW; END IF;

  IF phase_rank(v_target) > phase_rank(v_current) THEN
    UPDATE strategy_web_projects
       SET current_phase = v_target,
           updated_at = now()
     WHERE id = v_project_id;
  END IF;
  RETURN NEW;
END $$;

-- Backfill — bump every project to whatever its highest already-delivered
-- milestone implies. Idempotent: only writes when the inferred phase
-- outranks current_phase.
WITH max_phase_per_project AS (
  SELECT
    p.id AS project_id,
    p.current_phase,
    (
      SELECT m.phase
        FROM strategy_milestone_submissions s
        JOIN strategy_milestone_definitions d ON d.id = s.milestone_id
        JOIN strategy_web_phase_map m
          ON m.pathway = d.pathway AND m.step_number = d.step_number
       WHERE s.member = p.member
         AND s.is_active = true
         AND s.milestone_status IN ('sent','partner_replied','approved','in_revision')
       ORDER BY phase_rank(m.phase) DESC
       LIMIT 1
    ) AS inferred_phase
  FROM strategy_web_projects p
  WHERE p.archived = false
)
UPDATE strategy_web_projects p
   SET current_phase = mp.inferred_phase,
       updated_at = now()
  FROM max_phase_per_project mp
 WHERE p.id = mp.project_id
   AND mp.inferred_phase IS NOT NULL
   AND phase_rank(mp.inferred_phase) > phase_rank(p.current_phase);
