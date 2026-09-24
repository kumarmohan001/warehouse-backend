import User from '../Model/user.js';
import cloudinary from '../config/cloudinary.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
export const profilePayload = (user) => ({ id: user._id, name: user.name, email: user.email, phone: user.phone || '', photoUrl: user.photoUrl || '', role: user.role, status: user.status, permissions: user.permissions || [] });

export function validateProfile(values) {
  const changes = {};
  if (values.name !== undefined) {
    if (typeof values.name !== 'string' || !values.name.trim() || values.name.trim().length > 100) fail(400, 'Enter a name between 1 and 100 characters.');
    changes.name = values.name.trim();
  }
  if (values.email !== undefined) {
    if (typeof values.email !== 'string' || values.email.length > 254 || !/^\S+@\S+\.\S+$/.test(values.email.trim())) fail(400, 'Enter a valid email address.');
    changes.email = values.email.trim().toLowerCase();
  }
  if (values.phone !== undefined) {
    if (typeof values.phone !== 'string' || (values.phone.trim() && !/^\+?[\d ()-]{6,25}$/.test(values.phone.trim()))) fail(400, 'Enter a valid phone number.');
    changes.phone = values.phone.trim();
  }
  return changes;
}

export function validatePhoto(file) {
  const data = file.buffer;
  const jpeg = data?.[0] === 0xff && data?.[1] === 0xd8 && data?.[2] === 0xff;
  const png = data?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = data?.toString('ascii', 0, 4) === 'RIFF' && data?.toString('ascii', 8, 12) === 'WEBP';
  if (!data?.length || data.length > 5 * 1024 * 1024 || !({ 'image/jpeg': jpeg, 'image/png': png, 'image/webp': webp })[file.mimetype]) fail(400, 'Choose a valid JPG, PNG or WebP image up to 5 MB.');
}

async function uploadPhoto(file) {
  validatePhoto(file);
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) fail(503, 'Profile photo uploads are not configured. Contact your administrator.');
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({ folder: 'warehouse-profiles', resource_type: 'image', allowed_formats: ['jpg', 'png', 'webp'], transformation: [{ width: 512, height: 512, crop: 'limit' }] }, (error, result) => {
      if (error) return reject(Object.assign(new Error('Unable to upload profile photo. Please try again.'), { statusCode: 502 }));
      resolve(result);
    }).end(file.buffer);
  });
}

export async function updateOwnProfile(userId, values = {}, file) {
  const changes = validateProfile(values);
  if (!Object.keys(changes).length && !file) fail(400, 'Provide profile details or a photo to update.');
  const user = await User.findById(userId);
  if (!user || user.status !== 'Active') fail(401, 'Account is unavailable.');
  if (changes.email && changes.email !== user.email && await User.exists({ email: changes.email, _id: { $ne: userId } })) fail(409, 'An account already exists for this email.');
  let uploaded;
  const oldPhoto = user.photoPublicId;
  try {
    if (file) uploaded = await uploadPhoto(file);
    Object.assign(user, changes);
    if (uploaded) { user.photoUrl = uploaded.secure_url; user.photoPublicId = uploaded.public_id; }
    await user.save();
  } catch (error) {
    if (uploaded) await cloudinary.uploader.destroy(uploaded.public_id).catch(() => {});
    if (error.code === 11000) fail(409, 'An account already exists for this email.');
    throw error;
  }
  if (uploaded && oldPhoto && oldPhoto !== uploaded.public_id) await cloudinary.uploader.destroy(oldPhoto).catch(() => {});
  return profilePayload(user);
}
