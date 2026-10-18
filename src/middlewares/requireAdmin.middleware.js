import jwt from "jsonwebtoken";
import { ApiError } from "../utils/ApiError.js";
import { Admin } from "../models/admin.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Resolve the signed-in admin from the Authorization header. The role is read
// from the database (not the token) so role changes and deactivation take
// effect immediately, without waiting for the token to expire.
const loadAdmin = async (req) => {
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
  if (admin.isActive === false) {
    throw new ApiError(403, "This account has been deactivated");
  }

  return admin;
};

// Any authenticated account, regardless of role.
export const requireAuth = asyncHandler(async (req, res, next) => {
  req.admin = await loadAdmin(req);
  next();
});

// Restrict a route to the given roles, e.g. requireRole("admin", "scorer").
export const requireRole =
  (...roles) =>
  asyncHandler(async (req, res, next) => {
    const admin = req.admin || (await loadAdmin(req));
    if (!roles.includes(admin.role)) {
      throw new ApiError(
        403,
        "Your role does not have permission to perform this action"
      );
    }
    req.admin = admin;
    next();
  });

// Full control: account management, tournaments, teams, destructive actions.
export const requireAdmin = requireRole("admin");

// Live scoring and results operations (admins inherit scorer abilities).
export const requireScorer = requireRole("admin", "scorer");
