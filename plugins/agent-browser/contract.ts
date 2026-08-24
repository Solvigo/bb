import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  BROWSER_VERB,
  CREATED_BY,
  INPUT_KIND,
  TARGET_FIELD,
} from "./grammar.js";

/** Every attacker-influenced string on this surface is bounded (plans/bb-browser.md, Phase 1). */
const URL_MAX_LENGTH = 2048;
const TEXT_MAX_LENGTH = 4096;
export const SNAPSHOT_TEXT_MAX_LENGTH = 8000;

export const threadIdSchema = z.string().min(1).max(128);
const urlSchema = z.string().min(1).max(URL_MAX_LENGTH);

export const browserTargetSchema = z
  .object({
    [TARGET_FIELD.targetId]: z.string().min(1),
    [TARGET_FIELD.threadId]: threadIdSchema,
    [TARGET_FIELD.createdBy]: z.enum([CREATED_BY.cli, CREATED_BY.agent]),
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
    text: z.string(),
  })
  .strict();

export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;

export const browserCloseResultSchema = z
  .object({
    closed: z.boolean(),
    target: browserTargetSchema.nullable(),
  })
  .strict();

const threadRefSchema = z.object({ threadId: threadIdSchema }).strict();
const threadUrlSchema = z
  .object({ threadId: threadIdSchema, url: urlSchema })
  .strict();

/**
 * `createdBy` is deliberately absent from every input: rpc callers are the
 * operator and CLI callers carrying a thread context are the agent, so the
 * field is derived at the boundary instead of being claimed by the caller.
 */
export const agentBrowserRpcContract = defineRpcContract({
  [BROWSER_VERB.open]: { input: threadUrlSchema, output: browserTargetSchema },
  [BROWSER_VERB.navigate]: {
    input: threadUrlSchema,
    output: browserTargetSchema,
  },
  [BROWSER_VERB.snapshot]: {
    input: threadRefSchema,
    output: browserSnapshotSchema,
  },
  [BROWSER_VERB.close]: {
    input: threadRefSchema,
    output: browserCloseResultSchema,
  },
});

const mouseButtonSchema = z.enum([
  "none",
  "left",
  "middle",
  "right",
  "back",
  "forward",
]);

/** CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`, bounded. */
export const browserInputEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(INPUT_KIND.mouse),
      type: z.enum([
        "mousePressed",
        "mouseReleased",
        "mouseMoved",
        "mouseWheel",
      ]),
      x: z.number().finite(),
      y: z.number().finite(),
      button: mouseButtonSchema.default("none"),
      clickCount: z.number().int().min(0).max(3).default(0),
      deltaX: z.number().finite().default(0),
      deltaY: z.number().finite().default(0),
      modifiers: z.number().int().min(0).max(15).default(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal(INPUT_KIND.key),
      type: z.enum(["keyDown", "keyUp", "rawKeyDown", "char"]),
      key: z.string().max(64).default(""),
      code: z.string().max(64).default(""),
      text: z.string().max(TEXT_MAX_LENGTH).default(""),
      windowsVirtualKeyCode: z.number().int().min(0).max(255).default(0),
      modifiers: z.number().int().min(0).max(15).default(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal(INPUT_KIND.text),
      text: z.string().min(1).max(TEXT_MAX_LENGTH),
    })
    .strict(),
]);

export type BrowserInputEvent = z.infer<typeof browserInputEventSchema>;
