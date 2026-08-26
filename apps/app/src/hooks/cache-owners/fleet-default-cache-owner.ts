import type { QueryClient } from "@tanstack/react-query";

import {
  crewDefaultsQueryKey,
  fleetDefaultQueryKey,
} from "../queries/query-keys";

/**
 * The fleet default pair is read twice, for two different purposes: the
 * composer wants a nullable preload hint, the Defaults screen wants the
 * store's four distinct answers. They are separate query keys on purpose —
 * one key serving two shapes would let whichever hook mounted first decide
 * what the other one sees.
 *
 * Which makes a write to the pair a two-key event, and the sort of thing that
 * goes wrong when each call site remembers it for itself. It is owned here so
 * a caller cannot invalidate half of the subject.
 */
export function invalidateFleetDefault(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: fleetDefaultQueryKey() });
  void queryClient.invalidateQueries({ queryKey: crewDefaultsQueryKey() });
}
