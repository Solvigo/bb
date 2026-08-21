/**
 * Timeline-build performance baselines.
 *
 * 1. Corpus baseline (needs `BB_PROVIDER_CORPUS_DIR`): the 10 largest threads
 *    per provider, N=5 profiled builds each of the latest page and of the full
 *    page walk, after one warm-up build. Write mode records the numbers in
 *    `$BB_PROVIDER_CORPUS_DIR/snapshots/perf-baseline.json`; compare mode
 *    fails when a thread's normalized build cost exceeds its baseline by more
 *    than 10% or its median persisted event size by more than 15%.
 *
 *    Raw wall-clock p50/p95 are recorded and printed, but the gate uses the
 *    minimum of the five samples divided by the minimum of five interleaved
 *    builds of the synthetic calibration thread. Contention only ever adds
 *    time, so the minimum is the estimate closest to the intrinsic cost, and
 *    the in-run calibration cancels machine speed and load. On a loaded
 *    16-core workstation the raw p50 swung by up to 30% between two runs of
 *    the same commit; the normalized minimum stayed within a few percent, with
 *    rare bursts that the per-thread retry (below) absorbs.
 *
 * 2. CI micro-benchmark (always runs): every page of a synthetic 10k-event
 *    thread must build under a generous ceiling. It guards against a
 *    pathological regression, not against the budget the corpus baseline pins.
 */
import fs from "node:fs";
import path from "node:path";
import {
  corpusAvailable,
  listCorpusThreads,
  loadCorpusThread,
  resolveProviderCorpusDir,
} from "@bb/test-helpers";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ThreadTimelineBuildProfileStage } from "../../src/services/threads/timeline.js";
import {
  buildAllRouteTimelinePages,
  buildRouteTimelinePage,
  formatMarkdownTable,
  latestTimelinePage,
  loadCorpusThreadIntoDb,
  percentile,
  resolveSnapshotMode,
  type BuiltTimelinePage,
} from "./corpus-harness.js";
import {
  createSyntheticThread,
  type SyntheticThread,
} from "./synthetic-thread.js";

const BUILD_SAMPLES = 5;
/**
 * A burst of interference (another suite starting, a GC pause) can still hit
 * all five samples of one thread. Each thread is measured up to this many
 * times: write mode keeps the cheapest attempt, compare mode stops at the first
 * attempt that passes and fails only when every attempt exceeds the budget.
 */
const MEASUREMENT_ATTEMPTS = 3;
const LARGEST_PER_PROVIDER = 10;
const DURATION_TOLERANCE = 1.1;
/**
 * A latest-page build on a well-windowed thread takes ~2–20 ms, where one
 * timer tick or cache miss is already 10%. The budget is 10% or this many
 * milliseconds of intrinsic cost, whichever is larger.
 */
const DURATION_TOLERANCE_FLOOR_MS = 5;
const DATA_BYTES_TOLERANCE = 1.15;
const PER_THREAD_TIMEOUT_MS = 5 * 60_000;

/**
 * Measured locally at 160–250 ms p50 for the full page walk of the 10k-event
 * synthetic thread (12 pages, default variant) on a 2026 Linux workstation;
 * the ceiling is the top of that range times three so a slow CI runner passes
 * while a pathological regression (an unbounded reprojection, a quadratic
 * pass) still fails.
 */
const SYNTHETIC_EVENT_COUNT = 10_000;
const SYNTHETIC_CEILING_MS = 750;

const STAGES: readonly ThreadTimelineBuildProfileStage[] = [
  "event-query",
  "accepted-client-request-context-query",
  "event-json-decode",
  "summary-compaction",
  "context-window-query",
  "context-window-json-decode",
  "thread-view-projection",
  "pagination-segmentation",
];

const buildCostSchema = z.object({
  p50Ms: z.number(),
  p95Ms: z.number(),
  minMs: z.number(),
  /** `minMs` divided by the calibration thread's `minMs` from the same run. */
  normalizedMin: z.number(),
});
type BuildCost = z.infer<typeof buildCostSchema>;

const perfThreadBaselineSchema = z.object({
  provider: z.string(),
  eventRows: z.number(),
  dataBytesMedian: z.number(),
  dataBytesP95: z.number(),
  dataBytesTotal: z.number(),
  /** Full-walk minimum of the synthetic calibration thread, measured just before. */
  calibrationMinMs: z.number(),
  latest: buildCostSchema.extend({
    rowsProduced: z.number(),
    selectionStrategy: z.string(),
    stageP50Ms: z.record(z.string(), z.number()),
  }),
  walk: buildCostSchema.extend({
    pages: z.number(),
    rowsProduced: z.number(),
  }),
});
type PerfThreadBaseline = z.infer<typeof perfThreadBaselineSchema>;

