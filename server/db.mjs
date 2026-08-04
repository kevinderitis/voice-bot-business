import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

let client = null;
let db = null;

export const isMongoConfigured = () => Boolean(mongoUri);

export const getDb = async () => {
  if (db) return db;
  if (!mongoUri) throw new Error('MONGODB_URI no configurada');
  client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db(process.env.MONGO_DB || 'voice-bot');
  return db;
};

export const closeDb = async () => {
  try {
    await client?.close();
  } catch {
    /* noop */
  }
  client = null;
  db = null;
};
