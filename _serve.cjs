const http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
const ROOT='F:/UserData/Downloads/Painel git', PORT=5599;
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/_mobiletest.html';
  const fp=path.join(ROOT,p);
  if(!fp.startsWith(path.resolve(ROOT))){res.writeHead(403);return res.end('no');}
  fs.readFile(fp,(e,data)=>{ if(e){res.writeHead(404);return res.end('404');}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(data); });
}).listen(PORT,'0.0.0.0',()=>{
  const ifaces=os.networkInterfaces(); const ips=[];
  for(const k in ifaces) for(const i of ifaces[k]) if(i.family==='IPv4'&&!i.internal) ips.push(i.address);
  console.log('SERVER UP on port '+PORT);
  console.log('Abra no iPhone (mesmo Wi-Fi):');
  ips.forEach(ip=>console.log('   http://'+ip+':'+PORT+'/_mobiletest.html'));
});
