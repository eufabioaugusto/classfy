let sequence = 0;
// Supabase reuses channels by topic, including channels still awaiting removal.
// Each effect owns its subscription and must receive a fresh channel instance.
export function nextRealtimeTopic(scope: string): string {
  return `${scope}-${Date.now()}-${++sequence}`;
}
