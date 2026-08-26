import {
  defineWorkspaceTestConfig,
  findIsolationRequiringTests,
} from "../../vitest.shared.js";

const isolationTests = findIsolationRequiringTests(__dirname, ["src", "test"]);

// Pre-existing at fleet-patched pin aaa61376c: tsc-only errors for removed PluginAgentSurfaceTabProps.
const fleetPatchedPreExistingReds = [
  "test/services/plugins/plugin-authoring-docs.test.ts",
];

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    env: {
      BB_DATA_DIR: "/tmp/bb-server-test",
      BB_SERVER_PORT: "49161",
      BB_HOST_DAEMON_PORT: "49162",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "@bb/server",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          exclude: [
            "dist/**",
            "node_modules/**",
            ...isolationTests,
            ...fleetPatchedPreExistingReds,
          ],
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "@bb/server:isolated",
          include: isolationTests,
        },
      },
    ],
  },
});
