import {tableIds,imageFields,LarkError} from './lark-openapi.mjs';
import {random,reply} from './session.mjs';
const maxSize=3_000_000;
const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
export async function jsonBody(req,limit=4_100_000){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>limit)throw new LarkError(413,'Ảnh quá lớn để gửi qua web.');}try{return JSON.parse(raw);}catch{throw new LarkError(400,'Dữ liệu không hợp lệ.');}}
function validImage(bytes,type){return type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/gif'?bytes.subarray(0,3).toString()==='GIF':type==='image/webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';}
export async function imageRoute(req,res,url,identity,adapter){
  if(url.pathname==='/api/image-upload'&&req.method==='POST'){
    const input=await jsonBody(req),field=input.field||(input.source==='payments'?'Biên nhận':'Hình ảnh');
    if(!imageFields[input.source]?.includes(field)||!types[input.type]||typeof input.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))throw new LarkError(400,'Bản ghi hoặc ảnh không hợp lệ.');
    await adapter.record(input.source,input.recordId);
    const bytes=Buffer.from(input.data,'base64');if(!bytes.length||bytes.length>maxSize||!validImage(bytes,input.type))throw new LarkError(413,'Ảnh sau tối ưu phải dưới 3 MB và đúng định dạng.');
    {
      const form=new FormData();form.set('file_name',`siris-${random()}.${types[input.type]}`);form.set('parent_type','bitable_image');form.set('parent_node',process.env.LARK_BASE_TOKEN);form.set('size',String(bytes.length));form.set('file',new Blob([bytes],{type:input.type}),`image.${types[input.type]}`);
      const uploaded=await adapter.api('/drive/v1/medias/upload_all',{method:'POST',form});if(!uploaded.file_token)throw new LarkError(502,'Lark chưa xác nhận ảnh.');
      const latest=await adapter.record(input.source,input.recordId),existing=latest.fields?.[field]||[];
      if(!Array.isArray(existing)||existing.length>=100)throw new LarkError(400,'Trường ảnh đã đầy.');
      await adapter.write(tableIds[input.source],input.recordId,{[field]:[...existing.map(v=>({file_token:v.file_token})),{file_token:uploaded.file_token}]});
      return reply(res,200,{ok:true});
    }
  }
  if(url.pathname==='/api/image'&&req.method==='GET'){
    const source=url.searchParams.get('source'),id=url.searchParams.get('id'),token=url.searchParams.get('token');
    if(!imageFields[source]||!token||token.length>200)throw new LarkError(400,'Ảnh không hợp lệ.');
    const record=await adapter.record(source,id),field=imageFields[source].find(name=>Array.isArray(record.fields?.[name])&&record.fields[name].some(f=>f.file_token===token));
    if(!field)throw new LarkError(404,'Không tìm thấy ảnh hoặc bạn không có quyền xem.');
    const meta=(await adapter.fields(tableIds[source])).find(f=>f.field_name===field);if(!meta)throw new LarkError(403,'Bạn chưa có quyền xem trường ảnh.');
    const extra={bitablePerm:{tableId:tableIds[source],attachments:{[meta.field_id]:{[id]:[token]}}}};
    const data=await adapter.api('/drive/v1/medias/batch_get_tmp_download_url',{query:{file_tokens:[token],extra:JSON.stringify(extra)}});
    const target=data.tmp_download_urls?.find(item=>item.file_token===token)?.tmp_download_url;
    if(!target)throw new LarkError(403,'Lark chưa cấp đường dẫn xem ảnh này.');
    const parsed=new URL(target);if(parsed.protocol!=='https:'||!/(^|\.)(larksuite\.com|larkoffice\.com|feishucdn\.com|feishu\.cn|byteimg\.com|ibytedtos\.com|larkcdn\.com)$/.test(parsed.hostname))throw new LarkError(502,'Lark trả về đường dẫn ảnh chưa được hỗ trợ.');
    res.writeHead(302,{Location:target,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});res.end();return;
  }
  return reply(res,405,{error:'Method not allowed'});
}
