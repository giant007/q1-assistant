import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { badRequest } from './errors.js';

const COOKIE_NAME = 'sid';
const now = () => new Date().toISOString();

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => part.trim().split('=')).filter((p) => p.length === 2),
  );
}

function setCookie(res, sid) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
}

// 身份只从服务端会话读取，忽略请求体里的 clientId。
export function getSession(req, res) {
  const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const db = getDb();
  if (sid) {
    const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sid);
    if (row) return row;
  }
  const firstClient = db.prepare('SELECT id FROM clients ORDER BY rowid LIMIT 1').get();
  if (!firstClient) throw new Error('clients 表为空，请先执行灌库');
  const id = randomUUID();
  db.prepare('INSERT INTO sessions (session_id, client_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, firstClient.id, now(), now());
  if (res) setCookie(res, id);
  return { session_id: id, client_id: firstClient.id };
}

export function listClients() {
  return getDb().prepare('SELECT id, name, role, description FROM clients ORDER BY rowid').all();
}

// 切换身份：更新会话并清空历史，防止总包上下文被分包继承。
export function switchIdentity(req, res, clientId) {
  const session = getSession(req, res);
  const db = getDb();
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId);
  if (!client) throw badRequest('未知身份');
  const tx = db.transaction(() => {
    db.prepare('UPDATE sessions SET client_id = ?, updated_at = ? WHERE session_id = ?')
      .run(clientId, now(), session.session_id);
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(session.session_id);
  });
  tx();
  return { ...session, client_id: clientId };
}
