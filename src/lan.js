// Biblioteca en el móvil: una página web pequeña servida en tu Wi-Fi para ver
// tus juegos desde el teléfono y abrirlos en el PC.
//  - Solo se enciende si tú la activas, y se apaga al cerrar la app.
//  - Cada petición necesita el código secreto que va en el QR (sin él: 403).
//  - Desde el móvil solo se puede leer la lista y abrir juegos ya instalados;
//    cómo se abren lo decide la app, igual que con el botón Jugar.
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const qrcode = require('qrcode-generator');

const PORT = 47800;

function localIp() {
  const all = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  const priv = (a) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  // Preferir la red de casa (192.168.x) y evitar adaptadores virtuales
  const score = (i) => (priv(i.address) ? 2 : 0) + (/^192\.168\./.test(i.address) ? 1 : 0) - (/^169\.254\./.test(i.address) ? 5 : 0);
  return all.sort((a, b) => score(b) - score(a))[0]?.address || null;
}

const same = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

class LanServer {
  /** @param games () => juegos  @param launch (id) => abre el juego en el PC */
  constructor({ games, launch, token, shopping, day }) {
    this.shopping = shopping || null;
    this.day = day || null;
    this.games = games;
    this.launch = launch;
    this.token = token || crypto.randomBytes(12).toString('hex');
    this.server = null;
    this.port = null;
  }

  get running() {
    return !!this.server;
  }

  info() {
    if (!this.server) return { running: false };
    const ip = localIp();
    const url = ip ? `http://${ip}:${this.port}/?t=${this.token}` : null;
    let qr = null;
    if (url) {
      const q = qrcode(0, 'M');
      q.addData(url);
      q.make();
      qr = 'data:image/svg+xml;base64,' + Buffer.from(q.createSvgTag({ cellSize: 6, margin: 3, scalable: true })).toString('base64');
    }
    // lista de compras: misma dirección con /compras
    let shopUrl = null;
    let shopQr = null;
    if (ip && this.shopping) {
      shopUrl = `http://${ip}:${this.port}/compras?t=${this.token}`;
      const q2 = qrcode(0, 'M');
      q2.addData(shopUrl);
      q2.make();
      shopQr = 'data:image/svg+xml;base64,' + Buffer.from(q2.createSvgTag({ cellSize: 6, margin: 3, scalable: true })).toString('base64');
    }
    // Mi día: misma dirección con /dia
    let dayUrl = null;
    let dayQr = null;
    if (ip && this.day) {
      dayUrl = `http://${ip}:${this.port}/dia?t=${this.token}`;
      const q3 = qrcode(0, 'M');
      q3.addData(dayUrl);
      q3.make();
      dayQr = 'data:image/svg+xml;base64,' + Buffer.from(q3.createSvgTag({ cellSize: 6, margin: 3, scalable: true })).toString('base64');
    }
    return { running: true, url, qr, ip, port: this.port, shopUrl, shopQr, dayUrl, dayQr };
  }

