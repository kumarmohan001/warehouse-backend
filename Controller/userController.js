import User from '../Model/user.js'
import { hashPassword ,comparePassword} from '../config/hashPassword.js';

export const getAllUsers = async(req,res)=>{
    try {
        const users = await User.find({ role: { $ne: "admin" } });
        if(!users){
            res.status(404).json({
                success:false,
                message:"No users found!",
                data:null
            })
        }
        res.status(200).json({
            success: true,
            message: "Users retrieved successfully!",
            data: users
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
        const user = await User.findById(_id);

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
        const { name, email ,status} = req.body;

        // Validate input
        if (!name && !email) {
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
        updatedUser.name = name || updatedUser.name;
        updatedUser.email = email || updatedUser.email;
        updatedUser.status = status || updatedUser.status;
        await updatedUser.save();

        return res.status(200).json({
            success: true,
            message: "User updated successfully!",
            data: updatedUser
        });
    } catch (error) {
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
