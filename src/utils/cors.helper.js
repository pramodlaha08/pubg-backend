// Shared CORS origin config for REST + Socket.IO.
// CORS_ORIGIN may be a comma-separated list so one build can serve several
// local dev ports (localhost:3000, :3001, ...). Resolved lazily so dotenv has
// already loaded .env by the time it is read.
export const getCorsOrigins = () =>
  String(process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
