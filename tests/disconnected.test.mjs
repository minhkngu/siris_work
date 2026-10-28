import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import handler from '../api/index.js';
import {createApplication} from '../server.mjs';

function response(){return {status:0,data:'',setHeader(){},writeHead(status){this.status=status;},end(data){this.data=String(data||'');}};}
function request(url,method='GET'){return Object.assign(Readable.from([]),{url,method,headers:{}});}

test('online and local API routes stop before invoking Lark',async()=>{
  let calls=0;
  const adapter={execute(){calls++;throw new Error('Unexpected call');},dependencies(){calls++;return [];}};
  const local=createApplication({adapter});
  for(const path of ['/api/auth/status','/api/auth/login','/api/auth/callback','/api/data','/api/image','/api/image-upload','/api/fund','/api/review-sync-status']){
    for(const handle of [handler,local]){
      const res=response();await handle(request(path,path==='/api/fund'?'POST':'GET'),res);
      assert.equal(res.status,503,path);assert.equal(JSON.parse(res.data).disconnected,true);
    }
  }
  assert.equal(calls,0);
});

test('scheduled review synchronization exits without running',()=>{
  const result=spawnSync(process.execPath,['review-sync.mjs','--run-now'],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/tạm ngắt/);
});
