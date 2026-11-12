import { Router } from 'express';
import { review } from '../controllers/review.controller';
import { attachRequestId } from '../middlewares/requestId.middleware';
import { validateReview } from '../middlewares/validateReview.middleware';

const router = Router();

// The request id comes first so that even a rejected request carries it.
router.post('/', attachRequestId, validateReview, review);

export default router;