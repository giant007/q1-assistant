-- 公共基础设施：全部建表语句。业务代码禁止写 CREATE TABLE。

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  type TEXT NOT NULL,
  doc_date TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_acl (
  doc_id TEXT NOT NULL REFERENCES documents(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  PRIMARY KEY (doc_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_acl_client ON document_acl(client_id);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(id),
  seq INTEGER NOT NULL,
  heading TEXT,
  doc_date TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  status TEXT NOT NULL,
  text TEXT NOT NULL,
  text_2gram TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  chunk_id UNINDEXED, text_2gram
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  role TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_session ON messages(session_id, id);

CREATE TABLE IF NOT EXISTS glossary (
  term TEXT PRIMARY KEY,
  expansion TEXT
);
