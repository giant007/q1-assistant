import { Router } from 'express';
import { ok, asyncHandler } from '../http.js';
import { listClients } from '../session.js';

const router = Router();

router.get('/clients', asyncHandler(async (req, res) => {
  ok(res, listClients());
}));

export default router;
