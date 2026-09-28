// Optional profile fields remain on the tenant object and travel with JSON backup/cloud sync.
const TENANT_SECTIONS = [
  ['Tenancy and billing', [
    ['flat','Flat / room number'], ['name','Tenant full name'], ['rent','Monthly rent (₹)','number'],
    ['security','Security deposit (₹)','number'], ['startDate','Rent start date','date'], ['dueDay','Monthly rent due day (1–28)','number'],
    ['lastMeter','Initial meter reading','number'], ['elecRate','Electricity rate (₹/unit)','number']]],
  ['Tenant personal details', [
    ['alias','Alias / nickname'], ['fatherName',"Father’s name"], ['motherName',"Mother’s name"], ['spouseName',"Spouse’s name"],
    ['dob','Date of birth','date'], ['age','Age (if date of birth unknown)','number'], ['gender','Gender'], ['nationality','Nationality'],
    ['occupation','Occupation'], ['mobile','Mobile number','tel'], ['email','Email (optional)','email']]],
  ['Landlord / owner details', [
    ['ownerName','Owner full name'], ['ownerFatherName',"Owner’s father’s name"], ['ownerSpouseName',"Owner’s spouse’s name"],
    ['ownerMobile','Owner mobile','tel'], ['ownerEmail','Owner email (optional)','email'], ['ownerOccupation','Owner occupation'],
    ['ownerAddress','Owner complete residential address','textarea'], ['ownerHouse','Property house / plot / flat / room no.'],
    ['ownerLocality','Property sector / village / colony / society'], ['ownerDistrict','Property district'], ['ownerState','Property state'],
    ['ownerPin','Property PIN code'], ['ownerPoliceStation','Property police station'], ['ownerIdType','Owner ID proof type (if requested)'], ['ownerIdNum','Owner ID number (if requested)']]],
  ['Tenant permanent address', [
    ['address','Complete permanent address (existing record)','textarea'], ['permanentHouse','House / flat number'], ['permanentLocality','Village / locality'],
    ['permanentDistrict','District'], ['permanentState','State'], ['permanentPoliceStation','Police station'], ['permanentPin','PIN code'], ['permanentPhone','Mobile / telephone','tel']]],
  ['Tenant present / local address', [
    ['localRoom','Room / flat number'], ['localProperty','Property / society name'], ['localLocality','Sector / village / locality'],
    ['localDistrict','District'], ['localState','State'], ['localPin','PIN code'], ['localPoliceStation','Police station'], ['localPolicePost','Police post'],
    ['residingSince','Residing since','date'], ['localLandlordName','Landlord name'], ['localLandlordAddress','Landlord address','textarea']]],
  ['Identity proof', [
    ['idType','Primary ID proof type','select'], ['idNum','Primary ID proof number'],
    ['voterId','Voter ID number (optional)'], ['passport','Passport number (optional)'], ['drivingLicence','Driving licence number (optional)'], ['pan','PAN (where applicable)']]],
  ...[1,2,3].map(n => [`${n < 3 ? 'Reference' : 'Additional local contact (optional)'} ${n}`, [
    [`reference${n}Name`,'Full name'], [`reference${n}FatherName`,"Father’s name"], [`reference${n}Occupation`,'Occupation'],
    [`reference${n}Address`,'Address','textarea'], [`reference${n}Mobile`,'Mobile / phone','tel']]]),
  ['Previous residence / landlord', [
    ['previousAddress','Previous address','textarea'], ['previousLandlordName','Previous landlord name'], ['previousLandlordAddress','Previous landlord address','textarea'],
    ['previousLandlordPhone','Previous landlord contact','tel'], ['previousPeriod','Period of stay'], ['previousEmployer','Previous employer'], ['previousEmploymentPeriod','Previous employment period']]],
  ['Employment details', [
    ['employerName','Company / employer name'], ['designation','Occupation / designation'], ['employmentNature','Nature of employment'],
    ['workPlace','Place of work'], ['officeAddress','Office address','textarea'], ['officePhone','Office / mobile contact','tel']]],
  ['Agreement details', [
    ['agreementDate','Execution date','date'], ['agreementPlace','Place of execution'], ['agreementEnd','Licence end date','date'],
    ['agreementMonths','Duration (months)','number'], ['propertyFloor','Floor'], ['propertyArea','Area (sq ft)','number'],
    ['rentWords','Monthly rent in words'], ['securityWords','Deposit in words'], ['inventory','Fixtures / fittings / quantities / condition','textarea'],
    ['agreementNotes','Additional agreed terms / notes','textarea']]]
];
let tenantMediaDraft = {};
let tenantMediaPending = 0;
const TENANT_MEDIA = [['photo','Tenant photograph'], ['tenantSignature','Tenant signature'], ['ownerSignature','Owner signature']];
function safeTenantImage(value) {
  return typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
}
function tenantField([key,label,type = 'text'], tenant) {
  const value = tenant[key] ?? (key === 'dueDay' ? getDueDay(tenant) : '');
  const attrs = `id="ti_${key}" name="${key}"`;
  let input;
  if (key === 'dob') input = dobInput('ti_dob', String(value));
  else if (type === 'textarea') input = `<textarea ${attrs} rows="3">${escapeHtml(String(value))}</textarea>`;
  else if (type === 'select') input = `<select ${attrs}>${[...new Set(['','Aadhaar Card','PAN Card','Passport','Voter ID','Driving Licence','Other', String(value)])].map(option => `<option ${value === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`;
  else input = `<input ${attrs} type="${type}" value="${escapeAttr(String(value))}" ${type === 'number' ? `min="${key === 'dueDay' ? 1 : 0}" step="any" ${key === 'dueDay' ? 'max="28"' : ''}` : ''}>`;
  return `<div class="form-group"><label for="ti_${key}">${label}</label>${input}</div>`;
}
function renderTenantInfoForm() {
  const t = DB.tenants[currentTenantIdx];
  initAttachmentDraft(t);
  tenantMediaDraft = Object.fromEntries(TENANT_MEDIA.map(([key]) => [key, safeTenantImage(t[key])]));
  document.getElementById('tenantInfoForm').innerHTML = `<p class="hint">Save the details once for verification and agreements. Optional fields can be left blank.</p>` +
    TENANT_SECTIONS.map(([title, fields], i) => `<details class="tenant-section" ${i < 2 ? 'open' : ''}><summary>${title}</summary><div class="form-row">${fields.map(field => tenantField(field,t)).join('')}</div></details>`).join('') +
    documentSection() + `<details class="tenant-section"><summary>Photograph and signatures</summary><p class="hint">Upload JPG, PNG or WebP images up to 5 MB. Photos are compressed and stored separately. Save Changes to keep uploads or removals; cloud sync uploads the files.</p><div class="form-row">${TENANT_MEDIA.map(([key,label]) => `<div class="form-group"><label for="ti_${key}">${label}</label><input type="file" id="ti_${key}" accept="image/jpeg,image/png,image/webp" onchange="uploadTenantImage('${key}',this)"><div id="ti_preview_${key}">${tenantImagePreview(key)}</div><button class="btn btn-sm" type="button" onclick="removeTenantImage('${key}')">Remove image</button></div>`).join('')}</div></details>
    <div style="margin:16px 0"><button class="btn btn-primary btn-sm" type="button" onclick="printTenantVerification()">Print verification details / PDF</button> <button class="btn btn-primary btn-sm" type="button" onclick="previewAgreementDraft()">Preview agreement draft</button><span class="hint"> Uses the current form values.</span></div>`;
  renderDocumentList();
  refreshTenantMedia();
}
function tenantImagePreview(key) {
  const src = safeTenantImage(tenantMediaDraft[key]);
  return src ? `<img src="${src}" alt="${key}" style="max-width:180px;max-height:130px;object-fit:contain;margin:8px 0">` : '<span class="hint">No image selected</span>';
}
function readTenantInfo() {
  if (tenantMediaPending) { toast('Please wait for the image upload to finish.', 'error'); return null; }
  if (!updateDob('ti_dob', true)) return null;
  const t = {...DB.tenants[currentTenantIdx]};
  for (const [,fields] of TENANT_SECTIONS) for (const [key,label,type] of fields) {
    const input = document.getElementById('ti_' + key);
    if (!input.checkValidity()) { input.closest('details').open = true; input.reportValidity(); return null; }
    t[key] = type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value.trim();
  }
  if (!t.flat || !t.name) { toast('Flat number and tenant name are required.', 'error'); return null; }
  t.dueDay = normalizeDueDay(t.dueDay, t.startDate);
  ['rent','security','lastMeter','elecRate'].forEach(key => t[key] = Number(t[key]) || 0);
  t.documents=tenantDocumentDraft.map(ref=>({...ref}));
  for(const [key] of TENANT_MEDIA)t[key+'File']=tenantMediaFileDraft[key]||null;
  return Object.assign(t, tenantMediaDraft);
}
function saveTenantInfo() {
  const t = readTenantInfo(); if (!t) return;
  const previous = DB.tenants[currentTenantIdx];
  const nextData = {...DB, tenants: DB.tenants.map((tenant, index) => index === currentTenantIdx ? t : tenant)};
  if (new TextEncoder().encode(JSON.stringify(nextData)).length > 1900000) { toast('Images would exceed cloud storage capacity. Remove an image or use a smaller one before saving.', 'error'); return; }
  DB.tenants[currentTenantIdx] = t;
  try { saveData(DB, {label:'Edited tenant details for Flat ' + t.flat}); }
  catch (error) { DB.tenants[currentTenantIdx] = previous; toast('Could not save. Device storage may be full; remove large images and try again.', 'error'); return; }
  openTenant(currentTenantIdx); switchTab('info'); toast('Tenant info saved!', 'success');
}
// Keep paid as the aggregate for existing reports, balances and historical imports.
function entryPayments(entry) {
  const blank = () => ({amount:0,date:'',mode:''});
  if (Array.isArray(entry.payments)) return [0,1].map(i => ({...blank(),...entry.payments[i]}));
  return [{amount:Number(entry.paid)||0,date:entry.payDate||'',mode:entry.payMode||''},blank()];
}
function draftPayments(draft) {
  return [{amount:roundMoney(Number(draft.paid)||0),date:draft.date||'',mode:draft.mode||''}, {amount:roundMoney(Number(draft.paid2)||0),date:draft.date2||'',mode:draft.mode2||''}];
}
function readPaymentInputs(prefix) {
  const payments = ['', '2'].map(suffix => ({amount:Number(document.getElementById(prefix+'_paid'+suffix).value), date:document.getElementById(prefix+'_payDate'+suffix).value, mode:document.getElementById(prefix+'_payMode'+suffix).value}));
  if (payments.some(p => !Number.isFinite(p.amount) || p.amount < 0)) { toast('Payments must be valid, non-negative amounts.', 'error'); return null; }
  return payments.map(p => ({...p,amount:roundMoney(p.amount)}));
}
function paymentSummary(entry) {
  return entryPayments(entry).map((p,i) => p.amount ? `Payment ${i+1}: ₹${fmt(p.amount)}${p.date ? ' on '+fmtDate(p.date) : ''}${p.mode ? ' · '+p.mode : ''}` : '').filter(Boolean).join('\n') || '—';
}
function paymentSummaryHtml(entry) { return escapeHtml(paymentSummary(entry)).replace(/\n/g,'<br>'); }

const AGREEMENT_TEMPLATE_CLAUSES = [
  "2. Maintenance, Electricity and Water Charges",
  "a). That during the licence period, in addition to the monthly licence fee payable to the Licensor, the Licensee shall pay for the use of electricity & water as per bills received from Licensor.",
  "b. It is the responsibility of the Licensor to pay and clear all the dues of electricity bills & Water bills according to the readings on the respective meters till the date the possession of the premises is handed over by the Licensor to the Licensee.",
  "c). And it is the responsibility of the Licensee to pay the same up to the date of vacating of the property at the time of handing over possession of the premises back to the Licensor.",
  "3. Damages, Repairs and Alterations",
  "a). That all the sanitary, electrical and other fittings and fixtures and appliances in the premises shall be handed over from the Licensor to the Licensee in good working condition. There will be 2 weeks maintenance period after the possession of Licensee. If during these 2 weeks any defect in the same is identified & duly notified, the Licensor shall be responsible to repair/ replace the same at his own cost. Upon returning the premises, all the sanitary, electrical and other fittings and fixtures will be restored by the Licensee in a good condition as they are at present, subject to normal wear and tear or damage by act of God.",
  "b). That the day-to-day minor repairs such as leakage in the sanitary fittings, water taps and electrical usage etc. will be the responsibility of the Licensee at his own expense. However, any structural or major repairs, if so required, shall be carried out by the Licensor.",
  "c). That the Licensor shall hold the right to visit in person or his authorized agents, servants, workmen etc., to enter upon the property for inspection (not exceeding once in a month) or to carry out repairs / construction, as and when required, by giving a 24 hours notice to the Licensee.",
  "d). That no structural additions or alterations shall be made by the Licensee in the premises without the prior written consent of the Licensor.",
  "4. Licensee’s Responsibilities",
  "That the Licensee hereby assures to the covenants with the Licensor that:",
  "a). That the Licensee shall not sublet, assign or part with the property in whole or part thereof to any person in any circumstances whatsoever and the same shall be used for the bonafide residential purposes of the Licensee and his family and guests.",
  "b). That the Licensee will keep the Licensor harmless and free from all losses, damage, liability or expense due to acts or neglects of the Licensee, or his visitors whether in the licenced premises or elsewhere in the building or its approaches.",
  "c). The Licensee shall maintain the property in good and tenable condition. The Licensee shall hand over the vacant and peaceful possession of the property on termination of the licence period, in the same condition subject to natural wear and tear.",
  "d). Late Payment Fine - If the Licensee fails to pay the licence fee on the fixed date of payment, he shall be liable to pay a fine at the rate of 100/- (Rupees one Hundred only) per day till the date of payment.",
  "5. Licensor’s Responsibilities",
  "That the Licensor hereby assures to the covenants with the Licensee that:",
  "a). The Licensee, abiding by the terms of the licence, shall be entitled to peacefully and quietly hold and enjoy the property during the period of this licence free of any interference from the Licensor.",
  "b). The Licensor shall indemnify the Licensee against all damages, costs and expenses incurred by the Licensee as a result of any defect in the title of the Licensor which disturbs the possession and enjoyment of the property by the Licensee under the covenants herein before contained.",
  "c). The Licensor represents that he/she has complied with all the statutory payments of the property including that of taxes, penalties, electric charges, water charges etc if any. The Licensor also represents that there is no Charge including mortgage due existing on the property which would affect the peaceful possession of the Licensee of the property.",
  "d). The Licensor shall have full rights to take immediate possession of the property on breach of any of the herein mentioned terms and conditions on the part of the Licensee.",
  "6. Licence Termination & Extension",
  "a). Notice Period - The licence shall terminate at the end of the licence period as referred above or by a prior notice of 1 month by either parties, after the lock-in period if any.",
  "b). Percentage Increase in Licence fee - The licence may be extended further on termination by both parties on mutual consent with 10% increase in the monthly licence fee.",
  "c). Non-payment of Licence Fee -If the Licensee fails to pay the monthly licence fee for a continuous period of 15 days after due date, or if the Licensee fails to abide by any of the covenants  above, the Licensor may terminate the licence.",
  "d). If the Licensee cannot use the premises or any part thereof for residential purposes because of natural calamity or any commotions, or is acquired by any Government authority, the Licensee shall have the right to terminate the licence forthwith and vacate the premises and the Licensor shall refund the deposits and advance payments to the Licensee.",
  "e). In the event the Licensor sells, transfers or alienates the licenced premises or any part thereof or its right, title and interest, then the Licensor shall terminate the licence after giving one month notice to the Licensee.",
  "7. Additional Clauses",
  "a). Refund of Security Deposit - The Security deposit shall be refunded by the Licensor to the Licensee at the time of handing over possession of the property by the Licensee upon expiry or sooner termination of this licence after adjusting the dues (if any) or cost towards damages caused by the negligence of the Licensee or the person he/she is responsible for. This excludes normal wear & tear and damages due to act of god. No interest shall be paid on the deposit amount.",
  "b). Non-refund by Licensor - In case the Licensor fails to refund the security deposit to the Licensee on early termination or expiry of the licence agreement, the Licensee is entitled to hold possession of the licenced premises, without payments of Licence fee and/or any other charges whatsoever, till such time the Licensor refunds the security deposit to the Licensee. This is in addition to the other legal remedies available to the Licensee to recover the amount from the Licensor.",
  "c). Lock in period - The licence shall have a lock-in period of 6 months before which termination is not possible. If the licensee terminates the licence during the lock-in period, then he shall pay a sum equal to one month Licence fee to Licensor.",
  "d). Overstay - That in case, where the Premises are not vacated by the Licensee, on the termination of the licence period, the Licensee will pay damages calculated twice the Licence fee for any period of occupation commencing from the expiry of the licence period. The payment of damages as aforesaid will not preclude the Licensor from initiating legal proceedings against the Licensee for the same.",
  "e).Pets - The Licensee shall not be allowed to keep any pets within the premises.",
  "f). That the Licensee and the Licensor represent and warrant that they are fully empowered and competent to make this licence.",
  "g). This agreement shall be governed by Indian Contract Act, 1882.",
  "h). The Licensor and the Licensee shall bear and pay all cost and expenses equally by way of stamp duty, registration charges, etc. in respect of this Agreement. Each party shall bear and pay the professional fees of their respective agent’s advocates.",
  "i). This licence Deed shall be executed. The original shall be retained by the Licensor and the copy by the Licensee"
];

function buildAgreementDraft(t) {
  const val = key => escapeHtml(String(t[key] || '____________________'));
  const permanent = t.address || [t.permanentHouse,t.permanentLocality,t.permanentDistrict,t.permanentState,t.permanentPin].filter(Boolean).join(', ');
  const property = [t.localRoom || t.flat,t.localProperty,t.localLocality,t.localDistrict,t.localState,t.localPin].filter(Boolean).join(', ');
  const p = text => `<p style="line-height:1.7;margin:12px 0">${text}</p>`;
  return `<h1>Leave and Licence Agreement</h1><p><strong>DRAFT — for review</strong></p>` +
    p(`THIS DEED OF LEAVE AND LICENCE is made and executed at ${val('agreementPlace')} on ${val('agreementDate')}, between ${val('ownerName')}, ${t.ownerSpouseName ? 'spouse of ' + val('ownerSpouseName') : 'child of ' + val('ownerFatherName')}, residing at ${val('ownerAddress')} (hereinafter called the Licensor, which expression shall include their heirs, legal representatives, successors and assigns).`) +
    p(`AND ${val('name')}, child of ${val('fatherName')}, having permanent address at ${escapeHtml(permanent || '____________________')}, having ${val('idType')} number ${val('idNum')} (hereinafter called the Licensee, which expression shall include their legal representatives, successors and assigns).`) +
    p(`WHEREAS the Licensor is the absolute owner of the apartment / flat ${escapeHtml(property)}, floor ${val('propertyFloor')}, measuring ${val('propertyArea')} sq ft, with fixtures and fittings listed in the annexure, hereinafter referred to as the property. The Licensee has approached the Licensor seeking the property on leave and licence for ${val('agreementMonths')} months for residential purpose only on the terms mutually agreed below.`) +
    '<h2>1. Terms and Conditions</h2>' +
    p(`a). Duration — The licence commences on ${val('startDate')} and ends on ${val('agreementEnd')}, for a period of ${val('agreementMonths')} months.`) +
    p(`b). Monthly licence fee — The Licensee shall pay ₹${fmt(t.rent)} (${val('rentWords')}) per month in advance on or before day ${val('dueDay')} of every month. If the Licensee fails to pay when due, the Licensor has the right to cancel the agreement without notice or compensation to the Licensee.`) +
    p(`c). The Licensee has paid an interest-free refundable security deposit of ₹${fmt(t.security)} (${val('securityWords')}).`) +
    AGREEMENT_TEMPLATE_CLAUSES.map(text => /^\d\./.test(text) ? `<h2 style="font-size:18px">${escapeHtml(text)}</h2>` : p(escapeHtml(text))).join('') +
    (t.agreementNotes ? '<h2>Additional agreed terms</h2>' + p(val('agreementNotes')) : '') +
    p('IN WITNESS WHEREOF the parties have executed this agreement on the date stated above.') +
    `<div class="rep-sign"><div>Licensor: ${val('ownerName')}<br>Signature: ____________________</div><div>Licensee: ${val('name')}<br>Signature: ____________________</div></div>` +
    '<h2>Witnesses</h2>' + [1,2].map(n => p(`${n}. Name: ____________________ Address: ____________________<br>Phone: ____________________ Signature: ____________________ Date: ____________________`)).join('') +
    '<h2>Annexure — Fixtures and fittings</h2>' + `<p style="white-space:pre-wrap">${val('inventory')}</p>`;
}
function previewAgreementDraft() {
  const t = readTenantInfo(); if (!t) return;
  if (t.agreementEnd && t.startDate && t.agreementEnd <= t.startDate) { toast('The licence end date must be after the start date.', 'error'); return; }
  let modal = document.getElementById('agreementPreview');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'agreementPreview'; modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal" style="max-width:850px"><h3>Agreement draft</h3><p class="hint">Uses the clauses from your supplied leave and licence template. Review the dates, amounts, fixed terms and blanks before printing.</p><div id="agreementDraftBody" class="rep-doc" style="max-height:60vh;overflow:auto"></div><div style="margin-top:16px"><button class="btn btn-primary" onclick="printDoc(document.getElementById('agreementDraftBody').innerHTML)">Print draft / Save PDF</button> <button class="btn" onclick="closeModal('agreementPreview')">Close</button></div></div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('agreementDraftBody').innerHTML = buildAgreementDraft(t);
  modal.classList.add('open');
}

function paymentModes(entry) { return [...new Set(entryPayments(entry).filter(p => p.amount && p.mode).map(p => p.mode))].join(" / "); }
