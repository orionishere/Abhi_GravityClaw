import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Resolve current directory for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure a data directory exists so we don't litter the root
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

export const dbPath = path.join(dataDir, 'memory.db');
export const db = new Database(dbPath);

// Enable WAL mode for better concurrency and performance
db.pragma('journal_mode = WAL');

// Initialize Memory Tables
export function initDb() {
    // Standard table for raw memories
    db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            topic TEXT NOT NULL,
            content TEXT NOT NULL
        )
    `);

    // FTS5 Virtual Table for full-text search across memories
    // Concept from OpenClaw's memory architecture
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            topic,
            content,
            content='memories',
            content_rowid='id'
        )
    `);

    // Triggers to automatically keep the FTS index in sync with the memories table
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, topic, content) VALUES (new.id, new.topic, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, topic, content) VALUES('delete', old.id, old.topic, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, topic, content) VALUES('delete', old.id, old.topic, old.content);
            INSERT INTO memories_fts(rowid, topic, content) VALUES (new.id, new.topic, new.content);
        END;
    `);

    console.log('[Memory] SQLite + FTS5 initialized at', dbPath);
}
