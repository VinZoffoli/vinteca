'use strict';
// 1.18: ViperTeca en el iPhone (wifi de casa o Tailscale) y el mapa de Genshin.
(function () {
  // =================================================== EN EL MÓVIL
  window.renderPhone = (box, l, auto) => {
    const ts = l.tailscale;
    const step = (n, title, text, extra) => h('li', { class: 'ph-step' }, h('span', { class: 'ph-n', text: String(n) }), h('div', {}, h('b', { text: title }), h('p', { class: 'hint', text }), extra));
    if (!l.running) {
      return fill(box,
        h('section', { class: 'ph-hero' },
          h('div', {},
            h('p', { class: 'ks-kicker', text: 'ViperTeca en tu iPhone' }),
            h('h2', { text: 'Toda la app en el bolsillo, en vivo' }),
            h('p', { class: 'hint', text: 'Hoy, Casa (compras, pagos, presupuesto, fechas y regalos), tus juegos, Genshin, trabajo, anime, el PC y Pregúntale. Mientras ViperTeca esté abierta en este PC.' }),
            h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Encender', onclick: () => lanAction(window.api.lanStart) }), auto)
          ),
          h('div', { class: 'ph-mock', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'))
        )
      );
    }
    const qrBlock = (src, title, url, note) => h('div', { class: 'ph-qr' },
      src ? h('img', { src, alt: `Código QR: ${title}` }) : h('div', { class: 'ph-qr-empty', text: 'Sin red' }),
      h('b', { text: title }),
      url && h('code', { class: 'path', text: url.replace(/\?t=.*/, '?t=•••') }),
      h('p', { class: 'hint', text: note })
    );
    fill(box,
      h('div', { class: 'ph-grid' },
        qrBlock(l.mQr, 'En casa (misma wifi)', l.mUrl, 'Escanéalo con la cámara del iPhone conectado a la wifi de casa.'),
        ts
          ? qrBlock(l.tsQr, 'Desde cualquier lugar (Tailscale)', l.tsUrl, `Tailscale está conectado en este PC${ts.name ? ` como ${ts.name}` : ` (${ts.ip})`}. Con Tailscale abierto en el iPhone, funciona con datos móviles o en otra wifi.`)
          : h('div', { class: 'ph-qr ph-ts-off' },
              h('b', { text: 'Desde cualquier lugar' }),
              h('p', { class: 'hint', text: 'Instala Tailscale (gratis) en este PC y en el iPhone y entra con la misma cuenta. Es una red privada entre tus aparatos: nada queda abierto a internet. Cuando esté conectado aparece aquí el código.' }),
              h('button', { class: 'btn ghost small', text: 'Descargar Tailscale', onclick: () => window.api.open('https://tailscale.com/download') })
            )
      ),
      ts && h('section', { class: 'rx-card ph-https' },
        h('h3', { text: 'Avisos en el iPhone' }),
        l.httpsUrl
          ? h('div', { class: 'ph-https-on' }, h('img', { src: l.httpsQr, alt: 'Código QR del enlace seguro' }), h('div', {}, h('b', { text: 'Enlace seguro listo (con candado)' }), h('p', { class: 'hint', text: 'Escanéalo y añade ViperTeca a la pantalla de inicio desde este enlace. Después, en Más → PC, pulsa «Activar avisos»: te llegarán al iPhone los mismos avisos que ves en el PC, aunque estés fuera de casa. También funciona sin conexión con lo último que viste.' })))
          : [h('p', { class: 'hint', text: 'El iPhone solo acepta avisos de una app con candado (https). Tailscale da ese certificado gratis: actívalo una vez en tu panel de Tailscale (DNS → HTTPS Certificates → Enable) y luego pulsa aquí.' }), h('div', { class: 'row' }, h('button', { class: 'btn primary small', text: 'Crear el enlace seguro', onclick: () => lanAction(window.api.lanHttps) }), h('button', { class: 'btn subtle small', text: 'Abrir el panel de Tailscale', onclick: () => window.api.open('https://login.tailscale.com/admin/dns') }))]
      ),
      h('section', { class: 'rx-card' },
        h('h3', { text: 'Instalarla como app en el iPhone' }),
        h('ol', { class: 'ph-steps' },
          step(1, 'Ábrela en Safari', 'Escanea el código con la cámara y toca el enlace.'),
          step(2, 'Añádela a la pantalla de inicio', 'Toca Compartir y luego «Añadir a pantalla de inicio». Se abre a pantalla completa, con el icono de ViperTeca.'),
          step(3, 'Déjala lista para fuera de casa', ts ? 'Mantén Tailscale encendido en el iPhone. Si añadiste el código de casa, añade también el de Tailscale.' : 'Cuando tengas Tailscale, añade el segundo código: ese funciona en cualquier red.'),
          step(4, 'Que siempre esté disponible', 'Marca «Encenderla cada vez que abro la app» y deja ViperTeca abierta (puede estar minimizada).', auto)
        )
      ),
      h('ul', { class: 'advice' },
        h('li', { text: 'Los enlaces llevan un código secreto: sin él no se entra. Si lo compartiste sin querer, cámbialo y vuelve a añadir la app.' }),
        h('li', { text: 'Si con Tailscale no carga, permite ViperTeca en el Firewall de Windows también para la red de Tailscale.' }),
        h('li', { text: 'Desde el iPhone solo se lee, salvo marcar compras, pagos, recordatorios y recolecciones, anotar gastos, abrir juegos en el PC y preguntar.' })
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', text: 'Apagar', onclick: () => lanAction(window.api.lanStop) }),
        h('button', { class: 'btn ghost', text: 'Cambiar el código', onclick: () => lanAction(window.api.lanNewCode) }),
        h('button', { class: 'btn subtle', text: 'Volver a buscar Tailscale', onclick: () => lanAction(async () => { await window.api.lanStop(); return window.api.lanStart(); }) })
      )
    );
  };

  // =================================================== GENSHIN: MAPA
  const MAPS = [
    ['Teyvat', 'Mondstadt, Liyue, Inazuma, Sumeru, Fontaine, Natlan y Nod-Krai'],
    ['Enkanomiya', 'Bajo Watatsumi'],
    ['La Sima', 'Las minas de Liyue, arriba y abajo'],
    ['Mar Antiguo', 'El fondo de Fontaine'],
  ];
  window.gmapUI = {
    render: () => h('div', { class: 'gm' },
      h('section', { class: 'gm-hero' },
        h('div', { class: 'gm-art', 'aria-hidden': 'true' }),
        h('div', { class: 'gm-body' },
          h('p', { class: 'ks-kicker', text: 'Mapa interactivo oficial' }),
          h('h2', { text: 'Todo Teyvat, con tus marcas' }),
          h('p', { class: 'hint', text: 'El mapa de HoYoLAB en una ventana de ViperTeca: cofres, oculos, especialidades, minerales y jefes. Si entras con tu cuenta de HoYoLAB, lo que marques como recogido queda guardado. Se abre donde lo dejaste.' }),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', text: 'Abrir el mapa', onclick: () => window.api.gmap(false) }),
            h('button', { class: 'btn ghost', text: 'Abrir desde el principio', onclick: () => window.api.gmap(true) })
          )
        )
      ),
      h('div', { class: 'gm-maps' }, MAPS.map(([n, d]) => h('div', { class: 'gm-map' }, h('b', { text: n }), h('span', { class: 'hint', text: d })))),
      h('p', { class: 'hint', text: 'Dentro del mapa, cambia de región con el selector de arriba a la izquierda y busca cualquier material con la lupa. Para tus rutas de especialidades, marca «Ya recogí» en Farmeo y te aviso cuando vuelvan a salir.' })
    ),
  };
})();
