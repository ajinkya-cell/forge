// Local development only. Some internet providers' DNS refuses to look up Neon's database hosts
// (seen on Jio: "Query refused"), which breaks `wrangler dev` on this computer. Deployed Forge is not
// affected: it runs on Cloudflare and reaches Neon directly.
// This relay looks the host up through public DNS and forwards the Neon HTTP query to it.
// Use: node tools/neon-dev-proxy.js   and add NEON_DEV_PROXY=http://127.0.0.1:8790/sql to .dev.vars
const http = require('http'), https = require('https'), dns = require('dns');
const resolver = new dns.Resolver(); resolver.setServers(['8.8.8.8', '1.1.1.1']);
const lookup = (host, opts, cb) => resolver.resolve4(host, (err, addrs) => {
  if (err) return cb(err);
  if (opts && opts.all) return cb(null, addrs.map(a => ({ address: a, family: 4 })));
  cb(null, addrs[0], 4);
});
const PORT = Number(process.env.PORT) || 8790;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), host = u.searchParams.get('host') || '';
  if (!/^[a-z0-9.-]+\.neon\.tech$/i.test(host)) { res.writeHead(400); return res.end('only *.neon.tech'); }
  const headers = { ...req.headers, host }; delete headers['content-length'];
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks);
    const up = https.request({ host, path: '/sql', method: req.method, headers: { ...headers, 'content-length': body.length }, lookup, servername: host }, r => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    up.on('error', e => { res.writeHead(502); res.end(JSON.stringify({ message: 'dev proxy: ' + e.message })); });
    up.end(body);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Neon dev relay on http://127.0.0.1:${PORT}/sql`));
