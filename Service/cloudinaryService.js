import cloudinary from '../config/cloudinary.js';

const requireCloudinaryConfiguration = () => {
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) return;
  const error = new Error('Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to backend/.env, then restart the backend.');
  error.statusCode = 503;
  throw error;
};

export const uploadWarehouseDocument = (file) => {
  requireCloudinaryConfiguration();
  return cloudinary.uploader.upload(file.path, {
  folder: 'warehouse-receiving',
  resource_type: 'auto',
}).then((result) => ({
  fileName: file.originalname,
  fileUrl: result.secure_url,
  cloudinaryPublicId: result.public_id,
  cloudinaryResourceType: result.resource_type,
  }));
};

export const deleteWarehouseDocument = async (document) => {
  if (!document?.cloudinaryPublicId) return false;
  requireCloudinaryConfiguration();

  await cloudinary.uploader.destroy(document.cloudinaryPublicId, {
    resource_type: document.cloudinaryResourceType || 'image',
  });
  return true;
};
