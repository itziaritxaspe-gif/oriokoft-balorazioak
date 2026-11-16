import { createSign, createHash, timingSafeEqual } from 'node:crypto';

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' }
});

function equalSecret(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  // Always compare fixed-length hashes to avoid leaking the length of the password.
  return timingSafeEqual(createHash('sha256').update(x).digest(), createHash('sha256').update(y).digest());
}

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }

async function googleToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key || !process.env.GOOGLE_SHEET_ID) throw new Error('Google konfigurazioa falta da');
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({alg:'RS256', typ:'JWT'})}.${b64({iss:email, scope:'https://www.googleapis.com/auth/spreadsheets.readonly', aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3000})}`;
  const signature = createSign('RSA-SHA256').update(input).sign(key).toString('base64url');
  const resp = await fetch('https://oauth2.googleapis.com/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion:`${input}.${signature}`})});
  if (!resp.ok) throw new Error(`Google token: ${resp.status}`);
  return (await resp.json()).access_token;
}

async function values(range, auth) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(process.env.GOOGLE_SHEET_ID)}/values/${encodeURIComponent(range)}`;
  const resp = await fetch(url, { headers: {Authorization:`Bearer ${auth}`} });
  if (!resp.ok) throw new Error(`Google Sheets: ${resp.status}`);
  return (await resp.json()).values ?? [];
}

const numeric = (v) => Number(v);
const mean = (rows, index) => Number((rows.reduce((sum,r) => sum + numeric(r[index]), 0) / rows.length).toFixed(2));
const counts = (rows, index) => Object.fromEntries(['Oso ondo', 'Ondo', 'Hala-hola', 'Gaizki'].map(s => [s, rows.filter(r => r[index] === s).length]));

export default async function dashboard(request) {
  if (request.method !== 'POST') return reply({error:'Metodoa ez da onartzen'},405);
  if (Number(request.headers.get('content-length') || 0) > 2048) return reply({error:'Eskaera handiegia'},413);
  if (!process.env.DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWORD.length < 12) {
    console.error('DASHBOARD_PASSWORD falta da edo laburregia da');
    return reply({error:'Panela konfiguratu gabe dago'},503);
  }
  let body;
  try { const text = await request.text(); if (text.length > 2048) return reply({error:'Eskaera handiegia'},413); body = JSON.parse(text); }
  catch { return reply({error:'Eskaera okerra'},400); }
  if (typeof body?.password !== 'string' || !equalSecret(body.password, process.env.DASHBOARD_PASSWORD)) {
    return reply({error:'Pasahitz okerra'},401);
  }
  try {
    const token = await googleToken();
    const [games, answers] = await Promise.all([values('Partidak!A2:D',token), values('Erantzunak!A2:J',token)]);
    const result = games.filter(g => g[0] && g[1]).map(g => {
      const id = String(g[0]).trim();
      const rows = answers.filter(r => String(r[0] ?? '').trim() === id && [2,3,4,5].every(i => Number.isInteger(numeric(r[i])) && numeric(r[i]) >= 1 && numeric(r[i]) <= 5));
      const safe = rows.length >= 5;
      return {
        id, izena:String(g[1]), data:String(g[2] ?? ''), egoera:String(g[3] ?? ''), kopurua:rows.length,
        // To preserve anonymity, individual responses are revealed only when at least 5 exist.
        ...(safe ? {
          batezbestekoak: {ahalegina:mean(rows,2), jarduna:mean(rows,3), taktika:mean(rows,4), taldea:mean(rows,5)},
          sentsazioak:counts(rows,6),
          testuak: {ondo:rows.map(r => String(r[7]??'').trim()).filter(Boolean), hobetu:rows.map(r => String(r[8]??'').trim()).filter(Boolean), oharrak:rows.map(r => String(r[9]??'').trim()).filter(Boolean)}
        } : {})
      };
    });
    return reply({partidak:result});
  } catch (err) {
    console.error('Dashboard error:',err.message);
    return reply({error:'Ezin izan dira datuak eskuratu'},500);
  }
}
