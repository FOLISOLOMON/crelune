/**
 * CRELUNE — Strict PostgreSQL Connection URL Parser & Guard
 *
 * Parses PostgreSQL / Neon connection URLs without exposing credentials,
 * query secrets, or raw connection strings in error messages.
 *
 * Verified against installed @prisma/client 6.4.0 (Quaint engine):
 * - Explicit ports override the default 5432 connection port.
 * - `?host=...` overrides the URL hostname at connect time.
 * - Duplicate query parameters use last-wins interpretation (e.g. `sslmode=require&sslmode=disable`).
 * - Neon requires TLS (`sslmode=require` / `verify-ca` / `verify-full`) and uses `channel_binding=require`.
 */

export interface ParsedPostgresUrl {
  hostname: string;
  database: string;
}

const FORBIDDEN_QUERY_PARAMS = new Set([
  'host',
  'hostaddr',
  'port',
  'dbname',
  'database',
  'user',
  'username',
  'password',
  'service',
  'passfile',
  'options',
  'replication',
  'target_session_attrs',
  'sslkey',
  'sslcert',
  'sslrootcert',
  'sslcrl',
  'sslcrldir',
  'sslpassword',
  'krbsrvname',
  'gsslib',
  'gssencmode',
]);

const ALLOWED_SSL_MODES = new Set(['require', 'verify-ca', 'verify-full']);
const ALLOWED_CHANNEL_BINDING_MODES = new Set(['require', 'prefer']);
const SAFE_PARAM_KEY_REGEX = /^[a-z0-9_.-]{1,48}$/;

function extractRawPortToken(trimmedUrl: string): string | undefined {
  const schemeEnd = trimmedUrl.indexOf('://');
  if (schemeEnd === -1) return undefined;

  const rest = trimmedUrl.slice(schemeEnd + 3);
  const authEndCandidates = [rest.indexOf('/'), rest.indexOf('?'), rest.indexOf('#')].filter(
    (idx) => idx !== -1
  );
  const authorityEnd = authEndCandidates.length > 0 ? Math.min(...authEndCandidates) : rest.length;
  const authority = rest.slice(0, authorityEnd);

  const atIndex = authority.lastIndexOf('@');
  const hostPortPart = atIndex === -1 ? authority : authority.slice(atIndex + 1);

  if (hostPortPart.startsWith('[')) {
    const closeBracket = hostPortPart.indexOf(']');
    if (closeBracket === -1) return undefined;
    const afterBracket = hostPortPart.slice(closeBracket + 1);
    return afterBracket.startsWith(':') ? afterBracket.slice(1) : undefined;
  }

  const colonIndex = hostPortPart.indexOf(':');
  return colonIndex === -1 ? undefined : hostPortPart.slice(colonIndex + 1);
}

/**
 * Strictly validates protocol, hostname, default port (omitted or `5432`),
 * database pathname, and query parameters for routing/identity/SSL tampering.
 */
export function parseStrictPostgresUrl(
  rawUrl: string | undefined,
  varName: 'DATABASE_URL' | 'DATABASE_URL_UNPOOLED',
  createError: (message: string) => Error
): ParsedPostgresUrl {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    throw createError(`${varName} is missing.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw createError(`${varName} is malformed.`);
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw createError(`${varName} must use a valid PostgreSQL protocol.`);
  }

  if (parsed.hash) {
    throw createError(`${varName} must not contain a URL fragment.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname.includes(',') || hostname.includes('%')) {
    throw createError(`${varName} has a missing or invalid database hostname.`);
  }

  // Enforce default PostgreSQL port only (omitted or explicit 5432 without malformed/leading-zero tokens).
  const rawPortToken = extractRawPortToken(trimmed);
  if (rawPortToken !== undefined && rawPortToken !== '5432') {
    throw createError(`${varName} specifies an unapproved explicit port.`);
  }
  if (parsed.port && parsed.port !== '5432') {
    throw createError(`${varName} specifies an unapproved explicit port.`);
  }

  const database = parsed.pathname.replace(/^\//, '');
  if (!database || database.includes('/') || database.includes('%')) {
    throw createError(`${varName} is missing a valid database name.`);
  }

  if (parsed.search) {
    if (parsed.search.includes(';')) {
      throw createError(`${varName} contains invalid query parameter delimiter syntax.`);
    }

    const rawQuery = parsed.search.slice(1);
    if (!rawQuery) {
      throw createError(`${varName} contains an empty query string.`);
    }

    const seenKeys = new Set<string>();
    for (const segment of rawQuery.split('&')) {
      const eqIdx = segment.indexOf('=');
      if (eqIdx <= 0) {
        throw createError(`${varName} contains a malformed query parameter.`);
      }

      const rawKey = segment.slice(0, eqIdx);
      const rawValue = segment.slice(eqIdx + 1);
      if (rawKey.includes('%')) {
        throw createError(`${varName} contains an obfuscated query parameter name.`);
      }

      const lowerKey = rawKey.toLowerCase();
      if (!SAFE_PARAM_KEY_REGEX.test(lowerKey)) {
        throw createError(`${varName} contains an invalid query parameter name.`);
      }

      if (seenKeys.has(lowerKey)) {
        throw createError(
          `${varName} contains duplicate query parameter "${lowerKey}".`
        );
      }
      seenKeys.add(lowerKey);

      if (FORBIDDEN_QUERY_PARAMS.has(lowerKey)) {
        throw createError(
          `${varName} contains disallowed connection override parameter "${lowerKey}".`
        );
      }

      let decodedValue: string;
      try {
        decodedValue = decodeURIComponent(rawValue.replace(/\+/g, ' ')).trim().toLowerCase();
      } catch {
        throw createError(`${varName} contains a malformed query parameter value.`);
      }

      if (lowerKey === 'sslmode' && !ALLOWED_SSL_MODES.has(decodedValue)) {
        throw createError(`${varName} specifies an unapproved sslmode setting.`);
      }

      if (
        lowerKey === 'channel_binding' &&
        !ALLOWED_CHANNEL_BINDING_MODES.has(decodedValue)
      ) {
        throw createError(`${varName} specifies an unapproved channel_binding setting.`);
      }

      if (lowerKey === 'sslaccept' && decodedValue !== 'strict') {
        throw createError(`${varName} specifies an unapproved sslaccept setting.`);
      }
    }
  }

  return { hostname, database };
}
