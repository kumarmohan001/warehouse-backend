import cloudinary from "../config/cloudinary.js";
import Home from "../Model/home.js";

export const createHome = async (req, res) => {
  try {
    const { title, subtitle } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Image required" });
    }

    // Upload to cloudinary
    const uploadResult = await cloudinary.uploader.upload(req.file.path);

    const home = await Home.create({
      title,
      subtitle,
      image: uploadResult.secure_url,
    });

    return res.status(201).json({
      success: true,
      message: "Home section created successfully",
      home,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
