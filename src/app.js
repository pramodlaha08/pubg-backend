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

app.use("/api/v1/team", teamRoutes);
app.use("/api/v1/elimination", eliminationNotificationRoutes);
app.use("/api/v1/elimination-notification", eliminationNotificationRoutes);

export { app };
