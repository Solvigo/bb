import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { cn } from "@bb/shared-ui/lib/utils";
import { useSystemExecutionOptions } from "@/hooks/queries/system-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/route-paths";

interface SwapOk {
  ok: true;
  oldThreadId: string;
  newThreadId: string;
  providerFrom: string;
  providerTo: string;
  messagesCarried: number;
  toolCallsCarried: number;
  reason: string | null;
}
interface SwapRefused {
  ok: false;
  error: string;
}

/** A swap is only sane at a turn boundary; the store refuses otherwise. */
const BUSY_STATUSES = new Set(["active", "starting", "stopping"]);

/**
 * Move this conversation to another coding harness.
 *
 * The swap is not a mutation and cannot be: a thread's provider is fixed at
 * creation. The store makes a NEW thread on the target, carries the TEXT of the
 * conversation into it, and archives the source — so the old thread survives as
 * a record rather than a casualty, and we navigate to the successor because the
 * operator should watch the handover land rather than discover it happened.
 *
 * Tool calls deliberately do not cross. Every provider has its own, translating
 * them is the brittle low-value part, and leaving them behind is what makes
 * this simple enough to be reliable.
 */
export function SwapAgentButton({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const { data: thread } = useThread(threadId);
  const { data: options } = useSystemExecutionOptions({});
  const [error, setError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);

  const status = thread?.status ?? null;
  const optionsLoaded = options !== undefined;
  // The refusal is honest, but a button that explains itself before you press
  // it reads better than one that explains itself after.
  const busy = status !== null && BUSY_STATUSES.has(status);
  const targets = (options?.providers ?? []).filter(
    (provider) => provider.available && provider.id !== thread?.providerId,
  );

  const swap = async (to: string) => {
    if (swapping) return;
    setSwapping(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/plugins/crew/rpc/crew_swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, to }),
      });
      const body = (await res.json()) as { result?: SwapOk | SwapRefused };
      const result = body.result;
      if (!result || result.ok !== true) {
        setError(result?.error ?? "The swap did not complete.");
        return;
      }
      navigate(
        getThreadRoutePath({
          projectId: thread?.projectId ?? "",
          threadId: result.newThreadId,
        }),
      );
    } catch {
      setError("No answer from the store — nothing was swapped.");
    } finally {
      setSwapping(false);
    }
  };

  // A control that vanishes cannot be told apart from a build that never had
  // it. Until the provider list has been read we do not KNOW whether there is
  // anywhere to swap to, and once we do know, "nowhere" is an answer worth
  // printing rather than a reason to disappear.
  if (!optionsLoaded || targets.length === 0) {
    return (
      <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
        <span
          data-testid="swap-agent-unavailable"
          title={
            optionsLoaded
              ? "No other coding harness is available on this instance."
              : "Still reading which harnesses this instance can reach."
          }
          className="flex shrink-0 items-center gap-1 rounded-md border border-tower-border px-2 py-0.5 font-tower-mono text-[10px] text-tower-fg-faint opacity-60"
        >
          <Icon name="Zap" className="size-3" />
          {optionsLoaded ? "no swap targets" : "swap…"}
        </span>
      </span>
    );
  }

  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy || swapping}
            data-testid="swap-agent-button"
            title={
              busy
                ? "This agent is mid-turn. A swap waits for a turn boundary."
                : "Move this conversation to another coding harness"
            }
            className="flex shrink-0 items-center gap-1 rounded-md border border-tower-border px-2 py-0.5 font-tower-mono text-[10px] text-tower-fg-dim transition-colors hover:bg-tower-bright hover:text-tower-fg-body disabled:opacity-50"
          >
            <Icon name="Zap" className="size-3" />
            {swapping ? "swapping…" : "swap"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" mobileTitle="Swap harness">
          <DropdownMenuLabel>Continue this conversation on…</DropdownMenuLabel>
          {targets.map((provider) => (
            <DropdownMenuItem
              key={provider.id}
              onSelect={() => void swap(provider.id)}
            >
              {provider.displayName ?? provider.id}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <span className="min-w-0 truncate text-[10px] text-tower-accent-hover" title={error}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

export default SwapAgentButton;
