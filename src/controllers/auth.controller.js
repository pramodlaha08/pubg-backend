import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Admin } from "../models/admin.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const TOKEN_TTL = "12h";

const signToken = (admin) => {
  if (!process.env.JWT_SECRET) {
    throw new ApiError(500, "Server auth is not configured (JWT_SECRET missing)");
  }
  return jwt.sign(
    { id: admin._id.toString(), username: admin.username },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
};

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    throw new ApiError(400, "Username and password are required");
  }

  const admin = await Admin.findOne({ username: String(username).toLowerCase().trim() });
  if (!admin) {
    throw new ApiError(401, "Invalid credentials");
  }

  const valid = await bcrypt.compare(String(password), admin.passwordHash);
  if (!valid) {
    throw new ApiError(401, "Invalid credentials");
  }

  const token = signToken(admin);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        token,
        admin: { id: admin._id, username: admin.username },
      },
      "Logged in successfully"
    )
  );
});

export const me = asyncHandler(async (req, res) => {
  res.status(200).json(
    new ApiResponse(200, { id: req.admin._id, username: req.admin.username }, "Admin session")
  );
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "currentPassword and newPassword are required");
  }
  if (String(newPassword).length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }

  const admin = await Admin.findById(req.admin._id);
  if (!admin) {
    throw new ApiError(404, "Admin not found");
  }

  const valid = await bcrypt.compare(String(currentPassword), admin.passwordHash);
  if (!valid) {
    throw new ApiError(401, "Current password is incorrect");
  }

  admin.passwordHash = await bcrypt.hash(String(newPassword), 10);
  await admin.save();

  res.status(200).json(new ApiResponse(200, null, "Password updated successfully"));
});
