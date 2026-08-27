import { z } from "zod";
import {
  BROWSER_SELECTOR_MAX_LENGTH,
  BROWSER_TYPED_TEXT_MAX_LENGTH,
  BROWSER_URL_MAX_LENGTH,
} from "@bb/server-contract";

const targetIdSchema = z.string().min(1).max(128);
const tabIdSchema = z.string().min(1).max(256);
const threadIdSchema = z.string().min(1).max(128);

export const bbDesktopAutomationRegisterTargetRequestSchema = z
  .object({
    targetId: targetIdSchema,
    tabId: tabIdSchema,
    threadId: threadIdSchema,
  })
  .strict();
export type BbDesktopAutomationRegisterTargetRequest = z.infer<
  typeof bbDesktopAutomationRegisterTargetRequestSchema
>;

export const bbDesktopAutomationUnregisterTargetRequestSchema = z
  .object({
    targetId: targetIdSchema,
  })
  .strict();
export type BbDesktopAutomationUnregisterTargetRequest = z.infer<
  typeof bbDesktopAutomationUnregisterTargetRequestSchema
>;

export const bbDesktopAutomationNavigateRequestSchema = z
  .object({
    targetId: targetIdSchema,
    url: z.string().min(1).max(BROWSER_URL_MAX_LENGTH),
  })
  .strict();
export type BbDesktopAutomationNavigateRequest = z.infer<
  typeof bbDesktopAutomationNavigateRequestSchema
>;

export const bbDesktopAutomationTargetRefSchema = z
  .object({
    targetId: targetIdSchema,
  })
  .strict();

export const bbDesktopAutomationClickSelectorRequestSchema = z
  .object({
    targetId: targetIdSchema,
    selector: z.string().min(1).max(BROWSER_SELECTOR_MAX_LENGTH),
  })
  .strict();

export const bbDesktopAutomationClickCoordinatesRequestSchema = z
  .object({
    targetId: targetIdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export const bbDesktopAutomationClickRequestSchema = z.union([
  bbDesktopAutomationClickSelectorRequestSchema,
  bbDesktopAutomationClickCoordinatesRequestSchema,
]);
export type BbDesktopAutomationClickRequest = z.infer<
  typeof bbDesktopAutomationClickRequestSchema
>;

export const bbDesktopAutomationTypeRequestSchema = z
  .object({
    targetId: targetIdSchema,
    selector: z.string().min(1).max(BROWSER_SELECTOR_MAX_LENGTH),
    text: z.string().max(BROWSER_TYPED_TEXT_MAX_LENGTH),
  })
  .strict();
export type BbDesktopAutomationTypeRequest = z.infer<
  typeof bbDesktopAutomationTypeRequestSchema
>;

export const bbDesktopAutomationEvalRequestSchema = z
  .object({
    targetId: targetIdSchema,
    script: z.string().min(1).max(65536),
  })
  .strict();
export type BbDesktopAutomationEvalRequest = z.infer<
  typeof bbDesktopAutomationEvalRequestSchema
>;

export const bbDesktopAutomationSnapshotResultSchema = z
  .object({
    url: z.string().max(BROWSER_URL_MAX_LENGTH),
    title: z.string().max(1024),
    text: z.string().max(8000),
  })
  .strict();
export type BbDesktopAutomationSnapshotResult = z.infer<
  typeof bbDesktopAutomationSnapshotResultSchema
>;

export interface BbDesktopAutomationApi {
  registerTarget(request: BbDesktopAutomationRegisterTargetRequest): Promise<void>;
  unregisterTarget(
    request: BbDesktopAutomationUnregisterTargetRequest,
  ): Promise<void>;
  navigate(request: BbDesktopAutomationNavigateRequest): Promise<void>;
  snapshot(
    targetId: string,
  ): Promise<BbDesktopAutomationSnapshotResult>;
  click(request: BbDesktopAutomationClickRequest): Promise<void>;
  type(request: BbDesktopAutomationTypeRequest): Promise<void>;
  eval(request: BbDesktopAutomationEvalRequest): Promise<unknown>;
  close(targetId: string): Promise<void>;
  stop(targetId: string): Promise<void>;
}
