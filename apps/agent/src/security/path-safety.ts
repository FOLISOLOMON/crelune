/**
 * CRELUNE Windows Creative Agent — Filesystem Containment & Path Traversal Defense
 *
 * Enforces strict job workspace isolation under `workspaces/jobs/<jobId>/`.
 * Rejects drive-letter paths, UNC paths, null bytes, traversal segments (`..`),
 * and any path that resolves outside the approved workspace root.
 */

import fs from 'node:fs';
import path from 'node:path';

const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]{1,80}$/;
const SAFE_BASENAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,140}$/;

export class AgentPathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentPathSecurityError';
  }
}

export function assertSafeAgentIdentifier(value: string, label: string): string {
  if (!SAFE_IDENTIFIER_REGEX.test(value)) {
    throw new AgentPathSecurityError(
      `Invalid ${label}: must be 1-80 safe alphanumeric, underscore, or hyphen characters.`
    );
  }
  return value;
}

export function assertSafeBasename(filename: string, label = 'filename'): string {
  const trimmed = filename.trim();
  if (
    !trimmed ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    trimmed.includes('\0') ||
    /^[a-zA-Z]:/.test(trimmed) ||
    !SAFE_BASENAME_REGEX.test(trimmed)
  ) {
    throw new AgentPathSecurityError(
      `Unsafe ${label} rejected: "${filename}".`
    );
  }
  return trimmed;
}

export function assertSafeRelativeManifestPath(relativePath: string): string[] {
  const trimmed = relativePath.trim();
  if (
    !trimmed ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0') ||
    /^[a-zA-Z]:/.test(trimmed)
  ) {
    throw new AgentPathSecurityError(
      'Manifest relative path contains forbidden absolute or Windows drive prefixes.'
    );
  }

  const segments = trimmed.split('/').filter((seg) => seg.length > 0);
  if (segments.length === 0 || segments.length > 6) {
    throw new AgentPathSecurityError(
      'Manifest relative path has an invalid directory depth.'
    );
  }

  for (const seg of segments) {
    if (seg === '.' || seg === '..' || !SAFE_BASENAME_REGEX.test(seg)) {
      throw new AgentPathSecurityError(
        `Unsafe path segment "${seg}" in manifest relative path.`
      );
    }
  }

  return segments;
}

/**
 * Resolves a path strictly within `rootDir`. Throws `AgentPathSecurityError`
 * if resolution escapes `rootDir` (including via symlinks when parent exists).
 */
export function resolveStrictlyWithinRoot(
  rootDir: string,
  ...segments: string[]
): string {
  const normalizedRoot = path.resolve(rootDir);
  for (const segment of segments) {
    if (
      !segment ||
      segment.includes('\0') ||
      path.isAbsolute(segment) ||
      /^[a-zA-Z]:/.test(segment) ||
      segment.startsWith('\\\\')
    ) {
      throw new AgentPathSecurityError(
        'Absolute path or traversal segment rejected.'
      );
    }
  }

  const target = path.resolve(normalizedRoot, ...segments);
  const rel = path.relative(normalizedRoot, target);
  if (
    !rel ||
    rel === '.' ||
    rel.startsWith('..') ||
    path.isAbsolute(rel)
  ) {
    throw new AgentPathSecurityError(
      'Resolved path escapes approved CRELUNE agent workspace root.'
    );
  }

  // Verify existing ancestor realpath does not escape via Windows junctions/symlinks
  if (fs.existsSync(normalizedRoot)) {
    const realRoot = fs.realpathSync(normalizedRoot);
    let checkPath = target;
    while (!fs.existsSync(checkPath) && checkPath !== path.dirname(checkPath)) {
      checkPath = path.dirname(checkPath);
    }
    if (fs.existsSync(checkPath)) {
      const realExisting = fs.realpathSync(checkPath);
      const realRel = path.relative(realRoot, realExisting);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new AgentPathSecurityError(
          'Symlink or junction escape outside approved agent workspace root rejected.'
        );
      }
    }
  }

  return target;
}
