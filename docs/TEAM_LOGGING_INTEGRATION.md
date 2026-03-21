# PUBG Team Logging Integration

## Overview

This backend now produces rich event logs for every team mutation. These logs are designed for real-time commentator feeds during live PUBG tournaments.

## What Gets Logged

- Team creation (name, slot, opening points)
- Round creation per team
- Kill updates (delta and current totals)
- Single kill increase/decrease
- Player elimination toggle (player index, current elimination count)
- Full team elimination (4/4 players eliminated)
- Position updates with points impact
- Round deletion and points rollback
- Team deletion

Every log entry includes:

- Event type and severity (`info`, `highlight`, `critical`)
- Team identity (`teamId`, `teamName`, `slot`)
- Round number (when applicable)
- Human-friendly title + detailed message
- Structured `changes` list with previous/current/delta values
- Snapshot totals (`totalPoints`, round kills/points/eliminations)
- Timestamp

## Socket Events

The backend emits `team_log_created` for each log entry.

For a dedicated commentator page (single URL, no refresh, no query change), use:

- Client emits `subscribe_commentary_feed` once after socket connection.
- Server responds with `commentary_feed_snapshot` (latest logs already sorted newest-first).
- Client keeps listening to `team_log_created` and prepends incoming items to the top.
- If snapshot fails, server emits `commentary_feed_error`.

Emission targets:

- Global: all connected clients
- Team room: `team_<teamId>`
- Round room: `round_<roundNumber>`

### Frontend Socket Example

```js
import { io } from "socket.io-client";

const socket = io("https://your-backend-url");

let feed = [];

// One-time bootstrap for fixed log page (no URL/query changes needed)
socket.emit("subscribe_commentary_feed", { limit: 100 });

socket.on("commentary_feed_snapshot", ({ items }) => {
  // Already newest -> oldest from backend
  feed = items;
  // render(feed)
});

socket.on("commentary_feed_error", (err) => {
  console.error(err?.message || "Snapshot error");
});

// Optional scoped rooms
socket.emit("join_round", 3);
socket.emit("join_team", "TEAM_OBJECT_ID");

socket.on("team_log_created", (entry) => {
  // Keep latest on top in same page
  feed = [entry, ...feed];
  // render(feed)
});
```

## Dedicated Fixed-Page Flow (Recommended)

1. Open one commentator page route in frontend (single URL).
2. Connect Socket.IO once.
3. Emit `subscribe_commentary_feed` once.
4. Render `commentary_feed_snapshot`.
5. On every `team_log_created`, prepend to existing list.

This gives fully live updates without refresh, parameter changes, or route changes.

### Optional Reliability Fallback (No Params, Same URL)

If socket reconnect happens or snapshot event is missed, call this fixed endpoint:

- `GET /api/v1/team-log/snapshot`

This endpoint:

- Takes no query params
- Uses no body
- Returns latest 100 logs already sorted newest-first

Frontend fallback example:

```js
async function restoreFeedIfNeeded() {
  const res = await fetch("/api/v1/team-log/snapshot");
  const json = await res.json();
  if (json?.success && Array.isArray(json?.data?.items)) {
    feed = json.data.items;
    // render(feed)
  }
}
```

## REST APIs

Base path: `/api/v1/team-log`

### 1) Fetch paginated logs

- Method: `GET /api/v1/team-log`
- Query params:
  - `roundNumber` (optional)
  - `teamId` (optional)
  - `eventType` (optional)
  - `severity` (optional)
  - `page` (default 1)
  - `limit` (default 50, max 200)

Example:

```http
GET /api/v1/team-log?roundNumber=2&severity=highlight&page=1&limit=20
```

### 2) Fetch latest feed

- Method: `GET /api/v1/team-log/feed`
- Query params:
  - `roundNumber` (optional)
  - `limit` (default 30, max 200)

Example:

```http
GET /api/v1/team-log/feed?roundNumber=2&limit=50
```

### 3) Fetch single log entry

- Method: `GET /api/v1/team-log/:logId`

### 4) Fixed commentary snapshot (no params)

- Method: `GET /api/v1/team-log/snapshot`
- No query params
- No body
- Returns latest 100 logs for one-page commentator feed

### 5) Reset logs (admin utility)

- Method: `DELETE /api/v1/team-log/reset`
- Query params:
  - `roundNumber` (optional, resets only one round if provided)

