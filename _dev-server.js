const http=require('http'),fs=require('fs'),p=require('path');
const root=process.cwd();const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
http.createServer((req,res)=>{let f=decodeURIComponent(req.url.split('?')[0]);if(f==='/')f='/_dev-mesas.html';const fp=p.join(root,f);
fs.readFile(fp,(e,d)=>{if(e){res.writeHead(404);res.end('404');return;}res.writeHead(200,{'Content-Type':mime[p.extname(fp)]||'application/octet-stream'});res.end(d);});
}).listen(8899,()=>console.log('dev server http://localhost:8899'));
