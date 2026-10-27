import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const paths=['package.json','package-lock.json','vercel.json','index.html','app.js','cloud-auth.js','styles.css','taste.css','server.mjs','api/index.js','scripts/build.mjs',...(await readdir('server')).filter(x=>x.endsWith('.mjs')).map(x=>'server/'+x),...(await readdir('assets/fonts')).filter(x=>x.endsWith('.woff2')).map(x=>'assets/fonts/'+x)];
const files=[];
for(const file of paths){const bytes=await readFile(file);if(!file.endsWith('.woff2')&&/(?:app_secret|accessToken|refreshToken|LARK_APP_SECRET)\s*[:=]\s*['"][A-Za-z0-9+/_-]{24,}['"]|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(bytes.toString()))throw new Error('Potential secret in '+file);files.push({file,sha:createHash('sha1').update(bytes).digest('hex'),size:bytes.length,data:bytes.toString('base64')});}
await writeFile('/tmp/siris-preview-sources.json',JSON.stringify(files));
console.log(JSON.stringify(files.map(({data,...file},i)=>({...file,index:i,encodedLength:data.length}))));
