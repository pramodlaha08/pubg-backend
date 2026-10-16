// Shared CORS origin config for REST + Socket.IO.
// CORS_ORIGIN may be "*" (allow any origin) or a comma-separated allowlist so
// one build can serve several origins (local dev ports + production URL).
// Resolved lazily so dotenv has already loaded .env by the time it is read.
export const getCorsOrigins = () => {
  const origins = String(process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // The cors package treats an array as an exact-match allowlist, so ["*"]
  // matches no real origin and the Access-Control-Allow-Origin header is
  // dropped. Return the literal "*" string so wildcard/empty means allow-all.
  if (origins.length === 0 || origins.includes("*")) {
    return "*";
  }

  return origins;
};
