import { defineConfig } from "vite";
import { loadViteDevConfig } from "@bb/config/vite-dev";
import { sharedViteConfig } from "./vite.config.js";

/**
 * THE CARVE PREVIEW — the built app, served on its own port, riding a pinned bb server's API.
 *
 * WHY THIS FILE EXISTS AND `vite.dev.config.ts` IS NOT ENOUGH: the judgement is on the BUILT app (the
 * thing a repin would actually ship), not on a dev server with HMR — and `vite preview` needs its own
 * proxy block. It is otherwise the same seam: `/api` and `/ws` to the server, nothing else crosses.
 *
 * THE ONE LINE THAT IS NOT PRODUCTION-SHAPED, said out loud: `headers.origin`. bb's browser guard
 * trusts an origin only if it is the server's own, its configured app url, or its dev app port
 * (apps/server/src/browser-request-guard.ts:28-47) — so a preview on a fresh port is refused, not
 * because anything is wrong with it but because it is not yet served FROM bb's origin. The proxy
 * therefore presents the server's own origin on the requests it forwards. In the deployment this
 * preview is arguing for — our app built into the dist the server already serves — the app IS on that
 * origin and this line disappears. It is scaffolding for a judgement, not a workaround being shipped.
 */
const viteDevConfig = loadViteDevConfig();
const serverOrigin = viteDevConfig.serverHttpOrigin;
const previewPort = Number(process.env.BB_CARVE_PREVIEW_PORT ?? "21994");

const proxyToServer = {
  target: serverOrigin,
  changeOrigin: true,
  xfwd: true,
  headers: { origin: serverOrigin },
};

export default defineConfig({
  ...sharedViteConfig,
  define: {
    // The browser talks to the WS through this preview's own origin, so the dev define that points
    // straight at the server must stay unset — the proxy carries the upgrade instead.
    __BB_DEV_WS_BROWSER_HOST_PORT__: JSON.stringify(null),
  },
  preview: {
    host: "127.0.0.1",
    port: previewPort,
    strictPort: true,
    proxy: {
      "/api": proxyToServer,
      "/ws": { ...proxyToServer, ws: true },
    },
  },
});
