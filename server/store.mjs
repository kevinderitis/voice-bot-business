import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, isMongoConfigured } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const DATA_DIR = path.join(__dirname, 'data');
const JSON_FILE = path.join(DATA_DIR, 'settings.json');

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
  if (isMongoConfigured()) {
    const db = await getDb();
    const doc = await db.collection('settings').findOne({ key });
    return doc?.value ?? fallback;
  }
  const data = readJson();
  return key in data ? data[key] : fallback;
};

export const setSetting = async (key, value) => {
  if (isMongoConfigured()) {
    const db = await getDb();
    await db
      .collection('settings')
      .updateOne({ key }, { $set: { value } }, { upsert: true });
    return;
  }
  const data = readJson();
  data[key] = value;
  writeJson(data);
};