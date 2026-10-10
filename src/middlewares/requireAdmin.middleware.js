import jwt from "jsonwebtoken";
import { ApiError } from "../utils/ApiError.js";
import { Admin } from "../models/admin.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const requireAdmin = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    throw new ApiError(401, "Authentication required");
  }

  if (!process.env.JWT_SECRET) {
    throw new ApiError(500, "Server auth is not configured (JWT_SECRET missing)");
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new ApiError(401, "Invalid or expired session");
  }

  const admin = await Admin.findById(payload.id).select("-passwordHash");
  if (!admin) {
    throw new ApiError(401, "Admin account no longer exists");
  }

  req.admin = admin;
  next();
});

export { requireAdmin };
