import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
const token='123:test-only-token';
function signed(id){const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Test'})});const s=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');p.set('hash',createHmac('sha256',createHmac('sha256','WebAppData').update(token).digest()).update(s).digest('hex'));return p.toString();}
test('Authenticated CRUD, cross-user protection and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hisob-')),port=19384;
 let proc;
 async function start(){proc=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',BOT_TOKEN:token,APP_URL:'',PORT:String(port),DB_PATH:join(dir,'test.sqlite')},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{proc.stdout.on('data',d=>{if(d.toString().includes('server ready'))resolve();});proc.on('error',reject);proc.on('exit',()=>reject(Error('server exited')));});}
 async function stop(){await new Promise(r=>{proc.once('exit',r);proc.kill('SIGTERM');});}
 async function request(path,method='GET',data,id=1){const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{'X-Telegram-Init-Data':id?signed(id):'','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json()};}
 try{await start();assert.equal((await request('/api/state','GET',null,0)).status,401);await request('/api/state');const created=await request('/api/expenses','POST',{title:'Non',amount:'12000.50',date:'2026-01-01',category:'Food'});assert.equal(created.status,201);const id=created.body.id;assert.equal((await request('/api/state')).body.expenses[0].amount,1200050);assert.equal((await request('/api/expenses/'+id,'DELETE',null,2)).status,404);assert.equal((await request('/api/state','GET',null,2)).body.expenses.length,0);assert.equal((await request('/api/expenses/'+id,'PUT',{title:'Non',amount:'5000',date:'2026-01-01'})).status,200);const debt=await request('/api/debts','POST',{title:'Telefon',person:'Ali',amount:'100',date:'2026-01-01',dueDate:'2026-02-01'});await request('/api/debts/'+debt.body.id,'PATCH',{paid:true});assert.equal((await request('/api/state')).body.debts[0].paid,1);await stop();await start();assert.equal((await request('/api/state')).body.expenses[0].amount,500000);assert.equal((await request('/api/expenses/'+id,'DELETE')).status,200);assert.equal((await request('/api/state')).body.expenses.length,0);}finally{if(proc?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});