  start() {
    if (this.server) return Promise.resolve(this.info());
    const srv = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve, reject) => {
      const tryListen = (port) => {
        srv.once('error', (e) => {
          if (e.code === 'EADDRINUSE' && port !== 0) tryListen(0);
          else reject(e);
        });
        srv.listen(port, '0.0.0.0', () => {
          this.server = srv;
          this.port = srv.address().port;
          resolve(this.info());
        });
      };
      tryListen(PORT);
    });
  }

  stop() {
    if (this.server) this.server.close();
    this.server = null;
    this.port = null;
  }

  send(res, code, type, body) {
    res.writeHead(code, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    });
    res.end(body);
  }

  async handle(req, res) {
    const u = new URL(req.url, 'http://x');
    if (!same(u.searchParams.get('t'), this.token)) return this.send(res, 403, 'text/plain; charset=utf-8', 'Falta el código: escanea el QR de la app otra vez.');
    if (req.method === 'GET' && u.pathname === '/') return this.send(res, 200, 'text/html; charset=utf-8', PAGE);
    if (req.method === 'GET' && u.pathname === '/api/games') {
      const list = this.games()
        .filter((g) => g.kind !== 'tool')
        .map((g) => ({ id: g.id, title: g.title, cover: g.cover || null, store: g.store, installed: !!g.installed, lastPlayed: g.lastPlayed || 0 }));
      return this.send(res, 200, 'application/json; charset=utf-8', JSON.stringify(list));
    }
    if (req.method === 'POST' && u.pathname === '/api/launch') {
      const g = this.games().find((x) => x.id === u.searchParams.get('id'));
      if (!g || !g.installed) return this.send(res, 404, 'application/json', JSON.stringify({ ok: false, error: 'Ese juego no está instalado.' }));
      try {
        await this.launch(g);
        return this.send(res, 200, 'application/json', JSON.stringify({ ok: true, title: g.title }));
      } catch (e) {
        return this.send(res, 500, 'application/json', JSON.stringify({ ok: false, error: e.message }));
      }
    }
    if (this.shopping) {
      if (req.method === 'GET' && u.pathname === '/compras') return this.send(res, 200, 'text/html; charset=utf-8', SHOP_PAGE);
      if (req.method === 'GET' && u.pathname === '/api/compras') return this.send(res, 200, 'application/json; charset=utf-8', JSON.stringify(this.shopping.get()));
      if (req.method === 'POST' && u.pathname === '/api/compras/toggle') return this.send(res, 200, 'application/json', JSON.stringify({ ok: this.shopping.toggle(String(u.searchParams.get('id') || '')) }));
      if (req.method === 'POST' && u.pathname === '/api/compras/add') return this.send(res, 200, 'application/json', JSON.stringify({ ok: this.shopping.add(u.searchParams.get('name'), u.searchParams.get('qty')) }));
    }
    if (this.day) {
      if (req.method === 'GET' && u.pathname === '/dia') return this.send(res, 200, 'text/html; charset=utf-8', DAY_PAGE);
      if (req.method === 'GET' && u.pathname === '/api/dia') {
        try {
          return this.send(res, 200, 'application/json; charset=utf-8', JSON.stringify(await this.day()));
        } catch (e) {
          return this.send(res, 500, 'application/json', JSON.stringify({ error: e.message }));
        }
      }
    }
    this.send(res, 404, 'text/plain; charset=utf-8', 'No existe.');
  }
}

