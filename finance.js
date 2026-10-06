function financeMoney(value) { return "₹"+fmt(roundMoney(Number(value)||0)); }
// Cash totals use actual receipt/payment dates; billed totals use bill months.
function rentChargeCell(entry) { return financeMoney(entry.rent)+(chargeExtras(entry)?`<br><small>Maintenance / other: ${financeMoney(chargeExtras(entry))}</small>`:''); }
function chargeExtras(entry) { return Number(entry.maintenance) || 0; }
function rentEffectiveDate(t, month) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.startDate || '')) return '';
  const day=Math.min(Number(t.startDate.slice(8)),new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate());
  return month+'-'+String(day).padStart(2,'0');
}
function billExtraFields(prefix,entry={},tenant={},month='') {
  return `<div class="form-row"><div class="form-group"><label>Maintenance / other charges (₹)</label><input type="number" min="0" step="0.01" id="${prefix}_maintenance" value="${chargeExtras(entry)}" oninput="${prefix==='b'?'calcBilling()':''}"></div><div class="form-group"><label>Rent effective from (for this bill)</label><input type="date" id="${prefix}_rentFrom" value="${escapeAttr(entry.rentFrom || rentEffectiveDate(tenant,month))}"><span class="hint">Shown in the message. Rent is not automatically prorated; enter the agreed rent amount.</span></div></div>`;
}
function validFinanceDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value||'') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value; }
function financeRecords() { return Array.isArray(DB.financeRecords)?DB.financeRecords:[]; }
// Recalculate from recorded bills and payments, including historical receipts.
// Allocate electricity first, then rent due, maintenance, and finally rent advance.
function financeReceipts() {
  const rows=[];
  const cents=value=>Math.max(0,Math.round((Number(value)||0)*100));
  DB.tenants.forEach((t,ti)=>{
    let electricityCarry=0,otherCarry=0;
    [...(t.entries||[])].sort((a,b)=>String(a.month).localeCompare(String(b.month))).forEach(e=>{
      const previous=Number(e.lastOutstanding)||0;
      const arrears=cents(previous);
      electricityCarry=Math.min(electricityCarry,arrears);
      otherCarry=Math.min(otherCarry,Math.max(0,arrears-electricityCarry));
      let electricityDue=cents(e.elecBill)+electricityCarry;
      let otherDue=cents(chargeExtras(e))+otherCarry;
      let rentDue=Math.max(0,cents(e.rent)+arrears-electricityCarry-otherCarry-cents(-previous));
      const payments=entryPayments(e).map((p,pi)=>({...p,pi}));
      payments.sort((a,b)=>validFinanceDate(a.date)&&validFinanceDate(b.date)?a.date.localeCompare(b.date)||a.pi-b.pi:a.pi-b.pi);
      payments.forEach(p=>{
        let remaining=cents(p.amount);if(!remaining)return;
        const electricity=Math.min(remaining,electricityDue);electricityDue-=electricity;remaining-=electricity;
        const rent=Math.min(remaining,rentDue);rentDue-=rent;remaining-=rent;
        const other=Math.min(remaining,otherDue);otherDue-=other;remaining-=other;
        rows.push({t,ti,e,...p,split:{electricity:electricity/100,rent:(rent+remaining)/100,other:other/100},rentAdvance:remaining/100});
      });
      electricityCarry=electricityDue;otherCarry=otherDue;
    });
  });
  return rows;
}
function validReceiptSplit(split,amount) {return split && ['rent','electricity','other'].every(k=>Number.isFinite(Number(split[k]))&&Number(split[k])>=0) && Math.abs(Number(split.rent)+Number(split.electricity)+Number(split.other)-Number(amount))<0.01;}
function financeTotals(from,to) {
  const inside=date=>validFinanceDate(date)&&date>=from&&date<=to;
  const allReceipts=financeReceipts();
  const receipts=allReceipts.filter(p=>inside(p.date));
  const records=financeRecords().filter(r=>inside(r.date));
  const bills=[];DB.tenants.forEach(t=>(t.entries||[]).forEach(e=>{if(e.month>=from.slice(0,7)&&e.month<=to.slice(0,7))bills.push({t,e});}));
  const sum=(rows,fn)=>roundMoney(rows.reduce((s,r)=>s+Number(fn(r)||0),0));
  const allocated=receipts.filter(p=>validReceiptSplit(p.split,p.amount));
  return {receipts,records,bills,received:sum(receipts,p=>p.amount),rentReceived:sum(allocated,p=>p.split.rent),electricReceived:sum(allocated,p=>p.split.electricity),otherReceived:sum(allocated,p=>p.split.other),unallocated:sum(receipts.filter(p=>!validReceiptSplit(p.split,p.amount)),p=>p.amount),undated:sum(allReceipts.filter(p=>!validFinanceDate(p.date)),p=>p.amount),rentBilled:sum(bills,r=>r.e.rent),electricBilled:sum(bills,r=>r.e.elecBill),otherBilled:sum(bills,r=>chargeExtras(r.e)),dhbvn:sum(records.filter(r=>r.kind==='dhbvn'),r=>r.amount),expenses:sum(records.filter(r=>r.kind==='expense'),r=>r.amount)};
}
function openFinance() {
  showScreen('finance');
  const month=currentMonthString();
  if(!document.getElementById('expenseMonth').value)document.getElementById('expenseMonth').value=month;
  if(!document.getElementById('finDate').value)document.getElementById('finDate').value=toDateInput(new Date());
  if(!document.getElementById('finBillMonth').value)document.getElementById('finBillMonth').value=month;
  financeKindChanged();renderFinance();
}
function financeRange() {const from=document.getElementById('finFrom').value,to=document.getElementById('finTo').value;if(!validFinanceDate(from)||!validFinanceDate(to)||from>to)throw new Error('Choose a valid start and end date.');return {from,to};}
function financeKindChanged() {const electricity=document.getElementById('finKind').value==='dhbvn';document.getElementById('finMeterWrap').style.display=electricity?'block':'none';document.getElementById('finBillMonthWrap').style.display=electricity?'block':'none';if(!document.getElementById('finEditId').value)document.getElementById('finSave').textContent=electricity?'Save electricity payment':'Save expense';}
function saveFinanceRecord() {
  const date=document.getElementById('finDate').value,amount=Number(document.getElementById('finAmount').value),kind=document.getElementById('finKind').value,particulars=document.getElementById('finParticulars').value.trim();
  if(!validFinanceDate(date)||!Number.isFinite(amount)||amount<=0||!particulars){toast('Enter a date, particulars and an amount greater than zero.','error');return;}
  const record={id:document.getElementById('finEditId').value||crypto.randomUUID(),kind,date,amount:roundMoney(amount),particulars,remarks:document.getElementById('finRemarks').value.trim(),meter:kind==='dhbvn'?document.getElementById('finMeter').value.trim():'',billMonth:kind==='dhbvn'?document.getElementById('finBillMonth').value:''};
  if(kind==='dhbvn'&&!record.meter){toast('Enter a meter name.','error');return;}
  const records=financeRecords();const i=records.findIndex(r=>r.id===record.id);if(i<0)records.push(record);else records[i]=record;DB.financeRecords=records;
  saveData(DB,{label:(i<0?'Added':'Edited')+' '+(kind==='dhbvn'?'DHBVN payment':'expense')});resetFinanceForm();renderFinance();toast('Saved.','success');
}
function resetFinanceForm() {['finEditId','finAmount','finParticulars','finRemarks'].forEach(id=>document.getElementById(id).value='');document.getElementById('finSave').textContent='Save expense / payment';financeKindChanged();}
function editFinanceRecord(id) {const r=financeRecords().find(r=>r.id===id);if(!r)return;for(const [key,id2] of Object.entries({id:'finEditId',date:'finDate',kind:'finKind',amount:'finAmount',particulars:'finParticulars',remarks:'finRemarks',meter:'finMeter',billMonth:'finBillMonth'}))document.getElementById(id2).value=r[key]||'';document.getElementById('finSave').textContent='Save changes';financeKindChanged();document.getElementById('financeForm').scrollIntoView({behavior:'smooth'});}
function removeFinanceRecord(id) {if(!confirm('Remove this expense/payment? You can restore it using Undo in Backup.'))return;DB.financeRecords=financeRecords().filter(r=>r.id!==id);saveData(DB,{label:'Removed expense/payment'});renderFinance();}
function financeStatement(s,from,to) {
  const row=(label,value)=>`<tr><td class="tl">${label}</td><td>${financeMoney(value)}</td></tr>`;
  return reportHead('Owner Income & Expense Summary',fmtDate(from)+' to '+fmtDate(to))+`<h3>Income and expenses</h3><table class="rep-table"><tbody>${row('Rent received (including rent advances)',s.rentReceived)}${row('Electricity received',s.electricReceived)}${row('Maintenance / other received',s.otherReceived)}${row('<strong>Total money received from residents</strong>',s.received)}${row('DHBVN payments',s.dhbvn)}${row('Other expenditure',s.expenses)}${row('<strong>Total Expenditure</strong>',s.dhbvn+s.expenses)}${row('<strong>Balance After Expenses (cash surplus / deficit)</strong>',s.received-s.dhbvn-s.expenses)}</tbody></table>
  <h3>Electricity collections vs DHBVN</h3><table class="rep-table"><tbody>${row('Electricity collected from residents',s.electricReceived)}${row('Total Electricity Bill Paid to DHBVN',s.dhbvn)}${row('Net Difference / Billing Variance (collections less DHBVN)',s.electricReceived-s.dhbvn)}</tbody></table><p class="rep-note">Payments cover electricity first, then rent due and maintenance. Excess payments count as rent advances. Cash totals use receipt/payment dates. DHBVN payments are counted once, separately from other expenses. Security deposits are not income. Undated receipts excluded from cash totals: ${financeMoney(s.undated)}.</p>
`;
}
function financeTable(headers,rows) {return `<div class="table-wrap"><table class="rep-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">No records for this period.</td></tr>`}</tbody></table></div>`;}
function financeRecordTables(s,actions=false) {
  if(actions) return ['expense','dhbvn'].map(kind=>{
    const records=s.records.filter(r=>r.kind===kind).sort((a,b)=>b.date.localeCompare(a.date));
    return `<h3>${kind==='expense'?'Other expenses':'DHBVN electricity payments'} <span class="hint">${financeMoney(records.reduce((sum,r)=>sum+Number(r.amount),0))}</span></h3><div class="payment-records">${records.map(r=>`<article class="payment-record"><div class="record-heading"><strong>${escapeHtml(r.particulars)}</strong><strong>${financeMoney(r.amount)}</strong></div><p>${fmtDate(r.date)}${r.meter?' · '+escapeHtml(r.meter):''}${r.billMonth?' · Bill: '+escapeHtml(fmtMonth(r.billMonth)):''}</p>${r.remarks?`<p>${escapeHtml(r.remarks)}</p>`:''}<button class="btn btn-sm" data-id="${escapeAttr(r.id)}" onclick="editFinanceRecord(this.dataset.id)">Edit</button> <button class="btn btn-sm" data-id="${escapeAttr(r.id)}" onclick="removeFinanceRecord(this.dataset.id)">Remove</button></article>`).join('')||'<p class="hint">No payments recorded this month.</p>'}</div>`;
  }).join('');
  const recordRows=(kind)=>s.records.filter(r=>r.kind===kind).sort((a,b)=>a.date.localeCompare(b.date)).map((r,i)=>`<tr><td>${i+1}</td><td>${fmtDate(r.date)}</td><td>${escapeHtml(r.particulars)}${r.meter?' · '+escapeHtml(r.meter):''}${r.billMonth?' · '+escapeHtml(fmtMonth(r.billMonth)):''}</td><td>${escapeHtml(r.remarks)}</td><td>${financeMoney(r.amount)}</td>${actions?`<td><button class="btn btn-sm" data-id="${escapeAttr(r.id)}" onclick="editFinanceRecord(this.dataset.id)">Edit</button> <button class="btn btn-sm" data-id="${escapeAttr(r.id)}" onclick="removeFinanceRecord(this.dataset.id)">Remove</button></td>`:''}</tr>`);
  return '<h3>Expenses</h3>'+financeTable(['S. No.','Date','Expense Particulars','Remarks','Amount (₹)',...(actions?['Action']:[])],recordRows('expense'))+'<h3>DHBVN payments</h3>'+financeTable(['S. No.','Date paid','Particulars / Meter / Bill month','Remarks','Amount (₹)',...(actions?['Action']:[])],recordRows('dhbvn'));
}
function financeReportHtml(s,from,to) {return financeStatement(s,from,to)+financeRecordTables(s)+reportFoot();}
function renderFinance() {
  const month=document.getElementById('expenseMonth').value||currentMonthString();
  document.getElementById('expenseMonth').value=month;
  const records=financeRecords().filter(r=>r.date?.slice(0,7)===month);
  document.getElementById('expenseRecords').innerHTML=financeRecordTables({records},true);
}
function renderOwnerSummary() {
  const month=currentMonthString();
  if(!document.getElementById('finFrom').value)document.getElementById('finFrom').value=month+'-01';
  if(!document.getElementById('finTo').value)document.getElementById('finTo').value=toDateInput(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0));
  try {
    const {from,to}=financeRange(),s=financeTotals(from,to);
    document.getElementById('financeResults').innerHTML=financeStatement(s,from,to);
    document.getElementById('financeReceipts').innerHTML='<div class="payment-records">'+s.receipts.map(p=>`<article class="payment-record"><div class="record-heading"><strong>Flat ${escapeHtml(p.t.flat)} · ${escapeHtml(p.t.name)}</strong><strong>${financeMoney(p.amount)}</strong></div><p>${fmtDate(p.date)} · Bill: ${escapeHtml(fmtMonth(p.e.month))}</p><p>Electricity: <strong>${financeMoney(p.split.electricity)}</strong><br>Rent: <strong>${financeMoney(p.split.rent)}</strong>${p.rentAdvance?` (includes ${financeMoney(p.rentAdvance)} rent advance)`:''}<br>Maintenance / other: <strong>${financeMoney(p.split.other)}</strong></p></article>`).join('')+'</div>';
    if(!s.receipts.length)document.getElementById('financeReceipts').innerHTML='<p class="hint">No dated receipts in this period.</p>';
  } catch(error) {document.getElementById('financeResults').textContent=error.message;document.getElementById('financeReceipts').innerHTML='';}
}
function printFinance() {try{const {from,to}=financeRange();printDoc(financeReportHtml(financeTotals(from,to),from,to));}catch(e){toast(e.message,'error');}}
function downloadFinance() {try{const {from,to}=financeRange(),s=financeTotals(from,to);const rows=[['Jasmine Residency',from,to],['Particulars','Amount'],['Rent received (including rent advances)',s.rentReceived],['Electricity received',s.electricReceived],['Maintenance / other received',s.otherReceived],['Total receipts',s.received],['DHBVN paid',s.dhbvn],['Other expenses',s.expenses],['Total expenditure',s.dhbvn+s.expenses],['Cash balance',s.received-s.dhbvn-s.expenses],['Electricity variance',s.electricReceived-s.dhbvn],['Undated receipts excluded',s.undated],[],['Date','Type','Particulars','Meter','Bill month','Remarks','Amount'],...s.records.map(r=>[r.date,r.kind,r.particulars,r.meter,r.billMonth,r.remarks,r.amount])];const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+\-@]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.href=url;a.download=`Jasmine_Statement_${from}_${to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message,'error');}}
function referenceMessage(t,n) {const name=t['reference'+n+'Name']||'[Reference Person’s Name]',address=t.address||[t.permanentHouse,t.permanentLocality,t.permanentDistrict,t.permanentState,t.permanentPin].filter(Boolean).join(', ')||'[Permanent address]';return `Dear ${name},\nGreetings from Jasmine Residency, Sector 85, Gurugram.\n${t.name} is currently residing in Flat No. ${t.flat}, Jasmine Residency, Sector 85, Gurugram. They have provided your name as a reference, along with their permanent address: ${address}.\n\nWe would appreciate it if you could kindly confirm whether you know ${t.name} personally and, if possible, confirm that the above information is correct.\n\nThis verification is being requested for our residential records and resident verification purposes.\nThank you for your cooperation.\n\nRegards,\nJasmine Residency\nSikanderpur Badha, Sector 85\nGurugram – 122004\nMob. 9350184989`;}
function previewReferenceMessage() {const t=readTenantInfo();if(!t)return;const n=document.getElementById('referenceChoice').value;document.getElementById('referenceMessage').value=referenceMessage(t,n);}
async function copyReferenceMessage() {try{await navigator.clipboard.writeText(document.getElementById('referenceMessage').value);toast('Copied. Review and send it to the reference person.','success');}catch{toast('Select the message and copy it manually.','error');}}
let summaryView='tenant';
function setSummaryView(view) {
  summaryView=view;
  document.getElementById('tenantSummarySection').style.display=view==='tenant'?'':'none';
  document.getElementById('ownerSummarySection').style.display=view==='owner'?'':'none';
  document.getElementById('tenantSummaryButton').className='btn'+(view==='tenant'?' btn-primary':'');
  document.getElementById('ownerSummaryButton').className='btn'+(view==='owner'?' btn-primary':'');
  if(view==='owner')renderOwnerSummary();else changeTenantSummaryPeriod();
}
function changeTenantSummaryPeriod() {
  const mode=document.getElementById('tenantSummaryPeriod').value;
  document.getElementById('tenantMonthPicker').style.display=mode==='month'?'':'none';
  document.getElementById('tenantRangePicker').style.display=mode==='range'?'':'none';
  document.getElementById('tenantYearPicker').style.display=mode==='year'?'':'none';
  document.getElementById('summaryMonthlyDetails').style.display=mode==='month'?'':'none';
  document.getElementById('tenantPeriodResults').style.display=mode==='month'?'none':'';
  const month=currentMonthString();
  if(!document.getElementById('tenantSummaryFrom').value)document.getElementById('tenantSummaryFrom').value=month+'-01';
  if(!document.getElementById('tenantSummaryTo').value)document.getElementById('tenantSummaryTo').value=toDateInput(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0));
  const year=document.getElementById('tenantSummaryYear'),selected=year.value;
  year.innerHTML=availableFinancialYears().map(y=>`<option value="${y}" ${String(y)===selected?'selected':''}>${financialYearLabel(y)}</option>`).join('');
  if(mode==='month')renderSummary();else renderTenantPeriod();
}
function tenantSummaryRange() {const from=document.getElementById('tenantSummaryFrom').value,to=document.getElementById('tenantSummaryTo').value;if(!validFinanceDate(from)||!validFinanceDate(to)||from>to)throw new Error('Choose a valid start and end date.');return {from,to};}
function tenantPeriodReport() {
  const {from,to}=tenantSummaryRange(),s=financeTotals(from,to);
  return reportHead('Tenant Rent & Bill Summary',fmtDate(from)+' to '+fmtDate(to))+`<p>Whole monthly bills from ${escapeHtml(fmtMonth(from.slice(0,7)))} to ${escapeHtml(fmtMonth(to.slice(0,7)))}. Payments below are recorded against these bills.</p>`+financeTable(['Flat','Tenant','Bill month','Rent','Electricity','Other charges','Total due','Paid against bill','Closing balance'],s.bills.map(({t,e})=>`<tr><td>${escapeHtml(t.flat)}</td><td>${escapeHtml(e.tenantName||t.name)}</td><td>${fmtMonth(e.month)}</td><td>${financeMoney(e.rent)}</td><td>${financeMoney(e.elecBill)}</td><td>${financeMoney(chargeExtras(e))}</td><td>${financeMoney(e.totalDue)}</td><td>${financeMoney(e.paid)}</td><td>${balanceCell(e.outstanding)}</td></tr>`))+`<p><strong>Rent billed:</strong> ${financeMoney(s.rentBilled)} · <strong>Electricity billed:</strong> ${financeMoney(s.electricBilled)} · <strong>Other charges:</strong> ${financeMoney(s.otherBilled)}</p><p>Closing balances are shown per bill and should not be added across months.</p>`+reportFoot();
}
function renderTenantPeriod() {try{const mode=document.getElementById('tenantSummaryPeriod').value;document.getElementById('tenantPeriodResults').innerHTML=mode==='year'?buildYearDoc(Number(document.getElementById('tenantSummaryYear').value)):mode==='ledger'?buildLedgerDoc():tenantPeriodReport();}catch(e){document.getElementById('tenantPeriodResults').textContent=e.message;}}
function printTenantSummary() {const mode=document.getElementById('tenantSummaryPeriod').value;if(mode==='month')return printMonthFromSummary();try{const html=mode==='year'?buildYearDoc(Number(document.getElementById('tenantSummaryYear').value)):mode==='ledger'?buildLedgerDoc():tenantPeriodReport();printDoc(html);}catch(e){toast(e.message,'error');}}
function downloadTenantSummary() {
  const mode=document.getElementById('tenantSummaryPeriod').value;
  if(mode==='month')return downloadMonthFromSummary();
  if(mode==='year'){const year=Number(document.getElementById('tenantSummaryYear').value);return downloadWorkbook(`Jasmine_Tenant_Summary_${year}.xlsx`,buildYearWorkbook(year));}
  if(mode==='ledger')return downloadWorkbook('Jasmine_All_Tenant_Bills.xlsx',buildLedgerWorkbook());
  try{const {from,to}=tenantSummaryRange(),rows=financeTotals(from,to).bills;
    const sheet={name:'Tenant billing',freeze:3,cols:[12,24,14].concat(ENTRY_WIDTHS),rows:[[xText('Tenant Rent & Bill Summary',XS.title)],[xText(`${from} to ${to} · whole bill months`)],[...headerCells(['Flat','Tenant','Bill month'].concat(ENTRY_HEADER))],...rows.map(({t,e})=>[xText(t.flat),xText(e.tenantName||t.name),xText(fmtMonth(e.month)),...entryCells(e)])]};
    downloadWorkbook(`Jasmine_Tenant_Summary_${from}_${to}.xlsx`,[sheet]);
  }catch(e){toast(e.message,'error');}
}
function openReferenceMessages() {switchTab('info');const section=document.getElementById('referenceMessageSection');section.open=true;section.scrollIntoView({behavior:'smooth',block:'start'});}

function sendReferenceWhatsApp() {
  const t=readTenantInfo();if(!t)return;
  const n=document.getElementById('referenceChoice').value;
  const mobile=String(t['reference'+n+'Mobile']||'').replace(/\D/g,'');
  if(mobile.length<10||mobile.length>15){toast('Enter a valid mobile number for this reference in Tenant Info.','error');return;}
  const box=document.getElementById('referenceMessage');
  if(!box.value.trim())previewReferenceMessage();
  const number=mobile.length===10?'91'+mobile:mobile;
  window.open('https://wa.me/'+number+'?text='+encodeURIComponent(box.value),'_blank','noopener');
}
