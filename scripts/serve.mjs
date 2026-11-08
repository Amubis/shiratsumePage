import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.png':'image/png', '.mp4':'video/mp4' };
const port = Number(process.env.PORT || 3000);
const server = createServer(async (request, response) => {
  try {
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!path.startsWith(root+sep)) { response.writeHead(403); response.end(); return; }
    const information = await stat(path);
    if (!information.isFile()) {response.writeHead(404);response.end();return;}
    const content = await readFile(path);
    const headers = {'Content-Type':types[extname(path)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const suffix = !range[1];
      const start = suffix ? Math.max(0,content.length-Number(range[2])) : Number(range[1]);
      const end = suffix ? content.length-1 : Math.min(content.length-1,range[2] ? Number(range[2]) : content.length-1);
      if (start>end || start>=content.length) {response.writeHead(416,{'Content-Range':`bytes */${content.length}`});response.end();return;}
      response.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${content.length}`,'Content-Length':end-start+1});
      response.end(request.method==='HEAD'?undefined:content.subarray(start,end+1));
    } else {
      response.writeHead(200,{...headers,'Content-Length':content.length});response.end(request.method==='HEAD'?undefined:content);
    }
  } catch {response.writeHead(404);response.end('Not found');}
});
server.listen(port,'0.0.0.0',()=>console.log(`little clover garden: http://localhost:${port}`));