// Página del móvil (todo en un archivo; los datos se piden a /api con el mismo código)
const PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#16122a">
<title>Mis juegos</title>
<style>
:root{--night:#16122a;--n2:#1c1734;--s:#211b3d;--line:#3a3166;--text:#f1edff;--muted:#a39cc3;--amber:#ffb547;--ink:#2a1800}
*{box-sizing:border-box}body{margin:0;background:var(--night);color:var(--text);font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:2;background:rgba(22,18,42,.94);backdrop-filter:blur(10px);padding:14px 16px 10px;border-bottom:1px solid var(--line)}
h1{margin:0 0 10px;font-size:20px}h1 b{color:var(--amber)}
input{width:100%;padding:11px 14px;border-radius:10px;border:1px solid var(--line);background:var(--n2);color:var(--text);font:inherit}
.seg{display:flex;gap:6px;margin-top:10px}.seg button{flex:1;padding:8px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--muted);font:inherit;font-size:13px}
.seg button.on{background:var(--amber);color:var(--ink);border-color:var(--amber);font-weight:600}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:12px;padding:14px 16px 40px}
.g{background:none;border:0;padding:0;color:inherit;text-align:left;font:inherit}
.c{aspect-ratio:2/3;border-radius:8px;overflow:hidden;background:var(--s);display:grid;place-items:center;font-size:12px;color:var(--muted);text-align:center;padding:0}
.c img{width:100%;height:100%;object-fit:cover;display:block}
.g.off .c{opacity:.45}.t{font-size:12.5px;margin-top:5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.toast{position:fixed;left:16px;right:16px;bottom:18px;background:var(--s);border:1px solid var(--line);border-radius:12px;padding:12px 14px;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.on{opacity:1}
</style></head><body>
<header><h1>Mis <b>juegos</b></h1><input id="q" type="search" placeholder="Buscar…" autocomplete="off">
<div class="seg"><button data-v="inst" class="on">Instalados</button><button data-v="recent">Recientes</button><button data-v="all">Todos</button></div></header>
<main id="grid"></main><div id="toast" class="toast"></div>
<script>
const T=new URLSearchParams(location.search).get('t');let games=[],mode='inst';
const $=(s)=>document.querySelector(s);
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),3200)}
function render(){const q=$('#q').value.trim().toLowerCase();let l=games.filter(g=>!q||g.title.toLowerCase().includes(q));
if(mode==='inst')l=l.filter(g=>g.installed);
if(mode==='recent')l=l.filter(g=>g.lastPlayed).sort((a,b)=>b.lastPlayed-a.lastPlayed).slice(0,30);else l.sort((a,b)=>a.title.localeCompare(b.title,'es'));
const grid=$('#grid');grid.replaceChildren(...l.map(g=>{const b=document.createElement('button');b.className='g'+(g.installed?'':' off');
const c=document.createElement('div');c.className='c';if(g.cover){const i=document.createElement('img');i.src=g.cover;i.alt='';i.loading='lazy';i.referrerPolicy='no-referrer';i.onerror=()=>{i.remove();c.textContent=g.title};c.append(i)}else c.textContent=g.title;
const t=document.createElement('div');t.className='t';t.textContent=g.title;b.append(c,t);b.onclick=()=>launch(g);return b}));
if(!l.length)grid.textContent='Nada por aquí.'}
async function launch(g){if(!g.installed)return toast(g.title+' no está instalado en el PC.');
if(!confirm('¿Abrir '+g.title+' en el PC?'))return;
try{const r=await fetch('/api/launch?t='+encodeURIComponent(T)+'&id='+encodeURIComponent(g.id),{method:'POST'});const j=await r.json();toast(j.ok?'Abriendo '+g.title+' en el PC…':j.error)}catch(e){toast('No se pudo hablar con el PC.')}}
document.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{mode=b.dataset.v;document.querySelectorAll('.seg button').forEach(x=>x.classList.toggle('on',x===b));render()});
$('#q').oninput=render;
fetch('/api/games?t='+encodeURIComponent(T)).then(r=>r.json()).then(l=>{games=l;render()}).catch(()=>toast('No se pudo leer la biblioteca.'));
</script></body></html>`;

// Lista de compras en el celular (Casa → Compras)
const SHOP_PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#16122a">
<title>Lista de compras</title>
<style>
:root{--night:#16122a;--n2:#1c1734;--line:#3a3166;--text:#f1edff;--muted:#a39cc3;--amber:#ffb547;--ink:#2a1800}
*{box-sizing:border-box}body{margin:0;background:var(--night);color:var(--text);font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;background:rgba(22,18,42,.95);backdrop-filter:blur(10px);padding:14px 16px 12px;border-bottom:1px solid var(--line);z-index:2}
h1{margin:0 0 10px;font-size:21px}h1 b{color:var(--amber)}
form{display:flex;gap:8px}input{flex:1;min-width:0;padding:11px 13px;border-radius:10px;border:1px solid var(--line);background:var(--n2);color:var(--text);font:inherit}
input.q{flex:0 0 84px}button{padding:11px 16px;border-radius:10px;border:0;background:var(--amber);color:var(--ink);font:600 15px system-ui}
main{padding:8px 16px 40px}h2{font-size:14px;color:var(--muted);margin:18px 0 6px}
label{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--line)}
label input{flex:none;width:22px;height:22px;accent-color:var(--amber)}label small{color:var(--muted)}
label.done span{text-decoration:line-through;color:var(--muted)}p{color:var(--muted)}
</style></head><body>
<header><h1>Lista de <b>compras</b></h1>
<form id="f"><input id="n" placeholder="Qué falta" autocomplete="off"><input id="c" class="q" placeholder="Cant."><button>Añadir</button></form></header>
<main id="m"><p>Cargando…</p></main>
<script>
const t=new URLSearchParams(location.search).get('t');
const api=(p,m)=>fetch(p+(p.includes('?')?'&':'?')+'t='+encodeURIComponent(t),{method:m||'GET'}).then(r=>r.json());
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){const d=await api('/api/compras');const m=document.getElementById('m');
const pend=d.items.filter(x=>!x.done),done=d.items.filter(x=>x.done);
const cats=[...new Set([...d.cats,...pend.map(x=>x.cat)])];
let h='';for(const c of cats){const l=pend.filter(x=>x.cat===c);if(!l.length)continue;h+='<h2>'+esc(c)+'</h2>'+l.map(row).join('')}
if(!pend.length)h+='<p>No falta nada por comprar.</p>';if(done.length)h+='<h2>Comprado</h2>'+done.map(row).join('');m.innerHTML=h;
m.querySelectorAll('input[type=checkbox]').forEach(i=>i.onchange=async()=>{await api('/api/compras/toggle?id='+encodeURIComponent(i.dataset.id),'POST');load()})}
function row(x){return '<label class="'+(x.done?'done':'')+'"><input type="checkbox" data-id="'+esc(x.id)+'" '+(x.done?'checked':'')+'><span>'+esc(x.name)+'</span>'+(x.qty?' <small>'+esc(x.qty)+'</small>':'')+'</label>'}
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const n=document.getElementById('n'),c=document.getElementById('c');if(!n.value.trim())return;
await api('/api/compras/add?name='+encodeURIComponent(n.value)+'&qty='+encodeURIComponent(c.value),'POST');n.value='';c.value='';load()};
load();setInterval(load,15000);
</script></body></html>`;


