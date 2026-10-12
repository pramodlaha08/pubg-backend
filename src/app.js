import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "16kb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "16kb",
  })
);

app.use(express.static("public"));

import teamRoutes from "./routes/team.route.js";
import eliminationNotificationRoutes from "./routes/eliminationNotification.routes.js";
import teamLogRoutes from "./routes/teamLog.route.js";
import authRoutes from "./routes/auth.route.js";
import settingsRoutes from "./routes/settings.route.js";
import dashboardRoutes from "./routes/dashboard.route.js";
import tournamentRoutes from "./routes/tournament.route.js";
import { resolveTournament } from "./middlewares/resolveTournament.middleware.js";

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/tournaments", tournamentRoutes);
app.use("/api/v1/settings", resolveTournament, settingsRoutes);
app.use("/api/v1/dashboard", resolveTournament, dashboardRoutes);
app.use("/api/v1/team", resolveTournament, teamRoutes);
app.use("/api/v1/elimination", resolveTournament, eliminationNotificationRoutes);
app.use(
  "/api/v1/elimination-notification",
  resolveTournament,
  eliminationNotificationRoutes
);
app.use("/api/v1/team-log", resolveTournament, teamLogRoutes);

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    errors: err.errors || [],
  });
});

export { app };
