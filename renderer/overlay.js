'use strict';
// Panel flotante del modo enfoque: CPU, GPU y RAM cada 2 segundos.
const $ = (s) => document.querySelector(s);
const gb = (b) => (b / 1e9).toFixed(1).replace('.', ',');

function setBar(id, pct) {
  const bar = $(`#${id}Bar`);
  const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  bar.style.width = `${v}%`;
  bar.classList.toggle('hot', v >= 90);
  $(`#${id}`).textContent = pct == null ? '—' : `${Math.round(v)} %`;
}

window.api.onPerf((s) => {
  if (s.game) $('#game').textContent = s.game;
  $('#fps').textContent = s.fps ? Math.round(s.fps) : '—';
  $('#fps').title = s.low1 ? `1 % más bajo: ${Math.round(s.low1)} FPS` : '';
  setBar('cpu', s.cpu);
  setBar('gpu', s.gpu);
  setBar('ram', s.ramTotal ? (s.ramUsed / s.ramTotal) * 100 : null);
  const parts = [];
  if (s.gameRam) parts.push(`Juego ${gb(s.gameRam)} GB`);
  if (s.ramTotal) parts.push(`RAM ${gb(s.ramUsed)}/${gb(s.ramTotal)} GB`);
  if (s.vram) parts.push(`VRAM ${gb(s.vram)} GB`);
  $('#extra').textContent = parts.join(', ');
});
