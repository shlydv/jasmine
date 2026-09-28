// Pure application tests with synthetic data. No browser, PIN, cloud or live records.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
function app() {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id,{value:'',innerHTML:'',style:{},querySelectorAll:()=>[],checkValidity:()=>true,classList:{add(){},remove(){}}}); return elements.get(id); };
  const context = vm.createContext({console,TextEncoder,Date,document:{getElementById:el},toast(){},confirm:()=>true});
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const inline=html.split('<script>')[1].split('</script>')[0];
  // Load top-level function declarations, without executing app startup or auth.
  const declarations=[...inline.matchAll(/^(?:async )?function \w+\([^]*?^\}/gm)].map(m=>m[0]).join('\n');
  vm.runInContext(['tenant-details.js','verification.js','electricity.js','attachments.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n')+'\n'+declarations,context);
  vm.runInContext(`var DB={tenants:[{flat:'TEST',name:'Synthetic Tenant',rent:8000,security:3000,startDate:'2026-05-07',dueDay:7,lastMeter:100,elecRate:9,entries:[]}]};var currentTenantIdx=0;var editingEntryId=null;var monthEntryDraft={}; toast=()=>{};saveData=()=>{};openTenant=()=>{};switchTab=()=>{};`,context);
  return {el,run:code=>vm.runInContext(code,context)};
}
const plain = value => JSON.parse(JSON.stringify(value));
test('legacy payment records stay intact and summaries escape HTML',()=>{
 const {run}=app();
 assert.deepEqual(plain(run(`entryPayments({paid:1234,payDate:'2026-08-01',payMode:'Cash'})`)),[{amount:1234,date:'2026-08-01',mode:'Cash'},{amount:0,date:'',mode:''}]);
 assert.match(run(`paymentSummaryHtml({paid:1,payMode:'<script>'})`),/&lt;script&gt;/);
});
test('two installments save once, edit individually and recalculate later balances',()=>{
 const {run,el}=app();
 Object.entries({month:'2026-09',rent:8000,unitStart:100,unitFinal:110,elecRate:9,paid:5000,paid2:2000,payDate:'2026-09-07',payDate2:'2026-09-14',payMode:'Cash',payMode2:'Google Pay',remarks:'',lastOutstanding:0}).forEach(([k,v])=>el('b_'+k).value=String(v));
 run('saveBillingEntry()');
 assert.equal(run('DB.tenants[0].entries[0].paid'),7000);
 assert.equal(run('DB.tenants[0].entries[0].outstanding'),1090);
 assert.equal(run('DB.tenants[0].entries[0].payments[1].date'),'2026-09-14');
 run(`DB.tenants[0].entries.push({id:2,month:'2026-10',rent:8000,elecBill:0,paid:0,lastOutstanding:1090,totalDue:9090,outstanding:9090});editingEntryId=DB.tenants[0].entries[0].id;`);
 Object.entries({month:'2026-09',rent:8000,unitStart:100,unitFinal:110,rate:9,elecBill:90,paid:5000,paid2:3090,payDate:'2026-09-07',payDate2:'2026-09-14',payMode:'Cash',payMode2:'Google Pay',remarks:'',lastOutstanding:0}).forEach(([k,v])=>el('e_'+k).value=String(v));
 run('saveEditedEntry()');
 assert.equal(run('DB.tenants[0].entries[0].paid'),8090);
 assert.equal(run('DB.tenants[0].entries[0].outstanding'),0);
 assert.equal(run('DB.tenants[0].entries[1].outstanding'),8000);
 assert.match(run('buildReceiptMessage(DB.tenants[0],DB.tenants[0].entries[0])'),/Payment 2: ₹3,090/);
 const roundTrip=run('normalizeData(JSON.parse(JSON.stringify(DB)))');
 assert.equal(roundTrip.tenants[0].entries[0].payments[1].amount,3090);
});
test('bulk entry includes second-only payments and rejects negative amounts',()=>{
 const {run}=app();
 run(`monthEntryDraft={0:{paid:'1000',paid2:'2500'}}`);
 assert.equal(run(`computeMonthEntryRow(0,'2026-09').paid`),3500);
 run(`monthEntryDraft={0:{paid2:'2500'}}`);
 assert.equal(run(`computeMonthEntryRow(0,'2026-09').touched`),true);
 assert.equal(run(`computeMonthEntryRow(0,'2026-09').outstanding`),5500);
 run(`monthEntryDraft[0].paid2='-1'`);
 assert.match(run(`computeMonthEntryRow(0,'2026-09').error`),/non-negative/);
});
test('optional tenant fields persist through normalization and unsafe media is rejected',()=>{
 const {run}=app();
 run(`DB.tenants[0].ownerName='Synthetic Owner';DB.tenants[0].reference2Name='Reference';DB.tenants[0].officeAddress='Office';DB.tenants[0].name='A " <Tenant>';renderTenantInfoForm();`);
 assert.match(run(`document.getElementById('tenantInfoForm').innerHTML`),/A &quot; &lt;Tenant&gt;/);
 assert.equal(run(`normalizeData(JSON.parse(JSON.stringify(DB))).tenants[0].reference2Name`),'Reference');
 assert.equal(run(`safeTenantImage('https://example.com/photo.jpg')`),'');
 assert.equal(run(`safeTenantImage('data:image/svg+xml;base64,PHN2Zz4=')`),'');
 assert.match(run(`buildAgreementDraft(DB.tenants[0])`),/Synthetic Owner/);
 assert.match(run(`buildAgreementDraft(DB.tenants[0])`),/A &quot; &lt;Tenant&gt;/);
 const keys=plain(run('TENANT_SECTIONS.flatMap(s=>s[1].map(f=>f[0]))'));
 assert.equal(new Set(keys).size,keys.length);
 assert.ok(keys.includes('localPolicePost') && keys.includes('reference3Name') && keys.includes('ownerFatherName'));
});
test('DOB accepts typed years and leap days, rejecting partial and impossible dates',()=>{
 const {run}=app();assert.equal(run("parseBirthDate('29','2','1992').value"),'1992-02-29');assert.ok(run("parseBirthDate('29','2','1991').error"));assert.ok(run("parseBirthDate('1','','1985').error"));assert.equal(run("parseBirthDate('','','').value"),'');assert.ok(run("parseBirthDate('1','1','2999').error"));
});
test('multi-meter defaults, rates, amount-only bills and carry-forward remain separate',()=>{
 const {run}=app();assert.equal(run("meterConfiguration({flat:'104 (Hall)'}).length"),2);assert.equal(run("meterConfiguration({flat:'002 (Office)'}).length"),4);assert.equal(run("meterConfiguration({flat:'102'}).length"),1);
 const result=run(`calculateMeterRows([{id:'a',name:'A',start:100,final:120,rate:9,amount:''},{id:'b',name:'B',start:'',final:'',rate:8,amount:350}])`);assert.equal(result.total,530);assert.equal(result.meters[1].unitFinal,null);
 assert.ok(run(`calculateMeterRows([{name:'B',start:100,final:99,rate:9,amount:''}]).error`));
 assert.ok(run(`calculateMeterRows([{name:'B',start:'',final:'',rate:9,amount:''}]).error`));
 run(`DB.tenants[0].entries=[{month:'2026-08',unitFinal:90,meters:[{id:'main',unitFinal:90},{id:'meter-2',unitFinal:420}]}]`);assert.equal(run(`meterBeforeMonth(DB.tenants[0],'meter-2','2026-09')`),420);assert.equal(run(`meterBeforeMonth(DB.tenants[0],'main','2026-09')`),90);
});
test('Aadhaar parsing preserves masked IDs and never invents DOB from year of birth',()=>{
 const {run}=app();const result=plain(run(String.raw`parseAadhaarText('Name: Test Person\nDOB: 15/08/1985\nMALE\nXXXX XXXX 1234\nAddress: 12 Sample Road\nGurugram Haryana 122004')`));assert.equal(result.name,'Test Person');assert.equal(result.dob,'1985-08-15');assert.equal(result.idNum,'XXXXXXXX1234');assert.equal(result.permanentPin,'122004');assert.equal(result.gender,'Male');
 assert.equal(run(`parseAadhaarText('**** **** 1234').idNum`),'********1234');
 assert.equal(run(`parseAadhaarText('Year of Birth: 1985').dob`),undefined);
 assert.equal(run(`parseAadhaarText('DOB: 31/02/1985').dob`),undefined);
 assert.equal(run(`parseAadhaarText('1234 1234 1234').idNum`),undefined);
});
