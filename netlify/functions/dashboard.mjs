import {createSign, createHash, timingSafeEqual} from 'node:crypto';
const reply=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function equal(a,b){return timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());}
async function token(){
 const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!email||!key||!process.env.GOOGLE_SHEET_ID)throw Error('Google konfigurazioa falta da');
 const now=Math.floor(Date.now()/1000);
 const unsigned=`${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3300})}`;
 const sig=createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${sig}`})});
 if(!r.ok)throw Error('Google token: '+r.status);
 return (await r.json()).access_token;
}
async function values(range,auth){const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(process.env.GOOGLE_SHEET_ID)}/values/${encodeURIComponent(range)}`;const r=await fetch(url,{headers:{Authorization:`Bearer ${auth}`}});if(!r.ok)throw Error('Google Sheets: '+r.status);return (await r.json()).values??[];}
function mean(rows,i){return Number((rows.reduce((sum,row)=>sum+Number(row[i]),0)/rows.length).toFixed(2));}
function counts(rows){return Object.fromEntries(['Oso ondo','Ondo','Hala-hola','Gaizki'].map(v=>[v,rows.filter(r=>r[6]===v).length]));}
export default async function handler(request){
 if(request.method!=='POST')return reply({error:'Metodoa ez da onartzen'},405);
 if(Number(request.headers.get('content-length')??0)>2048)return reply({error:'Eskaera luzeegia'},413);
 let body;try{const raw=await request.text();if(raw.length>2048)return reply({error:'Eskaera luzeegia'},413);body=JSON.parse(raw);}catch{return reply({error:'Eskaera okerra'},400);}
 const pwd=body?.password;
 if(typeof pwd!=='string'||pwd.length>200)return reply({error:'Pasahitz okerra'},401);
 let passwords={};try{passwords=JSON.parse(process.env.TEAM_PASSWORDS_JSON||'{}');}catch{console.error('TEAM_PASSWORDS_JSON JSON okerra');return reply({error:'Pasahitzen konfigurazioa okerra da'},503);}
 const admin=process.env.ADMIN_DASHBOARD_PASSWORD;
 let allowedId=null,adminMode=false;
 if(typeof admin==='string'&&admin.length>=12&&equal(pwd,admin)){adminMode=true;}
 else for(const [id,secret] of Object.entries(passwords)) {
   if(typeof secret==='string'&&secret.length>=12&&equal(pwd,secret)){allowedId=id;break;}
 }
 if(!adminMode&&!allowedId)return reply({error:'Pasahitz okerra'},401);
 try {
  const auth=await token();
  const [teamRows,gameRows,answerRows]=await Promise.all([values('Taldeak!A2:B',auth),values('Partidak!A2:E',auth),values('Erantzunak!A2:K',auth)]);
  const teams=teamRows.filter(r=>r[0]&&r[1]).map(r=>({id:String(r[0]).trim(),izena:String(r[1]).trim()}));
  const authorized=adminMode?teams:teams.filter(t=>t.id===allowedId);
  const valid=new Set(authorized.map(t=>t.id));
  const gameIds=new Map(gameRows.filter(r=>r[0]&&r[4]).map(r=>[String(r[0]).trim(),String(r[4]).trim()]));
  const result=gameRows.filter(g=>g[0]&&g[1]&&valid.has(String(g[4]??'').trim())).map(g=>{
    const id=String(g[0]).trim(),teamId=String(g[4]).trim();
    const rows=answerRows.filter(r=>String(r[0]??'').trim()===id && (String(r[10]??'').trim()||gameIds.get(id))===teamId && [2,3,4,5].every(i=>Number.isInteger(Number(r[i]))&&Number(r[i])>=1&&Number(r[i])<=5));
    const safe=rows.length>=5;
    return {id,izena:String(g[1]),data:String(g[2]??''),egoera:String(g[3]??''),taldeId:teamId,kopurua:rows.length,...(safe?{batezbestekoak:{ahalegina:mean(rows,2),jarduna:mean(rows,3),taktika:mean(rows,4),taldea:mean(rows,5)},sentsazioak:counts(rows),testuak:{ondo:rows.map(r=>r[7]??'').filter(Boolean),hobetu:rows.map(r=>r[8]??'').filter(Boolean),oharrak:rows.map(r=>r[9]??'').filter(Boolean)}}:{})};
  });
  return reply({admin:adminMode,taldeak:authorized,partidak:result});
 }catch(err){console.error('Dashboard error:',err.message);return reply({error:'Ezin izan dira datuak eskuratu'},500);}
}
