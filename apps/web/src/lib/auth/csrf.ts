/**
 * CRELUNE — CSRF Origin / Referer Validation
 */

export function isAllowedOrigin(
  originHeader: string | null,
  refererHeader: string | null,
  hostHeader: string | null
): boolean {
  if (!hostHeader) return false;

  const checkUrl = (urlStr: string) => {
    try {
      const parsed = new URL(urlStr);
      return parsed.host === hostHeader;
    } catch {
      return false;
    }
  };

  if (originHeader) {
    return checkUrl(originHeader);
  }

  if (refererHeader) {
    return checkUrl(refererHeader);
  }

  // If both origin and referer are missing in a browser mutation POST, reject
  return false;
}