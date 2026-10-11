const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {mergeLocalEdits}=require('../sync-merge.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const bill=(month,paid=0)=>({month,id:month,rent:8000,elecBill:200,paid,lastOutstanding:0,totalDue:8200,outstanding:8200-paid});
const data=entries=>({schemaVersion:4,tenants:[{flat:'101',name:'Test tenant',dueDay:5,entries}],financeRecords:[]});
function harness(local,{base=null,version=1,dirty=true,stored=true}={}) {
  const store=new Map();if(stored)store.set('data',JSON.stringify(local));
  store.set('meta',JSON.stringify({version,dirty}));if(base)store.set('base',JSON.stringify(base));
  const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{style:{},textContent:'',value:'',disabled:false});return elements.get(id);};
  const timers=[];
  const ctx=vm.createContext({console,Date,TextEncoder,Response,URL,Blob,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},document:{getElementById:el,hidden:false},navigator:{onLine:true},location:{protocol:'https:'},toast(){}});
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const declarations=[...html.split('<script>')[1].split('</script>')[0].matchAll(/^(?:async )?function \w+\([^]*?^\}/gm)].map(m=>m[0]).join('\n');
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../sync-merge.js'),'utf8')+'\n'+declarations,ctx);
  vm.runInContext(`var DB=${JSON.stringify(local)};var STORE_KEY='data',CLOUD_META_KEY='meta',CLOUD_BASE_KEY='base',SYNC_RECOVERY_KEY='recovery',UNDO_KEY='undo',CLOUD_API='/api/data';var appUnlocked=true,cloudSyncInProgress=false,cloudSyncStarted=false,cloudSyncState='not_checked',cloudSyncMessage='',cloudSyncTimer=null,lastSavedSnapshot=${JSON.stringify(JSON.stringify(local))},undoStack=[];renderHome=()=>{};renderBackupInfo=()=>{};syncAttachmentFiles=async()=>{};`,ctx);
  return {ctx,store,timers,run:code=>vm.runInContext(code,ctx),json:code=>clone(vm.runInContext(code,ctx)),fetch(fn){ctx.fetch=fn;}};
}
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('local bill edits win; unrelated remote months and expenses survive',()=>{
 const base=data([bill('2026-08')]);const local=clone(base),remote=clone(base);local.tenants[0].entries[0]=bill('2026-08',7000);local.tenants[0].entries.push(bill('2026-09',8000));remote.tenants[0].entries[0]=bill('2026-08',5000);remote.tenants[0].entries.push(bill('2026-10',3000));remote.financeRecords.push({id:'x',amount:100});
 const merged=mergeLocalEdits(base,local,remote);assert.equal(merged.tenants[0].entries[0].paid,7000);assert.equal(merged.tenants[0].entries.length,3);assert.equal(merged.financeRecords.length,1);
});
test('explicit local deletions survive reconciliation with unrelated remote edits',()=>{
 const base=data([bill('2026-08'),bill('2026-09')]),local=clone(base),remote=clone(base);local.tenants[0].entries.pop();remote.financeRecords.push({id:'x'});assert.deepEqual(mergeLocalEdits(base,local,remote).tenants[0].entries,[bill('2026-08')]);
});
test('offline saves stay dirty and online sync uploads without another PIN',async()=>{
 const base=data([bill('2026-08')]),local=data([bill('2026-08',8000),bill('2026-09',5000)]);const h=harness(local,{base});h.run('navigator.onLine=false');assert.equal(await h.run('syncCloudData()'),false);assert.equal(h.json('readCloudMeta()').dirty,true);h.run('navigator.onLine=true');let uploaded;
 h.fetch(async(_url,options)=>{if(options.method==='GET')return response({data:base,version:1});uploaded=JSON.parse(options.body);return response({version:2});});assert.equal(await h.run('syncCloudData()'),true);assert.equal(uploaded.data.tenants[0].entries.length,2);assert.equal(h.json('readCloudMeta()').dirty,false);
});
test('a newer cloud copy never replaces a dirty local bill; CAS conflicts retry',async()=>{
 const base=data([bill('2026-08')]),local=data([bill('2026-08',7000)]),remote=data([bill('2026-08',3000),bill('2026-09',4000)]);const h=harness(local,{base});let gets=0,puts=0;h.fetch(async(_url,options)=>{if(options.method==='GET')return response({data:remote,version:2+(gets++>0?1:0)});puts++;if(puts===1)return new Response(JSON.stringify({error:'Conflict'}),{status:409,headers:{'content-type':'application/json'}});return response({version:4});});assert.equal(await h.run('syncCloudData()'),true);assert.equal(h.json('DB').tenants[0].entries[0].paid,7000);assert.equal(h.json('DB').tenants[0].entries.length,2);assert.equal(puts,2);
});
test('edits made during an upload remain dirty and queue another automatic save',async()=>{
 const base=data([bill('2026-08')]),local=data([bill('2026-08',1000)]);const h=harness(local,{base});h.fetch(async(_url,options)=>{if(options.method==='GET')return response({data:base,version:1});h.run("DB.tenants[0].entries[0].paid=2000;saveData(DB)");return response({version:2});});await h.run('syncCloudData()');assert.equal(h.json('DB').tenants[0].entries[0].paid,2000);assert.equal(h.json('readCloudMeta()').dirty,true);assert.equal(h.timers.at(-1).ms,800);
});
test('clean cloud updates keep an independent previous-copy recovery point',async()=>{
 const base=data([bill('2026-08')]),remote=data([bill('2026-08'),bill('2026-09',8000)]);const h=harness(base,{base,dirty:false});h.fetch(async()=>response({data:remote,version:2}));assert.equal(await h.run('syncCloudData()'),true);assert.equal(h.json('DB').tenants[0].entries.length,2);assert.equal(JSON.parse(h.store.get('recovery')).data.tenants[0].entries.length,1);
});
test('older cloud versions cannot roll back this device’s last successful save',async()=>{
 const local=data([bill('2026-08'),bill('2026-09',8000)]),remote=data([bill('2026-08')]);const h=harness(local,{base:local,version:5,dirty:false});let upload;h.fetch(async(_url,options)=>{if(options.method==='GET')return response({data:remote,version:3});upload=JSON.parse(options.body);return response({version:4});});assert.equal(await h.run('syncCloudData()'),true);assert.equal(upload.data.tenants[0].entries.length,2);
});
test('new devices load cloud data; upgraded clean devices preserve unshared history without reverting newer cloud bills',async()=>{
 const remote=data([bill('2026-08',8000)]),local=data([bill('2026-08',0),bill('2026-09',7000)]);const fresh=harness(data([]),{stored:false,dirty:false,version:0});fresh.fetch(async()=>response({data:remote,version:2}));await fresh.run('syncCloudData()');assert.equal(fresh.json('DB').tenants[0].entries[0].paid,8000);
 const old=harness(local,{dirty:false,version:1});let upload;old.fetch(async(_url,options)=>{if(options.method==='GET')return response({data:remote,version:2});upload=JSON.parse(options.body);return response({version:3});});await old.run('syncCloudData()');assert.equal(upload.data.tenants[0].entries[0].paid,8000);assert.equal(upload.data.tenants[0].entries[1].paid,7000);
});
test('failed save and expired Access login keep local edits and schedule retries',async()=>{
 const base=data([bill('2026-08')]),local=data([bill('2026-08',4000)]);const h=harness(local,{base});h.fetch(async()=>new Response('<html>Login</html>',{headers:{'content-type':'text/html'}}));assert.equal(await h.run('syncCloudData()'),false);assert.equal(h.json('DB').tenants[0].entries[0].paid,4000);assert.equal(h.json('readCloudMeta()').dirty,true);assert.equal(h.run('cloudSyncState'),'auth');assert.equal(h.timers.at(-1).ms,15000);
});
test('old cloud-replace action routes through safe synchronization instead',async()=>{
 const base=data([bill('2026-08')]),local=data([bill('2026-08'),bill('2026-09')]);const h=harness(local,{base});h.fetch(async(_url,options)=>options.method==='GET'?response({data:base,version:1}):response({version:2}));await h.run('useCloudCopy()');assert.equal(h.json('DB').tenants[0].entries.length,2);
});

