import { z } from "zod";

/**
 * Declarative presentation for a timeline item, attached by the provider
 * bridge when it opens the item and persisted with the item's events.
 *
 * Presentation is how a client renders an item it has no special code for:
 * a generic `tool` item from a provider nobody wrote a renderer for, or an
 * extension kind whose plugin is uninstalled or upgraded. The persisted event
 * carries the snapshot, so an old row renders the same way forever, and
 * mobile renders the declarative base for every kind without plugin code.
 *
 * Core kinds always use core renderers; `presentation` customizes them
 * (label, icon, suppression) and never replaces them. Optional on every item
 * while the grammar accepts v2 deltas beside v3 (A1 additive-then-delete);
 * the workstream that deletes the v2 paths makes it required.
 */
export const THREAD_EVENT_ITEM_PRESENTATION_DETAIL_MAX_LENGTH = 280;

export const threadEventItemPresentationLabelSchema = z.object({
  /** Present-tense row title while the item is in flight ("Reading file"). */
  pending: z.string().min(1),
  /** Past-tense row title once the item settled ("Read file"). */
  completed: z.string().min(1),
});
export type ThreadEventItemPresentationLabel = z.infer<
  typeof threadEventItemPresentationLabelSchema
>;

/**
 * A named host glyph (`{ glyph: "FileText" }`) or a plugin-relative asset
 * path (`{ asset: "./icons/tool.svg" }`) — the same two forms the plugin
 * branding and provider declaration icons use.
 */
export const threadEventItemPresentationIconSchema = z.union([
  z.object({ glyph: z.string().min(1) }),
  z.object({ asset: z.string().min(1) }),
]);
export type ThreadEventItemPresentationIcon = z.infer<
  typeof threadEventItemPresentationIconSchema
>;

export const threadEventItemPresentationTintSchema = z.object({
  light: z.string().min(1),
  dark: z.string().min(1),
});
export type ThreadEventItemPresentationTint = z.infer<
  typeof threadEventItemPresentationTintSchema
>;

export const threadEventItemPresentationSchema = z.object({
  label: threadEventItemPresentationLabelSchema,
  icon: threadEventItemPresentationIconSchema,
  /** Row headline beside the label (a path, a query, a child thread title). */
  title: z.string().optional(),
  /**
   * Short Markdown summary shown in the row body. Length-capped here so a
   * bridge cannot turn the persisted row into a transcript.
   */
  detail: z
    .string()
    .max(THREAD_EVENT_ITEM_PRESENTATION_DETAIL_MAX_LENGTH)
    .optional(),
  /** Low-value rows (TodoWrite, ToolSearch) clients collapse by default. */
  suppress: z.boolean().optional(),
  /** Accent colour per theme; omitted rows use the neutral row tint. */
  tint: threadEventItemPresentationTintSchema.optional(),
});
export type ThreadEventItemPresentation = z.infer<
  typeof threadEventItemPresentationSchema
>;
