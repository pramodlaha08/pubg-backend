import bcrypt from "bcryptjs";
import { Admin, ADMIN_ROLES } from "../models/admin.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const publicAdmin = (admin) => ({
  id: admin._id,
  username: admin.username,
  role: admin.role,
  isActive: admin.isActive !== false,
  createdAt: admin.createdAt,
});

const normalizeUsername = (value) => String(value || "").toLowerCase().trim();

const assertValidRole = (role) => {
  if (!ADMIN_ROLES.includes(role)) {
    throw new ApiError(400, `Role must be one of: ${ADMIN_ROLES.join(", ")}`);
  }
};

const countActiveAdmins = () =>
  Admin.countDocuments({ role: "admin", isActive: { $ne: false } });

export const listAdmins = asyncHandler(async (req, res) => {
  const admins = await Admin.find()
    .sort({ createdAt: 1 })
    .select("-passwordHash");
  res
    .status(200)
    .json(new ApiResponse(200, admins.map(publicAdmin), "Admin accounts"));
});

export const createAdmin = asyncHandler(async (req, res) => {
  const { username, password, role } = req.body || {};
  const name = String(username || "").toLowerCase().trim();

  if (!name || !password) {
    throw new ApiError(400, "username and password are required");
  }
  if (String(password).length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters");
  }
  const finalRole = role || "viewer";
  assertValidRole(finalRole);

  const exists = await Admin.findOne({ username: name });
  if (exists) {
    throw new ApiError(409, "An account with that username already exists");
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const admin = await Admin.create({
    username: name,
    passwordHash,
    role: finalRole,
  });

  res
    .status(201)
    .json(new ApiResponse(201, publicAdmin(admin), "Admin account created"));
});

export const updateAdmin = asyncHandler(async (req, res) => {
  const { adminId } = req.params;
  const { role, isActive } = req.body || {};

  const admin = await Admin.findById(adminId);
  if (!admin) {
    throw new ApiError(404, "Admin account not found");
  }

  const isSelf = String(admin._id) === String(req.admin._id);

  if (role !== undefined) {
    assertValidRole(role);
    if (isSelf && role !== "admin") {
      throw new ApiError(400, "You cannot change your own role");
    }
    if (admin.role === "admin" && role !== "admin" && admin.isActive !== false) {
      if ((await countActiveAdmins()) <= 1) {
        throw new ApiError(400, "At least one active admin is required");
      }
    }
    admin.role = role;
  }

  if (isActive !== undefined) {
    if (isSelf && isActive === false) {
      throw new ApiError(400, "You cannot deactivate your own account");
    }
    if (admin.role === "admin" && isActive === false && admin.isActive !== false) {
      if ((await countActiveAdmins()) <= 1) {
        throw new ApiError(400, "At least one active admin is required");
      }
    }
    admin.isActive = Boolean(isActive);
  }

  await admin.save();
  res
    .status(200)
    .json(new ApiResponse(200, publicAdmin(admin), "Admin account updated"));
});

export const resetAdminPassword = asyncHandler(async (req, res) => {
  const { adminId } = req.params;
  const { newPassword } = req.body || {};

  if (!newPassword || String(newPassword).length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }

  const admin = await Admin.findById(adminId);
  if (!admin) {
    throw new ApiError(404, "Admin account not found");
  }

  admin.passwordHash = await bcrypt.hash(String(newPassword), 10);
  await admin.save();

  res
    .status(200)
    .json(new ApiResponse(200, null, "Password reset successfully"));
});

export const deleteAdmin = asyncHandler(async (req, res) => {
  const { adminId } = req.params;

  if (String(adminId) === String(req.admin._id)) {
    throw new ApiError(400, "You cannot delete your own account");
  }

  const admin = await Admin.findById(adminId);
  if (!admin) {
    throw new ApiError(404, "Admin account not found");
  }
  if (admin.role === "admin" && admin.isActive !== false) {
    if ((await countActiveAdmins()) <= 1) {
      throw new ApiError(400, "At least one active admin is required");
    }
  }

  await admin.deleteOne();
  res.status(200).json(new ApiResponse(200, null, "Admin account deleted"));
});
