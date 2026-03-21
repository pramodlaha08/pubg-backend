import { app } from "./app.js";
import connectDB from "./db/index.js";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import { TeamLog } from "./models/teamLog.model.js";

dotenv.config({ path: "./.env" });

const port = process.env.PORT || 8000;

// Create HTTP server
const server = createServer(app);

// Configure Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
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

  // Dedicated commentator feed: fetch initial logs once, then keep listening to team_log_created.
  socket.on("subscribe_commentary_feed", async (payload = {}) => {
    try {
      console.log(`[Socket] Client ${socket.id} subscribed to commentary feed`);
      const requestedLimit = Number(payload.limit);
      const limit = Math.min(
        200,
        Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 100)
      );

      const latestLogs = await TeamLog.find({})
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
});

// Database connection and server start
connectDB()
  .then(() => {
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