const perfBaselineSchema = z.object({
  samplesPerThread: z.number(),
  calibrationEventCount: z.number(),
  threads: z.record(z.string(), perfThreadBaselineSchema),
});
type PerfBaseline = z.infer<typeof perfBaselineSchema>;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stageDuration(
  page: BuiltTimelinePage,
  stage: ThreadTimelineBuildProfileStage,
): number {
  return page.profile.stageTimings
    .filter((timing) => timing.stage === stage)
    .reduce((total, timing) => total + timing.durationMs, 0);
}

function sumProfileDurations(pages: readonly BuiltTimelinePage[]): number {
  return pages.reduce(
    (total, page) => total + page.profile.totalDurationMs,
    0,
  );
}

/** One warm-up build, then `BUILD_SAMPLES` measured builds. */
function sample<T>(build: () => T): T[] {
  build();
  const samples: T[] = [];
  for (let index = 0; index < BUILD_SAMPLES; index += 1) {
    samples.push(build());
  }
  return samples;
}

function buildCost(
  durations: readonly number[],
  calibrationMinMs: number,
): BuildCost {
  const minMs = Math.min(...durations);
  return {
    p50Ms: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    minMs: round(minMs),
    normalizedMin: round(minMs / calibrationMinMs, 4),
  };
}

function walkSynthetic(synthetic: SyntheticThread): BuiltTimelinePage[] {
  return buildAllRouteTimelinePages({
    db: synthetic.db,
    thread: synthetic.thread,
    variant: "default",
  });
}

interface InterleavedSample {
  calibrationMs: number;
  latest: BuiltTimelinePage;
  walk: BuiltTimelinePage[];
}

function measureCorpusThread(
  threadId: string,
  synthetic: SyntheticThread,
): PerfThreadBaseline {
  const corpusThread = loadCorpusThread(threadId);
  const loaded = loadCorpusThreadIntoDb(corpusThread);
  try {
    // Calibration, latest page, and full walk are interleaved per sample so a
    // change in machine load lands on the calibration and the thread alike.
    const samples = sample(
      (): InterleavedSample => ({
        calibrationMs: sumProfileDurations(walkSynthetic(synthetic)),
        latest: buildRouteTimelinePage({
          db: loaded.db,
          thread: loaded.thread,
          page: latestTimelinePage(),
          variant: "default",
        }),
        walk: buildAllRouteTimelinePages({
          db: loaded.db,
          thread: loaded.thread,
          variant: "default",
        }),
      }),
    );
    const calibrationMinMs = Math.min(
      ...samples.map((entry) => entry.calibrationMs),
    );
    const latestSamples = samples.map((entry) => entry.latest);
    const walkSamples = samples.map((entry) => entry.walk);
    const latestStageP50Ms: Record<string, number> = {};
    for (const stage of STAGES) {
      latestStageP50Ms[stage] = round(
        percentile(
          latestSamples.map((page) => stageDuration(page, stage)),
          0.5,
        ),
      );
    }
    const dataBytes = corpusThread.eventRows.map((row) =>
      Buffer.byteLength(row.data),
    );
    const lastLatest = latestSamples[latestSamples.length - 1];
    const lastWalk = walkSamples[walkSamples.length - 1];
    if (lastLatest === undefined || lastWalk === undefined) {
      throw new Error("no samples");
    }
    return {
      provider: corpusThread.provider,
      eventRows: corpusThread.eventRows.length,
      dataBytesMedian: percentile(dataBytes, 0.5),
      dataBytesP95: percentile(dataBytes, 0.95),
      dataBytesTotal: dataBytes.reduce((total, bytes) => total + bytes, 0),
      calibrationMinMs: round(calibrationMinMs),
      latest: {
        ...buildCost(
          latestSamples.map((page) => page.profile.totalDurationMs),
          calibrationMinMs,
        ),
        rowsProduced: lastLatest.profile.projectedRowCount,
        selectionStrategy: lastLatest.profile.selectionStrategy,
        stageP50Ms: latestStageP50Ms,
      },
      walk: {
        ...buildCost(
          walkSamples.map((pages) => sumProfileDurations(pages)),
          calibrationMinMs,
        ),
        pages: lastWalk.length,
        rowsProduced: lastWalk.reduce(
          (total, page) => total + page.profile.projectedRowCount,
          0,
        ),
      },
    };
  } finally {
    loaded.close();
  }
}

