import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const DATA_DIR = path.join(__dirname, 'data');
const JSON_FILE = path.join(DATA_DIR, 'settings.json');

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
const useMongo = Boolean(mongoUri);

let client = null;
let collection = null;

const ensureMongo = async () => {
  if (collection) return;
  client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(process.env.MONGO_DB || 'voice-bot');
  collection = db.collection('settings');
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
  if (useMongo) {
    await ensureMongo();
    const doc = await collection.findOne({ key });
    return doc?.value ?? fallback;
  }
  const data = readJson();
  return key in data ? data[key] : fallback;
};

export const setSetting = async (key, value) => {
  if (useMongo) {
    await ensureMongo();
    await collection.updateOne({ key }, { $set: { value } }, { upsert: true });
    return;
  }
  const data = readJson();
  data[key] = value;
  writeJson(data);
};
