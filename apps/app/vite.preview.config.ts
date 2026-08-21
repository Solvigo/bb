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
/**
 * THE LABEL, AND WHY IT IS SERVED RATHER THAN BUILT IN.
 *
 * Two previews now run side by side — one per carve phase — and the Captain was pointed at :21994 as
 * phase 1 while it had already been rebuilt as phase 2. He must never judge one believing it the
 * other, so each page says which it is. THE HARNESS PILOT CAUGHT THIS; the fix is his design.
 *
 * It is injected by the PREVIEW SERVER, not compiled into the app, for one reason: the phase-1 tree is
 * pinned at its own commit and must stay that way to be judgeable. A label baked into the bundle would
 * mean committing on top of the very thing under judgement. So the label describes THE SERVER'S
 * PAYLOAD, which is exactly what it is, and one mechanism serves both ports — neither page can be
 * labelled by a different means than the other, which is how two labels start disagreeing.
 *
 * `pointer-events: none` on purpose: a label that swallows a click the Captain wanted is worse than no
 * label. And it is deliberately plain — this is scaffolding for a judgement, not part of the design
 * being judged.
 */
const carveLabel = process.env.BB_CARVE_LABEL ?? "";

function labelInjector() {
  const style = [
    "position:fixed",
    "right:8px",
    "bottom:6px",
    "z-index:2147483647",
    "pointer-events:none",
    "font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace",
    "letter-spacing:0.04em",
    "padding:3px 8px",
    "border-radius:6px",
    "color:#c7c5ba",
    "background:rgba(25,25,24,0.86)",
    "border:1px solid #33322f",
  ].join(";");
  const markup = `<div id="bb-carve-preview-label" data-carve-label="${carveLabel}" style="${style}">${carveLabel}</div>`;
  return {
    name: "bb:carve-preview-label",
    configurePreviewServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      if (carveLabel === "") return;
      server.middlewares.use((req: any, res: any, next: () => void) => {
        // Only the document. Assets, /api and /ws are untouched — a rewritten payload anywhere else
        // would be this scaffolding changing what is being judged.
        const accept = String(req.headers?.accept ?? "");
        if (!accept.includes("text/html")) return next();
        const write = res.write.bind(res);
        const end = res.end.bind(res);
        let buffered = "";
        res.write = (chunk: any, ...rest: unknown[]) => {
          if (chunk && String(res.getHeader?.("content-type") ?? "").includes("text/html")) {
            buffered += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
            return true;
          }
          return write(chunk, ...(rest as []));
        };
        res.end = (chunk: any, ...rest: unknown[]) => {
          if (chunk && String(res.getHeader?.("content-type") ?? "").includes("text/html")) {
            buffered += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
          }
          if (buffered !== "") {
            const body = buffered.includes("</body>")
              ? buffered.replace("</body>", `${markup}</body>`)
              : buffered + markup;
            res.setHeader("content-length", Buffer.byteLength(body));
            return end(body, ...(rest as []));
          }
          return end(chunk, ...(rest as []));
        };
        next();
      });
    },
  };
}

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
  plugins: [...(sharedViteConfig.plugins ?? []), labelInjector()],
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
