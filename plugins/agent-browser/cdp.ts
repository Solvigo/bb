import { z } from "zod";

/**
 * A minimal Chrome DevTools Protocol client over one browser-level WebSocket,
 * using flat sessions (`Target.attachToTarget {flatten: true}`) so every page
 * shares this socket and carries a `sessionId`.
 *
 * CDP is an external boundary, so results arrive as `unknown` and each caller
 * parses the shape it needs.
 */

const CALL_TIMEOUT_MS = 20_000;

const cdpFrameSchema = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
  sessionId: z.string().optional(),
});

export interface CdpEvent {
  readonly params: unknown;
  readonly sessionId: string | undefined;
}

export type CdpEventListener = (event: CdpEvent) => void;

export interface CdpConnection {
  call<T>(
    method: string,
    params: Record<string, unknown>,
    schema: z.ZodType<T>,
    sessionId?: string,
  ): Promise<T>;
  /** A call whose result this surface does not read. */
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<void>;
  on(method: string, listener: CdpEventListener): () => void;
  /** Resolves with the reason the socket closed. */
  readonly closed: Promise<string>;
  close(): void;
}

export class CdpError extends Error {}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface PendingCall {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export async function connectCdp(
  webSocketDebuggerUrl: string,
): Promise<CdpConnection> {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map<number, PendingCall>();
  const listeners = new Map<string, Set<CdpEventListener>>();
  let nextId = 0;
  let closeReason: string | null = null;
  let resolveClosed: (reason: string) => void = () => {};
  const closed = new Promise<string>((resolve) => {
    resolveClosed = resolve;
  });

  const settleClosed = (reason: string): void => {
    if (closeReason !== null) return;
    closeReason = reason;
    for (const [, call] of pending) {
      clearTimeout(call.timer);
      call.reject(new CdpError(`CDP connection closed: ${reason}`));
    }
    pending.clear();
    resolveClosed(reason);
  };

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const frame = cdpFrameSchema.safeParse(parseJson(event.data));
    if (!frame.success) return;
    const { id, method, params, result, error, sessionId } = frame.data;
    if (id !== undefined) {
      const call = pending.get(id);
      if (!call) return;
      pending.delete(id);
      clearTimeout(call.timer);
      if (error) call.reject(new CdpError(error.message));
      else call.resolve(result);
      return;
    }
    if (method === undefined) return;
    for (const listener of listeners.get(method) ?? []) {
      listener({ params, sessionId });
    }
  });
  socket.addEventListener("close", () => settleClosed("socket closed"));
  socket.addEventListener("error", () => settleClosed("socket error"));

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () =>
        reject(new CdpError(`could not open ${webSocketDebuggerUrl}`)),
      { once: true },
    );
    socket.addEventListener(
      "close",
      () =>
        reject(new CdpError(`${webSocketDebuggerUrl} closed before opening`)),
      { once: true },
    );
  });

  function rawCall(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): Promise<unknown> {
    if (closeReason !== null) {
      return Promise.reject(
        new CdpError(`CDP connection closed: ${closeReason}`),
      );
    }
    const id = ++nextId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new CdpError(`${method} timed out after ${CALL_TIMEOUT_MS}ms`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      socket.send(
        JSON.stringify(
          sessionId === undefined
            ? { id, method, params }
            : { id, method, params, sessionId },
        ),
      );
    });
  }

  return {
    async call(method, params, schema, sessionId) {
      const result = await rawCall(method, params, sessionId);
      const parsed = schema.safeParse(result);
      if (!parsed.success) {
        throw new CdpError(
          `${method} returned an unexpected shape: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    },
    async send(method, params = {}, sessionId) {
      await rawCall(method, params, sessionId);
    },
    on(method, listener) {
      const set = listeners.get(method) ?? new Set<CdpEventListener>();
      set.add(listener);
      listeners.set(method, set);
      return () => {
        set.delete(listener);
      };
    },
    closed,
    close() {
      settleClosed("closed locally");
      socket.close();
    },
  };
}