// Mi día en el celular (lo mismo que la pantalla de inicio, en corto)
const DAY_PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#16122a">
<title>Mi día</title>
<style>
:root{--night:#16122a;--n2:#1c1734;--s:#211b3d;--line:#3a3166;--text:#f1edff;--muted:#a39cc3;--amber:#ffb547;--rose:#ff6b9a;--cyan:#5ce1e6;--ink:#2a1800}
*{box-sizing:border-box}body{margin:0;background:var(--night);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:20px 16px 8px}h1{margin:0;font-size:24px}header p{margin:2px 0 0;color:var(--muted)}
.strip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 16px}
.strip div{background:var(--n2);border:1px solid var(--line);border-radius:12px;padding:10px}
.strip dt{font-size:12px;color:var(--muted)}.strip dd{margin:2px 0 0;font-size:22px;font-weight:700}.hot{color:var(--rose)}
.next{margin:8px 16px;padding:14px;border-radius:14px;background:linear-gradient(135deg,#2b2152,#1c1734);border:1px solid var(--line)}
.next small{color:var(--amber)}.next h2{margin:4px 0;font-size:19px}.next a{display:inline-block;margin-top:6px;padding:9px 14px;border-radius:10px;background:var(--amber);color:var(--ink);font-weight:600;text-decoration:none}
section{margin:12px 16px;padding:12px 14px;background:var(--n2);border:1px solid var(--line);border-radius:14px}
section h3{margin:0 0 6px;font-size:15px;color:var(--cyan)}
ul{list-style:none;margin:0;padding:0}li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #2c2550}li:last-child{border:0}
li span{min-width:0;overflow-wrap:anywhere}li b{flex:none;font-weight:600;color:var(--muted);font-size:14px}li.hot b{color:var(--rose)}li.past span{color:var(--muted);text-decoration:line-through}
.bar{height:8px;border-radius:4px;background:#2c2550;overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;background:var(--amber)}.bar i.hot{background:var(--rose)}
.big{font-size:20px;font-weight:700;margin:0}footer{padding:8px 16px 40px;color:var(--muted);font-size:13px}footer a{color:var(--amber)}
</style></head><body>
<header><h1 id="h">Mi día</h1><p id="d"></p></header>
<main id="m"><p style="padding:0 16px;color:var(--muted)">Cargando…</p></main>
<footer><a id="shop" href="#">Lista de compras</a> · se actualiza sola cada minuto</footer>
<script>
const t=new URLSearchParams(location.search).get('t');
document.getElementById('shop').href='/compras?t='+encodeURIComponent(t);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hm=x=>new Date(x).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
const when=d=>d===0?'hoy':d===1?'mañana':d<0?'atrasado':'en '+d+' días';
const money=(v,c)=>Number(v).toLocaleString('es')+' '+(c||'');
const li=(a,b,cls)=>'<li class="'+(cls||'')+'"><span>'+esc(a)+'</span>'+(b?'<b>'+esc(b)+'</b>':'')+'</li>';
const sec=(title,rows)=>rows.length?'<section><h3>'+esc(title)+'</h3><ul>'+rows.join('')+'</ul></section>':'';
async function load(){
  const r=await fetch('/api/dia?t='+encodeURIComponent(t));if(!r.ok)return;const d=await r.json();
  const now=new Date();const hello=now.getHours()<12?'Buenos días':now.getHours()<19?'Buenas tardes':'Buenas noches';
  document.getElementById('h').textContent=hello+', Vincenzo';
  document.getElementById('d').textContent=now.toLocaleDateString('es',{weekday:'long',day:'numeric',month:'long'});
  const meets=d.meetings.filter(x=>!x.allDay);const nx=meets.find(x=>x.end>Date.now());
  let h='<div class="strip"><div><dt>Reuniones</dt><dd>'+meets.length+'</dd></div><div><dt>Pagos 7 días</dt><dd class="'+(d.pays.some(p=>p.days<=0)?'hot':'')+'">'+d.pays.length+'</dd></div><div><dt>Por comprar</dt><dd>'+d.shopping+'</dd></div></div>';
  if(nx)h+='<div class="next"><small>'+(nx.start<=Date.now()?'Reunión en curso':'Próxima reunión')+'</small><h2>'+esc(nx.title)+'</h2><div>'+hm(nx.start)+' – '+hm(nx.end)+'</div>'+(nx.link&&String(nx.link).startsWith('https://meet.google.com/')?'<a href="'+esc(nx.link)+'">Unirse</a>':'')+'</div>';
  h+=sec('Agenda de hoy',d.meetings.map(m=>li(m.title,m.allDay?'Todo el día':hm(m.start),m.end<Date.now()?'past':'')));
  h+=sec('Pagos que vienen',d.pays.map(p=>li(p.name+(p.group&&p.group!=='Personal'?' ('+p.group+')':'')+(p.amount?' · '+money(p.amount,p.currency):''),when(p.days),p.days<=0?'hot':'')));
  h+=sec('Trámites',(d.tramites||[]).map(x=>li(x.name,when(x.days),x.days<=7?'hot':'')));
  h+=sec('Cumpleaños',d.bdays.map(b=>li(b.name+(b.kind==='gato'?' (gatito)':''),when(b.days),b.days===0?'hot':'')));
  h+=sec('Recordatorios',d.rems.map(r=>li(r.title,when(r.days))));
  h+=sec('Gatitos',d.cats.map(c=>li(c.cat+': '+c.type,when(c.days),c.days<=0?'hot':'')));
  h+=sec('Tickets de Notion',d.tickets.slice(0,8).map(x=>li(x.title,x.late?'Vencido':x.deadline,x.late?'hot':'')));
  h+=sec('Anime',d.anime.map(a=>li(a.title+' · '+a.what,hm(a.at))));
  const b=d.budget;
  if(b&&b.limit)h+='<section><h3>Presupuesto del mes</h3><p class="big">'+money(b.spent,b.currency)+' de '+money(b.limit,b.currency)+'</p><div class="bar"><i class="'+(b.spent>b.limit?'hot':'')+'" style="width:'+Math.min(100,b.spent/b.limit*100)+'%"></i></div></section>';
  if(d.fx)h+='<section><h3>Dólar hoy</h3><p class="big">₡'+esc(d.fx.sell)+' <small style="font-size:14px;color:var(--muted)">venta · compra ₡'+esc(d.fx.buy)+'</small></p></section>';
  if(d.resin)h+='<section><h3>Genshin</h3><p class="big '+(d.resin.value>=d.resin.max?'hot':'')+'">Resina '+d.resin.value+'/'+d.resin.max+'</p></section>';
  document.getElementById('m').innerHTML=h;
}
load();setInterval(load,60000);
</script></body></html>`;

module.exports = { LanServer, localIp };
