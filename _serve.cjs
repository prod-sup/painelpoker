const http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
const ROOT='F:/UserData/Downloads/Painel git', PORT=5599;
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/'||p==='') p='/criacao-noturna.html';
  const fp=path.join(ROOT,p);
  if(!fp.startsWith(path.resolve(ROOT))){res.writeHead(403);return res.end('no');}
  fs.readFile(fp,(e,data)=>{ if(e){res.writeHead(404);return res.end('404 '+p);}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(data); });
}).listen(PORT,'0.0.0.0',()=>{
  const ips=[]; const ifs=os.networkInterfaces();
  for(const k in ifs) for(const i of ifs[k]) if(i.family==='IPv4'&&!i.internal) ips.push(i.address);
  console.log('SERVER UP :'+PORT);
  console.log('  neste PC:   http://localhost:'+PORT+'/criacao-noturna.html');
  ips.forEach(ip=>console.log('  no celular: http://'+ip+':'+PORT+'/criacao-noturna.html'));
});
