import { Router } from 'express';
import { ok, asyncHandler } from '../http.js';
import { getSession } from '../session.js';
import { listVisibleDocuments } from '../services/documents.js';

const router = Router();

router.get('/documents', asyncHandler(async (req, res) => {
  const session = getSession(req, res);
  ok(res, listVisibleDocuments(session.client_id));
}));

export default router;
