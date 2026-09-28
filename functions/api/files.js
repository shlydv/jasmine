import { requireAccess } from './data.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const STORAGE_BUDGET = 400 * 1024 * 1024; // Leave headroom within the free D1 database size.
const CHUNK_BYTES = 512 * 1024;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const headers = {'cache-control':'no-store','x-content-type-options':'nosniff'};
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json'}});
const schema = [
  `CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attachment_chunks (file_id TEXT NOT NULL REFERENCES attachments(id), part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(file_id, part))`
];
export function detectedMime(bytes) {
  if(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff)return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
  const text=new TextDecoder().decode(bytes.slice(0,12));
  if(text.startsWith('%PDF-'))return 'application/pdf';
  if(text.startsWith('RIFF') && text.slice(8,12)==='WEBP')return 'image/webp';
  return null;
}
export async function boundedFile(request) {
  if(Number(request.headers.get('content-length'))>MAX_FILE_BYTES)throw new Error('File exceeds 5 MB.');
  const reader=request.body?.getReader();if(!reader)throw new Error('No file received.');
  const parts=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_FILE_BYTES){await reader.cancel();throw new Error('File exceeds 5 MB.');}parts.push(value);}
  if(!size)throw new Error('File is empty.');
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export async function handleFiles(request,env) {
  const auth=await requireAccess(request,env);if(auth.response)return auth.response;
  const url=new URL(request.url),id=url.pathname.replace(/^\/api\/files\/?/,'');
  if(id && !ID.test(id))return json({error:'Invalid attachment ID.'},400);
  if(!['GET','PUT'].includes(request.method))return json({error:'Method not allowed.'},405);
  if(request.method==='PUT' && request.headers.get('origin') && request.headers.get('origin')!==url.origin)return json({error:'Cross-origin uploads are not allowed.'},403);
  const db=env.JASMINE_DB;
  try {
    // Additive, idempotent schema initialization; no existing tenant data is changed.
    await db.batch(schema.map(sql=>db.prepare(sql)));
    if(!id){if(request.method!=='GET')return json({error:'Attachment ID is required.'},400);const stats=await db.prepare('SELECT COALESCE(SUM(size),0) AS bytes, COUNT(*) AS files FROM attachments').first();return json({...stats,budget:STORAGE_BUDGET,maxFile:MAX_FILE_BYTES});}
    const existing=await db.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first();
    if(request.method==='GET'){
      if(!existing)return json({error:'Attachment not found.'},404);
      const {results}=await db.prepare('SELECT data FROM attachment_chunks WHERE file_id = ? ORDER BY part').bind(id).all();
      const bytes=new Uint8Array(existing.size);let offset=0;
      for(const row of results){const chunk=new Uint8Array(row.data);bytes.set(chunk,offset);offset+=chunk.length;}
      if(offset!==existing.size)throw new Error('Incomplete attachment');
      return new Response(bytes,{headers:{...headers,'content-type':existing.mime,'content-length':String(bytes.length),'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(existing.name)}`}});
    }
    let bytes;try{bytes=await boundedFile(request);}catch(error){return json({error:error.message},413);}
    const mime=detectedMime(bytes);if(!mime)return json({error:'Only PDF, JPG, PNG and WebP files are accepted.'},415);
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(existing)return existing.digest===digest?json({id,size:existing.size,mime:existing.mime}):json({error:'An attachment with this ID already contains a different file.'},409);
    let name;try{name=decodeURIComponent(request.headers.get('x-file-name')||'Document');}catch{ return json({error:'Invalid file name.'},400); }
    name=name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,180)||'Document';
    const statements=[db.prepare('INSERT INTO attachments (id,name,mime,size,digest,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM attachments) + ? <= ?').bind(id,name,mime,bytes.length,digest,Date.now(),bytes.length,STORAGE_BUDGET)];
    for(let offset=0,part=0;offset<bytes.length;offset+=CHUNK_BYTES,part++)statements.push(db.prepare('INSERT INTO attachment_chunks (file_id,part,data) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM attachments WHERE id=?)').bind(id,part,bytes.slice(offset,offset+CHUNK_BYTES).buffer,id));
    const result=await db.batch(statements);
    if(!result[0].meta?.changes)return json({error:'Attachment storage is full. Export your files and contact the administrator.'},413);
    return json({id,name,mime,size:bytes.length},201);
  } catch(error){return json({error:'Attachment storage is unavailable. Please retry; the local file is retained.'},503);}
}
