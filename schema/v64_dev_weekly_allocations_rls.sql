-- ============================================================================
-- v64_dev_weekly_allocations_rls.sql
-- Authenticated staff need full CRUD on strategy_dev_weekly_allocations to
-- use the allocation grid in the Planning workspace. The table had RLS
-- enabled at creation but no policies were ever added, so every write 403'd
-- silently and reads only happened by accident (depending on JWT). Anon
-- doesn't need access — this is a private internal scheduling table.
-- ============================================================================

CREATE POLICY "Authenticated can read dev allocations"
  ON strategy_dev_weekly_allocations FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert dev allocations"
  ON strategy_dev_weekly_allocations FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update dev allocations"
  ON strategy_dev_weekly_allocations FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete dev allocations"
  ON strategy_dev_weekly_allocations FOR DELETE TO authenticated
  USING (true);
