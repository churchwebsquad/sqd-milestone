/// <reference types="vite/client" />

/** Build-time app version stamp. Defined by `vite.config.ts` via
 *  `define`; resolves to the deploy's git SHA (Vercel) or a build
 *  timestamp. The client compares this against `/version.json` to
 *  detect when a new build has been deployed and prompt a reload. */
declare const __APP_VERSION__: string
