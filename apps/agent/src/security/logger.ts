/**
 * CRELUNE Windows Creative Agent — Sanitized Structured Logger
 *
 * Strips Bearer tokens, agent secrets, presigned query signatures, and
 * database connection strings before emitting any diagnostic output.
 */

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[a-zA-Z0-9._-]{8,}/gi,
  /\bcln_agent_[a-zA-Z0-9_-]{6,}/gi,
  /\bclm_[a-zA-Z0-9_-]{8,}/gi,
  /X-Crelune-Dispatch-Claim\s*:\s*\S+/gi,
  /X-Amz-Signature=[a-zA-Z0-9%._-]+/gi,
  /X-Amz-Credential=[^&\s"']+/gi,
  /X-Amz-Security-Token=[^&\s"']+/gi,
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
];

const SENSITIVE_FIELD_NAMES = new Set([
  'token',
  'bearertoken',
  'rawtoken',
  'claimtoken',
  'dispatchclaim',
  'x-crelune-dispatch-claim',
  'authorization',
  'secret',
  'password',
  'presignedurl',
  'signedurl',
  'cookie',
]);

export function redactSensitiveString(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

export function sanitizeLogMeta(
  value: unknown,
  depth: number = 0
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeLogMeta(item, depth + 1));
  }
  if (typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (
        SENSITIVE_FIELD_NAMES.has(lower) ||
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('authorization')
      ) {
        clean[key] = '[REDACTED]';
        continue;
      }
      clean[key] = sanitizeLogMeta(val, depth + 1);
    }
    return clean;
  }
  return String(value);
}

export interface AgentLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createConsoleAgentLogger(silent = false): AgentLogger {
  const emit = (
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    meta?: Record<string, unknown>
  ) => {
    if (silent) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: redactSensitiveString(message),
      ...(meta ? { meta: sanitizeLogMeta(meta) } : {}),
    };
    const line = JSON.stringify(entry);
    if (level === 'ERROR') {
      console.error(line);
    } else if (level === 'WARN') {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    info: (message, meta) => emit('INFO', message, meta),
    warn: (message, meta) => emit('WARN', message, meta),
    error: (message, meta) => emit('ERROR', message, meta),
  };
}
