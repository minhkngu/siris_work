import {createHash} from 'node:crypto';

export const tableIds={fund:'tblGvOnBuOxoKasX',companyFund:'tbldKgsT5NsFBCsD',income:'tblQ5gPuRREWk7fL',expense:'tblFrWyocxkXMhAL',location:'tblIfcNOs24GKcpn',cleaning:'tbl43kOPJuusdrxM',repairs:'tblu4E7ZpuHYxiGb',contacts:'tblab8uVzdqfTe6n',payments:'tbl7KFKggPU6quoD',purchases:'tblxtZdvxcbc7ewk',assets:'tbl34NNCueFPUwML',reviews:'tblxQ8XstkpuUT62',googleReviews:'tblAhiUJVvB14VFH'};
export const imageFields={cleaning:['Hình ảnh'],repairs:['Hình ảnh'],payments:['Biên nhận','Hoá đơn'],assets:['Ảnh'],googleReviews:['Ảnh review']};
const dependencies={fund:['fund','income','expense','location'],income:['income','fund','location'],expense:['expense','fund','location'],companyFund:['companyFund','payments','contacts','repairs','purchases','location'],cleaning:['cleaning','location'],repairs:['repairs','contacts','location','payments','purchases'],payments:['payments','contacts','repairs','purchases','location'],purchases:['purchases','payments','contacts','assets','location','repairs'],assets:['assets','location','purchases','repairs','contacts'],reviews:['reviews','googleReviews'],fundCreate:['fund','income','expense','location','contacts','payments','repairs','purchases']};
const optionSpecs=[['fundKinds','fund','Nội dung'],['incomeKinds','income','Nội dung'],['expenseKinds','expense','Nội dung'],['buildings','location','Toà'],['repairStatuses','repairs','Trạng thái'],['paymentPurposes','payments','Mục đích'],['paymentChannels','payments','Chi']];
const forbiddenCodes=new Set([99991672,99991674,91403,1254302,1254303,1254304,1254305,1254306,1254307,1254308,1254309,1254310]);
export class LarkError extends Error {constructor(status,message){super(message);this.status=status;}}
export class LarkAdapter {
  constructor(identity,{fetcher=fetch}={}){if(!identity?.accessToken)throw new LarkError(401,'Vui lòng đăng nhập bằng Lark.');this.identity=identity;this.fetcher=fetcher;this.schemas=new Map();this.lastError=null;this.requestView='fund';}
  dependencies(view){this.requestView=view;return dependencies[view]||dependencies.fund;}
  revision(rows){return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
  base(table){if(!Object.values(tableIds).includes(table))throw new LarkError(400,'Bảng không hợp lệ.');return `/bitable/v1/apps/${encodeURIComponent(process.env.LARK_BASE_TOKEN)}/tables/${table}`;}
  async api(path,{method='GET',body,query,form}={}){
    const url=new URL('https://open.larksuite.com/open-apis'+path);for(const [k,v]of Object.entries(query||{}))if(v!==undefined){if(Array.isArray(v))v.forEach(item=>url.searchParams.append(k,item));else url.searchParams.set(k,String(v));}
    for(let attempt=0;attempt<3;attempt++){
      let response;try{response=await this.fetcher(url,{method,headers:{Authorization:`Bearer ${this.identity.accessToken}`,...(body?{'Content-Type':'application/json'}:{})},body:form|| (body?JSON.stringify(body):undefined),signal:AbortSignal.timeout(18000)});}catch{if(method==='GET'&&attempt<2)continue;throw new LarkError(502,'Kết nối Lark bị gián đoạn. Vui lòng thử lại.');}
      if((response.status===429||response.status>=500)&&method==='GET'&&attempt<2){await new Promise(r=>setTimeout(r,500*(attempt+1)));continue;}
      const data=await response.json();
      if(!response.ok||data.code){
        const status=response.status===401||[99991663,99991664,99991668].includes(data.code)?401:response.status===403||forbiddenCodes.has(data.code)?403:response.status===404||[1254040,1254043,1254044].includes(data.code)?404:400;
        if(status===401&&this.onUnauthorized)await this.onUnauthorized();
        throw new LarkError(status,status===401?'Phiên Lark đã hết hạn. Vui lòng đăng nhập lại.':status===403?'Bạn chưa được cấp quyền cho dữ liệu hoặc thao tác này trong Lark.':status===404?'Không tìm thấy dữ liệu hoặc bạn không có quyền xem.':'Lark từ chối yêu cầu. Kiểm tra quyền ứng dụng và dữ liệu nhập.');
      }
      return data.data||data;
    }
  }
  async pages(path,key,query={}){
    const items=[],seen=new Set();let next;
    do{const page=await this.api(path,{query:{...query,page_size:500,page_token:next}});if(!Array.isArray(page[key]))throw new LarkError(502,'Lark trả về dữ liệu không đầy đủ.');items.push(...page[key]);if(!page.has_more)return items;next=page.page_token;if(!next||seen.has(next))throw new LarkError(502,'Không tải đủ các trang dữ liệu Lark.');seen.add(next);}while(true);
  }
  async fields(table){if(!this.schemas.has(table))this.schemas.set(table,this.pages(this.base(table)+'/fields','items').catch(error=>{this.schemas.delete(table);throw error;}));return this.schemas.get(table);}
  async records(table){
    const schema=await this.fields(table.id),allowed=table.fields.filter(name=>schema.some(f=>f.field_name===name));
    if(!allowed.length)throw new LarkError(403,'Bạn không có quyền xem các trường của bảng này.');
    const rows=await this.pages(this.base(table.id)+'/records','items',{field_names:JSON.stringify(allowed),user_id_type:'open_id',automatic_fields:true});
    return rows.map(record=>({record_id:record.record_id,...Object.fromEntries(Object.entries(record.fields||{}).map(([name,value])=>[name,this.normalizeValue(schema.find(f=>f.field_name===name),value)]))}));
  }
  normalizeValue(field,value){
    if(value==null)return null;const type=field?.type;
    if([19,20].includes(type)&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'value')){
      const result=value.value,resultType=value.type??field?.property?.type?.data_type;
      return this.normalizeValue({type:resultType},result);
    }
    if(type===2){
      let scalar=value;if(Array.isArray(scalar))scalar=scalar.length===1?scalar[0]:null;
      if(scalar&&typeof scalar==='object')scalar=scalar.text??scalar.value;
      if(typeof scalar!=='number'&&typeof scalar!=='string'||typeof scalar==='string'&&!scalar.trim())return null;
      const number=Number(scalar);return Number.isFinite(number)?number:null;
    }
    if([19,20].includes(type)&&Array.isArray(value)&&value.every(item=>item&&typeof item.text==='string'))return value.map(item=>item.text).join(', ');
    if(type===1)return typeof value==='string'?value:value.map?.(x=>x.text||'').join('')||'';
    if([5,1001,1002].includes(type)&&typeof value==='number')return new Date(value).toISOString();
    if([3,4].includes(type))return Array.isArray(value)?value:[value];
    if([18,21].includes(type)&&typeof value==='object'&&value.link_record_ids)return value.link_record_ids.map(id=>({id}));
    if([18,21].includes(type)&&Array.isArray(value))return value.flatMap(item=>typeof item==='string'?[{id:item}]:item?.id?[{id:item.id}]:Array.isArray(item?.record_ids)?item.record_ids.map(id=>({id})):[]);
    if(type===15)return value.link||value.text||'';
    if(type===19){if(Array.isArray(value))return value.map(v=>typeof v==='object'?(v.text||v.value||''):v).join(', ');return value?.value??value;}
    if([1003,1004].includes(type))return Array.isArray(value)?value:[value];
    return value;
  }
  async options(){
    const out=Object.fromEntries(optionSpecs.map(([key])=>[key,[]]));
    for(const [key,source,name]of optionSpecs){if(!this.schemas.has(tableIds[source]))continue;try{const field=(await this.schemas.get(tableIds[source])).find(f=>f.field_name===name);out[key]=(field?.property?.options||[]).map(o=>o.name);}catch(error){if(error.status!==403&&error.status!==404)throw error;}}
    return out;
  }
  async record(source,id){if(!/^rec[A-Za-z0-9_-]{8,}$/.test(id||''))throw new LarkError(400,'Bản ghi không hợp lệ.');const table=tableIds[source];if(!table)throw new LarkError(400,'Bảng không hợp lệ.');return (await this.api(this.base(table)+'/records/'+id,{query:{user_id_type:'open_id'}})).record;}
  async write(table,recordId,fields){
    const schema=await this.fields(table),out={};
    for(const [name,value]of Object.entries(fields)){
      const field=schema.find(f=>f.field_name===name);if(!field||[19,20,1001,1002,1003,1004,1005].includes(field.type))throw new LarkError(403,`Trường “${name}” không được phép chỉnh sửa.`);
      out[name]=[18,21].includes(field.type)?value.map(v=>v.id||v):field.type===3?(Array.isArray(value)?value[0]||null:value):field.type===5?(typeof value==='string'?Date.parse(value.replace(' ','T')+(value.includes('T')?'':':00+07:00')):value):value;
      if(field.type===5&&!Number.isFinite(out[name]))throw new LarkError(400,'Ngày không hợp lệ.');
    }
    const path=this.base(table)+'/records'+(recordId?'/'+recordId:'');
    return this.api(path,{method:recordId?'PUT':'POST',body:{fields:out},query:{user_id_type:'open_id'}});
  }
  async execute(binary,args){
    const flag=name=>args[args.indexOf(name)+1];
    try{
      if(args.includes('+field-list')){const fields=await this.fields(flag('--table-id'));return {stdout:JSON.stringify({ok:true,data:{fields:fields.map(f=>({name:f.field_name,type:[3,4].includes(f.type)?'select':String(f.type),options:f.property?.options||[]}))}})};}
      if(args.includes('+record-upsert')){const result=await this.write(flag('--table-id'),args.includes('--record-id')?flag('--record-id'):null,JSON.parse(flag('--json')));return {stdout:JSON.stringify({ok:true,data:result})};}
      throw new LarkError(501,'Thao tác này chưa được hỗ trợ trên web online.');
    }catch(error){this.lastError=error instanceof LarkError?error:new LarkError(502,'Không kết nối được Lark.');throw this.lastError;}
  }
  async activeStaff(rows){
    const ids=[...new Set(rows.filter(r=>r.source==='staff').map(r=>r.id))];if(!ids.length)return [];
    const result=await this.api('/contact/v3/users/batch_get',{query:{user_id_type:'open_id',user_ids:ids}});
    return (result.items||[]).filter(u=>u.status?.is_activated===true&&!u.status?.is_resigned&&!u.status?.is_frozen&&!u.status?.is_exited).map(u=>({id:u.open_id,name:u.name}));
  }
}
