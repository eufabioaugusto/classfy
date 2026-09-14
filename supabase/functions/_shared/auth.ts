interface ClaimsClient {
  auth: {
    getClaims: (token: string) => Promise<{
      data: { claims?: { sub?: unknown } } | null;
      error: unknown;
    }>;
  };
}

/**
 * Resolve a user id from a JWT that has already passed the Edge gateway.
 * getClaims verifies asymmetric tokens locally (using the cached JWKS), avoiding
 * an extra request to Auth for every playback or reward event.
 */
export async function getVerifiedUserId(
  client: ClaimsClient,
  authorization: string,
): Promise<string | null> {
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!token) return null;

  const { data, error } = await client.auth.getClaims(token);
  const subject = data?.claims?.sub;
  return error || typeof subject !== "string" || !subject ? null : subject;
}
