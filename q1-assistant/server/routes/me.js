import { Router } from 'express';
import { ok, asyncHandler } from '../http.js';
import { getSession } from '../session.js';

const router = Router();

// 前端只需要知道服务端会话当前身份；身份本身仍只从 Cookie 读取。
router.get('/me', asyncHandler(async (req, res) => {
  const session = getSession(req, res);
  ok(res, { clientId: session.client_id });
}));

export default router;
