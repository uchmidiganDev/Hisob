import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {authenticate,openDB,register,snapshot,validateEntry,fail,schedule,localDate} from './core.js';
const TOKEN=process.env.BOT_TOKEN||'',APP_URL=(process.env.APP_URL||'').replace(/\/$/,'');
const allowed=new Set((process.env.ALLOWED_USER_IDS||'').split(',').filter(Boolean).map(Number));
if(process.env.NODE_ENV==='production'&&(!TOKEN||!APP_URL.startsWith('https://')||!process.env.DB_PATH))throw new Error('BOT_TOKEN, HTTPS APP_URL and persistent DB_PATH required');
const db=openDB(process.env.DB_PATH||'./data/app.sqlite');
const staticFiles=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]].map(([url,[name,type]])=>[url,{body:readFileSync(fileURLToPath(new URL('./public/'+name,import.meta.url))),type}]));
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function body(req){let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>16384)fail('Ma’lumot juda katta.',413);}try{return JSON.parse(raw);}catch{fail('Yaroqsiz JSON.');}}
const limits=new Map();
function rate(id){const now=Date.now(),v=limits.get(id);if(!v||now-v.start>60000){limits.set(id,{start:now,count:1});return;}if(++v.count>120)fail('Biroz kutib qayta urinib ko‘ring.',429);}
setInterval(()=>{for(const [k,v]of limits)if(Date.now()-v.start>60000)limits.delete(k);},60000).unref();
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org");
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/health'){db.prepare('SELECT 1').get();return json(res,200,{ok:true});}
  if(staticFiles.has(path)&&req.method==='GET'){const f=staticFiles.get(path);res.writeHead(200,{'Content-Type':f.type});return res.end(f.body);}
  if(!path.startsWith('/api/'))return json(res,404,{error:'Topilmadi.'});
  const u=authenticate(req.headers['x-telegram-init-data'],TOKEN);
  if(allowed.size&&!allowed.has(u.id))fail('Bu botga kirish ruxsati yo‘q.',403);
  rate(u.id);register(db,u);
  if(path==='/api/state'&&req.method==='GET')return json(res,200,snapshot(db,u.id));
  if(path==='/api/settings'&&req.method==='PATCH'){
   const b=await body(req);if(typeof b.reports!=='boolean'||typeof b.reminders!=='boolean')fail('Sozlamalar noto‘g‘ri.');
   db.prepare('UPDATE users SET reports=?,reminders=? WHERE id=?').run(+b.reports,+b.reminders,u.id);
   if(!b.reports)db.prepare("DELETE FROM outbox WHERE user_id=? AND kind='report' AND sent=0").run(u.id);
   if(!b.reminders)db.prepare("DELETE FROM outbox WHERE user_id=? AND kind='debt' AND sent=0").run(u.id);
   return json(res,200,{ok:true});
  }
  const match=path.match(/^\/api\/(debts|expenses)(?:\/(\d+))?$/);
  if(!match)fail('Topilmadi.',404);
  const [,kind,idRaw]=match,id=Number(idRaw);
  if(req.method==='POST'&&!idRaw){
   const v=validateEntry(await body(req),kind);
   const result=kind==='debts'?db.prepare('INSERT INTO debts(user_id,title,person,amount,date,due_date,direction) VALUES(?,?,?,?,?,?,?)').run(u.id,v.title,v.person,v.amount,v.date,v.dueDate,v.direction):db.prepare('INSERT INTO expenses(user_id,title,amount,date,category) VALUES(?,?,?,?,?)').run(u.id,v.title,v.amount,v.date,v.category);
   return json(res,201,{id:Number(result.lastInsertRowid)});
  }
  if(!Number.isSafeInteger(id)||id<=0)fail('Topilmadi.',404);
  const existing=db.prepare(`SELECT * FROM ${kind} WHERE id=? AND user_id=?`).get(id,u.id);
  if(!existing)fail('Topilmadi.',404);
  if(req.method==='DELETE'){
   db.prepare(`DELETE FROM ${kind} WHERE id=? AND user_id=?`).run(id,u.id);
   if(kind==='debts')db.prepare("DELETE FROM outbox WHERE user_id=? AND ref_id=? AND kind='debt' AND sent=0").run(u.id,id);
   return json(res,200,{ok:true});
  }
  if(req.method==='PATCH'&&kind==='debts'){
   const b=await body(req);if(typeof b.paid!=='boolean')fail('Holat noto‘g‘ri.');
   db.prepare('UPDATE debts SET paid=? WHERE id=? AND user_id=?').run(+b.paid,id,u.id);
   if(b.paid)db.prepare("DELETE FROM outbox WHERE user_id=? AND ref_id=? AND kind='debt' AND sent=0").run(u.id,id);
   return json(res,200,{ok:true});
  }
  if(req.method==='PUT'){
   const v=validateEntry(await body(req),kind);
   if(kind==='debts'){
    db.prepare('UPDATE debts SET title=?,person=?,amount=?,date=?,due_date=?,direction=? WHERE id=? AND user_id=?').run(v.title,v.person,v.amount,v.date,v.dueDate,v.direction,id,u.id);
    db.prepare("DELETE FROM outbox WHERE user_id=? AND ref_id=? AND kind='debt' AND sent=0").run(u.id,id);
   }else db.prepare('UPDATE expenses SET title=?,amount=?,date=?,category=? WHERE id=? AND user_id=?').run(v.title,v.amount,v.date,v.category,id,u.id);
   return json(res,200,{ok:true});
  }
  fail('Amal mavjud emas.',405);
 }catch(e){json(res,e.status||500,{error:e.status?e.message:'Server xatosi. Qayta urinib ko‘ring.'});if(!e.status)console.error('Request failed:',e.name);}
});
async function telegram(method,payload){
 // Never log request URLs: they contain the bot token.
 const response=await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(40000)});
 const data=await response.json();if(!data.ok)throw Object.assign(new Error('Telegram request failed'),{code:data.error_code,retry:data.parameters?.retry_after});return data.result;
}
let stopped=false;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function polling(){
 let configured=false;
 while(!stopped){
  try{
   if(!configured){
    await telegram('deleteWebhook',{drop_pending_updates:false});
    await telegram('setMyCommands',{commands:[{command:'start',description:'Mini App’ni ochish'},{command:'help',description:'Yordam'},{command:'stop',description:'Xabarlarni to‘xtatish'}]});
    await telegram('setChatMenuButton',{menu_button:{type:'web_app',text:'Hisob-kitob',web_app:{url:APP_URL}}});configured=true;
   }
   const offset=Number(db.prepare("SELECT value FROM state WHERE key='offset'").get()?.value||0);
   const updates=await telegram('getUpdates',{offset,timeout:25,allowed_updates:['message']});
   for(const update of updates){
    const m=update.message;
    if(m?.chat.type==='private'&&m.from&&!m.from.is_bot&&(!allowed.size||allowed.has(m.from.id))){
     register(db,m.from,m.chat.id);
     const cmd=(m.text||'').split(' ')[0];
     if(cmd==='/stop'){
      db.prepare('UPDATE users SET reports=0,reminders=0 WHERE id=?').run(m.from.id);
      db.prepare('DELETE FROM outbox WHERE user_id=? AND sent=0').run(m.from.id);
      await telegram('sendMessage',{chat_id:m.chat.id,text:'Xabarlar to‘xtatildi. /start orqali qayta yoqishingiz mumkin.'});
     }else if(cmd==='/start'||cmd==='/help'){
      if(cmd==='/start')db.prepare('UPDATE users SET reports=1,reminders=1 WHERE id=?').run(m.from.id);
      await telegram('sendMessage',{chat_id:m.chat.id,text:'Hisob-kitobga xush kelibsiz!\n\nQarz va xarajatlaringizni Mini App’da yozing.\n⏰ Qarzlar: muddat kuni 09:00, kechiksa har kuni.\n📊 Hisobotlar: 00:00 da kunlik; oy va yil yakunida qo‘shimcha hisobot.\nVaqt: Toshkent. Valyuta: so‘m.\n/stop — xabarlarni o‘chirish.',reply_markup:{inline_keyboard:[[{text:'💚 Hisob-kitobni ochish',web_app:{url:APP_URL}}]]}});
     }
    }
    db.prepare("INSERT INTO state(key,value) VALUES('offset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(update.update_id+1));
   }
  }catch(e){console.error('Bot retry:',e.code||e.name);await wait(5000);}
 }
}
async function jobs(){
 while(!stopped){
  try{
   schedule(db);
   const pending=db.prepare('SELECT o.*,u.chat_id,u.reports,u.reminders FROM outbox o JOIN users u ON u.id=o.user_id WHERE o.sent=0 AND o.next_at<=? ORDER BY o.rowid LIMIT 30').all(Date.now());
   for(const item of pending){
    if(!item.chat_id||(item.kind==='report'&&!item.reports)||(item.kind==='debt'&&(!item.reminders||!db.prepare('SELECT id FROM debts WHERE id=? AND paid=0').get(item.ref_id)))){db.prepare('UPDATE outbox SET sent=1 WHERE key=?').run(item.key);continue;}
    try{await telegram('sendMessage',{chat_id:item.chat_id,text:item.text});db.prepare('UPDATE outbox SET sent=1 WHERE key=?').run(item.key);await wait(60);}
    catch(e){
     if(e.code===403){db.prepare('UPDATE users SET chat_id=NULL WHERE id=?').run(item.user_id);}
     const seconds=e.retry||Math.min(3600,30*2**Math.min(item.attempts,7));
     db.prepare('UPDATE outbox SET attempts=attempts+1,next_at=? WHERE key=?').run(Date.now()+seconds*1000,item.key);
    }
   }
  }catch(e){console.error('Scheduler retry:',e.name);}
  await wait(10000);
 }
}
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Hisob-kitob server ready'));
if(TOKEN&&APP_URL){polling();jobs();}else console.log('Bot disabled until BOT_TOKEN and APP_URL are configured.');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;server.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(0),5000).unref();});
