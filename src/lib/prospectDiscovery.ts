export type DiscoveryCriteria = {
  queries: string[];
  recent_months: number | null;
  published_after: string | null;
};

export function parseDiscoveryQueries(value: string): string[] {
  return value.split("\n").map((query) => query.trim()).filter(Boolean).slice(0, 3);
}

export function buildDiscoveryPreviewBody(queryText: string, recentMonths: string) {
  const queries = parseDiscoveryQueries(queryText);
  if (!queries.length) return null;
  return {
    limit: 5,
    queries,
    recent_months: recentMonths === "any" ? "any" : Number(recentMonths),
  };
}

export function buildDiscoveryCommitBody<T>(candidates: T[], criteria: DiscoveryCriteria | null) {
  return {
    limit: 5,
    commit: true,
    candidates,
    queries: criteria?.queries,
    recent_months: criteria?.recent_months ?? "any",
  };
}
