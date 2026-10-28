import {Readable} from 'node:stream';
import {createApplication} from '../server.mjs';
import {LarkAdapter} from '../server/lark-openapi.mjs';
import {authRoute,session,config as authConfig,reply,clearSession} from '../server/session.mjs';
import {imageRoute} from '../server/images.mjs';

export const config={api:{bodyParser:false}};
export default async function handler(req,res){
  return reply(res,503,{error:'Kết nối Lark đã tạm ngắt.',disconnected:true});
  if(req.body!==undefined){const input=Readable.from([Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body))]);Object.assign(input,{url:req.url,method:req.method,headers:req.headers});req=input;}
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
    const url=new URL(req.url,'https://localhost');
    if(url.searchParams.has('__route')){url.pathname=url.searchParams.get('__route');url.searchParams.delete('__route');req.url=url.pathname+url.search;}
    if(url.pathname==='/api/auth/status'){
      let configured=true;try{authConfig();}catch{configured=false;}
      if(!configured)return reply(res,200,{cloud:true,configured:false,authenticated:false});
      const identity=await session(req,{refresh:true,res});return reply(res,200,{cloud:true,configured:true,authenticated:Boolean(identity),user:identity?.user||null,otaAutomation:false});
    }
    if(url.pathname.startsWith('/api/auth/'))return await authRoute(req,res,url);
    const {origin}=authConfig();
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)return reply(res,403,{error:'Nguồn yêu cầu không hợp lệ.'});
    const identity=await session(req);if(!identity)return reply(res,401,{error:'Vui lòng đăng nhập bằng Lark.'});
    const adapter=new LarkAdapter(identity);adapter.onUnauthorized=()=>clearSession(res);
    if(url.pathname==='/api/image'||url.pathname==='/api/image-upload')return await imageRoute(req,res,url,identity,adapter);
    const view=url.searchParams.get('view')|| (url.pathname.startsWith('/api/cleaning')?'cleaning':url.pathname==='/api/payments/update'?'payments':url.pathname==='/api/reviews/score'?'reviews':url.pathname==='/api/data'?'fund':'fundCreate');
    return await createApplication({adapter,origin,view})(req,res);
  }catch(error){
    return reply(res,[400,401,403,404,409,413,415,501,503].includes(error.status)?error.status:502,{error:error.status?error.message:'Không kết nối được dịch vụ. Vui lòng thử lại.'});
  }
}
