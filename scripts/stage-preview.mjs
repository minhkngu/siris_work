import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
const target='/tmp/siris-vercel-preview';await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
for(const file of ['package.json','package-lock.json','vercel.json','index.html','app.js','cloud-auth.js','styles.css','taste.css','server.mjs'])await cp(file,`${target}/${file}`);
for(const dir of ['server','api','assets/fonts'])await cp(dir,`${target}/${dir}`,{recursive:true});
await mkdir(`${target}/scripts`);await cp('scripts/build.mjs',`${target}/scripts/build.mjs`);
await mkdir(`${target}/.vercel`);await writeFile(`${target}/.vercel/project.json`,JSON.stringify({projectId:'prj_Nz2ZOKEryobRisBK8B87eCN10VoA',orgId:'team_73AqiPSxruulZrNuNzMjB406',projectName:'siris-operations'}));
console.log('Prepared deployment directory with application files only.');
