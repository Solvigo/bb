import { z } from "zod";
import { BROWSER_VERB } from "./browser-grammar.js";
import {
  browserClickRequestSchema,
  browserEvalRequestSchema,
  browserNavigateRequestSchema,
  browserOpenRequestSchema,
  browserTargetRefRequestSchema,
  browserTypeRequestSchema,
} from "./browser.js";

export const DESKTOP_AUTOMATION_CHANNEL_CAPABILITY = "browser-automation-v1";

const requestIdSchema = z.string().min(1).max(128);
const threadIdSchema = z.string().min(1).max(128);
const targetIdSchema = z.string().min(1).max(128);
const tabIdSchema = z.string().min(1).max(256);

export const desktopAutomationRegisterMessageSchema = z
  .object({
    type: z.literal("register"),
    capabilities: z
      .array(z.literal(DESKTOP_AUTOMATION_CHANNEL_CAPABILITY))
      .min(1)
      .max(8),
  })
  .strict();
export type DesktopAutomationRegisterMessage = z.infer<
  typeof desktopAutomationRegisterMessageSchema
>;

const desktopAutomationOpenPayloadSchema = browserOpenRequestSchema.extend({
  targetId: targetIdSchema,
});
const desktopAutomationNavigatePayloadSchema = browserNavigateRequestSchema;
const desktopAutomationTargetPayloadSchema = browserTargetRefRequestSchema;
const desktopAutomationClickPayloadSchema = browserClickRequestSchema;
const desktopAutomationTypePayloadSchema = browserTypeRequestSchema;
const desktopAutomationEvalPayloadSchema = browserEvalRequestSchema;

export const desktopAutomationCommandMessageSchema = z
  .object({
    type: z.literal("command"),
    requestId: requestIdSchema,
    verb: z.enum([
      BROWSER_VERB.open,
      BROWSER_VERB.navigate,
      BROWSER_VERB.snapshot,
      BROWSER_VERB.click,
      BROWSER_VERB.type,
      BROWSER_VERB.eval,
      BROWSER_VERB.close,
    ]),
    threadId: threadIdSchema,
    targetId: targetIdSchema.optional(),
    payload: z.union([
      desktopAutomationOpenPayloadSchema,
      desktopAutomationNavigatePayloadSchema,
      desktopAutomationTargetPayloadSchema,
      desktopAutomationClickPayloadSchema,
      desktopAutomationTypePayloadSchema,
      desktopAutomationEvalPayloadSchema,
      z.object({}).strict(),
    ]),
  })
  .strict();
export type DesktopAutomationCommandMessage = z.infer<
  typeof desktopAutomationCommandMessageSchema
>;

export const desktopAutomationCancelMessageSchema = z
  .object({
    type: z.literal("cancel"),
    requestId: requestIdSchema,
  })
  .strict();
export type DesktopAutomationCancelMessage = z.infer<
  typeof desktopAutomationCancelMessageSchema
>;

export const desktopAutomationSnapshotResultSchema = z
  .object({
    url: z.string(),
    title: z.string().max(1024),
    text: z.string().max(8000),
  })
  .strict();
export type DesktopAutomationSnapshotResult = z.infer<
  typeof desktopAutomationSnapshotResultSchema
>;

export const desktopAutomationOpenResultSchema = z
  .object({
    tabId: tabIdSchema,
  })
  .strict();
export type DesktopAutomationOpenResult = z.infer<
  typeof desktopAutomationOpenResultSchema
>;

export const desktopAutomationResponseMessageSchema = z.union([
  z
    .object({
      type: z.literal("response"),
      requestId: requestIdSchema,
      ok: z.literal(true),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("response"),
      requestId: requestIdSchema,
      ok: z.literal(false),
      error: z
        .object({
          code: z.string().min(1).max(64),
          message: z.string().min(1).max(1024),
        })
        .strict(),
    })
    .strict(),
]);
export type DesktopAutomationResponseMessage = z.infer<
  typeof desktopAutomationResponseMessageSchema
>;

export const desktopAutomationClientMessageSchema = z.union([
  desktopAutomationRegisterMessageSchema,
  desktopAutomationResponseMessageSchema,
]);
export type DesktopAutomationClientMessage = z.infer<
  typeof desktopAutomationClientMessageSchema
>;

export const desktopAutomationServerMessageSchema = z.discriminatedUnion(
  "type",
  [
    desktopAutomationCommandMessageSchema,
    desktopAutomationCancelMessageSchema,
  ],
);
export type DesktopAutomationServerMessage = z.infer<
  typeof desktopAutomationServerMessageSchema
>;
