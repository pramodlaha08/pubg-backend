# Elimination Order Fix - Per Round Tracking

## Problem Resolved

The elimination notification numbers were incorrect, showing:
- 1st elimination: #3 ✓
- 2nd elimination: #0 (should be #2) ✗
- 3rd elimination: #0 (should be #1) ✗

**Root Cause**: The system wasn't properly tracking which teams were eliminated, making backward numbering impossible.

---

## Architecture Changes

### 1. **Elimination Record Creation/Deletion (Toggle System)**

Instead of keeping all teams with a status field, we now:
- **CREATE** a record only when a team becomes fully eliminated
- **DELETE** the record when a team is revived (player respawn)
- This means only **eliminated teams have records** in the database per round

**Example (3-team round):**
```
Team A eliminates 3 players → Record created: eliminationNotification for Team A
Team B eliminates 3 players → Record created: eliminationNotification for Team B
Team A gets revived (1 player back) → Record DELETED for Team A
Team C eliminates 3 players → Record created: eliminationNotification for Team C

Current eliminations in DB: Team B (#1), Team C (#0 - just eliminated, will recalc to #1)
```

### 2. **Per-Round Counting**

Elimination order calculation logic:
```javascript
// Count ONLY teams that are currently eliminated in this round
const eliminated = await EliminationNotification.find({
  roundNumber,
  status: "eliminated"
}).sort({ eliminatedAt: 1 });  // Oldest first = first eliminated

// Backward numbering: 1st eliminated gets highest number
// For 3 eliminated teams:
// Team A (1st): eliminationOrder = 3
// Team B (2nd): eliminationOrder = 2
// Team C (3rd): eliminationOrder = 1
const eliminationOrder = totalEliminated - index;
```

### 3. **Flushing Records on New Round**

When `createRound` is called:
```javascript
await flushEliminationRecords(roundNumber);
```

This **deletes all elimination records** for that round **before** creating it, ensuring:
- Clean slate for the new round
- No stale data from previous attempts
- Easy percalculation without filtering

---

## System Flow

### A. Team Gets Fully Eliminated
```
1. Team loses last player
2. eliminationCount >= SQUAD_CONFIG.fullEliminationCount
3. syncEliminationRealtime() called
4. Status changes: "alive" → "eliminated"
5. ACTION: CREATE EliminationNotification record with `eliminatedAt: new Date()`
6. Recalculate order for all eliminated teams in round
7. Emit socket: elimination_state_changed (action: "eliminated")
8. Emit socket: elimination_order_snapshot (with recalculated #numbers)
```

### B. Team Gets Revived (Player Respawned)
```
1. Team gains a player (eliminationCount < fullEliminationCount)
2. syncEliminationRealtime() called
3. Status would change: "eliminated" → "alive"
4. ACTION: DELETE EliminationNotification record entirely
5. Recalculate order for remaining eliminated teams
6. Emit socket: elimination_state_changed (action: "alive")
7. Emit socket: elimination_order_snapshot (with updated #numbers)
```

### C. New Round Created
```
1. createRound() called with roundNumber
2. flushEliminationRecords(roundNumber) executed
3. All elimination records for that round deleted
4. Fresh state for new round
5. Emit socket: round_created
```

---

## Database Schema

**EliminationNotification** - Only created/stored when team is eliminated in a round

```javascript
{
  teamId: ObjectId,
  teamName: String,
  teamLogo: String,
  roundNumber: Number,
  status: "eliminated",  // Only "eliminated" teams have records; "alive" = no record
  eliminatedAt: Date,    // The exact moment team became fully eliminated
  eliminationOrder: Number, // Calculated field: total_eliminated - index
  killCount: Number,
  position: Number,
  timestamps: true
}
```

**Key indexes**:
- `{ teamId: 1, roundNumber: 1 }` (unique) - ensures one record per team per round
- Sort by `eliminatedAt` ascending (oldest first = first eliminated)

---

