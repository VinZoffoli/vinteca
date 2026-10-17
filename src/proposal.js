// Propuestas para Workana con la estructura de ViperTech, sin IA: se detecta qué
// pide el proyecto (tienda, landing, web corporativa, Elementor, React/Nextjs…)
// y se arma el texto con frases que varían entre propuestas. Después se pasa
// por las reglas de Workana: sin enlaces ni dominios, sin números, sin palabras
// de contacto (correo, teléfono, WhatsApp…) y "Nextjs" sin punto.

// Proyectos destacados del perfil de Workana (el cliente los ve en el perfil)
const PORTFOLIO = [
  { name: 'Silkglobal', tags: ['corporativo', 'elementor', 'empresa', 'wordpress'], about: 'un sitio corporativo en WordPress y Elementor Pro' },
  { name: 'Butori Insumet', tags: ['corporativo', 'industria', 'empresa', 'catalogo', 'wordpress'], about: 'una web corporativa para una empresa industrial' },
  { name: 'BH-Internacional', tags: ['corporativo', 'empresa', 'servicios', 'wordpress'], about: 'un sitio corporativo con presencia internacional' },
  { name: 'Smart Trader Pro', tags: ['finanzas', 'landing', 'cursos', 'wordpress'], about: 'una web para un proyecto de trading y formación' },
  { name: 'Salva Vidrios', tags: ['servicios', 'negocio', 'local', 'wordpress'], about: 'una web de servicios para un negocio local' },
  { name: 'Tu Capital Tu Futuro', tags: ['finanzas', 'landing', 'asesoria', 'wordpress'], about: 'una web de asesoría financiera' },
  { name: 'Lateralia', tags: ['blog', 'contenido', 'editorial', 'wordpress'], about: 'un sitio de contenido y escritura creativa' },
];

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const has = (t, re) => re.test(t);

function analyze(p) {
  const t = `${p.title}\n${p.description}\n${(p.skills || []).join(' ')}`.toLowerCase();
  const kind = has(t, /tienda|e-?commerce|woocommerce|carrito|venta en l[ií]nea|productos|shopify/) ? 'tienda'
    : has(t, /landing|p[aá]gina de aterrizaje|one ?page/) ? 'landing'
    : has(t, /redise[ñn]o|actualizar (el|mi) sitio|mejorar (el|mi) sitio|migra/) ? 'rediseno'
    : has(t, /error|arreglar|corregir|soporte|mantenimiento|problema|lento|hackead/) ? 'soporte'
    : has(t, /blog|noticias|revista|art[ií]culos/) ? 'blog'
    : 'web';
  return {
    kind,
    elementor: has(t, /elementor/),
    woo: has(t, /woocommerce/),
    shopify: has(t, /shopify/),
    react: has(t, /react|next\.?js|vue|frontend moderno/),
    wp: has(t, /wordpress|wp\b/) || !has(t, /react|next\.?js|shopify|wix/),
    ai: has(t, /inteligencia artificial|\bia\b|\bai\b|chatgpt/),
    figma: has(t, /figma|dise[ñn]o (en|de) pdf|borrador|maqueta|mockup/),
    seo: has(t, /seo|posicionamiento|google/),
    chat: has(t, /whatsapp|wsp|chat/),
    form: has(t, /formulario|consulta|cotizaci[oó]n|reserva/),
    booking: has(t, /reserva|agenda|cita/),
    payments: has(t, /pago|pasarela|stripe|paypal|mercado ?pago/),
    multilang: has(t, /idiomas|multilenguaje|ingl[eé]s y espa[ñn]ol|biling/),
    speed: has(t, /velocidad|r[aá]pid|carga/),
    sector: (t.match(/abogad|cl[ií]nica|m[eé]dic|dent|restaurante|inmobiliari|hotel|turismo|gimnasio|escuela|curso|consultor|constructor|industria|fotograf|belleza|est[eé]tica|veterinari|transporte|log[ií]stica|financ|seguros|software|tecnolog/) || [null])[0],
  };
}

const SECTOR = { abogad: 'el despacho', 'clínica': 'la clínica', clinica: 'la clínica', 'médic': 'la consulta', medic: 'la consulta', dent: 'la clínica dental', restaurante: 'el restaurante', inmobiliari: 'la inmobiliaria', hotel: 'el hotel', turismo: 'el proyecto turístico', gimnasio: 'el gimnasio', escuela: 'la escuela', curso: 'los cursos', consultor: 'la consultora', constructor: 'la constructora', industria: 'la empresa', fotograf: 'el estudio', belleza: 'el negocio', 'estética': 'el centro', estetica: 'el centro', veterinari: 'la veterinaria', transporte: 'la empresa', 'logística': 'la empresa', logistica: 'la empresa', financ: 'el proyecto', seguros: 'la aseguradora', software: 'la empresa', tecnolog: 'la empresa' };

