import { app } from "./app.js";
import connectDB from "./db/index.js";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";

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
  console.log(`Client connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });

  // Join specific room for team updates
  socket.on("join_team", (teamId) => {
    socket.join(`team_${teamId}`);
  });

  // Join round updates room
  socket.on("join_round", (roundNumber) => {
    socket.join(`round_${roundNumber}`);
  });
});

// Database connection and server start
connectDB()
  .then(() => {
    server.listen(port, () => {
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
