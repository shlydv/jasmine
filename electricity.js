// Each bill snapshots its meters. Legacy entries retain their original single-meter amounts.
const meterForms = {};
function meterConfiguration(t) {
  if (Array.isArray(t.meterConfig) && t.meterConfig.length) return t.meterConfig;
  const flat=String(t.flat||'').trim();
  const count=/^104(?:\D|$)/.test(flat)?2:/^0*2(?:\D|$)/.test(flat)?4:1;
  return Array.from({length:count},(_,i)=>({id:i?'meter-'+(i+1):'main',name:'Meter '+(i+1),initial:i?'':(t.lastMeter??0),rate:t.elecRate??9}));
}
function meterBeforeMonth(t,id,month) {
  const entries=[...(t.entries||[])].filter(e=>e.month<month).sort(compareEntries).reverse();
  for(const entry of entries){const meter=(entry.meters||[]).find(m=>m.id===id);if(meter && meter.unitFinal!=null)return meter.unitFinal;if(id==='main' && entry.unitFinal!=null)return entry.unitFinal;}
  return meterConfiguration(t).find(m=>m.id===id)?.initial ?? '';
}
function extraMeterDrafts(t,month,stored) {
  return meterConfiguration(t).slice(1).map(m=>({id:m.id,name:m.name,start:meterBeforeMonth(t,m.id,month),final:'',rate:m.rate??t.elecRate??9,amount:'',...(stored||[]).find(d=>d.id===m.id)}));
}
function calculateMeterRows(rows) {
  let total=0;const meters=[];
  for(const row of rows){
    const hasStart=row.start!=='' && row.start!=null,hasFinal=row.final!=='' && row.final!=null,manual=row.amount!=='' && row.amount!=null;
    const start=hasStart?Number(row.start):null,final=hasFinal?Number(row.final):null,rate=Number(row.rate);
    if(!Number.isFinite(rate)||rate<0)return {error:row.name+': enter a valid rate.'};
    if((hasStart && (!Number.isFinite(start)||start<0)) || (hasFinal && (!Number.isFinite(final)||final<0)) || (hasStart&&hasFinal&&final<start))return {error:row.name+': final reading must not be below the start reading.'};
    if(!manual && (!hasStart||!hasFinal))return {error:row.name+': enter both readings, or enter its bill amount.'};
    if(hasFinal&&!hasStart)return {error:row.name+': enter the start reading.'};
    const consumed=hasStart&&hasFinal?roundMoney(final-start):null;
    const amount=manual?Number(row.amount):roundMoney(consumed*rate);
    if(!Number.isFinite(amount)||amount<0)return {error:row.name+': bill amount must be zero or greater.'};
    meters.push({id:row.id,name:row.name,unitStart:start,unitFinal:final,rate,consumed,amount:roundMoney(amount),manual});total+=amount;
  }
  return {meters,total:roundMoney(total)};
}
function meterRowsHtml(prefix, rows, handler) {
  meterForms[prefix]=rows;
  return rows.map((m,i)=>`<fieldset class="extra-meter"><legend>${escapeHtml(m.name)}</legend><div class="form-row">${[['start','Start reading'],['final','Final reading'],['rate','Rate / unit'],['amount','Bill amount (optional override)']].map(([key,label])=>`<div class="form-group"><label for="${prefix}_m${i}_${key}">${label}</label><input id="${prefix}_m${i}_${key}" type="number" min="0" step="0.01" value="${escapeAttr(String(m[key]??''))}" oninput="${handler}"></div>`).join('')}</div><span class="hint">Enter readings to calculate this meter, or its bill amount if readings are unavailable.</span></fieldset>`).join('');
}
function readMeterRows(prefix) {
  return (meterForms[prefix]||[]).map((m,i)=>({...m,...Object.fromEntries(['start','final','rate','amount'].map(k=>[k,document.getElementById(`${prefix}_m${i}_${k}`)?.value??m[k]??'']))}));
}
function prepareBillingMeters() {
  const t=DB.tenants[currentTenantIdx],month=document.getElementById('b_month').value;
  const rentFrom=document.getElementById('b_rentFrom');if(rentFrom)rentFrom.value=rentEffectiveDate(t,month);
  document.getElementById('b_extraMeters').innerHTML=meterRowsHtml('b',extraMeterDrafts(t,month),'calcBilling()');
  document.getElementById('b_unitStart').value=meterBeforeMonth(t,'main',month);
  document.getElementById('b_lastOutstanding').value=getBalanceBeforeMonth(t,month);
}
function billingMeterResult(showError=false) {
  const result=calculateMeterRows(readMeterRows('b'));
  if(result.error && showError)toast(result.error,'error');return result;
}
function primaryMeter(t,start,final,rate,amount) {
  return {id:'main',name:meterConfiguration(t)[0].name,unitStart:start,unitFinal:final,consumed:roundMoney(final-start),rate,amount:roundMoney(amount)};
}
function entryMeterRows(entry) {
  return (entry.meters||[]).slice(1).map(m=>({id:m.id,name:m.name,start:m.unitStart??'',final:m.unitFinal??'',rate:m.rate,amount:m.manual?m.amount:''}));
}
function addEditMeters() {
  const t=DB.tenants[currentTenantIdx],month=document.getElementById('e_month').value;
  const existing=readMeterRows('e');
  const combined=[...existing,...extraMeterDrafts(t,month).filter(m=>!existing.some(e=>e.id===m.id))];
  document.getElementById('e_extraMeters').innerHTML=meterRowsHtml('e',combined,'updateEditMeterBill()');
  updateEditMeterBill();
}
function electricityDescription(entry) {
  if(!entry.meters?.length)return entry.unitStart!=null&&entry.unitFinal!=null?`${fmt(entry.consumed)} units × ₹${fmt(entry.rate)}`:'Meter reading not recorded';
  return entry.meters.map(m=>`${m.name}: ${m.unitStart!=null&&m.unitFinal!=null?`${fmt(m.unitStart)} → ${fmt(m.unitFinal)} (${fmt(m.consumed)} units × ₹${fmt(m.rate)})`:'amount only'} = ₹${fmt(m.amount)}`).join('\n');
}
function renderMeterSettings() {
  const t=DB.tenants[currentTenantIdx];const meters=meterConfiguration(t);
  document.getElementById('meterSettings').innerHTML=`<p>Configure meters for this flat. All meters are added together in one monthly bill. Existing bills keep their saved readings and amounts.</p><div id="meterConfigRows">${meters.map((m,i)=>`<div class="form-row"><div class="form-group"><label>Meter ${i+1} name</label><input id="mc_name_${i}" value="${escapeAttr(m.name)}"></div><div class="form-group"><label>Initial reading</label><input id="mc_initial_${i}" type="number" min="0" step="0.01" value="${escapeAttr(String(m.initial??''))}"></div><div class="form-group"><label>Rate / unit</label><input id="mc_rate_${i}" type="number" min="0" step="0.01" value="${escapeAttr(String(m.rate??9))}"></div></div>`).join('')}</div><button class="btn btn-primary" onclick="saveMeterSettings()">Save meter settings</button> <button class="btn" onclick="saveMeterSettings(true)">Add another meter</button><p class="hint">104 (Hall) starts with two meters; 002 (Office) starts with four. Enter each additional meter’s opening reading, or enter bill amounts directly when billing.</p>`;
}
function saveMeterSettings(add=false) {
  const t=DB.tenants[currentTenantIdx];const next=meterConfiguration(t).map((m,i)=>({...m,name:document.getElementById('mc_name_'+i).value.trim(),initial:document.getElementById('mc_initial_'+i).value,rate:Number(document.getElementById('mc_rate_'+i).value)}));
  if(next.some(m=>!m.name||!Number.isFinite(m.rate)||m.rate<0||(m.initial!==''&&(!Number.isFinite(Number(m.initial))||Number(m.initial)<0)))){toast('Enter meter names, valid readings and non-negative rates.','error');return;}
  if(add){if(next.length>=8){toast('Up to 8 meters per flat are supported.','error');return;}next.push({id:crypto.randomUUID(),name:'Meter '+(next.length+1),initial:'',rate:t.elecRate??9});}
  t.meterConfig=next;t.lastMeter=Number(next[0].initial)||0;t.elecRate=next[0].rate;
  saveData(DB,{label:'Updated electricity meters for Flat '+t.flat});renderMeterSettings();prefillBilling();toast('Meter settings saved.','success');
}
