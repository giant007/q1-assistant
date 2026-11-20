import { getDb } from '../db.js';
import { visibleDocIds } from '../acl.js';

// 【注入顺序 2/4】依赖：db → acl。只按 acl 白名单取元数据，不在 service 里另写权限 SQL。

// 当前身份可见文档清单（仅元数据；越权文档连 id 都不会出现在结果里）。
export function listVisibleDocuments(clientId) {
  const ids = visibleDocIds(clientId);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return getDb().prepare(
    `SELECT id, file, type, doc_date AS date, version, status, superseded_by
     FROM documents WHERE id IN (${placeholders}) ORDER BY id`,
  ).all(...ids);
}
