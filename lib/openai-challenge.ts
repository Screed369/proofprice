// OpenAI's domain check for the plugin directory: GET /.well-known/openai-apps-challenge must return the token and nothing else.
// The token comes from the environment variable OPENAI_APPS_CHALLENGE. It is a public value, not a secret, but no real value is
// kept in the repository. Anything unexpected (unset, empty, odd characters, too long) gives no token, so a bad value is never served.

/** The most characters a token may have. */
export const CHALLENGE_MAX_LENGTH = 512;

/** Letters, digits and - _ . = + / only. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9\-_.=+/]+$/;

/** The token to serve, or null when the variable is unset, empty, too long or holds any other character. */
export function challengeToken(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.OPENAI_APPS_CHALLENGE;
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (!token || token.length > CHALLENGE_MAX_LENGTH || !CHALLENGE_PATTERN.test(token)) return null;
  return token;
}
