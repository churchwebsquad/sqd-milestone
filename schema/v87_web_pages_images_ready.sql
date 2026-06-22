-- v87 — Track image-readiness per page for the Design workspace's
-- Image count checklist. Additive nullable boolean; defaults to false
-- so existing pages start unchecked. Strategist/designer toggles it
-- from the new ImageCountChecklist in DesignWorkspace once the
-- organized-images folder has all the page's image assets.

ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS images_ready boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN web_pages.images_ready IS
  'Designer flips this from the Design workspace Image count checklist when the organized-images folder has every image slot covered for the page.';
