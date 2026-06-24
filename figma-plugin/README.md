# Squad — Web Builder (Figma plugin)

Per-project Figma plugin. The project's API credentials are baked into this folder at download time — there is no settings dialog and you paste nothing.

## Install (per project, per machine)

1. Unzip this folder somewhere stable on your machine — e.g. `~/Figma Plugins/__SQD_PROJECT_NAME__/`. Figma reads the folder from disk every run, so don't move or delete it after installing.
2. Open the Figma **desktop app**.
3. **Menu → Plugins → Development → Import plugin from manifest…**
4. Pick `manifest.json` inside this unzipped folder.
5. The plugin shows up under **Plugins → Development → Squad — __SQD_PROJECT_NAME__**.

## Use

1. Open the Figma file where the design lives. Make sure **Brixies Library ACSS [PRO]** is enabled (Assets panel → Libraries).
2. Run the plugin. The project's name is shown in the chip at the top of the panel so you can tell it apart from other Squad plugin installs.
3. Click **Preflight** — verifies every template imports cleanly. If it fails, the panel tells you why.
4. Click **Assemble style guide** — drops one instance per template into a `Style Guide · <project>` frame, detaches each, and promotes to a local component. The original Brixies key is stamped on every local component via pluginData so later waves can bridge back even after layout swaps.

## Re-running

Idempotent. Local components carrying the same Brixies origin key are kept in place — only new templates get added. Delete a local component if you want it rebuilt from scratch.

## Updates / new project

This folder is project-specific. To work on a different project, download that project's plugin zip from its own Design Handoff card. Each project gets its own install with a distinct name. If the token is rotated in the web app, re-download this project's zip and replace the folder in place — keep the path the same so Figma's import still resolves.

## Security

This folder contains a bearer token granting read access to this project's templates list. Don't commit it to a repo, share over public channels, or hand to anyone outside the team. If a copy leaks, **Revoke** in the web app immediately.

## What's next

Wave 2 — assemble pages with cowork content into a per-page frame using the local components.
Wave 3 — designer swap detection + handoff manifest.
Wave 4 — re-populate content on demand.
