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
  vm.runInContext(['tenant-details.js','verification.js','electricity.js','attachments.js','finance.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n')+'\n'+declarations,context);
  vm.runInContext(`var PROPERTY_NAME='Jasmine Residency';var PROPERTY_ADDRESS='Test address';var DB={tenants:[{flat:'TEST',name:'Synthetic Tenant',rent:8000,security:3000,startDate:'2026-05-07',dueDay:7,lastMeter:100,elecRate:9,entries:[]}]};var currentTenantIdx=0;var editingEntryId=null;var monthEntryDraft={}; toast=()=>{};saveData=()=>{};openTenant=()=>{};switchTab=()=>{};`,context);
  return {el,run:code=>vm.runInContext(code,context)};
}
const plain = value => JSON.parse(JSON.stringify(value));
function editInputs(a,index,changes={}) {
 const e=plain(a.run(`DB.tenants[0].entries[${index}]`));
 const payments=plain(a.run(`entryPayments(DB.tenants[0].entries[${index}])`));
 a.run(`editingEntryId=DB.tenants[0].entries[${index}].id;meterRowsHtml('e',entryMeterRows(DB.tenants[0].entries[${index}]),'');`);
 const values={month:e.month,rent:e.rent,unitStart:e.unitStart??0,unitFinal:e.unitFinal??0,rate:e.rate??9,elecBill:e.elecBill,lastOutstanding:e.lastOutstanding,maintenance:e.maintenance??0,rentFrom:e.rentFrom??'',paid:payments[0].amount,paid2:payments[1].amount,payDate:payments[0].date,payDate2:payments[1].date,payMode:payments[0].mode,payMode2:payments[1].mode,remarks:e.remarks??'',...changes};
 Object.entries(values).forEach(([key,value])=>a.el('e_'+key).value=String(value));
 const meters=plain(a.run(`entryMeterRows(DB.tenants[0].entries[${index}])`));
 meters.forEach((m,i)=>['start','final','rate','amount'].forEach(key=>a.el(`e_m${i}_${key}`).value=String(m[key]??'')));
}
test('payment metadata edits preserve historical monetary values and move cash into its receipt date range',()=>{
 const a=app();
 a.run(`DB.tenants[0].entries=[{id:1,month:'2026-05',rent:8000,unitStart:100,unitFinal:110,consumed:9,rate:8,meterBill:0,elecBill:81,lastOutstanding:195,totalDue:8276,paid:8276,outstanding:0,remarks:'Historical adjustment'},{id:2,month:'2026-07',rent:8000,elecBill:0,lastOutstanding:-19,totalDue:-19,paid:0,outstanding:-19}];`);
 const fields=['rent','consumed','meterBill','elecBill','lastOutstanding','totalDue','paid','outstanding'];
 const before=plain(a.run('DB.tenants[0].entries')).map(e=>fields.map(k=>e[k]));
 assert.equal(a.run(`financeTotals('2026-06-01','2026-06-30').received`),0);
 editInputs(a,0,{payDate:'2026-06-15',payMode:'Cash',remarks:'Confirmed date'});a.run('saveEditedEntry()');
 assert.deepEqual(plain(a.run('DB.tenants[0].entries')).map(e=>fields.map(k=>e[k])),before);
 assert.equal(a.run('DB.tenants[0].elecRate'),9);
 assert.equal(a.run(`financeTotals('2026-06-01','2026-06-30').received`),8276);
 assert.equal(a.run(`financeTotals('2026-05-01','2026-05-31').received`),0);
 assert.equal(a.run(`financeTotals('2026-06-01','2026-06-30').undated`),0);
 assert.equal(a.run('DB.tenants[0].entries[0].payments[0].mode'),'Cash');
});
test('dating two existing installments changes dated cash allocation without changing tenant balances',()=>{
 const a=app();a.run(`DB.tenants[0].entries=[{id:1,month:'2026-05',rent:8000,elecBill:100,lastOutstanding:0,totalDue:8100,paid:8100,outstanding:0,payments:[{amount:5000,date:'',mode:'Cash'},{amount:3100,date:'2026-06-01',mode:'Cash'}]}];`);
 editInputs(a,0,{payDate:'2026-07-01'});a.run('saveEditedEntry()');
 assert.equal(a.run('DB.tenants[0].entries[0].outstanding'),0);
 const june=plain(a.run(`financeTotals('2026-06-01','2026-06-30')`));
 assert.equal(june.received,3100);assert.equal(june.electricReceived,100);assert.equal(june.rentReceived,3000);
 assert.equal(a.run(`financeTotals('2026-07-01','2026-07-31').received`),5000);
});
test('metadata edits keep saved multi-meter snapshots and overridden bills intact',()=>{
 const a=app();a.run(`DB.tenants[0].entries=[{id:1,month:'2026-05',rent:8000,elecBill:40,lastOutstanding:0,totalDue:8040,paid:100,outstanding:7940,unitStart:10,unitFinal:20,rate:9,consumed:10,meterBill:140,meters:[{id:'main',name:'Main',unitStart:10,unitFinal:20,rate:9,consumed:10,amount:90},{id:'extra',name:'Second',unitStart:null,unitFinal:null,rate:9,consumed:null,amount:50,manual:true}]}];`);
 const meters=a.run('JSON.stringify(DB.tenants[0].entries[0].meters)');
 editInputs(a,0,{payDate:'2026-06-02'});a.run('saveEditedEntry()');
 assert.equal(a.run('JSON.stringify(DB.tenants[0].entries[0].meters)'),meters);
 assert.equal(a.run('DB.tenants[0].entries[0].meterBill'),140);
 assert.equal(a.run('DB.tenants[0].entries[0].elecBill'),40);
 assert.equal(a.run('DB.tenants[0].entries[0].outstanding'),7940);
});
test('moving the earliest bill later removes its old carry-forward and preserves the original opening due or credit',()=>{
 for(const opening of [50,-50]) {
  const a=app();a.run(`DB.tenants[0].entries=[{id:1,month:'2026-04',rent:100,elecBill:0,paid:0,lastOutstanding:${opening},totalDue:${opening+100},outstanding:${opening+100}},{id:2,month:'2026-05',rent:100,elecBill:0,paid:0,lastOutstanding:${opening+100},totalDue:${opening+200},outstanding:${opening+200}},{id:3,month:'2026-07',rent:100,elecBill:0,paid:0,lastOutstanding:${opening+200},totalDue:${opening+300},outstanding:${opening+300}}];`);
  editInputs(a,0,{month:'2026-06'});a.run('saveEditedEntry()');
  const rows=plain(a.run('DB.tenants[0].entries'));
  assert.deepEqual(rows.map(e=>e.month),['2026-05','2026-06','2026-07']);
  assert.deepEqual(rows.map(e=>e.lastOutstanding),[opening,opening+100,opening+200]);
  assert.deepEqual(rows.map(e=>e.outstanding),[opening+100,opening+200,opening+300]);
 }
});
test('moving a later bill earlier recalculates both positions and all following months',()=>{
 const a=app();a.run(`DB.tenants[0].entries=[{id:1,month:'2026-05',rent:100,elecBill:0,paid:0,lastOutstanding:50,totalDue:150,outstanding:150},{id:2,month:'2026-06',rent:200,elecBill:0,paid:50,lastOutstanding:150,totalDue:350,outstanding:300},{id:3,month:'2026-07',rent:300,elecBill:0,paid:0,lastOutstanding:300,totalDue:600,outstanding:600}];`);
 editInputs(a,1,{month:'2026-04'});a.run('saveEditedEntry()');
 const rows=plain(a.run('DB.tenants[0].entries'));
 assert.deepEqual(rows.map(e=>e.month),['2026-04','2026-05','2026-07']);
 assert.deepEqual(rows.map(e=>e.lastOutstanding),[50,200,300]);
 assert.deepEqual(rows.map(e=>e.outstanding),[200,300,600]);
});
test('moving a middle bill later preserves unaffected earlier months and recalculates intervening ones',()=>{
 const a=app();a.run(`DB.tenants[0].entries=[{id:1,month:'2026-04',rent:100,elecBill:0,paid:0,lastOutstanding:50,totalDue:150,outstanding:150},{id:2,month:'2026-05',rent:200,elecBill:0,paid:0,lastOutstanding:150,totalDue:350,outstanding:350},{id:3,month:'2026-06',rent:300,elecBill:0,paid:0,lastOutstanding:350,totalDue:650,outstanding:650},{id:4,month:'2026-08',rent:100,elecBill:0,paid:0,lastOutstanding:650,totalDue:750,outstanding:750}];`);
 const first=a.run('JSON.stringify(DB.tenants[0].entries[0])');
 editInputs(a,1,{month:'2026-07'});a.run('saveEditedEntry()');
 const rows=plain(a.run('DB.tenants[0].entries'));
 assert.equal(JSON.stringify(rows[0]),first);
 assert.deepEqual(rows.map(e=>e.lastOutstanding),[50,150,450,650]);
 assert.deepEqual(rows.map(e=>e.outstanding),[150,450,650,750]);
});
test('moving a sole bill preserves opening balance; moves into occupied months change nothing',()=>{
 const a=app();a.run(`DB.tenants[0].entries=[{id:1,month:'2026-04',rent:100,elecBill:0,paid:0,lastOutstanding:-50,totalDue:50,outstanding:50}];`);
 editInputs(a,0,{month:'2026-05'});a.run('saveEditedEntry()');assert.equal(a.run('DB.tenants[0].entries[0].outstanding'),50);
 a.run(`DB.tenants[0].entries.push({id:2,month:'2026-06',rent:100,elecBill:0,paid:0,lastOutstanding:50,totalDue:150,outstanding:150})`);
 const before=a.run('JSON.stringify(DB.tenants[0].entries)');
 editInputs(a,0,{month:'2026-06'});a.run('saveEditedEntry()');assert.equal(a.run('JSON.stringify(DB.tenants[0].entries)'),before);
});
test('annual workbook uses each latest in-year closing balance while paid and billed sheets remain additive',()=>{
 const a=app();a.run(`var XS={plain:0,title:1,head:2,money:3,date:4,totalMoney:5,cell:6,label:7,totalText:8};DB.tenants=[{flat:'101',name:'A',entries:[{month:'2026-04',rent:100,elecBill:20,maintenance:10,paid:30,outstanding:100},{month:'2026-05',rent:120,elecBill:10,maintenance:0,paid:30,outstanding:200},{month:'2027-04',rent:999,paid:999,outstanding:999}]},{flat:'102',name:'B',entries:[{month:'2026-04',rent:100,elecBill:0,paid:150,outstanding:-50},{month:'2026-07',rent:50,elecBill:0,paid:0,outstanding:0}]},{flat:'103',name:'C',checkedOut:true,entries:[{month:'2026-06',rent:100,elecBill:0,paid:125,outstanding:-25}]}];`);
 const sheets=plain(a.run('buildYearWorkbook(2026)'));
 assert.equal(sheets[0].rows[4].at(-1).v,'Latest closing balance');
 assert.deepEqual(sheets[0].rows.slice(5,-1).map(row=>row.at(-1).v),[200,0,-25]);
 assert.equal(sheets[0].rows.at(-1).at(-1).v,175);
 assert.equal(sheets[0].rows[5][2].v,100);assert.equal(sheets[0].rows[5][3].v,200);
 assert.equal(sheets[1].rows.at(-1).at(-1).v,335);
 assert.equal(sheets[2].rows.at(-1).at(-1).v,510);
});
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
test('flat directory separates former renters and includes vacant units without duplicate cards',()=>{
 const {run}=app();run(`DB={flats:['601',' 601 '],tenants:[{flat:'101',name:'Former',checkedOut:true},{flat:'101',name:'Current'},{flat:'102',name:'Former 2',checkedOut:true}]}`);
 assert.equal(run('homeRecords(true).length'),2);
 assert.equal(run('homeRecords(false).length'),3);
 assert.equal(run("homeRecords(false).find(r=>r.t.flat==='101').t.name"),'Current');
 assert.equal(run("homeRecords(false).find(r=>r.t.flat==='102').i"),-1);
 assert.equal(run('DB.tenants.length'),3);
});
test('maintenance charges save, appear on bills, and carry into later balances and reports',()=>{
 const {run,el}=app();Object.entries({month:'2026-10',rent:8000,unitStart:100,unitFinal:124,elecRate:9,paid:8000,paid2:0,payDate:'2026-10-15',payDate2:'',payMode:'Cash',payMode2:'',remarks:'',lastOutstanding:0,maintenance:500,rentFrom:'2026-10-15'}).forEach(([k,v])=>el('b_'+k).value=String(v));run('saveBillingEntry()');assert.equal(run('DB.tenants[0].entries[0].totalDue'),8716);assert.equal(run('DB.tenants[0].entries[0].outstanding'),716);assert.match(run('buildBillMessage(DB.tenants[0],DB.tenants[0].entries[0])'),/Maintenance\/Others Charges=500/);assert.equal(run('tenantStatementTotals(DB.tenants[0]).billed'),8716);assert.equal(run('getEntryIssues(DB.tenants[0],0).length'),0);
});
test('cash reports automatically split historical receipts, use payment dates and count DHBVN once',()=>{
 const {run}=app();run(`DB={tenants:[{flat:'101',name:'Former',checkedOut:true,entries:[{id:1,month:'2026-09',rent:8000,elecBill:216,maintenance:500,paid:8716,payments:[{amount:8216,date:'2026-10-04'},{amount:500,date:'2026-10-16'}],receiptSplits:{0:{rent:8000,electricity:216,other:0}}},{id:2,month:'2026-10',rent:100,elecBill:0,paid:100}]}],financeRecords:[{kind:'dhbvn',date:'2026-10-05',amount:150},{kind:'expense',date:'2026-10-06',amount:50},{kind:'dhbvn',date:'2026-09-30',amount:999}]}`);const t=plain(run("financeTotals('2026-10-01','2026-10-10')"));assert.equal(t.received,8216);assert.equal(t.rentReceived,8000);assert.equal(t.electricReceived,216);assert.equal(t.dhbvn,150);assert.equal(t.expenses,50);assert.equal(t.undated,100);assert.equal(t.rentBilled,100);assert.equal(t.receipts.length,1);assert.equal(run("financeTotals('2026-10-01','2026-10-31').unallocated"),0);assert.equal(run("financeTotals('2026-10-01','2026-10-31').otherReceived"),500);assert.equal(run("validReceiptSplit({rent:8000,electricity:216,other:0},8000)"),false);
});
test('effective rent dates clamp short months; reference drafts include permanent address',()=>{const {run}=app();assert.equal(run("rentEffectiveDate({startDate:'2026-01-31'},'2026-02')"),'2026-02-28');assert.match(run("referenceMessage({name:'Test Resident',flat:'206',reference1Name:'Test Reference',address:'Test Address'},1)"),/Dear Test Reference/);assert.match(run("referenceMessage({name:'Test Resident',flat:'206',address:'Test Address'},1)"),/Test Address/);});
test('bulk maintenance-only entries and receipt corrections recalculate safely',()=>{
 const {run,el}=app();run(`monthEntryDraft={0:{maintenance:'250',paid:'0',rentFrom:'2026-10-07'}}`);assert.equal(run("computeMonthEntryRow(0,'2026-10').totalDue"),8250);run(`monthEntryDraft[0].maintenance='-1'`);assert.ok(run("computeMonthEntryRow(0,'2026-10').error"));
 run(`DB.tenants[0].entries=[{id:1,month:'2026-10',rent:8000,elecBill:0,maintenance:250,unitStart:100,unitFinal:100,rate:9,paid:8000,payments:[{amount:8000,date:'2026-10-07',mode:'Cash'},{amount:0,date:'',mode:''}],receiptSplits:{0:{rent:8000,electricity:0,other:0}},lastOutstanding:0}];editingEntryId=1;`);
 Object.entries({month:'2026-10',rent:8000,unitStart:100,unitFinal:100,rate:9,elecBill:0,maintenance:300,rentFrom:'2026-10-07',paid:8100,paid2:0,payDate:'2026-10-07',payDate2:'',payMode:'Cash',payMode2:'',remarks:'',lastOutstanding:0}).forEach(([k,v])=>el('e_'+k).value=String(v));run('saveEditedEntry()');assert.equal(run('DB.tenants[0].entries[0].totalDue'),8300);assert.equal(run('DB.tenants[0].entries[0].outstanding'),200);assert.equal(run('DB.tenants[0].entries[0].receiptSplits'),undefined);
});