function ratio(current: number, baseline: number): string {
  if (baseline === 0) {
    return current === 0 ? "1.00×" : "∞";
  }
  return `${(current / baseline).toFixed(2)}×`;
}

function perfChecks(
  result: PerfThreadBaseline,
  expected: PerfThreadBaseline,
): string[] {
  // The floor is expressed in the same normalized unit as the gate.
  const durationFloor = DURATION_TOLERANCE_FLOOR_MS / result.calibrationMinMs;
  const checks: [string, number, number, number, number][] = [
    [
      "latest normalized min",
      result.latest.normalizedMin,
      expected.latest.normalizedMin,
      DURATION_TOLERANCE,
      durationFloor,
    ],
    [
      "walk normalized min",
      result.walk.normalizedMin,
      expected.walk.normalizedMin,
      DURATION_TOLERANCE,
      durationFloor,
    ],
    [
      "median data bytes",
      result.dataBytesMedian,
      expected.dataBytesMedian,
      DATA_BYTES_TOLERANCE,
      0,
    ],
  ];
  return checks
    .filter(
      ([, current, base, tolerance, floor]) =>
        current > Math.max(base * tolerance, base + floor),
    )
    .map(
      ([label, current, base, tolerance]) =>
        `${label} ${current} exceeds baseline ${base} × ${tolerance}`,
    );
}

function normalizedCost(result: PerfThreadBaseline): number {
  return result.latest.normalizedMin + result.walk.normalizedMin;
}

interface MeasuredThread {
  attempts: number;
  failures: string[];
  result: PerfThreadBaseline;
}

/**
 * Measures up to `MEASUREMENT_ATTEMPTS` times. Without a baseline (write
 * mode) every attempt runs and the cheapest wins; with one, the first passing
 * attempt wins and otherwise the cheapest failing attempt is reported.
 */
function measureThreadWithRetries(
  threadId: string,
  synthetic: SyntheticThread,
  expected: PerfThreadBaseline | null,
): MeasuredThread {
  let best: MeasuredThread | null = null;
  for (let attempt = 1; attempt <= MEASUREMENT_ATTEMPTS; attempt += 1) {
    const result = measureCorpusThread(threadId, synthetic);
    const failures = expected === null ? [] : perfChecks(result, expected);
    const candidate: MeasuredThread = { attempts: attempt, failures, result };
    if (
      best === null ||
      normalizedCost(candidate.result) < normalizedCost(best.result)
    ) {
      best = candidate;
    }
    if (expected !== null && failures.length === 0) {
      return candidate;
    }
    best.attempts = attempt;
  }
  if (best === null) {
    throw new Error("no measurement attempts");
  }
  return best;
}

const available = corpusAvailable();
const mode = resolveSnapshotMode();
const corpusThreads = available
  ? listCorpusThreads({ reasons: ["largest"] })
      .sort((left, right) => right.events - left.events)
      .filter((thread, _index, all) => {
        const rank = all
          .filter((candidate) => candidate.provider === thread.provider)
          .indexOf(thread);
        return rank < LARGEST_PER_PROVIDER;
      })
  : [];

