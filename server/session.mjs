import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const random=()=>randomBytes(32).toString('base64url');
export function config(){
  const required=['APP_URL','LARK_APP_ID','LARK_APP_SECRET','LARK_BASE_TOKEN','LARK_TENANT_KEY','SESSION_ENCRYPTION_KEY'];
  const missing=required.filter(k=>!process.env[k]);if(missing.length)throw Object.assign(new Error('Web đang chờ hoàn tất cấu hình đăng nhập Lark.'),{status:503});
  const origin=new URL(process.env.APP_URL).origin;if(!origin.startsWith('https://')&&process.env.NODE_ENV!=='test')throw new Error('HTTPS required');
  return {origin,key:Buffer.from(process.env.SESSION_ENCRYPTION_KEY,'base64')};
}
export function seal(value){const key=config().key;if(key.length!==32)throw new Error('Invalid encryption key');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');}
export function unseal(value){const bytes=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',config().key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]));}
export function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(x=>x.includes('=')).map(x=>{const at=x.indexOf('=');return[x.slice(0,at).trim(),x.slice(at+1).trim()];}));}
export function cookie(name,value,seconds){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
const sessionCookieNames=['__Host_siris_session','__Host_siris_session_1','__Host_siris_session_2'];
export function sessionCookies(value){
  const encrypted=seal(value),chunkSize=3400;
  if(encrypted.length>chunkSize*sessionCookieNames.length)throw Object.assign(new Error('Phiên Lark vượt giới hạn kích thước hỗ trợ. Vui lòng liên hệ quản trị.'),{status:503});
  return sessionCookieNames.map((name,index)=>{const chunk=encrypted.slice(index*chunkSize,(index+1)*chunkSize);return cookie(name,chunk,chunk?604800:0);});
}
function setSession(res,value){res.setHeader('Set-Cookie',sessionCookies(value));}
export function clearSession(res){res.setHeader('Set-Cookie',sessionCookieNames.map(name=>cookie(name,'',0)));}
async function oauthToken(body){const response=await fetch('https://open.larksuite.com/open-apis/authen/v2/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:process.env.LARK_APP_ID,client_secret:process.env.LARK_APP_SECRET,...body}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok||data.code||!data.access_token)throw Object.assign(new Error('Phiên Lark không còn hợp lệ. Vui lòng đăng nhập lại.'),{status:401});return data;}
export async function session(req,{refresh=false,res}={}){
  config();const jar=cookies(req);if(!jar.__Host_siris_session)return null;const encrypted=sessionCookieNames.map(name=>jar[name]||'').join('');
  let value;try{value=unseal(encrypted);}catch{return null;}
  if(!value?.user?.id||value.user.tenant!==process.env.LARK_TENANT_KEY||!value.accessToken||!Number.isFinite(value.createdAt)||value.createdAt+7*86400000<Date.now())return null;
  if(value.expiresAt<Date.now()+120000){
    if(!refresh){if(value.expiresAt<=Date.now())return null;return value;}
    const token=await oauthToken({grant_type:'refresh_token',refresh_token:value.refreshToken});
    value={...value,accessToken:token.access_token,refreshToken:token.refresh_token||value.refreshToken,expiresAt:Date.now()+token.expires_in*1000};setSession(res,value);
  }
  return value;
}
export async function authRoute(req,res,url){
  const {origin}=config();
  if(url.pathname==='/api/auth/login'){
    if(req.method!=='GET')return reply(res,405,{error:'Method not allowed'});
    const state=random(),verifier=random();res.setHeader('Set-Cookie',cookie('__Host_siris_oauth',seal({state,verifier,expiresAt:Date.now()+600000}),600));
    const target=new URL('https://accounts.larksuite.com/open-apis/authen/v1/authorize');
    for(const[key,value]of Object.entries({client_id:process.env.LARK_APP_ID,response_type:'code',redirect_uri:origin+'/api/auth/callback',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',scope:process.env.LARK_OAUTH_SCOPES||'offline_access base:record:read base:record:retrieve base:record:create base:record:update base:field:read docs:document.media:download docs:document.media:upload contact:user.base:readonly'}))target.searchParams.set(key,value);
    res.writeHead(302,{Location:target.toString(),'Cache-Control':'no-store'});res.end();return;
  }
  if(url.pathname==='/api/auth/callback'){
    let pending;try{pending=unseal(cookies(req).__Host_siris_oauth||'');}catch{}
    if(!pending||pending.expiresAt<Date.now()||!equal(url.searchParams.get('state'),pending.state)||!url.searchParams.get('code'))return reply(res,400,{error:'Lượt đăng nhập không hợp lệ hoặc đã hết hạn. Hãy bắt đầu lại.'});
    res.setHeader('Set-Cookie',cookie('__Host_siris_oauth','',0));
    const token=await oauthToken({grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:origin+'/api/auth/callback',code_verifier:pending.verifier});
    const response=await fetch('https://open.larksuite.com/open-apis/authen/v1/user_info',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(12000)});const result=await response.json(),user=result.data;
    if(!response.ok||result.code||!user?.open_id||user.tenant_key!==process.env.LARK_TENANT_KEY)return reply(res,403,{error:'Tài khoản không thuộc tổ chức Siris được cấp phép.'});
    if(!token.refresh_token)return reply(res,403,{error:'Lark chưa cấp quyền duy trì đăng nhập. Cần cấp offline_access cho ứng dụng.'});
    const value={user:{id:user.open_id,name:String(user.name||'').slice(0,100),tenant:user.tenant_key},accessToken:token.access_token,refreshToken:token.refresh_token,expiresAt:Date.now()+token.expires_in*1000,createdAt:Date.now()};
    res.setHeader('Set-Cookie',[...sessionCookies(value),cookie('__Host_siris_oauth','',0)]);res.writeHead(302,{Location:'/', 'Cache-Control':'no-store'});res.end();return;
  }
  if(url.pathname==='/api/auth/logout'){
    if(req.method!=='POST'||req.headers.origin!==origin)return reply(res,403,{error:'Nguồn yêu cầu không hợp lệ.'});clearSession(res);return reply(res,200,{ok:true});
  }
  return reply(res,404,{error:'Not found'});
}
export function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
