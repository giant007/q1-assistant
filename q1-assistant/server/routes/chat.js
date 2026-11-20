import { Router } from 'express';
import { ok, asyncHandler } from '../http.js';
import { logger } from '../logger.js';
import { ChatRequestSchema } from '../validate.js';
import { getSession } from '../session.js';
import { answer, answerStream } from '../services/chat.js';

const router = Router();

// EventSource 只支持 GET，问题放 query；身份仍从服务端会话读，body/query 里的 clientId 一律忽略。
router.get('/chat/stream', asyncHandler(async (req, res) => {
  logger.info('[chat/stream] GET 请求到达', req.query.question);
  const { question } = ChatRequestSchema.parse({ question: req.query.question });
  const session = getSession(req, res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);
  try {
    for await (const event of answerStream({
      clientId: session.client_id, sessionId: session.session_id, question,
    })) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: error.message ?? '生成失败' })}\n\n`);
  }
  res.end();
}));

router.post('/chat', asyncHandler(async (req, res) => {
  const { question } = ChatRequestSchema.parse(req.body);
  const session = getSession(req, res);
  const context = { clientId: session.client_id, sessionId: session.session_id, question };

  if (req.body.stream === true) {
    logger.info('[chat] POST stream 请求到达', question);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.socket?.setNoDelay?.(true);
    try {
      for await (const event of answerStream(context)) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message ?? '生成失败' })}\n\n`);
    }
    res.end();
    return;
  }

  ok(res, await answer(context));
}));

export default router;
