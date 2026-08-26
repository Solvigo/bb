import { useEffect, useRef, useState } from "react";
import { ageLabel, useCrewRpc } from "./useCrewRpc";

/**
 * Native-canopy render surface (Phase 1). Read the artifact via
 * crew_artifact_render (the server prepends the annotation bridge) and show it in
 * a sandboxed srcdoc iframe: sandbox="allow-scripts" with NO allow-same-origin.
 * Re-render is gated on the content hash, so a live signal that didn't change the
 * blob never reloads the frame.
 *
 * Increment 4 — annotations → demands: the bridge posts {selector, quote,
 * occurrence} on selection; we compose a comment and crew_annotation_write raises
 * a demand on the composing SP. The annotations list is fetched SEPARATELY
 * (crew_artifact_annotations) so it refreshes without reloading the blob, and
 * clicking one reveals it in the frame via the inbound bridge command.
 */
const BRIDGE_CHANNEL = "bb-canopy";
const BRIDGE_VERSION = "1";

interface RenderResult {
  ok: boolean;
  artifactId: number;
  taskId: string;
  hash: string;
  html: string;
  bridgeVersion: string;
}
interface Annotation {
  id: number;
  selector: string;
  quote: string;
  occurrence: number | null;
  body: string;
  author: string;
  resolved_at: string | null;
}
interface AnnotationsResult {
  ok: boolean;
  annotations: Annotation[];
  unresolved: number;
}
interface PendingSelection {
  selector: string;
  quote: string;
  occurrence: number | null;
}

