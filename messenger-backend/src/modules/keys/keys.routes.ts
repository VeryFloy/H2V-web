import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  uploadBundleHandler,
  fetchBundleHandler,
  hasBundleHandler,
  replenishHandler,
  preKeyCountHandler,
} from './keys.controller';

const router = Router();

router.use(authMiddleware);

router.post('/bundle', uploadBundleHandler);
router.get('/bundle/:userId', fetchBundleHandler);
router.get('/has-bundle/:userId', hasBundleHandler);
router.post('/replenish', replenishHandler);
router.get('/count', preKeyCountHandler);

export default router;
