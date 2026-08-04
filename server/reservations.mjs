import { ObjectId } from 'mongodb';
import { getDb } from './db.mjs';

export const ROOM_TYPES = ['private', 'dorm'];
export const ROOM_LABELS = { private: 'Privada', dorm: 'Dorm' };
export const SEED_DAYS = 365;

const toDateKey = (d) => d.toISOString().slice(0, 10);

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateKey(d);
};

export const todayKey = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
};

const isValidDate = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function datesInRange(checkIn, checkOut) {
  const out = [];
  let cur = checkIn;
  let guard = 0;
  while (cur < checkOut && guard < 730) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

async function getAvailabilityMap(roomType, days) {
  const db = await getDb();
  const docs = await db.collection('availability').find({ roomType, date: { $in: days } }).toArray();
  return new Map(docs.map((d) => [d.date, d.available]));
}

// ---- Seeding / migration ----

export async function seedAvailability(days = SEED_DAYS) {
  const db = await getDb();
  const ops = [];
  const today = new Date();
  for (const roomType of ROOM_TYPES) {
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() + i);
      const date = toDateKey(d);
      ops.push({
        updateOne: {
          filter: { roomType, date },
          update: { $setOnInsert: { roomType, date, available: true } },
          upsert: true,
        },
      });
    }
  }
  await db.collection('availability').bulkWrite(ops, { ordered: false });
  return ops.length;
}

// ---- Availability ----

export async function getAvailabilityRange(roomType, from, days) {
  const dateKeys = [];
  for (let i = 0; i < days; i++) dateKeys.push(addDays(from, i));
  const map = await getAvailabilityMap(roomType, dateKeys);
  return dateKeys.map((date) => ({ date, available: map.get(date) !== false }));
}

export async function setAvailability(roomType, date, available) {
  const db = await getDb();
  await db
    .collection('availability')
    .updateOne({ roomType, date }, { $set: { roomType, date, available: Boolean(available) } }, { upsert: true });
}

// ---- Reservations ----

export async function getReservations() {
  const db = await getDb();
  const docs = await db.collection('reservations').find({}).sort({ checkIn: -1 }).toArray();
  return docs.map((r) => ({ id: String(r._id), ...r }));
}

export async function createReservation(data) {
  const name = String(data.name || '').trim();
  const surname = String(data.surname || '').trim();
  const checkIn = data.checkIn;
  const checkOut = data.checkOut;
  const roomType = data.roomType;
  const guests = Number(data.guests);

  const errors = [];
  if (!name) errors.push('Falta el nombre');
  if (!surname) errors.push('Falta el apellido');
  if (!isValidDate(checkIn)) errors.push('Fecha de check-in inválida');
  if (!isValidDate(checkOut)) errors.push('Fecha de check-out inválida');
  if (checkIn && checkOut && !(checkOut > checkIn)) errors.push('El check-out debe ser posterior al check-in');
  if (!ROOM_TYPES.includes(roomType)) errors.push('Tipo de habitación inválido');
  if (!Number.isInteger(guests) || guests < 1) errors.push('Cantidad de personas inválida');
  if (errors.length) return { confirmed: false, message: errors.join('. ') };

  const days = datesInRange(checkIn, checkOut);
  const map = await getAvailabilityMap(roomType, days);
  const blocked = days.filter((d) => map.get(d) === false);
  if (blocked.length) {
    return {
      confirmed: false,
      message: `No hay disponibilidad para ${ROOM_LABELS[roomType]} en: ${blocked.join(', ')}.`,
    };
  }

  const db = await getDb();
  const doc = {
    name,
    surname,
    checkIn,
    checkOut,
    roomType,
    guests,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };
  const { insertedId } = await db.collection('reservations').insertOne(doc);

  const bulk = days.map((d) => ({
    updateOne: {
      filter: { roomType, date: d },
      update: { $set: { available: false, roomType, date: d } },
      upsert: true,
    },
  }));
  if (bulk.length) await db.collection('availability').bulkWrite(bulk, { ordered: false });

  return {
    confirmed: true,
    reservationId: String(insertedId),
    message: `Reserva confirmada para ${name} ${surname} (${ROOM_LABELS[roomType]}, ${guests} persona(s), del ${checkIn} al ${checkOut}).`,
  };
}

