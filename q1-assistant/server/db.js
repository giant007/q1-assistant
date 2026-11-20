import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

let instance;

export function getDb() {
  if (!instance) {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    instance = new Database(config.dbPath);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    instance.exec(schema);
  }
  return instance;
}

export function closeDb() {
  instance?.close();
  instance = undefined;
}
