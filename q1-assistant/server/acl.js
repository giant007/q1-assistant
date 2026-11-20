import { getDb } from './db.js';

// 可见白名单的唯一入口。检索必须先用它过滤，越权文档不得进入任何下游。
export function visibleDocIds(clientId) {
  return getDb()
    .prepare('SELECT doc_id FROM document_acl WHERE client_id = ?')
    .all(clientId)
    .map((row) => row.doc_id);
}

export function isVisible(clientId, docId) {
  return Boolean(
    getDb()
      .prepare('SELECT 1 FROM document_acl WHERE client_id = ? AND doc_id = ?')
      .get(clientId, docId),
  );
}
