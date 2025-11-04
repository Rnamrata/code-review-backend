import { Router } from 'express';
import { uploadFile } from '../controllers/upload.controller';
import { uploadSingleFile } from '../middlewares/fileUpload.middleware';

const router = Router();

/**
 * POST /api/upload
 * Upload a code file for review
 * 
 * Form data:
 * - file: Code file (required)
 * - language: Programming language (optional)
 */

router.post('/', uploadSingleFile, uploadFile);

export default router;