import { DB_NAME } from "../constants.js";
import mongoose from "mongoose";

// Connect to MongoDB

const connectDB = async () => {
  try {
    const connectionInstance = await mongoose.connect(
      `${process.env.MONGODB_URI}/${DB_NAME}`
    );
    console.log(
      `Db connected !! and hosted in ${connectionInstance.connection.host}`
    );
  } catch (error) {
    console.error("Error connecting to the database", error);
    process.exit(1);
  }
};

export default connectDB;
