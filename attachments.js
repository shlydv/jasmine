// Files are kept in IndexedDB offline, and in private D1 attachment records online.
let attachmentDatabase;
let tenantDocumentDraft=[];
let tenantMediaFileDraft={};
let ocrBusy=false;
let ocrReviewContext=null;
const attachmentURLs=new Map();
const FILE_LIMIT=5*1024*1024;
const FILE_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function attachmentDB() {
  if(!attachmentDatabase)attachmentDatabase=new Promise((resolve,reject)=>{const req=indexedDB.open('jasmine-attachments',1);req.onupgradeneeded=()=>req.result.createObjectStore('files',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('Device file storage is unavailable.'));});
  return attachmentDatabase;
}
async function localAttachment(id, record) {
  const db=await attachmentDB();return new Promise((resolve,reject)=>{const tx=db.transaction('files',record?'readwrite':'readonly');const req=record?tx.objectStore('files').put(record):tx.objectStore('files').get(id);let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('Device storage is full or unavailable.'));tx.onabort=tx.onerror;});
}
function attachmentReferences(data) {
  const refs=new Map();for(const t of data.tenants||[]){for(const ref of [...(t.documents||[]),...['photoFile','tenantSignatureFile','ownerSignatureFile'].map(k=>t[k])])if(ref&&FILE_ID.test(ref.id))refs.set(ref.id,ref);}return [...refs.values()];
}
async function stageAttachment(blob,name) {
  if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(blob.type)||!blob.size||blob.size>FILE_LIMIT)throw new Error('Choose a PDF, JPG, PNG or WebP file up to 5 MB.');
  const ref={id:crypto.randomUUID(),name:name.slice(0,180),mime:blob.type,size:blob.size};
  await localAttachment(ref.id,{...ref,blob,synced:false});return ref;
}
async function syncAttachmentFiles(data) {
  for(const ref of attachmentReferences(data)){
    const local=await localAttachment(ref.id);if(!local||local.synced)continue;
    const response=await fetch('/api/files/'+ref.id,{method:'PUT',credentials:'same-origin',headers:{'content-type':ref.mime,'x-file-name':encodeURIComponent(ref.name)},body:local.blob});
    await readCloudResponse(response);await localAttachment(ref.id,{...local,synced:true});
  }
}
async function attachmentBlob(ref) {
  if(!ref||!FILE_ID.test(ref.id))throw new Error('Invalid attachment reference.');
  const local=await localAttachment(ref.id);if(local?.blob)return local.blob;
  const response=await fetch('/api/files/'+ref.id,{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('This file is not available on this device. Connect and sign in to Cloudflare, then try again.');
  const blob=await response.blob();if(blob.size>FILE_LIMIT||!['application/pdf','image/jpeg','image/png','image/webp'].includes(blob.type))throw new Error('Unexpected file response.');
  await localAttachment(ref.id,{...ref,blob,synced:true});return blob;
}
function blobDataURL(blob) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});}
async function attachmentImageData(ref) {const blob=await attachmentBlob(ref);if(!blob.type.startsWith('image/'))throw new Error('Expected a photo.');return blobDataURL(blob);}
async function downloadAttachment(id) {
  try {const ref=attachmentReferences({tenants:[{documents:tenantDocumentDraft,...Object.fromEntries(Object.entries(tenantMediaFileDraft).map(([k,v])=>[k+'File',v]))}]}).find(r=>r.id===id);const blob=await attachmentBlob(ref);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=ref.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message,'error');}
}
function initAttachmentDraft(t) {
  tenantDocumentDraft=(t.documents||[]).filter(d=>FILE_ID.test(d.id)).map(d=>({...d}));
  tenantMediaFileDraft=Object.fromEntries(TENANT_MEDIA.map(([key])=>[key,t[key+'File']||null]));
}
function documentSection() {
  return `<details class="tenant-section"><summary>ID documents and Aadhaar import</summary><p class="hint">Upload PDF / JPG / PNG / WebP up to 5 MB. Files are kept on this device and uploaded privately with cloud sync after Save Changes. OCR runs on this device; review suggestions before applying them.</p><label for="aadhaarFile">Add an ID document</label><input id="aadhaarFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onchange="addIdentityDocument(this)"><div id="documentList"></div><p id="ocrStatus" role="status" aria-live="polite"></p><div id="ocrReview"></div><button type="button" class="btn btn-sm" onclick="showAttachmentStorage()">Check file storage</button><p id="attachmentStorage" class="hint"></p></details>`;
}
function renderDocumentList() {
  const list=document.getElementById('documentList');if(!list)return;
  list.innerHTML=tenantDocumentDraft.map(ref=>`<div class="document-row"><strong>${escapeHtml(ref.name)}</strong> <span class="hint">${Math.ceil(ref.size/1024)} KB</span><div><button class="btn btn-sm" onclick="downloadAttachment('${ref.id}')">Download</button> <button class="btn btn-sm" onclick="readAadhaarDocument('${ref.id}')">Read Aadhaar details</button> <button class="btn btn-sm" onclick="removeIdentityDocument('${ref.id}')">Remove</button></div></div>`).join('')||'<p class="hint">No ID documents uploaded.</p>';
}
async function showAttachmentStorage() {
  const el=document.getElementById('attachmentStorage');try{const r=await readCloudResponse(await fetch('/api/files',{credentials:'same-origin',cache:'no-store'}));if(!Number.isFinite(r.bytes))throw new Error();el.textContent=`Cloud files: ${(r.bytes/1024/1024).toFixed(1)} MB of ${(r.budget/1024/1024).toFixed(0)} MB reserved (${r.files} files). Removed files are retained for backup/undo.`;}catch{el.textContent='Cloud file storage could not be checked. Local files are retained; use Sync now after reconnecting.';}
}
async function addIdentityDocument(input) {
  const file=input.files[0];if(!file)return;const draft=tenantDocumentDraft;
  if(draft.length>=10){toast('Up to 10 ID documents per tenant.','error');input.value='';return;}
  tenantMediaPending++;
  try{const ref=await stageAttachment(file,file.name);if(draft!==tenantDocumentDraft)return;draft.push(ref);renderDocumentList();toast('Document added on this device. Save Changes to keep it with this tenant.','success');}
  catch(error){toast(error.message,'error');}finally{tenantMediaPending--;input.value='';}
}
function removeIdentityDocument(id){tenantDocumentDraft=tenantDocumentDraft.filter(r=>r.id!==id);ocrReviewContext=null;document.getElementById('ocrReview').innerHTML='';renderDocumentList();}
async function compressPhoto(file) {
  const image=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1200/Math.max(image.width,image.height));canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);image.close();
  for(const quality of [.85,.7,.5]){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<300000)return blob;}throw new Error('Photo is too detailed to compress. Please select a smaller image.');
}
async function uploadTenantImage(key,input) {
  const file=input.files[0];if(!file)return;const draft=tenantMediaDraft,files=tenantMediaFileDraft;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>FILE_LIMIT){toast('Choose a JPG, PNG or WebP photo up to 5 MB.','error');input.value='';return;}
  tenantMediaPending++;
  try{const blob=await compressPhoto(file);const ref=await stageAttachment(blob,key+'.jpg');if(draft!==tenantMediaDraft||files!==tenantMediaFileDraft)return;files[key]=ref;draft[key]='';await refreshTenantMedia();}
  catch(error){toast(error.message,'error');}finally{tenantMediaPending--;input.value='';}
}
function removeTenantImage(key) {
  if(tenantMediaPending){toast('Wait for the upload to finish before removing it.','error');return;}
  tenantMediaDraft[key]='';tenantMediaFileDraft[key]=null;document.getElementById('ti_preview_'+key).innerHTML=tenantImagePreview(key);
}
async function refreshTenantMedia() {
  const draft=tenantMediaFileDraft;
  for(const [key] of TENANT_MEDIA){const ref=draft[key];if(!ref)continue;const preview=document.getElementById('ti_preview_'+key);if(!preview)continue;preview.textContent='Loading saved image…';try{let url=attachmentURLs.get(ref.id);if(!url){url=URL.createObjectURL(await attachmentBlob(ref));attachmentURLs.set(ref.id,url);}if(draft!==tenantMediaFileDraft||draft[key]?.id!==ref.id)continue;preview.innerHTML=`<img src="${escapeAttr(url)}" alt="${key}" style="max-width:180px;max-height:130px;object-fit:contain">`;}catch(error){if(draft===tenantMediaFileDraft)preview.textContent=error.message;}}
}
// English Aadhaar text only. No guessed birth date from year of birth; masked IDs stay masked.
function parseAadhaarText(text) {
  const lines=String(text).replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean),result={};
  const dob=String(text).match(/(?:DOB|D\.O\.B\.?|Date\s+of\s+Birth|Birth\s*Date)[^\d\n]{0,20}(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/i);
  if(dob){const date=parseBirthDate(dob[1],dob[2],dob[3]);if(date.value)result.dob=date.value;}
  const gender=String(text).match(/\b(FEMALE|MALE|TRANSGENDER)\b/i);if(gender)result.gender=gender[1][0].toUpperCase()+gender[1].slice(1).toLowerCase();
  const numbers=[...String(text).matchAll(/\b([2-9]\d{3})[ -]?(\d{4})[ -]?(\d{4})\b/g)].map(m=>m.slice(1).join(''));
  const masked=String(text).match(/(?<![A-Za-z0-9])[Xx*]{4}\s*[Xx*]{4}\s*\d{4}\b/);
  if(masked)result.idNum=masked[0].replace(/\s/g,'').toUpperCase();else if(new Set(numbers).size===1)result.idNum=numbers[0];
  if(result.idNum)result.idType='Aadhaar Card';
  const named=lines.find(l=>/^Name\s*[:\-]/i.test(l));
  if(named)result.name=named.replace(/^Name\s*[:\-]\s*/i,'');
  else {const i=lines.findIndex(l=>/(?:DOB|Date of Birth|Year of Birth|D\.O\.B)/i.test(l));if(i>0 && /^[A-Za-z][A-Za-z .'-]{2,70}$/.test(lines[i-1]) && !/government|india|authority|unique|aadhaar|download|enrol/i.test(lines[i-1]))result.name=lines[i-1];}
  const addrIndex=lines.findIndex(l=>/^Address\s*[:\-]?/i.test(l));
  if(addrIndex>=0){const address=[];for(let i=addrIndex;i<lines.length&&address.length<8;i++){let line=i===addrIndex?lines[i].replace(/^Address\s*[:\-]?\s*/i,''):lines[i];if(/\b(?:1947|help@|www\.|uidai|VID|Aadhaar|[2-9]\d{3}\s\d{4}\s\d{4})\b/i.test(line))break;if(line)address.push(line);if(/\b\d{6}\b/.test(line))break;}if(address.length){result.address=address.join(', ');const pin=result.address.match(/\b\d{6}\b/);if(pin)result.permanentPin=pin[0];}}
  return result;
}
let ocrLibraryPromise;
function loadOcrLibrary() {if(!ocrLibraryPromise)ocrLibraryPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./vendor/tesseract/tesseract.min.js';script.onload=resolve;script.onerror=()=>{ocrLibraryPromise=null;reject(new Error('Could not load OCR. Connect to the internet and retry.'));};document.head.appendChild(script);});return ocrLibraryPromise;}
async function documentText(blob,status) {
  let worker;
  const recognise=async image=>{if(!worker){await loadOcrLibrary();worker=await Tesseract.createWorker('eng',1,{workerPath:new URL('./vendor/tesseract/worker.min.js',location.href).href,corePath:new URL('./vendor/tesseract/core/',location.href).href,langPath:new URL('./vendor/tesseract/lang/',location.href).href,logger:m=>{if(m.status==='recognizing text')status('Reading text: '+Math.round(m.progress*100)+'%');}});}return (await worker.recognize(image)).data.text;};
  try {
    if(blob.type!=='application/pdf')return await recognise(blob);
    const pdfjs=await import('./vendor/pdfjs/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',location.href).href;
    const loading=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
    let pdf;try{pdf=await loading.promise;}catch(error){if(error.name==='PasswordException')throw new Error('This PDF is password-protected. Upload an unlocked copy or a clear JPG/PNG.');throw error;}
    try{if(pdf.numPages>4)throw new Error('For OCR, upload an Aadhaar document with at most 4 pages. The file can still be saved.');let text='';for(let i=1;i<=pdf.numPages;i++){status(`Reading PDF page ${i} of ${pdf.numPages}…`);const page=await pdf.getPage(i);const content=await page.getTextContent();let extracted='';let lastY;for(const item of content.items){const y=Math.round(item.transform[5]);if(lastY!=null&&Math.abs(lastY-y)>3)extracted+='\n';extracted+=item.str+' ';if(item.hasEOL)extracted+='\n';lastY=y;}
      if(extracted.replace(/\s/g,'').length<40){const v=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(2,2200/Math.max(v.width,v.height))});const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;extracted=await recognise(canvas);}text+='\n'+extracted;page.cleanup();}return text;}finally{await pdf.destroy();}
  } finally {if(worker)await worker.terminate();}
}
async function readAadhaarDocument(id) {
  if(ocrBusy){toast('Another document is still being read.','error');return;}
  const ref=tenantDocumentDraft.find(r=>r.id===id);if(!ref)return;
  ocrBusy=true;const draft=tenantDocumentDraft;const status=message=>{if(draft===tenantDocumentDraft)document.getElementById('ocrStatus').textContent=message;};
  try{status('Reading on this device…');const text=await documentText(await attachmentBlob(ref),status);if(draft!==tenantDocumentDraft)return;const suggestions=parseAadhaarText(text);ocrReviewContext={draft,id};
    const labels={name:'Name',dob:'Date of birth',gender:'Gender',address:'Permanent address',permanentPin:'PIN code',idType:'ID proof type',idNum:'ID number'};
    document.getElementById('ocrReview').innerHTML=`<h4>Review extracted details</h4><p class="hint">Suggestions may be incorrect. Select only fields you want to copy. Existing values are shown for comparison; nothing changes until you apply.</p>${Object.entries(suggestions).map(([key,value])=>`<div class="form-group"><label><input type="checkbox" id="ocr_use_${key}"> ${labels[key]}</label><input id="ocr_value_${key}" value="${escapeAttr(value)}"><span class="hint">Current: ${escapeHtml(document.getElementById('ti_'+key)?.value||'blank')}</span></div>`).join('')}<details><summary>Extracted text</summary><pre style="white-space:pre-wrap;max-height:200px;overflow:auto">${escapeHtml(text)}</pre></details>${Object.keys(suggestions).length?'<button class="btn btn-primary" onclick="applyAadhaarSuggestions()">Apply selected fields</button>':''}`;
    status(Object.keys(suggestions).length?'Review the suggestions below.':'No reliable fields found. Use the extracted text to fill the form manually.');
  }catch(error){status('Could not read this document: '+error.message+' You can still enter details manually.');}finally{ocrBusy=false;}
}
function applyAadhaarSuggestions() {
  if(!ocrReviewContext||ocrReviewContext.draft!==tenantDocumentDraft)return;
  const selected=[...document.querySelectorAll('#ocrReview input[type="checkbox"]:checked')];
  for(const check of selected){const key=check.id.replace('ocr_use_',''),value=document.getElementById('ocr_value_'+key).value.trim();if(key==='dob'){const parts=value.split('-');if(parts.length!==3||parseBirthDate(parts[2],parts[1],parts[0]).error){toast('Correct the suggested birth date using YYYY-MM-DD.','error');return;}}}
  for(const check of selected){const key=check.id.replace('ocr_use_',''),value=document.getElementById('ocr_value_'+key).value.trim();if(key==='dob'){const [y,m,d]=value.split('-');document.getElementById('ti_dob_day').value=d;document.getElementById('ti_dob_month').value=Number(m);document.getElementById('ti_dob_year').value=y;updateDob('ti_dob');}else document.getElementById('ti_'+key).value=value;}
  toast(`${selected.length} fields applied. Review Tenant Info and Save Changes.`,'success');
}
async function backupWithAttachments(data) {
  const copy=JSON.parse(JSON.stringify(data));copy.attachmentFiles=[];
  for(const ref of attachmentReferences(copy))copy.attachmentFiles.push({...ref,data:await blobDataURL(await attachmentBlob(ref))});return copy;
}
async function restoreAttachmentBackup(data) {
  for(const file of data.attachmentFiles||[]){if(!FILE_ID.test(file.id)||typeof file.data!=='string'||file.data.length>FILE_LIMIT*1.4||!/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(file.data))throw new Error('Invalid attachment in backup.');const raw=atob(file.data.split(',')[1]);const blob=new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:file.mime});if(blob.size>FILE_LIMIT)throw new Error('Attachment is larger than 5 MB.');await localAttachment(file.id,{id:file.id,blob,name:file.name,mime:file.mime,size:blob.size,synced:false});}delete data.attachmentFiles;
}
