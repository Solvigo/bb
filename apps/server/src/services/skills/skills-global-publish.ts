import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const SKILLS_GLOBAL_PUBLISH_FILE_NAME = "skills-global-publish.json";

const skillsGlobalPublishSchema = z
  .object({
    version: z.literal(1),
    skills: z.record(
      z.string().min(1),
      z
        .object({
          publishGlobally: z.literal(true),
        })
        .strict(),
    ),
  })
  .strict();

type SkillsGlobalPublishState = z.infer<typeof skillsGlobalPublishSchema>;

function resolveSkillsGlobalPublishPath(dataDir: string): string {
  return path.join(dataDir, SKILLS_GLOBAL_PUBLISH_FILE_NAME);
}

function emptyState(): SkillsGlobalPublishState {
  return { version: 1, skills: {} };
}

function readSkillsGlobalPublishState(
  dataDir: string,
): SkillsGlobalPublishState {
  try {
    const parsed = skillsGlobalPublishSchema.safeParse(
      JSON.parse(
        readFileSync(resolveSkillsGlobalPublishPath(dataDir), "utf8"),
      ),
    );
    return parsed.success ? parsed.data : emptyState();
  } catch {
    return emptyState();
  }
}

async function writeSkillsGlobalPublishState(
  dataDir: string,
  state: SkillsGlobalPublishState,
): Promise<void> {
  const filePath = resolveSkillsGlobalPublishPath(dataDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.bb-write-${process.pid}`;
  try {
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(state)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/** Names of data-dir skills marked for global install beside bb-cli. */
export function listGloballyPublishedSkillNames(dataDir: string): string[] {
  const state = readSkillsGlobalPublishState(dataDir);
  return Object.keys(state.skills).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function isSkillGloballyPublished(
  dataDir: string,
  skillName: string,
): boolean {
  return readSkillsGlobalPublishState(dataDir).skills[skillName] !== undefined;
}

export async function setSkillGloballyPublished(args: {
  dataDir: string;
  skillName: string;
  publishGlobally: boolean;
}): Promise<void> {
  const state = readSkillsGlobalPublishState(args.dataDir);
  if (args.publishGlobally) {
    state.skills[args.skillName] = { publishGlobally: true };
  } else {
    delete state.skills[args.skillName];
  }
  await writeSkillsGlobalPublishState(args.dataDir, state);
}

export async function clearGloballyPublishedSkill(
  dataDir: string,
  skillName: string,
): Promise<void> {
  await setSkillGloballyPublished({
    dataDir,
    skillName,
    publishGlobally: false,
  });
}
