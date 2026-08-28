import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import type { Logger } from "@bb/logger";
import { Hono } from "hono";
import { registerPluginRoutes } from "../../../src/routes/plugins.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;

async function writeFixturePlugin(dir: string, name: string): Promise<string> {
  const rootDir = join(dir, name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name,
      version: "0.1.0",
      bb: {
        name: "Frontend report fixture",
        description: "Fixture for the frontend-registration report route.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    "export default function plugin() {}\n",
  );
  return rootDir;
}

describe("plugin frontend-registration report route", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;
  let app: Hono;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-frontend-report-"));
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 2000,
    });
    app = new Hono();
    registerPluginRoutes(app, { config: { serverPort: 4000 }, db }, service);
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("reports a thrown frontend registration as an additive, honest field and clears it once a later generation succeeds", async () => {
    const rootDir = await writeFixturePlugin(workDir, "bb-plugin-report-one");
    const installed = await service.installPath(rootDir);
    const id = installed.id;
    expect(installed.enabled).toBe(true);
    expect(installed.frontendError).toBeNull();

    const failedResponse = await app.request(
      `/plugins/${id}/frontend-registration`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generation: 1,
          error: 'invalid slot id "myPanel" — use kebab-case',
        }),
      },
    );
    expect(failedResponse.status).toBe(200);
    const failedBody = (await failedResponse.json()) as {
      ok: boolean;
      plugin: { enabled: boolean; frontendError: unknown };
    };
    // Honest split state: the server half is fine (enabled stays true), the
    // frontend half names the thrown error rather than vanishing silently.
    expect(failedBody.plugin.enabled).toBe(true);
    expect(failedBody.plugin.frontendError).toMatchObject({
      message: 'invalid slot id "myPanel" — use kebab-case',
    });
    expect(
      service.list().find((p) => p.id === id)?.frontendError,
    ).toMatchObject({ message: 'invalid slot id "myPanel" — use kebab-case' });

    const clearedResponse = await app.request(
      `/plugins/${id}/frontend-registration`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation: 2, error: null }),
      },
    );
    expect(clearedResponse.status).toBe(200);
    const clearedBody = (await clearedResponse.json()) as {
      plugin: { frontendError: unknown };
    };
    expect(clearedBody.plugin.frontendError).toBeNull();
    expect(service.list().find((p) => p.id === id)?.frontendError).toBeNull();
  });

  it("ignores an out-of-order stale report and 404s for an unknown plugin", async () => {
    const rootDir = await writeFixturePlugin(workDir, "bb-plugin-report-two");
    const installed = await service.installPath(rootDir);
    const id = installed.id;

    await app.request(`/plugins/${id}/frontend-registration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generation: 5, error: "boom" }),
    });

    // Generation 3 arrives after generation 5 (out-of-order network
    // delivery) — it must not clobber the newer failure.
    const staleResponse = await app.request(
      `/plugins/${id}/frontend-registration`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation: 3, error: null }),
      },
    );
    const staleBody = (await staleResponse.json()) as {
      plugin: { frontendError: unknown };
    };
    expect(staleBody.plugin.frontendError).toMatchObject({
      message: "boom",
    });

    const unknownResponse = await app.request(
      "/plugins/does-not-exist/frontend-registration",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation: 1, error: null }),
      },
    );
    expect(unknownResponse.status).toBe(404);
  });
});
