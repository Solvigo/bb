export interface PathClassificationArgs {
  path: string;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;

/**
 * `localImage` and attachment paths are absolute (a host filesystem path) or
 * relative (a server-managed attachment reference) — see the schema comment
 * on `promptInputSchema`'s `localImage` variant.
 */
export function isAbsoluteLocalPath({ path }: PathClassificationArgs): boolean {
  return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);
}
