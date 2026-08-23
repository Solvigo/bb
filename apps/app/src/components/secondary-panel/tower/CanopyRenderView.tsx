import { useEffect, useState } from "react";
import { ageLabel, useCrewRpc } from "./useCrewRpc";

/**
 * Render-tab v0 — READ-ONLY native-canopy viewing (Phase 1, rides with 2).
 * Fetches crew_artifact_render (the server prepends the annotation bridge) and
 * shows the self-contained page in a sandboxed srcdoc iframe:
 *   sandbox="allow-scripts" with NO allow-same-origin — agent HTML never touches
 *   the app origin, storage, or API.
 * Re-render is gated on the content hash, so a live signal that didn't change the
 * blob never reloads the frame (scroll/state survive). No annotations, no inbound
 * bridge yet — those land in increment 4.
 */
interface RenderResult {
  ok: boolean;
  artifactId: number;
  taskId: string;
  kind: string;
  hash: string;
  html: string;
  bridgeVersion: string;
}

export function CanopyRenderView({ artifactId }: { artifactId: number }) {
  const { data, error, loading, ageSeconds } = useCrewRpc<RenderResult>(
    "crew",
    "crew_artifact_render",
    { artifactId },
  );

  // Hash-gated: only swap srcDoc when the blob actually changed.
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [renderedHash, setRenderedHash] = useState<string | null>(null);
  useEffect(() => {
    if (data?.hash && data.hash !== renderedHash) {
      setRenderedHtml(data.html);
      setRenderedHash(data.hash);
    }
  }, [data?.hash, data?.html, renderedHash]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-surface font-tower-sans">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-tower-border px-4 py-2.5">
        <span className="font-tower-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim">
          Canopy · {data?.taskId ?? "artifact"} #{artifactId}
        </span>
        <span className="font-tower-mono text-[10px] text-tower-fg-faint">
          {error ? (
            <span className="text-tower-accent-hover">rpc error · {error}</span>
          ) : renderedHash ? (
            <>
              read-only · bridge v{data?.bridgeVersion ?? "?"} · as of{" "}
              {ageLabel(ageSeconds)}
            </>
          ) : (
            "loading…"
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 p-3">
        {loading && !renderedHtml ? (
          <div className="grid h-full place-items-center italic text-tower-fg-faint">
            loading canopy…
          </div>
        ) : error && !renderedHtml ? (
          <div className="grid h-full place-items-center px-6 text-center italic text-tower-fg-faint">
            No canopy to render ({error}).
          </div>
        ) : renderedHtml ? (
          <iframe
            key={renderedHash ?? "canopy"}
            title={`canopy-${artifactId}`}
            srcDoc={renderedHtml}
            sandbox="allow-scripts"
            className="h-full w-full rounded-[12px] border border-tower-border bg-white"
          />
        ) : null}
      </div>
    </div>
  );
}

export default CanopyRenderView;
