/**
 * Reader for the private provider corpus: real production threads extracted
 * from a bb database for the provider-plugin migration regression gates.
 *
 * The corpus is never committed. Tests find it through
 * `BB_PROVIDER_CORPUS_DIR` and must skip when it is absent
 * (`describe.skipIf(!corpusAvailable())`). Layout:
 *
 *   manifest.json                          thread selection and reasons
 *   threads/<provider>/<threadId>/meta.json      `threads` row + reasons
 *   threads/<provider>/<threadId>/events.ndjson  raw `events` rows in order
 *
 * Event payloads decode through the same `@bb/domain` parser the server uses
 * for stored rows, so a corpus thread that fails to load here would also fail
 * to load in production.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildThreadEventRow,
  parseStoredThreadEvent,
  reasoningLevelSchema,
  threadEventScopeKindSchema,
  threadEventTypeSchema,
  threadOriginKindSchema,
  threadScope,
  threadStatusSchema,
  threadVisibilitySchema,
  turnScope,
} from "@bb/domain";
import type { ThreadEventRow, ThreadEventScope } from "@bb/domain";
import { z } from "zod";

export const PROVIDER_CORPUS_DIR_ENV = "BB_PROVIDER_CORPUS_DIR";

const corpusManifestThreadSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  events: z.number().int().nonnegative(),
  reasons: z.array(z.string().min(1)),
});

const corpusManifestSchema = z.object({
  providers: z.array(z.string().min(1)),
  threads: z.array(corpusManifestThreadSchema),
});

const corpusThreadRowSchema = z.object({
  id: z.string().min(1),
  provider_id: z.string().min(1),
  title: z.string().nullable(),
  status: threadStatusSchema,
  created_at: z.number().int(),
  updated_at: z.number().int(),
  archived_at: z.number().int().nullable(),
  deleted_at: z.number().int().nullable(),
  parent_thread_id: z.string().nullable(),
  origin_kind: threadOriginKindSchema.nullable(),
  visibility: threadVisibilitySchema,
  model_override: z.string().nullable(),
  reasoning_level_override: reasoningLevelSchema.nullable(),
});

const corpusMetaSchema = z.object({
  thread: corpusThreadRowSchema,
  features: z.record(z.string(), z.union([z.number(), z.string()])),
  reasons: z.array(z.string().min(1)),
  event_rows: z.number().int().nonnegative(),
});

const corpusEventRowSchema = z.object({
  id: z.string().min(1),
  thread_id: z.string().min(1),
  environment_id: z.string().nullable(),
  scope_kind: threadEventScopeKindSchema,
  turn_id: z.string().nullable(),
  provider_thread_id: z.string().nullable(),
  sequence: z.number().int().nonnegative(),
  type: threadEventTypeSchema,
  item_id: z.string().nullable(),
  item_kind: z.string().nullable(),
  data: z.string(),
  created_at: z.number().int(),
  parent_tool_call_id: z.string().nullable(),
});

export type CorpusManifestThread = z.infer<typeof corpusManifestThreadSchema>;

/** The `threads` row as extracted, with the column subset the extractor kept. */
export interface CorpusThreadRow {
  id: string;
  providerId: string;
  title: string | null;
  status: z.infer<typeof threadStatusSchema>;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
  parentThreadId: string | null;
  originKind: z.infer<typeof threadOriginKindSchema> | null;
  visibility: z.infer<typeof threadVisibilitySchema>;
  modelOverride: string | null;
  reasoningLevelOverride: z.infer<typeof reasoningLevelSchema> | null;
}

/** One raw `events` row, column-for-column, ready to insert as stored. */
export interface CorpusStoredEventRow {
  id: string;
  threadId: string;
  environmentId: string | null;
  scopeKind: z.infer<typeof threadEventScopeKindSchema>;
  turnId: string | null;
  providerThreadId: string | null;
  sequence: number;
  type: z.infer<typeof threadEventTypeSchema>;
  itemId: string | null;
  itemKind: string | null;
  data: string;
  createdAt: number;
  parentToolCallId: string | null;
}

export interface CorpusThread {
  id: string;
  provider: string;
  reasons: string[];
  features: Record<string, number | string>;
  thread: CorpusThreadRow;
  /** Raw rows in sequence order, for inserting into a test database. */
  eventRows: CorpusStoredEventRow[];
  /** The same rows decoded with the server's stored-event parser. */
  events: ThreadEventRow[];
}

export interface ListCorpusThreadsArgs {
  provider?: string;
  /** Keep threads whose manifest reasons include at least one of these. */
  reasons?: readonly string[];
}

export function resolveProviderCorpusDir(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[PROVIDER_CORPUS_DIR_ENV];
  if (value === undefined || value.trim().length === 0) {
    return null;
  }
  return path.resolve(value);
}

