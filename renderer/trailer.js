'use strict';
// Reproductor de tráileres de Steam. Steam ya no da un .mp4 de cada tráiler,
// solo DASH (vídeo y audio en trozos de 3 s), así que aquí se leen esos trozos
// y se van pasando al <video> con MediaSource, sin librerías externas.
// Solo se descargan unos 30 s por delante de lo que estás viendo.
(function () {
  const AHEAD = 30;
  let token = 0;

  const parseDur = (s) => {
    const m = String(s || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
    return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0;
  };

  function track(xml, type, maxHeight) {
    const set = [...xml.getElementsByTagName('AdaptationSet')].find((s) => (s.getAttribute('contentType') || s.getAttribute('mimeType') || '').startsWith(type));
    if (!set) return null;
    const reps = [...set.getElementsByTagName('Representation')].sort((a, b) => Number(b.getAttribute('bandwidth')) - Number(a.getAttribute('bandwidth')));
    const rep = (type === 'video' ? reps.find((r) => Number(r.getAttribute('height')) <= maxHeight) : null) || reps[reps.length - 1];
    if (!rep) return null;
    const tpl = rep.getElementsByTagName('SegmentTemplate')[0] || set.getElementsByTagName('SegmentTemplate')[0];
    const id = rep.getAttribute('id');
    const name = (pattern, n) => pattern.replace(/\$RepresentationID\$/g, id).replace(/\$Number(?:%0(\d+)d)?\$/g, (_, w) => String(n).padStart(Number(w || 0), '0'));
    return {
      mime: `${rep.getAttribute('mimeType') || set.getAttribute('mimeType')}; codecs="${rep.getAttribute('codecs')}"`,
      init: name(tpl.getAttribute('initialization'), 0),
      media: (n) => name(tpl.getAttribute('media'), n),
      start: Number(tpl.getAttribute('startNumber') || 1),
      seg: Number(tpl.getAttribute('duration')) / Number(tpl.getAttribute('timescale') || 1),
    };
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const once = (sb) => new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
  async function get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  }

  async function feed(video, ms, sb, base, t, total, my) {
    sb.appendBuffer(await get(base + t.init));
    await once(sb);
    const count = Math.ceil(total / t.seg);
    for (let i = 0; i < count; i++) {
      // No descargar demasiado por delante de lo que se ve
      while (my === token && (i * t.seg) - video.currentTime > AHEAD) await wait(500);
      if (my !== token || ms.readyState !== 'open') return;
      const buf = await get(base + t.media(t.start + i));
      if (my !== token || ms.readyState !== 'open') return;
      // Liberar lo que ya se vio hace rato
      if (video.currentTime > 60 && sb.buffered.length && sb.buffered.start(0) < video.currentTime - 45) {
        sb.remove(0, video.currentTime - 40);
        await once(sb);
      }
      sb.appendBuffer(buf);
      await once(sb);
    }
  }

  /** Reproduce el tráiler en el <video>. Devuelve false si no se puede (se usa el avance corto). */
  async function play(video, mpdUrl) {
    const my = ++token;
    if (!window.MediaSource) return false;
    const base = mpdUrl.replace(/[^/]*$/, '');
    const r = await fetch(mpdUrl);
    if (!r.ok) return false;
    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
    const total = parseDur(xml.documentElement.getAttribute('mediaPresentationDuration'));
    const tracks = [track(xml, 'video', 720), track(xml, 'audio')].filter(Boolean);
    if (!total || !tracks.length || !tracks.every((t) => MediaSource.isTypeSupported(t.mime))) return false;
    const ms = new MediaSource();
    video.src = URL.createObjectURL(ms);
    await new Promise((res) => ms.addEventListener('sourceopen', res, { once: true }));
    if (my !== token) return true;
    ms.duration = total;
    const sbs = tracks.map((t) => ms.addSourceBuffer(t.mime));
    video.play().catch(() => {});
    Promise.all(tracks.map((t, i) => feed(video, ms, sbs[i], base, t, total, my)))
      .then(() => {
        if (my === token && ms.readyState === 'open') ms.endOfStream();
      })
      .catch(() => {});
    return true;
  }

  function stop(video) {
    token++;
    if (!video) return;
    video.pause();
    const src = video.src;
    video.removeAttribute('src');
    video.load();
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  }

  window.trailerPlayer = { play, stop };
})();