describe.skipIf(!available)("provider corpus timeline perf baseline", () => {
  // The describe body runs at collection time even when skipped, so it must
  // tolerate a missing corpus.
  const corpusDir = resolveProviderCorpusDir() ?? "";
  const snapshotsDir = path.join(corpusDir, "snapshots");
  const baselinePath = path.join(snapshotsDir, "perf-baseline.json");
  const baseline: PerfBaseline | null =
    available && mode === "compare" && fs.existsSync(baselinePath)
      ? perfBaselineSchema.parse(
          JSON.parse(fs.readFileSync(baselinePath, "utf8")),
        )
      : null;
  const measured = new Map<string, PerfThreadBaseline>();
  const attemptsByThread = new Map<string, number>();
  const failures: string[] = [];
  let synthetic: SyntheticThread | null = null;

  it.each(
    corpusThreads.map((thread) => [thread.id, thread.provider] as const),
  )(
    "%s (%s)",
    (threadId) => {
      synthetic ??= createSyntheticThread(SYNTHETIC_EVENT_COUNT);
      let expected: PerfThreadBaseline | null = null;
      if (mode === "compare") {
        if (baseline === null) {
          throw new Error(
            `No perf baseline at ${baselinePath}; run once with BB_PROVIDER_CORPUS_SNAPSHOT=write`,
          );
        }
        expected = baseline.threads[threadId] ?? null;
        if (expected === null) {
          throw new Error(
            `${threadId} is missing from perf-baseline.json; rewrite the baseline`,
          );
        }
      }
      const outcome = measureThreadWithRetries(threadId, synthetic, expected);
      measured.set(threadId, outcome.result);
      attemptsByThread.set(threadId, outcome.attempts);
      for (const failure of outcome.failures) {
        failures.push(`${threadId} (after ${outcome.attempts} attempts): ${failure}`);
      }
    },
    PER_THREAD_TIMEOUT_MS,
  );

  afterAll(() => {
    synthetic?.close();
    if (!available || measured.size === 0) {
      return;
    }
    const header = [
      "thread",
      "provider",
      "events",
      "data bytes p50/p95",
      "latest rows",
      "latest p50/p95 ms",
      "latest norm",
      "pages",
      "walk rows",
      "walk p50/p95 ms",
      "walk norm",
      "attempts",
      ...(baseline ? ["latest vs base", "walk vs base"] : []),
    ];
    const rows = [...measured.entries()].map(([threadId, result]) => {
      const base = baseline?.threads[threadId];
      return [
        threadId,
        result.provider,
        result.eventRows,
        `${result.dataBytesMedian}/${result.dataBytesP95}`,
        result.latest.rowsProduced,
        `${result.latest.p50Ms}/${result.latest.p95Ms}`,
        result.latest.normalizedMin.toFixed(3),
        result.walk.pages,
        result.walk.rowsProduced,
        `${result.walk.p50Ms}/${result.walk.p95Ms}`,
        result.walk.normalizedMin.toFixed(3),
        attemptsByThread.get(threadId) ?? 0,
        ...(baseline
          ? [
              base
                ? ratio(result.latest.normalizedMin, base.latest.normalizedMin)
                : "n/a",
              base
                ? ratio(result.walk.normalizedMin, base.walk.normalizedMin)
                : "n/a",
            ]
          : []),
      ];
    });
    const table = formatMarkdownTable(header, rows);
    process.stdout.write(
      `Timeline perf (${mode}, ${BUILD_SAMPLES} samples/thread, default variant; norm = min ÷ calibration min):\n${table}\n`,
    );
    fs.mkdirSync(snapshotsDir, { recursive: true });
    fs.writeFileSync(path.join(snapshotsDir, "perf-last-run.md"), `${table}\n`);
    if (mode === "write") {
      const written: PerfBaseline = {
        samplesPerThread: BUILD_SAMPLES,
        calibrationEventCount: SYNTHETIC_EVENT_COUNT,
        threads: Object.fromEntries(measured),
      };
      fs.writeFileSync(baselinePath, `${JSON.stringify(written, null, 2)}\n`);
      return;
    }
    expect(failures, "timeline perf regressions").toEqual([]);
  });
});

describe("timeline build micro-benchmark", () => {
  it(
    `projects every page of a ${SYNTHETIC_EVENT_COUNT}-event thread under ${SYNTHETIC_CEILING_MS} ms`,
    () => {
      const synthetic = createSyntheticThread(SYNTHETIC_EVENT_COUNT);
      try {
        expect(synthetic.eventCount).toBeGreaterThanOrEqual(
          SYNTHETIC_EVENT_COUNT,
        );
        // The latest page alone is bounded by segment windowing, so the whole
        // walk is what scales with the thread: every page, default variant,
        // summed over the build profiles (SQLite reads, decode, projection,
        // pagination) rather than wall time, so disk noise does not count.
        const samples = sample(() => walkSynthetic(synthetic));
        const durations = samples.map((pages) => sumProfileDurations(pages));
        const p50 = percentile(durations, 0.5);
        const last = samples[samples.length - 1];
        if (last === undefined) {
          throw new Error("no samples");
        }
        const rowsProjected = last.reduce(
          (total, page) => total + page.profile.projectedRowCount,
          0,
        );
        process.stdout.write(
          `Synthetic ${synthetic.eventCount}-event thread: ${last.length} pages, ${rowsProjected} rows projected, ` +
            `full walk p50 ${round(p50)} ms (samples ${durations.map((value) => round(value)).join(", ")})\n`,
        );
        expect(last.length).toBeGreaterThan(1);
        expect(p50).toBeLessThan(SYNTHETIC_CEILING_MS);
      } finally {
        synthetic.close();
      }
    },
    120_000,
  );
});
