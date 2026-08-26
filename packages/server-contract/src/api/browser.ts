import { z } from "zod";
import {
  BROWSER_VERB,
  CREATED_BY,
  TARGET_FIELD,
  type BrowserCreatedBy,
} from "./browser-grammar.js";

/** Every attacker-influenced string on this surface is bounded (plans/bb-browser.md). */
export const BROWSER_URL_MAX_LENGTH = 2048;
export const BROWSER_SELECTOR_MAX_LENGTH = 4096;
export const BROWSER_TYPED_TEXT_MAX_LENGTH = 4096;
export const BROWSER_EVAL_SCRIPT_MAX_LENGTH = 65536;
export const BROWSER_SNAPSHOT_TEXT_MAX_LENGTH = 8000;
export const BROWSER_TARGET_LIST_MAX_LENGTH = 64;

const urlSchema = z.string().min(1).max(BROWSER_URL_MAX_LENGTH);
const selectorSchema = z.string().min(1).max(BROWSER_SELECTOR_MAX_LENGTH);
const targetIdSchema = z.string().min(1).max(128);
const threadIdSchema = z.string().min(1).max(128);

export const browserCreatedBySchema = z.enum([
  CREATED_BY.cli,
  CREATED_BY.agent,
]);
export type BrowserCreatedByValue = BrowserCreatedBy;

export const browserTargetSchema = z
  .object({
    [TARGET_FIELD.targetId]: targetIdSchema,
    [TARGET_FIELD.threadId]: threadIdSchema,
    [TARGET_FIELD.createdBy]: browserCreatedBySchema,
    [TARGET_FIELD.visible]: z.boolean(),
    [TARGET_FIELD.createdAt]: z.string(),
    [TARGET_FIELD.lastUsedAt]: z.string(),
  })
  .strict();
export type BrowserTarget = z.infer<typeof browserTargetSchema>;

export const browserSnapshotSchema = z
  .object({
    target: browserTargetSchema,
    url: z.string(),
    title: z.string(),
    text: z.string().max(BROWSER_SNAPSHOT_TEXT_MAX_LENGTH),
  })
  .strict();
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;

export const browserCloseResultSchema = z
  .object({
    closed: z.boolean(),
    target: browserTargetSchema.nullable(),
  })
  .strict();
export type BrowserCloseResult = z.infer<typeof browserCloseResultSchema>;

export const browserListResponseSchema = z
  .object({
    targets: z.array(browserTargetSchema).max(BROWSER_TARGET_LIST_MAX_LENGTH),
  })
  .strict();
export type BrowserListResponse = z.infer<typeof browserListResponseSchema>;

/**
 * Optional `--thread` query flag. When present the operator names a thread
 * explicitly; when omitted the caller's thread context (header) supplies it.
 */
export const browserThreadScopeQuerySchema = z
  .object({
    thread: threadIdSchema.optional(),
  })
  .strict();
export type BrowserThreadScopeQuery = z.infer<
  typeof browserThreadScopeQuerySchema
>;

export const browserOpenRequestSchema = z
  .object({
    url: urlSchema,
    visible: z.boolean().optional(),
  })
  .strict();
export type BrowserOpenRequest = z.infer<typeof browserOpenRequestSchema>;

export const browserNavigateRequestSchema = z
  .object({
    targetId: targetIdSchema,
    url: urlSchema,
  })
  .strict();
export type BrowserNavigateRequest = z.infer<
  typeof browserNavigateRequestSchema
>;

export const browserTargetRefRequestSchema = z
  .object({
    targetId: targetIdSchema,
  })
  .strict();
export type BrowserTargetRefRequest = z.infer<
  typeof browserTargetRefRequestSchema
>;

export const browserClickSelectorRequestSchema = z
  .object({
    targetId: targetIdSchema,
    selector: selectorSchema,
  })
  .strict();

export const browserClickCoordinatesRequestSchema = z
  .object({
    targetId: targetIdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export const browserClickRequestSchema = z.union([
  browserClickSelectorRequestSchema,
  browserClickCoordinatesRequestSchema,
]);
export type BrowserClickRequest = z.infer<typeof browserClickRequestSchema>;

export const browserTypeRequestSchema = z
  .object({
    targetId: targetIdSchema,
    selector: selectorSchema,
    text: z.string().max(BROWSER_TYPED_TEXT_MAX_LENGTH),
  })
  .strict();
export type BrowserTypeRequest = z.infer<typeof browserTypeRequestSchema>;

export const browserEvalRequestSchema = z
  .object({
    targetId: targetIdSchema,
    script: z.string().min(1).max(BROWSER_EVAL_SCRIPT_MAX_LENGTH),
  })
  .strict();
export type BrowserEvalRequest = z.infer<typeof browserEvalRequestSchema>;

export const browserEvalResultSchema = z
  .object({
    target: browserTargetSchema,
    result: z.unknown(),
  })
  .strict();
export type BrowserEvalResult = z.infer<typeof browserEvalResultSchema>;

export const browserAutomationAuditEntrySchema = z
  .object({
    verb: z.enum([
      BROWSER_VERB.open,
      BROWSER_VERB.list,
      BROWSER_VERB.navigate,
      BROWSER_VERB.snapshot,
      BROWSER_VERB.click,
      BROWSER_VERB.type,
      BROWSER_VERB.eval,
      BROWSER_VERB.close,
    ]),
    targetId: targetIdSchema.nullable(),
    threadId: threadIdSchema.nullable(),
    createdBy: browserCreatedBySchema,
    callerThreadId: threadIdSchema.nullable(),
    visible: z.boolean().nullable(),
  })
  .strict();
export type BrowserAutomationAuditEntry = z.infer<
  typeof browserAutomationAuditEntrySchema
>;

export const desktopAutomationChannelUnavailableDetailsSchema = z
  .object({
    missing: z.literal("desktop-automation-channel"),
  })
  .strict();
export type DesktopAutomationChannelUnavailableDetails = z.infer<
  typeof desktopAutomationChannelUnavailableDetailsSchema
>;
