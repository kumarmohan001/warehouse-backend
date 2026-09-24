import User from '../Model/user.js';
import { hashPassword } from '../config/hashPassword.js';
import { setUserPassword } from '../Service/passwordService.js';
import { disconnectUser } from '../Service/socketService.js';

const roles = ['warehouse', 'qc-test', 'production', 'admin'];
const validPermissions = ['inventory:view', 'inventory:manage', 'qc:view', 'qc:manage', 'production:view', 'production:manage', 'reports:view'];

const normalizePermissions = (permissions = []) => Array.isArray(permissions)
  ? [...new Set(permissions.filter((permission) => validPermissions.includes(permission)))]
  : [];

export const createUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone = "",
      role,
      status = "Active",
      permissions = [],
    } = req.body || {};

    // Required fields
    if (!name?.trim() || !email?.trim() || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password, and role are required.",
      });
    }

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // Email validation
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address.",
      });
    }

    // Password validation
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    // Check existing user
    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account already exists for this email.",
      });
    }

    // Create user
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: await hashPassword(password),
      phone: String(phone || '').trim(),
      role,
      status,
      permissions: normalizePermissions(permissions),
    });

    // Remove password from response
    const userData = user.toObject();
    delete userData.password;

    return res.status(201).json({
      success: true,
      message: "User created successfully.",
      data: userData,
    });
  } catch (error) {
    console.error("Signup Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create user.",
    });
  }
};

// Backward-compatible name for any older route still importing `signup`.
export const signup = createUser;

export const getAllUsers = async(req,res)=>{
    try {
        const { search = '', role = '', status = '', page = 1, limit = 7 } = req.query;
        const query = {};
        if (role) query.role = role;
        if (status) query.status = status;
        if (search.trim()) query.$or = [{ name: { $regex: search.trim(), $options: 'i' } }, { email: { $regex: search.trim(), $options: 'i' } }];
        const pageNumber = Math.max(Number.parseInt(page, 10) || 1, 1);
        const pageSize = Math.min(Math.max(Number.parseInt(limit, 10) || 7, 1), 100);
        const total = await User.countDocuments(query);
        const totalPages = Math.max(Math.ceil(total / pageSize), 1);
        const safePage = Math.min(pageNumber, totalPages);
        const users = await User.find(query).select('-password').sort({ createdAt: -1 }).skip((safePage - 1) * pageSize).limit(pageSize);
        return res.status(200).json({
            success: true,
            message: "Users retrieved successfully!",
            data: { users, pagination: { page: safePage, limit: pageSize, total, totalPages } }
        });
    } catch (error) {
         console.log(error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error!"
        });
    }
}

export const getUserById = async (req, res) => {
    try {
        const { _id } = req.params;

        // Find user by _
        const user = await User.findById(_id).select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found!",
                data: null
            });
        }

        return res.status(200).json({
            success: true,
            message: "User retrieved successfully!",
            data: user
        });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        if (error.name === 'VersionError') return res.status(409).json({ success: false, message: 'This user was updated. Refresh and try again.' });
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error!"
        });
    }
};


export const updateUser = async (req, res) => {
    try {
        const { _id } = req.params;
        const { name, email, phone, password, status, role, permissions } = req.body || {};

        // Validate input
        if (!name && !email && !phone && !password && !status && !role && permissions === undefined) {
            return res.status(400).json({
                success: false,
                message: "Please provide name or email to update!",
                data: null
            });
        }

        // Update user
        const updatedUser = await User.findById(_id);

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: "User not found!",
                data: null
            });
        }
        if (name?.trim()) updatedUser.name = name.trim();
        if (email?.trim()) {
            const normalizedEmail = email.trim().toLowerCase();
            const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: _id } });
            if (existing) return res.status(409).json({ success: false, message: 'An account already exists for this email.' });
            updatedUser.email = normalizedEmail;
        }
        if (phone !== undefined) updatedUser.phone = String(phone || '').trim();
        if (password) {
            await setUserPassword(updatedUser, password);
        }
        if (status) {
            if (!['Active', 'Inactive'].includes(status)) return res.status(400).json({ success: false, message: 'Select a valid status.' });
            updatedUser.status = status;
        }
        if (role) {
            if (!roles.includes(role)) return res.status(400).json({ success: false, message: 'Select a valid role.' });
            updatedUser.role = role;
        }
        if (permissions !== undefined) updatedUser.permissions = normalizePermissions(permissions);
        await updatedUser.save();
        if (password) disconnectUser(updatedUser._id);

        const userData = updatedUser.toObject(); delete userData.password;

        return res.status(200).json({
            success: true,
            message: "User updated successfully!",
            data: userData
        });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        if (error.name === 'VersionError') return res.status(409).json({ success: false, message: 'This user was updated. Refresh and try again.' });
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error!"
        });
    }
};

export const deleteUser = async (req, res) => {
    try {
        const { _id } = req.params;

        // Find user by _
        const user = await User.findByIdAndDelete(_id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found!",
                data: null
            });
        }

        return res.status(200).json({
            success: true,
            message: "User Deleted successfully!",
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error!"
        });
    }
};
