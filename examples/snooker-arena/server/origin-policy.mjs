function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function createOriginPolicy(options = {}) {
  const production = options.production === true;
  const allowed = new Set((options.allowedOrigins || []).map(normalizeOrigin).filter(Boolean));
  if (!allowed.size) throw new Error("At least one valid public origin is required");
  const isAllowed = (origin) => {
    if (!origin) return true;
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    if (allowed.has(normalized)) return true;
    if (!production) {
      const hostname = new URL(normalized).hostname;
      return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
    }
    return false;
  };
  return {
    allowedOrigins: [...allowed],
    isAllowed,
    corsOrigin(origin, callback) {
      if (isAllowed(origin)) callback(null, true);
      else {
        const error = new Error("Origin is not allowed");
        error.code = "ORIGIN_NOT_ALLOWED";
        callback(error);
      }
    }
  };
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join("; ");
