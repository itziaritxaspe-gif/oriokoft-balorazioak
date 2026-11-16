
import {
  createSign,
  createHash,
  timingSafeEqual
} from 'node:crypto';

// RESPUESTAS JSON

const reply = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff'
    }
  });

const b64 = x =>
  Buffer.from(JSON.stringify(x)).toString('base64url');

// PASAHITZAK KONPARATU

function equal(a, b) {
  return timingSafeEqual(
    createHash('sha256').update(String(a)).digest(),
    createHash('sha256').update(String(b)).digest()
  );
}

// GOOGLE AUTENTIFIKAZIOA

async function token() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  const key = process.env.GOOGLE_PRIVATE_KEY
    ?.replace(/\\n/g, '\n');

  if (
    !email ||
    !key ||
    !process.env.GOOGLE_SHEET_ID
  ) {
    throw Error('Google konfigurazioa falta da');
  }

  const now = Math.floor(Date.now() / 1000);

  const unsigned =
    `${b64({ alg: 'RS256', typ: 'JWT' })}.` +
    b64({
      iss: email,
      scope:
        'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3300
    });

  const sig = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(key)
    .toString('base64url');

  const r = await fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type:
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${sig}`
      })
    }
  );

  if (!r.ok) {
    throw Error('Google token: ' + r.status);
  }

  return (await r.json()).access_token;
}

// GOOGLE SHEETSETIK DATUAK IRAKURRI

async function values(range, auth) {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${encodeURIComponent(process.env.GOOGLE_SHEET_ID)}` +
    `/values/${encodeURIComponent(range)}`;

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${auth}`
    }
  });

  if (!r.ok) {
    throw Error('Google Sheets: ' + r.status);
  }

  return (await r.json()).values ?? [];
}

// BALORAZIO ZUZENA DEN EGIAZTATU

function validRating(value) {
  // Hutsik dauden gelaxkak ez dira zero gisa kontatuko.
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  ) {
    return false;
  }

  const number = Number(value);

  return (
    Number.isInteger(number) &&
    number >= 1 &&
    number <= 5
  );
}

// BATEZ BESTEKOA KALKULATU

function mean(rows, column) {
  const validRows = rows.filter(
    row => validRating(row[column])
  );

  if (!validRows.length) {
    return null;
  }

  const total = validRows.reduce(
    (sum, row) => sum + Number(row[column]),
    0
  );

  return Number(
    (total / validRows.length).toFixed(2)
  );
}

// GUTXIENEZ 5 ERANTZUN BEHAR DIRA
// BALORAZIO BERRIA ERAKUSTEKO

function protectedMean(rows, column) {
  const validRows = rows.filter(
    row => validRating(row[column])
  );

  if (validRows.length < 5) {
    return null;
  }

  return mean(validRows, column);
}

// SENTSAZIOEN KOPURUAK

function counts(rows) {
  const options = [
    'Oso ondo',
    'Ondo',
    'Hala-hola',
    'Gaizki'
  ];

  return Object.fromEntries(
    options.map(value => [
      value,
      rows.filter(row => row[6] === value).length
    ])
  );
}

// DASHBOARD NAGUSIA

export default async function handler(request) {

  // POST SOILIK
  if (request.method !== 'POST') {
    return reply(
      { error: 'Metodoa ez da onartzen' },
      405
    );
  }

  // ESKAERAREN TAMAINA
  if (
    Number(request.headers.get('content-length') ?? 0)
      > 2048
  ) {
    return reply(
      { error: 'Eskaera luzeegia' },
      413
    );
  }

  let body;

  try {
    const raw = await request.text();

    if (raw.length > 2048) {
      return reply(
        { error: 'Eskaera luzeegia' },
        413
      );
    }

    body = JSON.parse(raw);

  } catch {
    return reply(
      { error: 'Eskaera okerra' },
      400
    );
  }

  // PASAHITZA IRAKURRI

  const pwd = body?.password;

  if (
    typeof pwd !== 'string' ||
    pwd.length > 200
  ) {
    return reply(
      { error: 'Pasahitz okerra' },
      401
    );
  }

  // TALDEEN PASAHITZAK

  let passwords = {};

  try {
    passwords = JSON.parse(
      process.env.TEAM_PASSWORDS_JSON || '{}'
    );

    if (
      !passwords ||
      typeof passwords !== 'object' ||
      Array.isArray(passwords)
    ) {
      throw Error('JSON okerra');
    }

  } catch {
    console.error('TEAM_PASSWORDS_JSON JSON okerra');

    return reply(
      { error: 'Pasahitzen konfigurazioa okerra da' },
      503
    );
  }

  // ADMINISTRATZAILEAREN PASAHITZA

  const admin =
    process.env.ADMIN_DASHBOARD_PASSWORD;

  let allowedId = null;
  let adminMode = false;

  if (
    typeof admin === 'string' &&
    admin.length >= 12 &&
    equal(pwd, admin)
  ) {
    adminMode = true;

  } else {

    for (const [id, secret] of Object.entries(passwords)) {

      if (
        typeof secret === 'string' &&
        secret.length >= 12 &&
        equal(pwd, secret)
      ) {
        allowedId = id;
        break;
      }
    }
  }

  // SARBIDEA UKATU

  if (!adminMode && !allowedId) {
    return reply(
      { error: 'Pasahitz okerra' },
      401
    );
  }

  try {

    // GOOGLE SHEETS KONEKTATU

    const auth = await token();

    // TALDEAK, PARTIDAK ETA ERANTZUNAK

    const [
      teamRows,
      gameRows,
      answerRows
    ] = await Promise.all([
      values('Taldeak!A2:B', auth),
      values('Partidak!A2:E', auth),

      // ORAIN A:M IRAKURTZEN DUGU
      values('Erantzunak!A2:M', auth)
    ]);

    // TALDEAK

    const teams = teamRows
      .filter(row => row[0] && row[1])
      .map(row => ({
        id: String(row[0]).trim(),
        izena: String(row[1]).trim()
      }));

    // BAIMENDUTAKO TALDEAK

    const authorized = adminMode
      ? teams
      : teams.filter(team => team.id === allowedId);

    const valid = new Set(
      authorized.map(team => team.id)
    );

    // PARTIDA ETA TALDEAREN ERLAZIOA

    const gameIds = new Map(
      gameRows
        .filter(row => row[0] && row[4])
        .map(row => [
          String(row[0]).trim(),
          String(row[4]).trim()
        ])
    );

    // PARTIDEN EMAITZAK

    const result = gameRows
      .filter(
        game =>
          game[0] &&
          game[1] &&
          valid.has(
            String(game[4] ?? '').trim()
          )
      )
      .map(game => {

        const id = String(game[0]).trim();
        const teamId = String(game[4]).trim();

        // PARTIDA HONETAKO ERANTZUNAK

        const rows = answerRows.filter(row => {

          const answerGameId =
            String(row[0] ?? '').trim();

          const answerTeamId =
            String(row[10] ?? '').trim() ||
            gameIds.get(id);

          const originalRatingsValid =
            [2, 3, 4, 5].every(
              index => validRating(row[index])
            );

          return (
            answerGameId === id &&
            answerTeamId === teamId &&
            originalRatingsValid
          );
        });

        // ANONIMOTASUNA BABESTU

        const safe = rows.length >= 5;

        const base = {
          id,
          izena: String(game[1]),
          data: String(game[2] ?? ''),
          egoera: String(game[3] ?? ''),
          taldeId: teamId,
          kopurua: rows.length
        };

        if (!safe) {
          return base;
        }

        // BATEZ BESTEKOAK

        const averages = {
          // PARTIDA AURREKO GALDERAK
          mentala: protectedMean(rows, 11),
          fisikoa: protectedMean(rows, 12),

          // LEHENGO GALDERAK
          ahalegina: mean(rows, 2),
          jarduna: mean(rows, 3),
          taktika: mean(rows, 4),
          taldea: mean(rows, 5)
        };

        // SENTSAZIOAK

        const feelings = counts(rows);

        // JOKALARIEN IRUZKINAK

        const comments = {
          ondo: rows
            .map(row => row[7] ?? '')
            .filter(Boolean),

          hobetu: rows
            .map(row => row[8] ?? '')
            .filter(Boolean),

          oharrak: rows
            .map(row => row[9] ?? '')
            .filter(Boolean)
        };

        return {
          ...base,
          batezbestekoak: averages,
          sentsazioak: feelings,
          testuak: comments
        };

      });

    // EMAITZAK ITZULI

    return reply({
      admin: adminMode,
      taldeak: authorized,
      partidak: result
    });

  } catch (err) {

    console.error(
      'Dashboard error:',
      err.message
    );

    return reply(
      { error: 'Ezin izan dira datuak eskuratu' },
      500
    );
  }
}
