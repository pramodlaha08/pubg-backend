import "dotenv/config";
import { app } from "./app.js";
import connectDB from "./db/index.js";
import { createServer } from "http";
import { Server } from "socket.io";
import { TeamLog } from "./models/teamLog.model.js";
import { getEliminationSnapshot } from "./utils/eliminationRealtime.helper.js";
import { seedAdmin, ensureSettings, ensureDefaultTournament } from "./utils/seedAdmin.js";
import { getCorsOrigins } from "./utils/cors.helper.js";

const port = process.env.PORT || 8000;

// Create HTTP server
const server = createServer(app);

// Configure Socket.IO
const io = new Server(server, {
  cors: {
    origin: getCorsOrigins(),
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });

  // Join specific room for team updates
  socket.on("join_team", (teamId) => {
    console.log(
      `[Socket] Client ${socket.id} joining team room: team_${teamId}`
    );
    socket.join(`team_${teamId}`);
  });

  // Join round updates room
  socket.on("join_round", (roundNumber) => {
    console.log(
      `[Socket] Client ${socket.id} joining round room: round_${roundNumber}`
    );
    socket.join(`round_${roundNumber}`);
  });

  // Join a tournament room so concurrent broadcasts stay isolated.
  socket.on("join_tournament", (tournamentId) => {
    if (!tournamentId) return;
    console.log(
      `[Socket] Client ${socket.id} joining tournament room: t_${tournamentId}`
    );
    socket.join(`t_${tournamentId}`);
  });

  // Dedicated commentator feed: fetch initial logs once, then keep listening to team_log_created.
  socket.on("subscribe_commentary_feed", async (payload = {}) => {
    try {
      console.log(`[Socket] Client ${socket.id} subscribed to commentary feed`);
      const requestedLimit = Number(payload.limit);
      const limit = Math.min(
        200,
        Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 100)
      );

      const tournamentId = payload.tournamentId || null;
      if (tournamentId) socket.join(`t_${tournamentId}`);

      const query = {};
      if (tournamentId) query.tournamentId = tournamentId;

      const latestLogs = await TeamLog.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit);

      console.log(
        `[Socket] Sending snapshot to ${socket.id} with ${latestLogs.length} logs`
      );
      socket.emit("commentary_feed_snapshot", {
        items: latestLogs,
        total: latestLogs.length,
      });
    } catch (error) {
      console.error(
        `[Socket] Error in subscribe_commentary_feed: ${error.message}`
      );
      socket.emit("commentary_feed_error", {
        message: "Unable to fetch live commentary feed",
      });
    }
  });

  socket.on("subscribe_elimination_feed", async (payload = {}) => {
    try {
      const requestedRound = Number(payload.roundNumber);
      const roundNumber = Number.isFinite(requestedRound)
        ? requestedRound
        : null;

      if (roundNumber) {
        socket.join(`round_${roundNumber}`);
      }

      const tournamentId = payload.tournamentId || null;
      if (tournamentId) socket.join(`t_${tournamentId}`);

      const items = await getEliminationSnapshot(roundNumber, tournamentId);
      socket.emit("elimination_order_snapshot", {
        roundNumber: roundNumber || null,
        tournamentId: tournamentId || null,
        items,
      });
    } catch (error) {
      console.error(
        `[Socket] Error in subscribe_elimination_feed: ${error.message}`
      );
      socket.emit("elimination_feed_error", {
        message: "Unable to fetch elimination feed",
      });
    }
  });
});

// Database connection and server start
connectDB()
  .then(async () => {
    await seedAdmin();
    await ensureSettings();
    await ensureDefaultTournament();

    server.listen(port, "0.0.0.0", () => {
      console.log(`Server listening on ${port}`);
    });

    server.on("error", (err) => {
      console.error(`Server error: ${err}`);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error(`MongoDB connection error: ${err}`);
    process.exit(1);
  });

// Make io available in app
app.io = io;
