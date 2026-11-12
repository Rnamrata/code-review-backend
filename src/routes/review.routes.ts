import { Router } from 'express';
import { review } from '../controllers/review.controller';
import { validateReview } from '../middlewares/validateReview.middleware';

const router = Router();

// The request id is attached in app.ts, before the body is read, so it is already there.
router.post('/', validateReview, review);

export default router;
