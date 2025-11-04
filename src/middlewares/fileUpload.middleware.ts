import multer from 'multer';
import { appConfig } from '../config/app.config';

// Use memory storage (file stored in buffer)
const storage = multer.memoryStorage();

// File filter
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = file.originalname.split('.').pop()?.toLowerCase();
  
  if (ext && appConfig.allowedExtensions.includes(`.${ext}`)) {
    cb(null, true);
  } else {
    cb(new Error(`File type .${ext} not allowed`));
  }
};

// Create multer instance
export const upload = multer({
  storage,
  limits: {
    fileSize: appConfig.maxFileSizeMB * 1024 * 1024 // MB to bytes
  },
  fileFilter
});

// Export middleware for single file upload
export const uploadSingleFile = upload.single('file');