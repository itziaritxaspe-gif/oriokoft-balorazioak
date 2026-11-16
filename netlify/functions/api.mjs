
import { createSign } from 'node:crypto';

// GOOGLE SHEETS KONFIGURAZIOA

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ?.replace(/\\n/g, '\n');

const reply = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });

const b64 = x =>
  Buffer.from(JSON.stringify(x)).toString('base64url');

// GOOGLE AUTENTIFIKAZIOA

async function token() {
  if (!SHEET_ID || !EMAIL || !PRIVATE_KEY) {
    throw Error('Google konfigurazioa falta da');
  }

  const now = Math.floor(Date.now() / 1000);

  const unsigned =
    `${b64({ alg: 'RS256', typ: 'JWT' })}.` +
    b64({
      iss: EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3300
    });

  const sig = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(PRIVATE_KEY)
    .toString('base64url');

  const body = new URLSearchParams({
    grant_type:
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${sig}`
  });

  const r = await fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded'
      },
      body
    }
  );

  if (!r.ok) {
    throw Error('Google token: ' + r.status);
  }

  return (await r.json()).access_token;
}

// GOOGLE SHEETSETIK IRAKURRI

async function values(range, auth) {
  const u =
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${encodeURIComponent(SHEET_ID)}/values/` +
    `${encodeURIComponent(range)}`;

  const r = await fetch(u, {
    headers: {
      Authorization: `Bearer ${auth}`
    }
  });

  if (!r.ok) {
    console.error('Google Sheets read error:', r.status);
    throw Error('Google Sheets read: ' + r.status);
  }

  return (await r.json()).values ?? [];
}

// GOOGLE SHEETSEN GORDE

async function append(range, rows, auth) {
  const u =
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${encodeURIComponent(SHEET_ID)}/values/` +
    `${encodeURIComponent(range)}` +
    `:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  const r = await fetch(u, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: rows
    })
  });

  if (!r.ok) {
    console.error('Google Sheets write error:', r.status);
    throw Error('Google Sheets write: ' + r.status);
  }
}

// PARTIDAREN DATA IRAKURRI

function parseDate(x) {
  const s = String(x ?? '').trim();

  let m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/
  );

  let year, month, day;

  if (m) {
    day = +m[1];
    month = +m[2];
    year = +m[3];
  } else {
    m = s.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T|\s|$)/
    );

    if (!m) return null;

    year = +m[1];
    month = +m[2];
    day = +m[3];
  }

  const d = new Date(Date.UTC(year, month - 1, day));

  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }

  return (
    `${year}-` +
    `${String(month).padStart(2, '0')}-` +
    `${String(day).padStart(2, '0')}`
  );
}

// GAURKO DATA: EUROPE/MADRID

function todayMadrid() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(new Date())
      .map(x => [x.type, x.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

// TESTUAK SEGURTASUNEZ GORDE

function sanitize(x) {
  let s = String(x ?? '').trim().slice(0, 1000);

  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }

  return s;
}

// TALDEAK ETA PARTIDAK KARGATU

async function loadData(auth) {
  const [teamRows, gameRows] = await Promise.all([
    values('Taldeak!A2:B', auth),
    values('Partidak!A2:E', auth)
  ]);

  const taldeak = teamRows
    .filter(r => r[0] && r[1])
    .map(r => ({
      id: String(r[0]).trim(),
      izena: String(r[1]).trim()
    }));

  const validTeams = new Set(
    taldeak.map(t => t.id)
  );

  const now = todayMadrid();

  const partidak = gameRows
    .filter(
      r =>
        r[0] &&
        r[1] &&
        String(r[3] ?? '').trim().toUpperCase() ===
          'IREKITA'
    )
    .map(r => ({
      id: String(r[0]).trim(),
      izena: String(r[1]).trim(),
      data: String(r[2] ?? ''),
      dataISO: parseDate(r[2]),
      taldeId: String(r[4] ?? '').trim()
    }))
    .filter(
      p =>
        validTeams.has(p.taldeId) &&
        p.dataISO &&
        p.dataISO <= now
    )
    .sort(
      (a, b) =>
        b.dataISO.localeCompare(a.dataISO) ||
        a.id.localeCompare(b.id)
    );

  return {
    taldeak,
    partidak
  };
}

// BALORAZIOAK BALIOZTATU

const ratingKeys = [
  'mentala',
  'fisikoa',
  'ahalegina',
  'jarduna',
  'taktika',
  'taldea'
];

function validRatings(data) {
  return ratingKeys.every(
    key =>
      Number.isInteger(data[key]) &&
      data[key] >= 1 &&
      data[key] <= 5
  );
}

// API NAGUSIA

export default async function handler(request) {
  if (!['GET', 'POST'].includes(request.method)) {
    return reply(
      { error: 'Metodoa ez da onartzen' },
      405
    );
  }

  try {
    const auth = await token();
    const model = await loadData(auth);

    // TALDEAK ETA PARTIDAK
    if (request.method === 'GET') {
      return reply(model);
    }

    // MEZUAREN TAMAINA
    if (
      Number(request.headers.get('content-length') ?? 0)
      > 8000
    ) {
      return reply(
        { error: 'Mezua luzeegia da' },
        413
      );
    }

    const raw = await request.text();

    if (raw.length > 8000) {
      return reply(
        { error: 'Mezua luzeegia da' },
        413
      );
    }

    // JSON IRAKURRI
    let d;

    try {
      d = JSON.parse(raw);
    } catch {
      return reply(
        { error: 'JSON okerra' },
        400
      );
    }

    if (
      !d ||
      typeof d !== 'object' ||
      Array.isArray(d)
    ) {
      return reply(
        { error: 'Datu okerrak' },
        400
      );
    }

    // PARTIDA ETA TALDEA EGIAZTATU
    const game = model.partidak.find(
      g =>
        g.id === d.partidaId &&
        g.taldeId === d.taldeId
    );

    if (!game) {
      return reply(
        {
          error:
            'Partida itxita dago edo ez da talde honetakoa'
        },
        400
      );
    }

    // SEI BALORAZIOAK EGIAZTATU
    if (!validRatings(d)) {
      return reply(
        {
          error:
            'Balorazio guztiak 1etik 5era izan behar dira'
        },
        400
      );
    }

    // SENTSAZIOA EGIAZTATU
    if (
      ![
        'Oso ondo',
        'Ondo',
        'Hala-hola',
        'Gaizki'
      ].includes(d.sentsazioa)
    ) {
      return reply(
        { error: 'Sentsazioa aukeratu' },
        400
      );
    }

    // GOOGLE SHEETSEN GORDE
    // A:K = LEHENGO ZUTABEAK
    // L = MENTALA
    // M = FISIKOA

    await append(
      'Erantzunak!A:M',
      [[
        game.id,              // A - Partida ID
        game.izena,           // B - Partida
        d.ahalegina,          // C - Ahalegina
        d.jarduna,            // D - Jarduna
        d.taktika,            // E - Taktika
        d.taldea,             // F - Taldea
        d.sentsazioa,         // G - Sentsazioa
        sanitize(d.ondo),     // H - Ondo
        sanitize(d.hobetu),   // I - Hobetu
        sanitize(d.oharrak),  // J - Oharrak
        game.taldeId,         // K - Talde ID
        d.mentala,            // L - Mentala
        d.fisikoa            // M - Fisikoa
      ]],
      auth
    );

    return reply({ ok: true });

  } catch (err) {
    console.error('API error:', err.message);

    return reply(
      {
        error:
          'Zerbitzariaren errorea. Egiaztatu konfigurazioa.'
      },
      500
    );
  }
}
