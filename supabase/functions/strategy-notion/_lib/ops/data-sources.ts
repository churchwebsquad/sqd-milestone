// Notion database IDs for the Strategy module. These map to what Notion's
// REST API treats as the database ID — that's the URL-based ID for
// full-page databases (Progress, Doc Hub) and the data source ID for inline
// databases that happen to share IDs with their wrapper (Initiatives,
// Milestones). The two can diverge, so any 404 from this layer means we're
// pointing at the wrong shape — pull the right one from the database's
// page URL in Notion (`https://www.notion.so/<workspace>/<id>?v=...`).

export const DB = {
  INITIATIVES:   '67ad4907-3798-424b-86eb-4f5c50b6d8b2',
  MILESTONES:    'fe5164be-b833-4e94-aa3f-5084b3ce9d49',
  PROGRESS:      '5014cc49-0014-45b7-bfbc-e3ae70cf2253',
  DOC_HUB:       '297e83f7-31f6-80e3-92cf-f8cbb8cf150f',
  // Web support documentation database — holds partner site notes,
  // troubleshooting docs, integration playbooks. Filtered by the
  // `notes type` select property; "Partner site notes" rows surface
  // on the Church details page → Web Squad section.
  WEB_SUPPORT:   '366e83f7-31f6-80db-a10b-eb7a02fa3910',
  // All-In Documents database — strategy briefs, audits, roadmaps
  // per partner. Filtered by `Doc Type` (select) and matched to a
  // project via the `Member #` rollup (from the Church relation).
  // This is the wrapper DB ID that `/v1/databases/{id}/query` takes
  // (matches the Notion URL the user shares). The inner data source
  // ID is 1f2e83f7-31f6-806b-b707-000b638fcbc7 but the API accepts
  // either against single-source DBs.
  ALL_IN_DOCS:   '1f2e83f7-31f6-80d8-a7ea-db623db57a58',
} as const
