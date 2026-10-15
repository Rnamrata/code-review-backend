import { Router } from "express";
import reviewRoutes from "./review.routes";

const router = Router();

router.use('/review', reviewRoutes);

export default router;
