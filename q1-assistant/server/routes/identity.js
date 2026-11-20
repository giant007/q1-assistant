import { Router } from 'express';
import { ok, asyncHandler } from '../http.js';
import { SwitchIdentitySchema } from '../validate.js';
import { switchIdentity } from '../session.js';

const router = Router();

router.post('/switch-identity', asyncHandler(async (req, res) => {
  const { clientId } = SwitchIdentitySchema.parse(req.body);
  const session = switchIdentity(req, res, clientId);
  ok(res, { clientId: session.client_id });
}));

export default router;
