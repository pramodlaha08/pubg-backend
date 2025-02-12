import { app } from "./app.js";
import connectDB from "./db/index.js";
import dotenv from "dotenv";
dotenv.config({
  path: "./.env",
});

import { Server } from "socket.io";

const io = new Server(server);

io.on("connection", (socket) => {
  console.log("Client connected");

  // Send initial data
  Team.find().then((teams) => {
    socket.emit("initial-data", teams);
  });

  // Listen for updates
  socket.on("update-kills", async (data) => {
    // Handle kill updates
  });
});

// Add this middleware to make io available in routes
app.use((req, res, next) => {
  req.io = io;
  next();
});
const port = process.env.PORT || 8000;
connectDB()
  .then(() => {
    app.listen(port, () => {
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
