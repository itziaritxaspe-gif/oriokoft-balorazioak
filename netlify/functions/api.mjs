import { createSign } from 'node:crypto';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const json = (obj, status=200) => new Response(JSON.stringify(obj), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const enc = (s) => Buffer.from(JSON.stringify(s)).toString('base64url');

async function token() {
  if (!SPREADSHEET_ID || !SA_EMAIL || !SA_KEY) throw new Error('Netlify ingurune-aldagaiak falta dira.');
  const now = Math.floor(Date.now()/1000);
  const input = `${enc({alg:'RS256',typ:'JWT'})}.${enc({iss:SA_EMAIL,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500})}`;
  const sig = createSign('RSA-SHA256').update(input).sign(SA_KEY).toString('base64url');
  const body = new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${input}.${sig}`});
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  if (!r.ok) throw new Error('Google autentifikazioak huts egin du: '+r.status);
  return (await r.json()).access_token;
}
async function sheet(range, accessToken, opts={}) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}/values/${encodeURIComponent(range)}${opts.append?':append':''}`+(opts.append?'?valueInputOption=RAW&insertDataOption=INSERT_ROWS':'');
  const response = await fetch(url,{method:opts.append?'POST':'GET',headers:{Authorization:`Bearer ${accessToken}`,...(opts.append?{'Content-Type':'application/json'}:{})},...(opts.append?{body:JSON.stringify({values:opts.values})}:{})});
  if(!response.ok) throw new Error('Google Sheets errorea: '+response.status);
  return response.json();
}
function sanitize(x) {
  let s = String(x??'').trim().slice(0,1000);
  // Inhibit formula interpretation even if exported elsewhere.
  if(/^[=+\-@\t\r]/.test(s)) s="'"+s;
  return s;
}
async function openGames(auth) {
  const result = await sheet('Partidak!A2:D',auth);
  return (result.values??[]).filter(r=>String(r[3]??'').trim().toUpperCase()==='IREKITA' && r[0] && r[1])
  .map(r=>({id:String(r[0]).trim(),izena:String(r[1]).trim()}));
}
export default async (request) => {
  try {
    if(request.method!=='GET' && request.method!=='POST') return json({error:'Metodoa ez da onartzen'},405);
    const auth = await token();
    if(request.method==='GET') return json({partidak:await openGames(auth)});
    const limit = Number(request.headers.get('content-length')??0);
    if(limit>8000) return json({error:'Mezua luzeegia da'},413);
    const raw = await request.text();
    if(raw.length>8000) return json({error:'Mezua luzeegia da'},413);
    let d; try {d=JSON.parse(raw);} catch {return json({error:'JSON okerra'},400);}
    if(!d || typeof d!=='object') return json({error:'Datu okerrak'},400);
    const fields=['ahalegina','jarduna','taktika','taldea'];
    if(fields.some(k=>!Number.isInteger(d[k]) || d[k]<1 || d[k]>5)) return json({error:'Balorazioak 1etik 5era izan behar dira'},400);
    if(!['Oso ondo','Ondo','Hala-hola','Gaizki'].includes(d.sentsazioa)) return json({error:'Sentsazioa aukeratu'},400);
    const games=await openGames(auth);
    const game=games.find(g=>g.id===String(d.partidaId??''));
    if(!game) return json({error:'Partida itxita dago edo ez da existitzen'},400);
    await sheet('Erantzunak!A:J',auth,{append:true,values:[[game.id,game.izena,d.ahalegina,d.jarduna,d.taktika,d.taldea,d.sentsazioa,sanitize(d.ondo),sanitize(d.hobetu),sanitize(d.oharrak)]]});
    return json({ok:true});
  } catch(err) {
    console.error('API error',err);
    return json({error:'Zerbitzariaren errorea. Egiaztatu konfigurazioa edo saiatu berriro.'},500);
  }
};
