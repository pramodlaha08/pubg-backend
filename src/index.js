import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { app } from "./app.js";
import connectDB from "./db/index.js";
import {Team} from "./models/team.model.js";

dotenv.config({ path: "./.env" });

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

// Middleware to make io available in routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Socket.io connection
io.on("connection", (socket) => {
  console.log("Client connected");

  // Send initial data
  Team.find()
    .then((teams) => {
      socket.emit("initial-data", teams);
    })
    .catch((err) => console.error("Error fetching teams:", err));

  // Listen for updates
  socket.on("update-kills", async (data) => {
    console.log("Received update-kills event:", data);
    // Handle kill updates (add logic here)
  });
});

const port = process.env.PORT || 8000;
connectDB()
  .then(() => {
    httpServer.listen(port, () => {
      console.log(`Server listening on ${port}`);
    });

    app.on("error", (err) => {
      console.error(`Server error: ${err}`);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error(`MongoDB connection error: ${err}`);
    process.exit(1);
  });
