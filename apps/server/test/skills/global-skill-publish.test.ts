import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  setSkillPublishGloballyRequestSchema,
  systemCliSkillsStatusResponseSchema,
  systemInstallCliSkillsResponseSchema,
} from "@bb/server-contract";
import { resolveDataDirSkillsRootPath } from "@bb/config/skill-storage-paths";
import { readJson } from "../helpers/json.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  isSkillGloballyPublished,
  setSkillGloballyPublished,
} from "../../src/services/skills/skills-global-publish.js";

async function writeBuiltinCliSkill(harness: TestAppHarness): Promise<void> {
  const skillDirectory = join(
    harness.deps.config.builtinSkillsRootPath,
    "bb-cli",
  );
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    "---\nname: bb-cli\ndescription: Control bb from the CLI.\n---\n",
  );
}

async function writeDataDirSkill(
  harness: TestAppHarness,
  name: string,
): Promise<void> {
  const skillDirectory = join(
    resolveDataDirSkillsRootPath(harness.deps.config.dataDir),
    name,
  );
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Published globally.\n---\n`,
  );
}

function installRequest(hostIds: string[]): Request {
  return new Request("http://test/api/v1/system/cli-skills/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostIds }),
  });
}

describe("global skill publish flag", () => {
  it("defaults off so only bb-cli is installed globally", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      await writeDataDirSkill(harness, "review");
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-laptop",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          expect(request.command).toMatchObject({
            type: "host.install_global_skills",
            skills: [{ name: "bb-cli", entryPath: "SKILL.md" }],
          });
          return {
            ok: true,
            result: { installations: [] },
          };
        },
      });

      const response = await harness.app.request(installRequest([host.id]));
      expect(response.status).toBe(200);
      systemInstallCliSkillsResponseSchema.parse(await readJson(response));
      expect(responder.requests).toHaveLength(1);
      expect(isSkillGloballyPublished(harness.deps.config.dataDir, "review")).toBe(
        false,
      );
    });
  });

  it("includes flagged data-dir skills in the install and status sets", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      await writeDataDirSkill(harness, "review");
      await setSkillGloballyPublished({
        dataDir: harness.deps.config.dataDir,
        skillName: "review",
        publishGlobally: true,
      });
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-laptop",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "host.install_global_skills") {
            expect(request.command.skills.map((skill) => skill.name).sort()).toEqual(
              ["bb-cli", "review"],
            );
            return { ok: true, result: { installations: [] } };
          }
          if (request.command.type === "host.global_skills_status") {
            expect(request.command.names).toEqual(["bb-cli", "review"]);
            return {
              ok: true,
              result: {
                entries: request.command.names.map((name) => ({
                  name,
                  path: `/home/${host.id}/.agents/skills/${name}`,
                  treeHash: null,
                })),
              },
            };
          }
          throw new Error(`Unexpected command ${request.command.type}`);
        },
      });

      const installResponse = await harness.app.request(
        installRequest([host.id]),
      );
      expect(installResponse.status).toBe(200);

      const statusResponse = await harness.app.request(
        "/api/v1/system/cli-skills",
      );
      const body = systemCliSkillsStatusResponseSchema.parse(
        await readJson(statusResponse),
      );
      expect(body.machines).toEqual([
        {
          hostId: "host-laptop",
          hostName: "Test Host",
          status: "missing",
        },
      ]);
    });
  });

  it("exposes publishGlobally on the skills list and toggles it", async () => {
    await withTestHarness(async (harness) => {
      await writeDataDirSkill(harness, "review");
      const { host, session } = seedHostSession(harness.deps, { id: "host-laptop" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "host.list_skills") {
            return { ok: true, result: { skills: [] } };
          }
          throw new Error(`Unexpected command ${request.command.type}`);
        },
      });
      const listResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/skills?environmentId=`,
      );
      const listed = (await readJson(listResponse)) as {
        skills: Array<{ name: string; publishGlobally: boolean; id: string }>;
      };
      const review = listed.skills.find((skill) => skill.name === "review");
      expect(review?.publishGlobally).toBe(false);

      const payload = setSkillPublishGloballyRequestSchema.parse({
        skillId: review?.id,
        environmentId: null,
        publishGlobally: true,
      });
      const patchResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/skills/publish-globally`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      expect(patchResponse.status).toBe(200);
      expect(await readJson(patchResponse)).toEqual({ publishGlobally: true });

      const relisted = (await readJson(
        await harness.app.request(
          `/api/v1/projects/${project.id}/skills?environmentId=`,
        ),
      )) as {
        skills: Array<{ name: string; publishGlobally: boolean }>;
      };
      expect(
        relisted.skills.find((skill) => skill.name === "review")?.publishGlobally,
      ).toBe(true);
    });
  });
});
