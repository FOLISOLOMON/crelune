/**
 * CRELUNE — CSRF Origin / Referer Validation
 *
 * Validates browser request Origin / Referer headers against the expected target host
 * or explicitly configured deployment origins. Forwarded proxy headers are never
 * trusted unless explicitly opted in via `TRUST_PROXY=true`.
 */

export interface OriginValidationInput {
  originHeader: string | null;
  refererHeader: string | null;
  hostHeader: string | null;
  forwardedHostHeader?: string | null;
  forwardedProtoHeader?: string | null;
  allowedOrigins?: string | null;
  appUrl?: string | null;
  trustProxy?: boolean;
}

export interface OriginValidationResult {
  allowed: boolean;
  reason?:
    | 'missing_origin_and_referer'
    | 'malformed_origin'
    | 'malformed_referer'
    | 'origin_not_allowlisted'
    | 'missing_or_invalid_host'
    | 'invalid_forwarded_host'
    | 'origin_host_mismatch'
    | 'origin_protocol_mismatch';
}

interface ParsedOrigin {
  origin: string;
  host: string;
  protocol: 'http:' | 'https:';
}

function parseSourceOrigin(
  originHeader: string | null,
  refererHeader: string | null
): { parsed: ParsedOrigin | null; error?: OriginValidationResult['reason'] } {
  if (originHeader !== null) {
    if (!originHeader || originHeader === 'null' || /\s/.test(originHeader)) {
      return { parsed: null, error: 'malformed_origin' };
    }
    try {
      const url = new URL(originHeader);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { parsed: null, error: 'malformed_origin' };
      }
      if (url.username || url.password || url.origin.toLowerCase() !== originHeader.toLowerCase()) {
        return { parsed: null, error: 'malformed_origin' };
      }
      return {
        parsed: {
          origin: url.origin.toLowerCase(),
          host: url.host.toLowerCase(),
          protocol: url.protocol as 'http:' | 'https:',
        },
      };
    } catch {
      return { parsed: null, error: 'malformed_origin' };
    }
  }

  if (refererHeader !== null) {
    if (!refererHeader.trim()) {
      return { parsed: null, error: 'malformed_referer' };
    }
    try {
      const url = new URL(refererHeader);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { parsed: null, error: 'malformed_referer' };
      }
      if (url.username || url.password || !url.host) {
        return { parsed: null, error: 'malformed_referer' };
      }
      return {
        parsed: {
          origin: url.origin.toLowerCase(),
          host: url.host.toLowerCase(),
          protocol: url.protocol as 'http:' | 'https:',
        },
      };
    } catch {
      return { parsed: null, error: 'malformed_referer' };
    }
  }

  return { parsed: null, error: 'missing_origin_and_referer' };
}

function normalizeHostValue(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;
  const trimmed = rawHost.trim().toLowerCase();
  if (!trimmed || /\s|[/?#@\\]/.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(`http://${trimmed}`);
    if (url.username || url.password || !url.hostname) {
      return null;
    }
    // Preserve explicit port if provided, matching URL.host semantics when non-default
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

export function validateRequestOriginDetails(
  input: OriginValidationInput
): OriginValidationResult {
  const { parsed: source, error } = parseSourceOrigin(input.originHeader, input.refererHeader);
  if (!source) {
    return { allowed: false, reason: error };
  }

  // 1. Explicit ALLOWED_ORIGINS allowlist takes strict precedence when configured
  if (input.allowedOrigins && input.allowedOrigins.trim().length > 0) {
    const allowlist = new Set<string>();
    for (const entry of input.allowedOrigins.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      try {
        const parsed = new URL(trimmed);
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password) {
          allowlist.add(parsed.origin.toLowerCase());
        }
      } catch {
        // Ignore malformed configuration entry
      }
    }
    if (allowlist.has(source.origin)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'origin_not_allowlisted' };
  }

  // 2. Explicit APP_URL canonical origin check (exact scheme + host + port)
  if (input.appUrl && input.appUrl.trim().length > 0) {
    try {
      const appParsed = new URL(input.appUrl.trim());
      if (
        (appParsed.protocol === 'http:' || appParsed.protocol === 'https:') &&
        source.origin === appParsed.origin.toLowerCase()
      ) {
        return { allowed: true };
      }
    } catch {
      // Ignore malformed APP_URL and fall back to host evaluation
    }
  }

  // 3. Trusted reverse-proxy evaluation ONLY when explicitly enabled
  if (input.trustProxy === true && input.forwardedHostHeader) {
    const firstFwdHost = input.forwardedHostHeader.split(',')[0];
    const normalizedFwdHost = normalizeHostValue(firstFwdHost);
    if (!normalizedFwdHost) {
      return { allowed: false, reason: 'invalid_forwarded_host' };
    }

    if (input.forwardedProtoHeader) {
      const firstFwdProto = input.forwardedProtoHeader.split(',')[0]?.trim().toLowerCase();
      if (firstFwdProto !== 'http' && firstFwdProto !== 'https') {
        return { allowed: false, reason: 'origin_protocol_mismatch' };
      }
      if (source.protocol !== `${firstFwdProto}:`) {
        return { allowed: false, reason: 'origin_protocol_mismatch' };
      }
    }

    if (source.host !== normalizedFwdHost) {
      return { allowed: false, reason: 'origin_host_mismatch' };
    }
    return { allowed: true };
  }

  // 4. Direct HTTP Host header check (arbitrary X-Forwarded-Host headers are ignored)
  const normalizedHost = normalizeHostValue(input.hostHeader);
  if (!normalizedHost) {
    return { allowed: false, reason: 'missing_or_invalid_host' };
  }

  if (source.host !== normalizedHost) {
    return { allowed: false, reason: 'origin_host_mismatch' };
  }

  return { allowed: true };
}

export function validateRequestOrigin(request: Request): OriginValidationResult {
  return validateRequestOriginDetails({
    originHeader: request.headers.get('origin'),
    refererHeader: request.headers.get('referer'),
    hostHeader: request.headers.get('host'),
    forwardedHostHeader: request.headers.get('x-forwarded-host'),
    forwardedProtoHeader: request.headers.get('x-forwarded-proto'),
    allowedOrigins: process.env.ALLOWED_ORIGINS ?? null,
    appUrl: process.env.APP_URL ?? null,
    trustProxy: process.env.TRUST_PROXY === 'true',
  });
}

export function isAllowedOrigin(
  originHeader: string | null,
  refererHeader: string | null,
  hostHeader: string | null
): boolean {
  return validateRequestOriginDetails({
    originHeader,
    refererHeader,
    hostHeader,
  }).allowed;
}
