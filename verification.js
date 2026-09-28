// Dates are stored as ISO values; the user can type the year without navigating a calendar.
function dobInput(id, value = '') {
  const [year='',month='',day=''] = String(value).split('-');
  return `<div class="dob-fields"><input aria-label="Birth day" id="${id}_day" type="number" min="1" max="31" placeholder="Day" value="${escapeAttr(day)}" oninput="updateDob('${id}')"><select aria-label="Birth month" id="${id}_month" onchange="updateDob('${id}')"><option value="">Month</option>${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>`<option value="${i+1}" ${Number(month)===i+1?'selected':''}>${m}</option>`).join('')}</select><input aria-label="Birth year" id="${id}_year" type="number" min="1900" max="${new Date().getFullYear()}" placeholder="Year, e.g. 1985" value="${escapeAttr(year)}" oninput="updateDob('${id}')"></div><input type="hidden" id="${id}" value="${escapeAttr(value)}"><span class="hint" id="${id}_hint">Type the birth year directly.</span>`;
}
function parseBirthDate(day, month, year) {
  if (![day,month,year].some(v=>String(v).trim())) return {value:''};
  if ([day,month,year].some(v=>!/^\d+$/.test(String(v)))) return {error:'Enter the day, month and four-digit birth year.'};
  const d=Number(day),m=Number(month),y=Number(year),date=new Date(y,m-1,d);
  if (String(year).length!==4 || y<1900 || date.getFullYear()!==y || date.getMonth()!==m-1 || date.getDate()!==d || date>new Date()) return {error:'Enter a valid birth date in the past (for example, 15 / May / 1985).'};
  return {value:`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`};
}
function updateDob(id, showError = false) {
  const result=parseBirthDate(...['day','month','year'].map(part=>document.getElementById(`${id}_${part}`).value));
  document.getElementById(id).value=result.value || '';
  document.getElementById(id+'_hint').textContent=result.error || 'Type the birth year directly.';
  if (result.error && showError) { toast(result.error,'error'); document.getElementById(id+'_year').focus(); }
  return !result.error;
}
function verificationDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value||'') ? value.split('-').reverse().join('/') : value; }
function buildVerificationPages(t, media = {}) {
  const value=v=>escapeHtml(String(v === 0 ? 0 : v || '—'));
  const joined=(...keys)=>keys.map(k=>t[k]).filter(Boolean).join(', ');
  const row=(label,v,label2,v2)=>`<tr><th>${label}</th><td ${label2?'':'colspan="3"'}>${value(v)}</td>${label2?`<th>${label2}</th><td>${value(v2)}</td>`:''}</tr>`;
  const section=(title,rows)=>`<section class="pv-section"><h2>${title}</h2><table><colgroup><col style="width:19%"><col style="width:31%"><col style="width:19%"><col style="width:31%"></colgroup><tbody>${rows.join('')}</tbody></table></section>`;
  const photo=media.photo || safeTenantImage(t.photo);
  const image=(src,label)=>src?`<img src="${escapeAttr(src)}" alt="${label}">`:label;
  const footer=n=>`<footer>Tenant / Paying Guest Verification · Flat ${value(t.flat)} · ${value(t.name)}<span>${n} / 2</span></footer>`;
  return `<div class="pv-document"><article class="pv-page"><header class="pv-header"><div><h1>Police Verification Details</h1><p>Tenant / Paying Guest · Gurugram, Haryana</p><p><strong>Flat / room:</strong> ${value(t.flat)}<br><strong>Tenant:</strong> ${value(t.name)}</p></div><div class="pv-photo">${image(photo,'Recent tenant photograph')}</div></header>`+
    section('1. Tenant particulars',[
      row('Full name',t.name,'Alias',t.alias),row('Father’s name',t.fatherName,'Mother’s name',t.motherName),row('Spouse’s name',t.spouseName,'Gender',t.gender),
      row('Date of birth',verificationDate(t.dob),'Age',t.age),row('Nationality',t.nationality,'Occupation',t.occupation),row('Mobile',t.mobile,'Email',t.email)])+
    section('2. Landlord / owner',[
      row('Full name',t.ownerName,'Occupation',t.ownerOccupation),row('Father’s name',t.ownerFatherName,'Spouse’s name',t.ownerSpouseName),row('Mobile',t.ownerMobile,'Email',t.ownerEmail),
      row('Home address',t.ownerAddress),row('Property address',joined('ownerHouse','ownerLocality','ownerDistrict','ownerState','ownerPin')),row('Police station',t.ownerPoliceStation,'ID proof / number',joined('ownerIdType','ownerIdNum'))])+
    section('3. Permanent address',[
      row('Complete address',t.address),row('House / flat',t.permanentHouse,'Village / locality',t.permanentLocality),row('District / state',joined('permanentDistrict','permanentState'),'PIN',t.permanentPin),row('Police station',t.permanentPoliceStation,'Phone',t.permanentPhone)])+
    section('4. Present / local address',[
      row('Room / society',joined('localRoom','localProperty')||t.flat,'Sector / locality',t.localLocality),row('District / state',joined('localDistrict','localState'),'PIN',t.localPin),
      row('Police station',t.localPoliceStation,'Police post',t.localPolicePost),row('Residing since',verificationDate(t.residingSince||t.startDate),'Landlord name',t.localLandlordName||t.ownerName),row('Landlord address',t.localLandlordAddress||t.ownerAddress)])+
    section('5. Identity proof',[
      row('Primary proof',t.idType,'ID number',t.idNum),row('Voter ID',t.voterId,'Passport',t.passport),row('Driving licence',t.drivingLicence,'PAN',t.pan)])+footer(1)+`</article><article class="pv-page">`+
    `<header><h1>Verification Details — continued</h1><p>${value(t.name)} · Flat ${value(t.flat)}</p></header>`+
    section('6. Employment',[
      row('Company / employer',t.employerName,'Designation',t.designation||t.occupation),row('Employment nature',t.employmentNature,'Place of work',t.workPlace),row('Office address',t.officeAddress),row('Office / mobile',t.officePhone)])+
    section('7. Previous residence / employment',[
      row('Previous address',t.previousAddress),row('Landlord name',t.previousLandlordName,'Contact',t.previousLandlordPhone),row('Landlord address',t.previousLandlordAddress),row('Period of stay',t.previousPeriod,'Previous employer',t.previousEmployer),row('Employment period',t.previousEmploymentPeriod)])+
    [1,2,3].map(n=>section(n===3?'10. Additional local contact (optional)':`${n+7}. Reference ${n}`, [
      row('Name',t[`reference${n}Name`],'Father’s name',t[`reference${n}FatherName`]),row('Occupation',t[`reference${n}Occupation`],'Phone',t[`reference${n}Mobile`]),row('Address',t[`reference${n}Address`])])).join('')+
    `<section class="pv-section"><h2>Declaration</h2><p>I declare that the information provided above is true and correct to the best of my knowledge.</p><p>Place: ____________________ &nbsp; Date: ____________________</p><div class="pv-signatures"><div>${image(media.tenantSignature||safeTenantImage(t.tenantSignature),'Signature: ____________________')}<p>Tenant: ${value(t.name)}</p></div><div>${image(media.ownerSignature||safeTenantImage(t.ownerSignature),'Signature: ____________________')}<p>Landlord / applicant: ${value(t.ownerName)}</p></div></div></section><section class="pv-section"><h2>For police use</h2><p>Officer / unit: ____________________ &nbsp; Date: ____________________</p><p>Remarks / result: ______________________________________________________________</p><p>Signature and seal: ____________________</p></section>${footer(2)}</article></div>`;
}
async function printTenantVerification() {
  const t=readTenantInfo(); if (!t) return;
  try {
    const media={};
    for (const [key] of TENANT_MEDIA) if (t[key+'File']) media[key]=await attachmentImageData(t[key+'File']);
    const area=document.getElementById('printArea');area.innerHTML=buildVerificationPages(t,media);
    await Promise.all([...area.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));
    // A4 layout is fitted without clipping or dropping any field. Reject exceptional overflow.
    const pages=[...area.querySelectorAll('.pv-page')];
    area.classList.add('pv-measure');
    const fits=p=>{const last=[...p.querySelectorAll('.pv-section')].at(-1);return p.scrollHeight<=p.clientHeight+1 && last.getBoundingClientRect().bottom+6<=p.querySelector('footer').getBoundingClientRect().top;};
    let size=9.2;
    for (;size>=7.6;size-=0.2) {area.style.setProperty('--pv-font',size+'pt');if(pages.every(fits))break;}
    const overflow=!pages.every(fits); area.classList.remove('pv-measure');
    if(overflow){toast('These details exceed two pages. Shorten very long address or contact entries before printing.','error');return;}
    window.print();
  } catch(error) {toast('Could not load the photograph for printing. '+error.message,'error');}
}
