import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dixxd3uf9",
  api_key: process.env.CLOUDINARY_API_KEY || "459585981834624",
  api_secret: process.env.CLOUDINARY_API_SECRET || "nlxl6UxxaQnVB6i18SB5rPZNQzk",
});

export default cloudinary;
