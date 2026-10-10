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

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/team", teamRoutes);
app.use("/api/v1/elimination", eliminationNotificationRoutes);
app.use("/api/v1/elimination-notification", eliminationNotificationRoutes);
app.use("/api/v1/team-log", teamLogRoutes);

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    errors: err.errors || [],
  });
});

export { app };
