import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleFiles, MAX_FILE_BYTES} from '../functions/api/files.js';
import {webcrypto} from 'node:crypto';
const sql = new DatabaseSync(':memory:');
const db={prepare(query){let values=[];return {bind(...args){values=args.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values).map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Uint8Array?[...v]:v])))};},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await webcrypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='test';jwk.alg='RS256';
globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{headers:{'content-type':'application/json'}});
const env={JASMINE_DB:db,CF_ACCESS_TEAM_DOMAIN:'https://test.cloudflareaccess.com',CF_ACCESS_AUD:'test-aud'};
async function token(exp=Math.floor(Date.now()/1000)+3600){const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const s=encode({alg:'RS256',kid:'test'})+'.'+encode({iss:env.CF_ACCESS_TEAM_DOMAIN,aud:'test-aud',exp});const sig=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(s));return s+'.'+Buffer.from(sig).toString('base64url');}
const jwt=await token();
const request=(id,method='GET',body,extra={})=>new Request('https://jasmine.example/api/files'+(id?'/'+id:''),{method,headers:{'cf-access-jwt-assertion':jwt,'x-file-name':encodeURIComponent('test document.pdf'),...extra},...(body?{body}: {})});
test('attachment API denies missing and expired Access tokens before storage access',async()=>{
 assert.equal((await handleFiles(new Request('https://jasmine.example/api/files'),env)).status,401);
 assert.equal((await handleFiles(request('', 'GET',null,{'cf-access-jwt-assertion':await token(1)}),env)).status,401);
 assert.equal((await handleFiles(request('', 'GET'),{})).status,503);
});
test('chunked PDF upload/download is exact, idempotent and immutable',async()=>{
 const id='00000000-0000-4000-8000-000000000001';const bytes=new Uint8Array(1300000).fill(65);bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
 let r=await handleFiles(request(id,'PUT',bytes),env);assert.equal(r.status,201);assert.equal((await r.json()).size,bytes.length);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM attachment_chunks').get().n,3);
 r=await handleFiles(request(id),env);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
 assert.equal((await handleFiles(request(id,'PUT',bytes),env)).status,200);
 bytes[100]=66;assert.equal((await handleFiles(request(id,'PUT',bytes),env)).status,409);
 const stats=await (await handleFiles(request(''),env)).json();assert.equal(stats.files,1);assert.equal(stats.bytes,1300000);
});
test('invalid IDs, unsupported files, oversize and cross-origin uploads are rejected',async()=>{
 const id='00000000-0000-4000-8000-000000000002';
 assert.equal((await handleFiles(request('../oops'),env)).status,400);
 assert.equal((await handleFiles(request(id,'PUT','<svg>bad</svg>'),env)).status,415);
 assert.equal((await handleFiles(request(id,'PUT','%PDF-1.7',{'content-length':String(MAX_FILE_BYTES+1)}),env)).status,413);
 assert.equal((await handleFiles(request(id,'PUT','%PDF-1.7',{origin:'https://evil.example'}),env)).status,403);
 assert.equal((await handleFiles(request(id),env)).status,404);
});
test('storage budget prevents partial file/chunk insertion',async()=>{
 sql.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?)').run('budget-test','existing','application/pdf',400*1024*1024,'synthetic',1);
 const id='00000000-0000-4000-8000-000000000003';const r=await handleFiles(request(id,'PUT','%PDF-1.7\nsynthetic'),env);assert.equal(r.status,413);assert.equal(sql.prepare('SELECT COUNT(*) n FROM attachments WHERE id=?').get(id).n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM attachment_chunks WHERE file_id=?').get(id).n,0);
});