## Elimination Order Guarantee

✅ **First team eliminated** → Always gets highest `#` number  
✅ **Each subsequent elimination** → Gets `#` number one less  
✅ **Backward numbering** → #N, #(N-1), #(N-2)...#1  
✅ **Revives recalculate** → Remaining teams re-number correctly  
✅ **Per-round isolation** → Each round starts fresh with no stale data  
✅ **All clients sync** → Socket events broadcast to all tabs/devices simultaneously  

---

## Environment Variables

### Backend (.env)
```
DEBUG_MODE=false          # Set true to log elimination tracking, flushing, sync details
```

Output when `DEBUG_MODE=true`:
```
[ELIMINATION_ORDER] Round 1: 2 teams eliminated
[ELIMINATION_ORDER] Team "Apex Legends": position 1/2 = #2
[ELIMINATION_ORDER] Team "Valorant": position 2/2 = #1
[ELIMINATION_ORDER] Final snapshot: [{ team: 'Apex Legends', order: 2, status: 'eliminated' }, ...]
[SYNC_ELIMINATION] Team: "Team X", Round: 1
  Status: alive -> eliminated
  Transitioned: true
  Action: ELIMINATED (record created)
  Broadcasting elimination_state_changed with action: eliminated
[CREATE_ROUND] Flushed 0 elimination records for round 2
```

### Frontend (.env.local)
```
NEXT_PUBLIC_DEBUG_MODE=false    # Shows debug panel on points table
```

---

## Testing Checklist

1. **First elimination**:
   - Lose all players → `syncEliminationRealtime()` fires
   - DB check: `EliminationNotification` record created with `eliminatedAt` timestamp
   - Display: Shows `#3` (for 3-team round)

2. **Second elimination**:
   - Another team loses all players
   - DB check: Second `EliminationNotification` record created
   - Recalculation: First team's order stays `#3`, second team gets `#2`
   - Display: Both teams show correct numbers

3. **Revive scenario**:
   - First eliminated team gains a player back
   - DB check: That team's `EliminationNotification` record **deleted**
   - Recalculation: Second team's order becomes `#1` (only eliminated now)
   - Display: Shows correct `#1` number

4. **New round**:
   - `createRound()` called for next round
   - DB check: All elimination records for previous round remain; new round starts with 0 records
   - `flushEliminationRecords()` clears old data
   - Emission: `round_created` socket event broadcast

5. **Debug panel**:
   - Enable `NEXT_PUBLIC_DEBUG_MODE=true`
   - Points table shows "SOCKET: LIVE", "LAST EVENT: elimination_state_changed", update count

---

## Key Functions

### `syncEliminationRealtime({ req, team, round })`
- Called after every player elimination/revival action on a team
- Creates record if team becomes eliminated
- Deletes record if team is revived
- Recalculates all elimination orders for the round
- Broadcasts socket events with updated state

### `recalculateEliminationOrder(roundNumber)`
- Finds all **currently eliminated** teams in the round
- Assigns `#` numbers: highest for oldest elimination, down to #1 for newest
- Returns socket-formatted snapshot

### `flushEliminationRecords(roundNumber)`
- Called at start of `createRound()`
- Deletes ALL EliminationNotification records for that round
- Ensures clean slate for new round

### `getEliminationSnapshot(roundNumber)`
- Returns current elimination state for subscription/join events
- Sends to newly connected clients via socket

---

## Socket Events

**`elimination_state_changed`**
```javascript
{
  eventId: "id-timestamp",
  action: "eliminated" | "alive" | "updated",
  notification: {
    teamId, teamName, teamLogo, roundNumber, status,
    killCount, position, eliminationOrder, updatedAt
  }
}
```

**`elimination_order_snapshot`**
```javascript
{
  roundNumber: number,
  items: [ /* all teams with current eliminationOrder */ ]
}
```

Backend broadcasts both events when elimination state changes. Frontend listens and updates animations/display accordingly.