async function rpc(method: string, input: unknown): Promise<unknown> {
  const res = await fetch(`/api/v1/plugins/crew/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.json();
}

export function CanopyRenderView({ artifactId }: { artifactId: number }) {
  const render = useCrewRpc<RenderResult>("crew", "crew_artifact_render", {
    artifactId,
  });
  const annos = useCrewRpc<AnnotationsResult>(
    "crew",
    "crew_artifact_annotations",
    { artifactId },
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Hash-gated: only swap srcDoc when the blob actually changed.
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [renderedHash, setRenderedHash] = useState<string | null>(null);
  useEffect(() => {
    if (render.data?.hash && render.data.hash !== renderedHash) {
      setRenderedHtml(render.data.html);
      setRenderedHash(render.data.hash);
    }
  }, [render.data?.hash, render.data?.html, renderedHash]);

  // Bridge outbound: the frame posts a selection; open a comment composer.
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const d = event.data as
        | { channel?: string; selector?: unknown; quote?: unknown; occurrence?: unknown }
        | null;
      if (!d || d.channel !== BRIDGE_CHANNEL) return;
      if (typeof d.selector !== "string" || typeof d.quote !== "string") return;
      // Enforce the bridge contract's own caps — a message whose "quote" is the
      // whole document (or, e.g., the bridge source) is not a real selection.
      if (
        d.selector.length === 0 ||
        d.selector.length > 512 ||
        d.quote.length === 0 ||
        d.quote.length > 2000
      ) {
        return;
      }
      setPending({
        selector: d.selector,
        quote: d.quote,
        occurrence: typeof d.occurrence === "number" ? d.occurrence : null,
      });
      setBody("");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const submit = async () => {
    if (!pending || !body.trim()) return;
    setBusy(true);
    try {
      await rpc("crew_annotation_write", {
        artifactId,
        selector: pending.selector,
        quote: pending.quote,
        occurrence: pending.occurrence,
        body: body.trim(),
      });
      setPending(null);
      setBody("");
    } finally {
      setBusy(false);
    }
  };

  // Bridge inbound: reveal an annotation's target in the frame.
  const reveal = (a: Annotation) => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        channel: BRIDGE_CHANNEL,
        v: BRIDGE_VERSION,
        cmd: "reveal",
        selector: a.selector,
        occurrence: a.occurrence,
      },
      "*",
    );
  };

  const annotations = annos.data?.annotations ?? [];
  const unresolved = annos.data?.unresolved ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-render font-tower-sans">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-tower-border px-4 py-2.5">
        <span className="font-tower-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim">
          Canopy · {render.data?.taskId ?? "artifact"} #{artifactId}
        </span>
        <span className="font-tower-mono text-[10px] text-tower-fg-faint">
          {render.error ? (
            <span className="text-tower-accent-hover">rpc error</span>
          ) : renderedHash ? (
            <>
              bridge v{render.data?.bridgeVersion ?? "?"} ·{" "}
              {unresolved > 0 ? (
                <span className="text-tower-accent-hover">
                  {unresolved} unresolved
                </span>
              ) : (
                "no open notes"
              )}{" "}
              · as of {ageLabel(render.ageSeconds)}
            </>
          ) : (
            "loading…"
          )}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_minmax(220px,28%)]">
        {/* the rendered canopy */}
        <div className="relative min-h-0 p-3">
          {renderedHtml ? (
            <iframe
              key={renderedHash ?? "canopy"}
              ref={iframeRef}
              title={`canopy-${artifactId}`}
              srcDoc={renderedHtml}
              sandbox="allow-scripts"
              className="h-full w-full rounded-[12px] border border-tower-border bg-white"
            />
          ) : (
            <div className="grid h-full place-items-center italic text-tower-fg-faint">
              {render.error ? "no canopy to render" : "loading canopy…"}
            </div>
          )}

          {/* comment composer for a fresh selection */}
          {pending ? (
            <div className="absolute inset-x-3 bottom-3 rounded-[12px] border border-tower-accent bg-tower-panel p-3 shadow-lg">
              <div className="mb-1 font-tower-mono text-[9px] uppercase tracking-[0.1em] text-tower-accent-hover">
                Annotate
              </div>
              <div className="mb-2 truncate text-[12px] text-tower-fg-muted">
                “{pending.quote}”
              </div>
              <textarea
                autoFocus
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Your note — becomes a demand on the SP…"
                className="mb-2 h-16 w-full resize-none rounded-lg border border-tower-input-border bg-tower-input px-3 py-2 text-[12px] text-tower-fg-body outline-none placeholder:text-tower-fg-faint focus:border-tower-fg-dim"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="rounded-md px-2.5 py-1 font-tower-mono text-[10px] text-tower-fg-dim hover:text-tower-fg-body"
                >
                  cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !body.trim()}
                  onClick={() => void submit()}
                  className="rounded-md border border-tower-accent bg-tower-accent-tint px-2.5 py-1 font-tower-mono text-[10px] text-tower-accent-hover disabled:opacity-40"
                >
                  {busy ? "sending…" : "send"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* annotations rail */}
        <div className="min-h-0 overflow-y-auto border-l border-tower-border p-3">
          <div className="mb-2 font-tower-mono text-[9px] font-bold uppercase tracking-[0.12em] text-tower-fg-dim">
            Notes · {annotations.length}
          </div>
          {annotations.length === 0 ? (
            <div className="text-[12px] italic text-tower-fg-faint">
              Select text in the canopy to annotate it.
            </div>
          ) : (
            <ul className="space-y-2">
              {annotations.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => reveal(a)}
                    title="Reveal in canopy"
                    className={
                      "w-full rounded-[10px] border p-2.5 text-left transition-colors hover:bg-tower-bright " +
                      (a.resolved_at
                        ? "border-tower-border bg-tower-panel opacity-60"
                        : "border-l-2 border-l-tower-accent border-tower-border bg-tower-panel")
                    }
                  >
                    <div className="truncate font-tower-mono text-[10px] text-tower-fg-faint">
                      “{a.quote}”
                    </div>
                    <div className="mt-1 text-[12px] text-tower-fg-body">
                      {a.body}
                    </div>
                    <div className="mt-1 font-tower-mono text-[9px] text-tower-fg-faint">
                      {a.author}
                      {a.resolved_at ? " · resolved" : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default CanopyRenderView;
