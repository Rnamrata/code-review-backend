import { Router } from 'express';
import { review } from '../controllers/review.controller';

const router = Router();

router.post('/', review);

export default router; 