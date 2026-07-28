import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
const ROOT = process.cwd();
const T = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.map':'application/json' };
http.createServer(async (req,res)=>{
  try{
    let p = decodeURIComponent(req.url.split('?')[0]);
    if(p==='/') p='/hub.html';
    const fp = normalize(join(ROOT, p));
    if(!fp.startsWith(ROOT)){ res.writeHead(403).end('no'); return; }
    const data = await readFile(fp);
    res.writeHead(200,{'Content-Type':T[extname(fp)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  }catch(e){ res.writeHead(404).end('404: '+req.url); }
}).listen(8080,'0.0.0.0',()=>console.log('SERVER-UP http://0.0.0.0:8080'));
