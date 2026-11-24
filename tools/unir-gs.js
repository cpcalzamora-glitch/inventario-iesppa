// Une todos los .gs en un solo archivo para pegarlo a mano en el editor de Apps Script.
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..','apps-script');
const out=fs.readdirSync(dir).filter(f=>f.endsWith('.gs')).sort().map(f=>'// ===== '+f+' =====\n'+fs.readFileSync(path.join(dir,f),'utf8')).join('\n');
const dest=process.argv[2]||path.join(__dirname,'..','CODIGO_APPS_SCRIPT.gs.txt');
fs.writeFileSync(dest,out);console.log('Creado',dest,out.split('\n').length,'líneas');
