import {
  createNodeBbSdk,
  createNodeTransport,
  type BbSdk,
  type BbSdkContext,
  type BbSdkTransport,
} from "@bb/sdk/node";

export interface CreateCliBbSdkOptions {
  context?: BbSdkContext;
}

export function cliFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, init);
}

export function createCliTransport(
  baseUrl: string,
  options: { fetch?: typeof cliFetch } = {},
): BbSdkTransport {
  return createNodeTransport({
    baseUrl,
    fetch: options.fetch ?? cliFetch,
  });
}

export function createCliBbSdk(
  baseUrl: string,
  options: CreateCliBbSdkOptions = {},
): BbSdk {
  return createNodeBbSdk({
    baseUrl,
    context: options.context,
    fetch: cliFetch,
  });
}
