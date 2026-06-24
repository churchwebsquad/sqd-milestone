# Squad — Web Builder (Figma plugin)

Local-development Figma plugin. Wave 1 covers the design-handoff workflow's first big step: pull the project's Brixies templates from the team library, detach them, and promote each to a local component the designer can restyle.

## Install (one-time, per Figma desktop install)

1. Clone or download this repo.
2. Open Figma **desktop app**.
3. **Menu → Plugins → Development → Import plugin from manifest…**
4. Pick `figma-plugin/manifest.json` from this repo.
5. The plugin now appears under **Plugins → Development → Squad — Web Builder**.

## Use

1. In the Web Manager (web app), open the project → **Dev Handoff** tab → **Figma plugin** panel → click **Generate token**. Copy the project ID + the token.
2. In Figma, open the file you want to build the design in. Make sure **Brixies Library ACSS [PRO]** is enabled on the file (Assets panel → Libraries).
3. Run the plugin. Paste the project ID + token. Save settings.
4. Click **Preflight** to verify every template can be imported. If anything fails, the panel tells you why.
5. Click **Assemble style guide**. The plugin places one instance per template into a `Style Guide · <project>` frame, detaches each, and promotes to a local component. Stamps the original Brixies key onto each local component via `pluginData` so later waves can read the bridge back.

## Re-running

Idempotent. Local components carrying the same `brixies_origin_key` are kept in place on re-runs — only new templates get added. Delete a local component if you want it rebuilt from scratch.

## What's next

Wave 2 — assemble pages with cowork content into a per-page frame using the local components.
Wave 3 — designer swap detection + handoff manifest.
Wave 4 — re-populate content on demand.
