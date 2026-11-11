import { Router } from "express";
import reviewRoutes from "./review.routes";
import { appConfig } from "../config/app.config";
import { createRateLimiter } from "../middlewares/rateLimit.middleware";

const router = Router();

// Only /review is limited: it is the one route that costs real work.
const reviewLimiter = createRateLimiter({
    windowMs: appConfig.rateLimitWindowMinutes * 60_000,
    max: appConfig.rateLimitMaxRequests
});

router.use('/review', reviewLimiter, reviewRoutes);

export default router;