function references(a) {
  const want = [a.kind === 'tienda' ? 'catalogo' : a.kind === 'blog' ? 'blog' : a.kind === 'landing' ? 'landing' : 'corporativo', a.sector && /financ|seguros/.test(a.sector) ? 'finanzas' : null, a.sector && /industria|constructor/.test(a.sector) ? 'industria' : null, a.elementor ? 'elementor' : null, 'servicios'].filter(Boolean);
  return PORTFOLIO.map((p) => ({ p, s: want.reduce((n, w, i) => n + (p.tags.includes(w) ? 5 - i : 0), 0) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, 2)
    .map((x) => x.p);
}

/** Propuesta completa para un proyecto. */
function build(p, opts = {}) {
  const a = analyze(p);
  const s = hash(p.slug || p.title);
  const forWho = a.sector ? SECTOR[a.sector] || 'el negocio' : 'el negocio';
  const opening = {
    tienda: [`Hola, puedo desarrollar la tienda online con ${a.shopify ? 'Shopify' : 'WordPress y WooCommerce'}, con un diseño profesional que transmita confianza y facilite la compra desde cualquier dispositivo.`, `Hola, puedo crear la tienda online que necesita, con un catálogo claro, un proceso de compra sencillo y un diseño que ayude a vender más.`],
    landing: [`Hola, puedo desarrollar la landing page con un diseño moderno y enfocado en conversión, para que cada visita tenga un camino claro hacia la acción que busca.`, `Hola, puedo crear una landing page atractiva y directa, pensada para captar clientes y comunicar el valor de su propuesta desde el primer vistazo.`],
    rediseno: [`Hola, puedo rediseñar el sitio actual para darle una imagen más moderna y profesional, mejorando la estructura, la velocidad y la experiencia de navegación.`, `Hola, puedo renovar la web con un diseño actual y una estructura más clara, manteniendo la identidad de marca y mejorando el rendimiento.`],
    soporte: [`Hola, puedo revisar el sitio, identificar el origen del problema y dejarlo funcionando de forma estable, cuidando que no se pierda ningún contenido.`, `Hola, puedo encargarme de corregir y optimizar el sitio, revisando la configuración, los complementos y el rendimiento para dejarlo estable y seguro.`],
    blog: [`Hola, puedo desarrollar el sitio con un diseño limpio y ordenado, pensado para publicar contenido con facilidad y que los lectores encuentren rápido lo que buscan.`, `Hola, puedo crear un sitio de contenido moderno y fácil de administrar, con una estructura clara y buena base para el posicionamiento.`],
    web: [`Hola, puedo desarrollar una web profesional para ${forWho}, con un diseño moderno y elegante que transmita confianza y ayude a captar nuevos clientes.`, `Hola, puedo crear un sitio web moderno y profesional para ${forWho}, con un diseño personalizado que destaque sus servicios y facilite la captación de clientes.`],
  }[a.kind];
  const parts = [pick(opening, s)];

  // Lo que incluiría, según lo que pide el proyecto
  const feats = [];
  if (a.kind === 'tienda') feats.push('catálogo de productos con categorías y filtros', a.payments ? 'pasarela de pago' : 'carrito y proceso de compra optimizado', 'gestión sencilla de pedidos e inventario');
  else if (a.kind === 'landing') feats.push('secciones de beneficios y llamados a la acción', 'testimonios o casos de éxito', 'formulario para captar consultas');
  else if (a.kind === 'soporte') feats.push('revisión de errores y conflictos entre complementos', 'actualizaciones seguras', 'optimización de velocidad y seguridad');
  else feats.push('presentación del negocio', 'sección de servicios', a.form ? 'formulario de consultas' : 'secciones pensadas para generar confianza');
  if (a.booking && a.kind !== 'soporte') feats.push('sistema de reservas o citas');
  if (a.chat && a.kind !== 'soporte') feats.push('botón de chat directo');
  if (a.multilang) feats.push('versión en varios idiomas');
  if (a.figma) feats.push('maquetación fiel al diseño que nos compartan');
  if (a.kind !== 'soporte') parts.push(`El sitio incluiría ${feats.slice(0, -1).join(', ')} y ${feats[feats.length - 1]}. ${pick(['Trabajaría una navegación intuitiva y una estructura clara para que los visitantes encuentren rápido la información que necesitan.', 'La idea es que la navegación sea simple y que cada sección guíe al visitante hacia la acción que buscamos.'], s >> 3)}`);
  else parts.push(`Me encargaría de la ${feats.slice(0, -1).join(', ')} y la ${feats[feats.length - 1]}, explicando en cada paso lo que se hizo.`);

  // Tecnología y calidad
  const tech = a.react
    ? 'Podemos trabajar con React y Nextjs para una solución personalizada y rápida, o con WordPress si prefiere poder administrar el contenido por su cuenta.'
    : a.shopify
      ? 'Trabajaría sobre Shopify, configurando el tema, los productos y los ajustes de venta para que pueda gestionarlo con facilidad.'
      : `Trabajaría con WordPress${a.elementor ? ' y Elementor' : ''}${a.woo || a.kind === 'tienda' ? ' y WooCommerce' : ''}, para que pueda autoadministrar el contenido sin depender de nadie.`;
  parts.push(`${tech} ${pick(['También incluiría diseño responsive, optimización de velocidad y SEO básico para mejorar la visibilidad en buscadores.', 'Priorizaría el diseño responsive, la velocidad de carga y una base SEO sólida para que el sitio rinda bien en buscadores y en cualquier dispositivo.'], s >> 5)}`);
  if (a.ai) parts.push('Además, podemos integrar herramientas de inteligencia artificial cuando aporten valor, por ejemplo para contenido, asistentes o automatizaciones, sin perder el criterio humano en el diseño.');

  // Referencias del portafolio (visibles en el perfil de Workana)
  const refs = references(a);
  if (refs.length) parts.push(`Tengo experiencia en proyectos similares, como ${refs.map((r) => `${r.name}, ${r.about}`).join(', y ')}. Puede verlos en mi perfil, en la sección de proyectos destacados.`);

  if (a.kind !== 'soporte') parts.push('Además, ofrecemos hosting gratuito en Hostinger, incluyendo la configuración y puesta en producción.');
  parts.push(pick(['Quedo atento para conversar los detalles y ajustar la propuesta a lo que necesita.', 'Con gusto conversamos los detalles por aquí para ajustar la propuesta a sus objetivos.'], s >> 7));
  const text = clean(parts.join('\n\n'));
  return { text, analysis: a, references: refs.map((r) => r.name), problems: check(text) };
}

// ---- reglas de Workana ----
const RULES = [
  { re: /\b(?:https?:\/\/|www\.)\S+/gi, why: 'enlace', fix: '' },
  { re: /\b[\w-]+(?:\.|\(\.\)|\[\.\]| punto )(?:com|net|org|io|co|cr|es|mx|ar|cl|dev|app|site|online|store|shop)\b[^\s]*/gi, why: 'dominio o web', fix: '' },
  { re: /\bnext\.js\b/gi, why: 'Next.js con punto', fix: 'Nextjs' },
  { re: /\bnode\.js\b/gi, why: 'Node.js con punto', fix: 'Nodejs' },
  { re: /\breact\.js\b/gi, why: 'React.js con punto', fix: 'React' },
  { re: /\bvue\.js\b/gi, why: 'Vue.js con punto', fix: 'Vue' },
  { re: /\bwhats ?app\b|\bwsp\b|\bwpp\b/gi, why: 'WhatsApp', fix: 'chat directo' },
  { re: /\btel[eé]fonos?\b|\bcelular(es)?\b|\bm[oó]vil de contacto\b/gi, why: 'teléfono', fix: '' },
  { re: /\bcontactos?\b|\bcontactar(me|nos)?\b|\bcont[aá]ct(a|e)(me|nos)\b/gi, why: 'contacto', fix: 'comunicación' },
  { re: /\be-?mails?\b|\bcorreos?( electr[oó]nicos?)?\b|\bgmail\b|\boutlook\b|@/gi, why: 'correo', fix: '' },
  { re: /\b(instagram|facebook|linkedin|telegram|tiktok|twitter|skype|discord|youtube)\b/gi, why: 'red social', fix: '' },
  { re: /\d/g, why: 'número', fix: '' },
];

function check(text) {
  const out = [];
  for (const r of RULES) {
    const m = text.match(r.re);
    if (m) out.push({ why: r.why, found: [...new Set(m)].slice(0, 3) });
  }
  return out;
}

/** Aplica las reglas: corrige lo que se puede y quita lo que no. */
function clean(text) {
  let t = text;
  for (const r of RULES) t = t.replace(r.re, r.fix);
  return t.replace(/[ \t]{2,}/g, ' ').replace(/ ([,.])/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { build, check, clean, analyze, PORTFOLIO };
