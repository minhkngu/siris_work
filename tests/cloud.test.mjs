import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import handler from '../api/index.js';
import {LarkAdapter,LarkError} from '../server/lark-openapi.mjs';
import {createApplication} from '../server.mjs';
import {seal,unseal,session,sessionCookies,clearSession} from '../server/session.mjs';
import {randomBytes} from 'node:crypto';

function response(){return {status:0,headers:{},data:'',setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);},end(v){this.data=v?String(v):'';}};}
function request(url,method='GET',body){const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{url,method,headers:{'content-type':'application/json',origin:'https://siris.test'}});return req;}
const configured={APP_URL:'https://siris.test',LARK_APP_ID:'cli_test',LARK_APP_SECRET:'not-a-real-secret',LARK_BASE_TOKEN:'base_test',LARK_TENANT_KEY:'tenant_test',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'not-a-real-token'};
Object.assign(process.env,configured);

test('server secrets are authenticated ciphertext',()=>{const text=seal({accessToken:'private-user-one'});assert.ok(!text.includes('private-user-one'));assert.equal(unseal(text).accessToken,'private-user-one');assert.throws(()=>unseal(text.slice(0,-8)+'aaaaaaaa'));});
test('every data/write/image endpoint rejects unauthenticated access',async()=>{for(const [path,method]of [['/api/data','GET'],['/api/staff','GET'],['/api/image','GET'],['/api/fund','POST'],['/api/history','POST'],['/api/entry','POST'],['/api/cleaning','PATCH'],['/api/cleaning/date','PATCH'],['/api/payments/update','PATCH'],['/api/reviews/score','PATCH'],['/api/image-upload','POST']]){const res=response();await handler(request(path,method,{}),res);assert.equal(res.status,401,path);assert.ok(!res.data.includes('base_test'));}});
test('missing cloud configuration fails closed',async()=>{delete process.env.LARK_APP_SECRET;let res=response();await handler(request('/api/data'),res);assert.equal(res.status,503);res=response();await handler(request('/api/auth/status'),res);assert.deepEqual(JSON.parse(res.data),{cloud:true,configured:false,authenticated:false});process.env.LARK_APP_SECRET=configured.LARK_APP_SECRET;});
test('cross origin write cannot use an existing login',async()=>{const req=request('/api/fund','POST',{});req.headers.origin='https://attacker.test';const res=response();await handler(req,res);assert.equal(res.status,403);});
test('OAuth callback requires matching one-time browser state',async()=>{const res=response();await handler(request('/api/auth/callback?code=test&state=wrong'),res);assert.equal(res.status,400);});
test('Lark requests stay scoped to each user including pagination',async()=>{const calls=[];function fetcher(user){return async(url,options)=>{calls.push(options.headers.Authorization);const page=new URL(url).searchParams.get('page_token');return new Response(JSON.stringify({code:0,data:{items:[{record_id:user+(page?'2':'1')}],has_more:!page,page_token:page?undefined:'next'}}));};}const a=new LarkAdapter({accessToken:'user-a'},{fetcher:fetcher('a')}),b=new LarkAdapter({accessToken:'user-b'},{fetcher:fetcher('b')});const [ra,rb]=await Promise.all([a.pages('/test','items'),b.pages('/test','items')]);assert.deepEqual(ra.map(r=>r.record_id),['a1','a2']);assert.deepEqual(rb.map(r=>r.record_id),['b1','b2']);assert.equal(calls.filter(c=>c==='Bearer user-a').length,2);assert.equal(calls.filter(c=>c==='Bearer user-b').length,2);});
test('failed Lark permissions never fall back to an application identity',async()=>{let calls=0;const a=new LarkAdapter({accessToken:'restricted'},{fetcher:async()=>{calls++;return new Response(JSON.stringify({code:1254302}),{status:403});}});await assert.rejects(()=>a.api('/test'),e=>e.status===403);assert.equal(calls,1);});
test('repeated pagination tokens reject incomplete data',async()=>{const a=new LarkAdapter({accessToken:'u'},{fetcher:async()=>new Response(JSON.stringify({code:0,data:{items:[],has_more:true,page_token:'same'}}))});await assert.rejects(()=>a.pages('/test','items'),e=>e.status===502);});
test('a forbidden secondary table does not break the current tab',async()=>{const adapter={dependencies:()=>['payments','contacts'],records:async table=>{if(table.key==='contacts')throw new LarkError(403,'denied');return [{record_id:'rec123456789',Ngày:'2026-10-25', 'Nội dung':'Visible payment','Số tiền':100, 'Đã chi':false}];},revision:()=>1,options:async()=>({}),execute:()=>{throw new Error('No CLI allowed');}};const res=response();await createApplication({adapter,origin:'https://siris.test',view:'payments'})(request('/api/data?view=payments'),res);assert.equal(res.status,200);const data=JSON.parse(res.data);assert.equal(data.tables.contacts.denied,true);assert.equal(data.rows.filter(r=>r.source==='payments').length,1);assert.ok(!data.rows.some(r=>r.source==='contact'));});
test('server rejects a stale payment edit without writing',async()=>{let writes=0;const adapter={dependencies:()=>['payments'],records:async table=>table.key==='payments'?[{record_id:'rec123456789',Ngày:'2026-10-25', 'Nội dung':'Changed by someone','Số tiền':100}]:[],revision:()=>1,options:async()=>({}),execute:async()=>{writes++;return {stdout:'{"ok":true}'};}};const res=response();await createApplication({adapter,origin:'https://siris.test',view:'payments'})(request('/api/payments/update','PATCH',{recordId:'rec123456789',changes:{category:'New'},original:{category:'Old'}}),res);assert.equal(res.status,409);assert.equal(writes,0);});
test('base-specific allowed table list blocks arbitrary table IDs',()=>{const a=new LarkAdapter({accessToken:'u'});assert.throws(()=>a.base('tblUnrelated'),e=>e.status===400);});

test('large Lark sessions round trip through bounded secure cookies and reject missing chunks',async()=>{
  const value={user:{id:'user-large',tenant:'tenant_test'},accessToken:randomBytes(1800).toString('base64'),refreshToken:randomBytes(1800).toString('base64'),createdAt:Date.now(),expiresAt:Date.now()+3600000};
  const parts=sessionCookies(value);assert.equal(parts.length,3);
  for(const part of parts){assert.ok(Buffer.byteLength(part)<4096);assert.match(part,/HttpOnly; Secure; SameSite=Lax/);}
  const req={headers:{cookie:parts.map(p=>p.split(';')[0]).join('; ')}};assert.deepEqual(await session(req),value);
  req.headers.cookie=parts[0].split(';')[0];assert.equal(await session(req),null);
  const res=response();clearSession(res);assert.equal(res.headers['Set-Cookie'].length,3);assert.ok(res.headers['Set-Cookie'].every(p=>p.endsWith('Max-Age=0')));
  assert.throws(()=>sessionCookies({...value,accessToken:'x'.repeat(12000)}),e=>e.status===503);
});