function limitStorage(h, maxChars) {
 h.ctx.localStorage.setItem=(key,value)=>{
  const size=[...h.store].reduce((sum,[k,v])=>sum+(k===key?0:v.length),0)+value.length;
  if(size>maxChars){const error=new Error('Storage quota exceeded');error.name='QuotaExceededError';throw error;}
  h.store.set(key,value);
 };
}
test('full browser storage discards only Undo and completes cloud reconciliation',async()=>{
 const base=data([bill('2026-08')]),remote=data([bill('2026-08'),bill('2026-09',8000)]);
 const h=harness(base,{base,dirty:false});h.store.set('undo','x'.repeat(5000));limitStorage(h,5500);
 h.fetch(async()=>response({data:remote,version:2}));
 assert.equal(await h.run('syncCloudData()'),true);
 assert.equal(h.json('DB').tenants[0].entries.length,2);
 assert.equal(JSON.parse(h.store.get('recovery')).data.tenants[0].entries.length,1);
 assert.deepEqual(JSON.parse(h.store.get('data')),remote);
 assert.deepEqual(JSON.parse(h.store.get('base')),remote);
 assert.equal(h.json('readCloudMeta()').dirty,false);
});
test('offline edits save even when old Undo fills browser storage',()=>{
 const local=data([bill('2026-08')]);const h=harness(local,{base:local});
 h.store.set('undo','x'.repeat(5000));limitStorage(h,5500);h.run('navigator.onLine=false;DB.tenants[0].entries[0].paid=4321;saveData(DB)');
 assert.equal(JSON.parse(h.store.get('data')).tenants[0].entries[0].paid,4321);
 assert.equal(h.json('readCloudMeta()').dirty,true);
 assert.deepEqual(JSON.parse(h.store.get('base')),local);
});
test('Undo history is capped by size and keeps the newest available copies',()=>{
 const h=harness(data([]));h.run("undoStack=Array.from({length:20},(_,i)=>({label:String(i),data:{tenants:[],padding:'x'.repeat(60000)}}));persistUndoStack()");
 const saved=JSON.parse(h.store.get('undo'));assert.ok(h.store.get('undo').length<=512*1024);assert.equal(saved.at(-1).label,'19');assert.ok(saved.length<20);
});
test('unrecoverable quota never removes primary records or claims sync success',async()=>{
 const base=data([bill('2026-08')]),remote=data([bill('2026-08'),bill('2026-09',8000)]);
 const h=harness(base,{base,dirty:false});const original=h.store.get('data');limitStorage(h,original.length*2+50);
 h.fetch(async()=>response({data:remote,version:2}));assert.equal(await h.run('syncCloudData()'),false);
 assert.equal(h.store.get('data'),original);assert.deepEqual(JSON.parse(h.store.get('base')),base);assert.equal(h.run('cloudSyncState'),'error');
});
