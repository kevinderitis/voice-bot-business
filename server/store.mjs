import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const JSON_FILE = path.join(DATA_DIR, 'settings.json');

const dbUrl = process.env.DATABASE_URL;
const usePostgres = Boolean(dbUrl);

let pool = null;

const ensurePostgres = async () => {
  if (pool) return;
  pool = new pg.Pool({ connectionString: dbUrl });
  await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
};

const readJson = () => {
  try {
    return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  } catch {
    return {};
  }
};

const writeJson = (data) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 2));
};

export const getSetting = async (key, fallback = null) => {
  if (usePostgres) {
    await ensurePostgres();
    const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    return rows.length ? rows[0].value : fallback;
  }
  const data = readJson();
  return key in data ? data[key] : fallback;
};

export const setSetting = async (key, value) => {
  if (usePostgres) {
    await ensurePostgres();
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, value]
    );
    return;
  }
  const data = readJson();
  data[key] = value;
  writeJson(data);
};
