import { profilePayload, updateOwnProfile } from '../Service/profileService.js';
import { changeOwnPassword } from '../Service/passwordService.js';

export async function changePassword(req, res) {
  try {
    await changeOwnPassword(req.user._id, req.body || {});
    return res.json({ success: true, data: { message: 'Password changed successfully. Sign in with your new password.' } });
  } catch (error) {
    if (error.name === 'VersionError') return res.status(409).json({ success: false, message: 'Your account changed. Sign in again and retry.' });
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to change password.' });
  }
}

export function getProfile(req, res) {
  return res.json({ success: true, data: { user: profilePayload(req.user) } });
}

export async function updateProfile(req, res) {
  try {
    const user = await updateOwnProfile(req.user._id, req.body || {}, req.file);
    return res.json({ success: true, data: { user } });
  } catch (error) {
    if (error.name === 'VersionError') return res.status(409).json({ success: false, message: 'Your profile changed. Refresh and try again.' });
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to update profile.' });
  }
}
