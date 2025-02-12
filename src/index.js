import { app } from "./app.js";
import connectDB from "./db/index.js";
import dotenv from "dotenv";
dotenv.config({
  path: "./.env",
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