## Frontend Rendering Tips

- Show `title` as bold headline and `message` as commentator line.
- Use `severity` to color-code feed cards:
  - `info`: neutral
  - `highlight`: accent color
  - `critical`: warning/red accent
- Display a compact stats bar using `totals`:
  - `totalPoints`, `totalKillsInRound`, `eliminationCountInRound`
- Render `changes` as mini chips (for analytics/tooltip).

## Suggested Feed Sorting

- Realtime: append/prepend as events arrive.
- Initial load: request `/feed` and sort by `createdAt` descending.

## Event Types Reference

- `TEAM_CREATED`
- `ROUND_CREATED`
- `ROUND_DELETED`
- `KILL_ADDED`
- `KILL_UPDATED`
- `KILL_DECREASED`
- `POSITION_UPDATED`
- `ELIMINATION_UPDATED`
- `TEAM_ELIMINATED`
- `TEAM_DELETED`

## Backward Compatibility

- Existing team APIs remain unchanged.
- Logging runs as side effects and does not alter existing response shapes.

## Frontend Implementation Added (pubg-points)

The following commentator-focused frontend integration has been added in the `pubg-points` app:

- New page route: `/commentator`
- New navigation item under Controllers: `Commentator Live`
- Live Socket.IO integration using:
  - `subscribe_commentary_feed`
  - `commentary_feed_snapshot`
  - `team_log_created`
- REST fallback for reliability:
  - `GET /api/v1/team-log/snapshot`

### UI/UX Goals Implemented for Commentators

- High-contrast cards with severity color coding for fast scanning
- Distance-readable typography using responsive `clamp(...)` sizing
- Persistent top summary panel (connection, event counts, critical/highlights)
- Compact key stat tiles per event (`round`, `total points`, `kills`, `eliminations`)
- Optional live pause/resume mode for reading without feed movement

## Integration Steps (Frontend)

### 1) Add Environment Variables

In frontend environment file (`pubg-points/.env.local`):

```bash
NEXT_PUBLIC_API_URL=https://your-backend-domain/api/v1
# Optional. If omitted, frontend derives socket URL from NEXT_PUBLIC_API_URL by removing /api/v1
NEXT_PUBLIC_SOCKET_URL=https://your-backend-domain
```

Localhost setup (no website required):

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_SOCKET_URL=http://localhost:8000
```

You can copy defaults from `pubg-points/.env.example`.

### 2) Ensure Backend CORS Allows Frontend Origin

Backend `CORS_ORIGIN` must include the exact frontend origin for HTTP and Socket.IO.

Example backend env:

```bash
CORS_ORIGIN=https://your-frontend-domain
```

Localhost backend env example:

```bash
CORS_ORIGIN=http://localhost:3000
PORT=8000
```

You can copy defaults from `pubg-backend/.env.example`.

### Socket Setup Clarification

You do **not** need any external website during development.

- Run backend locally on `http://localhost:8000`
- Run frontend locally on `http://localhost:3000`
- Keep `CORS_ORIGIN` equal to frontend origin
- Point frontend env values to backend localhost URL

Only production deployment needs public domain URLs.

### 3) Start Backend and Frontend

Backend:

```bash
cd pubg-backend
npm install
npm run dev
```

Frontend:

```bash
cd pubg-points
npm install
npm run dev
```

### 4) Open the Commentator Page

- Visit `/commentator` from the sidebar (`Commentator Live`)
- Verify initial load from snapshot
- Trigger any team action (kill, elimination, position update)
- Confirm the newest log appears at the top in real time

## Files Updated for This Integration

- `pubg-points/app/commentator/page.tsx` (new)
- `pubg-points/utils/NavigationLinks.ts` (updated)
- `pubg-backend/docs/TEAM_LOGGING_INTEGRATION.md` (this documentation update)

## Troubleshooting

- If feed is empty:
  - Confirm backend has log entries in `TeamLog`
  - Confirm `NEXT_PUBLIC_API_URL` points to the correct backend
- If realtime is not updating:
  - Check browser devtools for socket connection errors
  - Verify backend CORS + frontend origin match exactly
  - Set `NEXT_PUBLIC_SOCKET_URL` explicitly when behind proxy/CDN
- If snapshot fails:
  - Check `GET /api/v1/team-log/snapshot` manually
  - Verify backend route is reachable from frontend network