export async function deleteReservation(id) {
  const db = await getDb();
  let oid;
  try {
    oid = new ObjectId(id);
  } catch {
    throw new Error('ID inválido');
  }
  const col = db.collection('reservations');
  const doc = await col.findOne({ _id: oid });
  if (!doc) throw new Error('Reserva no encontrada');
  await col.deleteOne({ _id: oid });
  const days = datesInRange(doc.checkIn || '', doc.checkOut || '');
  if (days.length) {
    const bulk = days.map((d) => ({
      updateOne: {
        filter: { roomType: doc.roomType, date: d },
        update: { $set: { available: true, roomType: doc.roomType, date: d } },
        upsert: true,
      },
    }));
    await db.collection('availability').bulkWrite(bulk, { ordered: false });
  }
  return { ok: true };
}

// ---- Function calling ----

export function functionDeclarations() {
  return [
    {
      name: 'check_availability',
      description:
        'Consulta la disponibilidad de habitaciones para un rango de fechas y un tipo de habitación (private o dorm). Úsala cuando el usuario pregunte por disponibilidad, cupo, lugar, o si una fecha está libre. NO crea ninguna reserva.',
      parameters: {
        type: 'OBJECT',
        properties: {
          checkIn: { type: 'string', description: 'Fecha de entrada en formato YYYY-MM-DD' },
          checkOut: { type: 'string', description: 'Fecha de salida en formato YYYY-MM-DD' },
          roomType: { type: 'string', enum: ROOM_TYPES, description: 'Tipo de habitación: private (privada) o dorm (compartida)' },
        },
        required: ['checkIn', 'checkOut', 'roomType'],
      },
    },
    {
      name: 'create_reservation',
      description:
        'Crea una reserva DEFINITIVA en la base de datos. Úsala SOLO cuando tengas TODOS los datos requeridos (nombre, apellido, fecha de check-in, fecha de check-out, tipo de habitación y cantidad de personas) Y el usuario haya confirmado el pedido. Si falta algún dato o no hay confirmación, pídelo al usuario antes de llamar a esta función.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'string', description: 'Nombre del cliente' },
          surname: { type: 'string', description: 'Apellido del cliente' },
          checkIn: { type: 'string', description: 'Fecha de entrada en formato YYYY-MM-DD' },
          checkOut: { type: 'string', description: 'Fecha de salida en formato YYYY-MM-DD' },
          roomType: { type: 'string', enum: ROOM_TYPES, description: 'Tipo de habitación: private (privada) o dorm (compartida)' },
          guests: { type: 'integer', description: 'Cantidad de personas' },
        },
        required: ['name', 'surname', 'checkIn', 'checkOut', 'roomType', 'guests'],
      },
    },
  ];
}

export async function executeFunction(name, args) {
  switch (name) {
    case 'check_availability': {
      const { checkIn, checkOut, roomType } = args || {};
      if (!isValidDate(checkIn) || !isValidDate(checkOut)) return { error: 'Fechas inválidas. Usa el formato YYYY-MM-DD.' };
      if (!ROOM_TYPES.includes(roomType)) return { error: 'Tipo de habitación inválido. Usa private o dorm.' };
      const days = datesInRange(checkIn, checkOut);
      const map = await getAvailabilityMap(roomType, days);
      const blocked = days.filter((d) => map.get(d) === false);
      return {
        roomType,
        checkIn,
        checkOut,
        available: blocked.length === 0,
        availableDates: days.filter((d) => map.get(d) !== false),
        unavailableDates: blocked,
        message: blocked.length
          ? `No disponible en ${ROOM_LABELS[roomType]} para: ${blocked.join(', ')}.`
          : `Hay disponibilidad en ${ROOM_LABELS[roomType]} para todas las fechas solicitadas.`,
      };
    }
    case 'create_reservation':
      return createReservation(args || {});
    default:
      return { error: `Función desconocida: ${name}` };
  }
}