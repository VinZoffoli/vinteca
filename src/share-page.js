// Página para compartir tu biblioteca: un solo .html que se abre en cualquier
// navegador (las carátulas se cargan de las tiendas). No incluye nada de tu
// cuenta: ni SteamID, ni claves, ni rutas del PC.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function render(rows, { notes }) {
  const total = rows.length;
  const hours = Math.round(rows.reduce((s, r) => s + (r.hours || 0), 0));
  const finished = rows.filter((r) => r.status === 'Terminado').length;
  const stores = [...new Set(rows.map((r) => r.store))];
  const statuses = ['Jugando', 'Pendiente', 'Terminado', 'Abandonado'].filter((s) => rows.some((r) => r.status === s));
  const card = (r) => `
<article class="g" data-store="${esc(r.store)}" data-status="${esc(r.status)}" data-fav="${r.fav ? 1 : 0}" data-t="${esc(r.title.toLowerCase())}">
  <div class="c">${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span class="ph">${esc(r.title)}</span>${r.fav ? '<span class="fav" title="Favorito">♥</span>' : ''}</div>
  <h3>${esc(r.title)}</h3>
  <p class="m">${esc(r.store)}${r.hours ? ` · ${String(r.hours).replace('.', ',')} h` : ''}${r.status ? ` · <b>${esc(r.status)}</b>` : ''}</p>
  ${r.rating ? `<p class="st" aria-label="${r.rating} de 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</p>` : ''}
  ${notes && r.note ? `<p class="n">${esc(r.note)}</p>` : ''}
</article>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mi biblioteca de juegos</title>
<style>
:root{--night:#16122a;--n2:#1c1734;--s:#211b3d;--line:#3a3166;--text:#f1edff;--muted:#a39cc3;--faint:#6f6797;--amber:#ffb547;--pink:#ff5c8a}
*{box-sizing:border-box}body{margin:0;background:var(--night);color:var(--text);font:15px/1.45 "Segoe UI",system-ui,sans-serif}
header{padding:32px 24px 8px;max-width:1280px;margin:0 auto}
h1{margin:0;font:700 34px/1.1 Bahnschrift,"Segoe UI",sans-serif}h1 b{color:var(--amber)}
.sum{color:var(--muted);margin:8px 0 18px}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;max-width:1280px;margin:0 auto;padding:0 24px 16px;position:sticky;top:0;background:rgba(22,18,42,.94);backdrop-filter:blur(8px);z-index:2;padding-top:10px}
input,select{background:var(--n2);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:8px 12px;font:inherit}
input{flex:1 1 220px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px;max-width:1280px;margin:0 auto;padding:8px 24px 48px}
.g h3{margin:8px 0 2px;font-size:14px;line-height:1.25}.m{margin:0;color:var(--muted);font-size:12.5px}.m b{color:var(--text);font-weight:600}
.c{position:relative;aspect-ratio:2/3;border-radius:8px;overflow:hidden;background:var(--s);box-shadow:0 12px 22px -14px #000}
.c img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.ph{position:absolute;inset:0;display:grid;place-items:center;padding:10px;text-align:center;color:var(--faint);font-size:13px}
.fav{position:absolute;top:6px;left:8px;color:var(--pink);font-size:18px;text-shadow:0 1px 6px #000}
.st{margin:2px 0 0;color:var(--amber);font-size:13px;letter-spacing:1px}.n{margin:4px 0 0;color:var(--muted);font-size:12.5px;white-space:pre-line}
footer{color:var(--faint);text-align:center;font-size:12px;padding:0 0 30px}
.hide{display:none}
</style></head><body>
<header><h1>Mi biblioteca de <b>juegos</b></h1>
<p class="sum">${total} juegos${hours ? ` · ${hours.toLocaleString('es')} horas jugadas` : ''}${finished ? ` · ${finished} terminados` : ''} · ${esc(stores.join(', '))}</p></header>
<div class="bar"><input id="q" type="search" placeholder="Buscar un juego…">
<select id="store"><option value="">Todas las tiendas</option>${stores.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
<select id="status"><option value="">Todos los estados</option><option value="fav">Favoritos</option>${statuses.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
<span id="count" class="m"></span></div>
<main id="grid">${rows.map(card).join('')}</main>
<footer>Hecho con ViperTeca · ${new Date().toLocaleDateString('es')}</footer>
<script>
const q=document.getElementById('q'),st=document.getElementById('store'),ss=document.getElementById('status'),cards=[...document.querySelectorAll('.g')];
function f(){const t=q.value.trim().toLowerCase();let n=0;for(const c of cards){const ok=(!t||c.dataset.t.includes(t))&&(!st.value||c.dataset.store===st.value)&&(!ss.value||(ss.value==='fav'?c.dataset.fav==='1':c.dataset.status===ss.value));c.classList.toggle('hide',!ok);if(ok)n++}document.getElementById('count').textContent=n+' juegos'}
q.oninput=st.onchange=ss.onchange=f;f();
</script></body></html>`;
}

module.exports = { render };
