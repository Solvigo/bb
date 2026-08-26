import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import {
  mapDesktopAutomationChannelError,
  readBrowserCallerContext,
} from "../services/browser/browser-automation-lifecycle.js";

export function registerBrowserRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.browser;
  const browser = deps.browserAutomation;

  post(routes.open, async (context, payload) => {
    try {
      const target = await browser.open({
        caller: readBrowserCallerContext(context),
        payload,
      });
      return context.json(target);
    } catch (error) {
      throw mapDesktopAutomationChannelError(error);
    }
  });

  get(routes.list, (context, query) => {
    const caller = readBrowserCallerContext(context);
    const scope =
      query?.thread !== undefined
        ? { ...caller, explicitThreadId: query.thread }
        : caller;
    return context.json(browser.list({ caller: scope }));
  });

  post(routes.navigate, async (context, payload) => {
    try {
      const target = await browser.navigate({
        caller: readBrowserCallerContext(context),
        payload,
      });
      return context.json(target);
    } catch (error) {
      throw mapDesktopAutomationChannelError(error);
    }
  });

  post(routes.snapshot, async (context, payload) => {
    try {
      const snapshot = await browser.snapshot({
        caller: readBrowserCallerContext(context),
        payload,
      });
      return context.json(snapshot);
    } catch (error) {
      throw mapDesktopAutomationChannelError(error);
    }
  });

  post(routes.click, async (context, payload) => {
    try {
      const target = await browser.click({
        caller: readBrowserCallerContext(context),
        payload,
      });
      return context.json(target);
    } catch (error) {
      throw mapDesktopAutomationChannelError(error);
    }
  });

  post(routes.type, async (context, payload) => {
    try {
      const target = await browser.type({
        caller: readBrowserCallerContext(context),
        payload,
      });
      return context.json(target);
    } catch (error) {
      throw mapDesktopAutomationChannelError(error);
    }
  });

  post(routes.eval, async (context, payload) => {
    try {
      const result = await browser.eval({
        caller: readBrowserCallerContext(context),
        payload,
      });
      return context.json(result);
    } catch (error) {
      throw mapDesktopAutomationChannelError(error);
    }
  });

  post(routes.close, async (context, payload) => {
    try {
      const result = await browser.close({
        caller: readBrowserCallerContext(context),
        payload,
      });
      return context.json(result);
    } catch (error) {
      throw mapDesktopAutomationChannelError(error);
    }
  });
}
