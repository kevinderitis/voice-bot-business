import { seedAvailability } from './reservations.mjs';
import { closeDb, getDb, isMongoConfigured } from './db.mjs';

async function main() {
  if (!isMongoConfigured()) {
    console.error('[migrate] MONGODB_URI no está configurada en server/.env');
    process.exit(1);
  }
  await getDb();
  const inserted = await seedAvailability();
  console.log(`[migrate] Disponibilidad inicializada para ${inserted} combinaciones (roomType + fecha).`);
  await closeDb();
  console.log('[migrate] Listo.');
}

main().catch((err) => {
  console.error('[migrate] Error:', err);
  process.exit(1);
});