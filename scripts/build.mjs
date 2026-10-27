import {cp,mkdir,rm} from 'node:fs/promises';
await rm('public',{recursive:true,force:true});await mkdir('public',{recursive:true});
for(const file of ['index.html','styles.css','taste.css','app.js','cloud-auth.js'])await cp(file,`public/${file}`);
await cp('assets/fonts','public/assets/fonts',{recursive:true});
