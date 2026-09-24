import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter(req, file, next) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return next(new Error('Choose a JPG, PNG or WebP image.'));
    next(null, true);
  },
}).single('photo');

export function profileUpload(req, res, next) {
  upload(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, message: error.code === 'LIMIT_FILE_SIZE' ? 'Profile photo must be 5 MB or smaller.' : error.message });
    next();
  });
}