export function corpusAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const dir = resolveProviderCorpusDir(env);
  return dir !== null && fs.existsSync(path.join(dir, "manifest.json"));
}

function requireProviderCorpusDir(): string {
  const dir = resolveProviderCorpusDir();
  if (dir === null) {
    throw new Error(
      `${PROVIDER_CORPUS_DIR_ENV} is not set; guard the suite with corpusAvailable()`,
    );
  }
  return dir;
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function listCorpusThreads(
  args: ListCorpusThreadsArgs = {},
): CorpusManifestThread[] {
  const dir = requireProviderCorpusDir();
  const manifest = corpusManifestSchema.parse(
    readJsonFile(path.join(dir, "manifest.json")),
  );
  return manifest.threads.filter((thread) => {
    if (args.provider !== undefined && thread.provider !== args.provider) {
      return false;
    }
    if (
      args.reasons !== undefined &&
      !args.reasons.some((reason) => thread.reasons.includes(reason))
    ) {
      return false;
    }
    return true;
  });
}

function toCorpusThreadRow(
  row: z.infer<typeof corpusThreadRowSchema>,
): CorpusThreadRow {
  return {
    id: row.id,
    providerId: row.provider_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    parentThreadId: row.parent_thread_id,
    originKind: row.origin_kind,
    visibility: row.visibility,
    modelOverride: row.model_override,
    reasoningLevelOverride: row.reasoning_level_override,
  };
}

function toCorpusStoredEventRow(
  row: z.infer<typeof corpusEventRowSchema>,
): CorpusStoredEventRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    environmentId: row.environment_id,
    scopeKind: row.scope_kind,
    turnId: row.turn_id,
    providerThreadId: row.provider_thread_id,
    sequence: row.sequence,
    type: row.type,
    itemId: row.item_id,
    itemKind: row.item_kind,
    data: row.data,
    createdAt: row.created_at,
    parentToolCallId: row.parent_tool_call_id,
  };
}

function toStoredEventScope(row: CorpusStoredEventRow): ThreadEventScope {
  if (row.scopeKind === "thread") {
    return threadScope();
  }
  if (row.turnId === null) {
    throw new Error(
      `Corpus event ${row.id} (#${row.sequence}, ${row.type}) has turn scope without turn_id`,
    );
  }
  return turnScope(row.turnId);
}

/**
 * Decodes a raw row the way `apps/server` `parseStoredEventRow` does: the
 * `data` JSON plus the scope columns go through `parseStoredThreadEvent`.
 */
export function decodeCorpusStoredEventRow(
  row: CorpusStoredEventRow,
): ThreadEventRow {
  const scope = toStoredEventScope(row);
  const data: unknown = JSON.parse(row.data);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `Corpus event ${row.id} (#${row.sequence}, ${row.type}) has malformed data`,
    );
  }
  const event = parseStoredThreadEvent({
    type: row.type,
    data: z.record(z.string(), z.unknown()).parse(data),
    threadId: row.threadId,
    providerThreadId: row.providerThreadId,
    scope,
  });
  return buildThreadEventRow({
    id: row.id,
    scope,
    threadId: row.threadId,
    seq: row.sequence,
    createdAt: row.createdAt,
    event,
  });
}

function findCorpusThreadDir(dir: string, threadId: string): string {
  const threadsDir = path.join(dir, "threads");
  for (const provider of fs.readdirSync(threadsDir)) {
    const candidate = path.join(threadsDir, provider, threadId);
    if (fs.existsSync(path.join(candidate, "meta.json"))) {
      return candidate;
    }
  }
  throw new Error(`Corpus thread ${threadId} not found under ${threadsDir}`);
}

export function loadCorpusThread(threadId: string): CorpusThread {
  const dir = requireProviderCorpusDir();
  const threadDir = findCorpusThreadDir(dir, threadId);
  const meta = corpusMetaSchema.parse(
    readJsonFile(path.join(threadDir, "meta.json")),
  );
  const ndjson = fs.readFileSync(path.join(threadDir, "events.ndjson"), "utf8");
  const eventRows: CorpusStoredEventRow[] = [];
  for (const line of ndjson.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    eventRows.push(
      toCorpusStoredEventRow(corpusEventRowSchema.parse(JSON.parse(line))),
    );
  }
  if (eventRows.length !== meta.event_rows) {
    throw new Error(
      `Corpus thread ${threadId} has ${eventRows.length} event rows; meta.json says ${meta.event_rows}`,
    );
  }
  return {
    id: meta.thread.id,
    provider: meta.thread.provider_id,
    reasons: meta.reasons,
    features: meta.features,
    thread: toCorpusThreadRow(meta.thread),
    eventRows,
    events: eventRows.map((row) => decodeCorpusStoredEventRow(row)),
  };
}