test('electricity is paid first across installments and carried arrears; excess is rent advance',()=>{
 const {run}=app();run(`DB.tenants[0].entries=[
 {month:'2026-09',rent:7500,elecBill:1017,lastOutstanding:-5,payments:[{amount:500,date:'2026-09-06'},{amount:0}]},
 {month:'2026-10',rent:7500,elecBill:200,lastOutstanding:8012,payments:[{amount:1000,date:'2026-10-06'},{amount:16000,date:'2026-10-15'}]}
 ]`);
 const receipts=plain(run('financeReceipts()'));
 assert.deepEqual(receipts.map(p=>p.split),[{electricity:500,rent:0,other:0},{electricity:717,rent:283,other:0},{electricity:0,rent:16000,other:0}]);
 assert.equal(receipts[2].rentAdvance,1288);
 const october=plain(run("financeTotals('2026-10-01','2026-10-31')"));assert.equal(october.electricReceived,717);assert.equal(october.rentReceived,16283);assert.equal(october.received,17000);
 assert.equal(run('DB.tenants[0].entries[0].receiptSplits'),undefined);
});
test('two payments share one electricity charge even when second installment was entered first',()=>{
 const {run}=app();run(`DB.tenants[0].entries=[{month:'2026-10',rent:7500,elecBill:1017,maintenance:200,lastOutstanding:-5,payments:[{amount:8500,date:'2026-10-10'},{amount:500,date:'2026-10-06'}]}]`);
 const t=plain(run("financeTotals('2026-10-01','2026-10-31')"));assert.equal(t.electricReceived,1017);assert.equal(t.otherReceived,200);assert.equal(t.rentReceived,7783);assert.equal(t.received,t.rentReceived+t.electricReceived+t.otherReceived);
 const r=plain(run('financeReceipts()'));assert.equal(r[0].pi,1);assert.equal(r[0].split.electricity,500);assert.equal(r[1].split.electricity,517);assert.equal(r[1].rentAdvance,288);
});
test('only electricity bills show rent effective date; receipts omit it and tenancy date',()=>{
 const {run}=app();run(`DB.tenants[0].entries=[{month:'2026-10',rent:7500,elecBill:1017,paid:8500,lastOutstanding:-5,totalDue:8512,outstanding:12,rentFrom:'2026-10-01'}]`);
 const receipt=run('buildReceiptMessage(DB.tenants[0],DB.tenants[0].entries[0])');assert.doesNotMatch(receipt,/w.e.f/);assert.doesNotMatch(receipt,/Tenancy start date/);assert.match(receipt,/Balance still due: ₹12/);
 assert.doesNotMatch(run("buildReceiptDoc(0,'2026-10')"),/w.e.f/);
 const bill=run('buildBillMessage(DB.tenants[0],DB.tenants[0].entries[0])');assert.match(bill,/Rent w.e.f. 01 Oct 2026/);assert.doesNotMatch(bill,/Tenancy start date/);
});
test('WhatsApp reference button targets the selected reference and preserves reviewed message',()=>{
 const {run,el}=app();run(`var opened=[];window={open:(...args)=>opened.push(args)};readTenantInfo=()=>({name:'Test Tenant',flat:'208',reference1Mobile:'9876543210',reference2Mobile:'+91 91234 56789',reference2Name:'Reference Two'});`);
 el('referenceChoice').value='2';el('referenceMessage').value='Reviewed message & details';run('sendReferenceWhatsApp()');
 assert.equal(run('opened[0][0]'),'https://wa.me/919123456789?text=Reviewed%20message%20%26%20details');
 el('referenceChoice').value='1';el('referenceMessage').value='';run('sendReferenceWhatsApp()');assert.match(run('opened[1][0]'),/^https:\/\/wa.me\/919876543210\?text=/);
 run(`readTenantInfo=()=>({reference1Mobile:''})`);run('sendReferenceWhatsApp()');assert.equal(run('opened.length'),2);
});
