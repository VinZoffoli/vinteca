'use strict';
// Websites → Editor: la carpeta de una web con sus archivos, un editor como el
// de VS Code (Monaco) y el chat con Claude Code al lado, con el modelo, el
// esfuerzo, los permisos y el % de contexto usado en la esquina.
(function () {
  const ed = window.api.ed;
  const cl = window.api.claude;
  const E = {
    repo: null, tree: {}, expanded: new Set(['']), tabs: [], active: null, monaco: null, editor: null, git: null, cursor: null, panels: { tree: true, chat: true },
    chat: { session: null, messages: [], busy: false, model: 'sonnet', effort: '', access: 'edit', usage: null, modelUsed: null, limit: null, withFile: true, status: null, msgId: null },
  };
  const MODELS = [['opus', 'Opus (el más capaz)'], ['sonnet', 'Sonnet (equilibrado)'], ['haiku', 'Haiku (rápido)']];
  const EFFORT = [['', 'Esfuerzo normal'], ['low', 'Esfuerzo bajo'], ['medium', 'Esfuerzo medio'], ['high', 'Esfuerzo alto'], ['xhigh', 'Esfuerzo muy alto'], ['max', 'Esfuerzo máximo']];
  const ACCESS = [['read', 'Solo leer'], ['edit', 'Leer y editar archivos'], ['run', 'Editar y ejecutar comandos']];
  const base = (p) => String(p).split('/').pop();
  const dirOf = (p) => String(p).split('/').slice(0, -1).join('/');

  // ---------------- Monaco ----------------
  function loadMonaco() {
    if (window.monaco) return Promise.resolve(window.monaco);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../node_modules/monaco-editor/min/vs/loader.js';
      s.onload = () => {
        window.MonacoEnvironment = { getWorkerUrl: () => new URL('../node_modules/monaco-editor/min/vs/base/worker/workerMain.js', location.href).href };
        window.require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
        window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
      };
      s.onerror = () => reject(new Error('No se pudo cargar el editor.'));
      document.head.append(s);
    });
  }
  function theme(m) {
    const css = getComputedStyle(document.documentElement);
    const v = (n, d) => (css.getPropertyValue(n).trim() || d);
    const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : null);
    const light = document.documentElement.dataset.theme === 'light' || matchMedia('(prefers-color-scheme: light)').matches && document.documentElement.dataset.theme === 'system';
    m.editor.defineTheme('viper', {
      base: light ? 'vs' : 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': hex(v('--night', '')) || (light ? '#ffffff' : '#16122a'),
        'editorGutter.background': hex(v('--night', '')) || (light ? '#ffffff' : '#16122a'),
        'editor.lineHighlightBackground': hex(v('--night-2', '')) || '#1c1734',
        'editorCursor.foreground': hex(v('--amber', '')) || '#ffb547',
        'editor.selectionBackground': (hex(v('--amber', '')) || '#ffb547') + '44',
      },
    });
    m.editor.setTheme('viper');
  }
  async function ensureEditor() {
    if (E.editor) return E.editor;
    const m = (E.monaco = await loadMonaco());
    for (const d of [m.languages.typescript.typescriptDefaults, m.languages.typescript.javascriptDefaults]) {
      d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
      d.setCompilerOptions({ jsx: m.languages.typescript.JsxEmit.ReactJSX, allowJs: true, target: m.languages.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true });
    }
    theme(m);
    E.host ||= h('div', { class: 'ed-monaco-host' });
    if (!E.host.isConnected) $('#edMonaco')?.append(E.host);
    E.editor = m.editor.create(E.host, { automaticLayout: true, fontSize: 13.5, fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace', fontLigatures: true, minimap: { enabled: true, scale: 1 }, smoothScrolling: true, tabSize: 2, wordWrap: 'off', renderWhitespace: 'selection', scrollBeyondLastLine: false, bracketPairColorization: { enabled: true } });
    E.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => save());
    E.editor.onDidChangeCursorPosition((e) => {
      E.cursor = e.position;
      statusBar();
    });
    return E.editor;
  }

  // ---------------- archivos ----------------
  async function loadDir(rel) {
    try {
      E.tree[rel] = await ed.list(rel);
    } catch (e) {
      E.tree[rel] = [];
      toast(errMsg(e), true);
    }
  }
  async function toggleDir(p) {
    if (E.expanded.has(p)) E.expanded.delete(p);
    else {
      E.expanded.add(p);
      if (!E.tree[p]) await loadDir(p);
    }
    renderTree();
  }
  const tabOf = (p) => E.tabs.find((t) => t.path === p);

  async function openFile(p) {
    await ensureEditor();
    let t = tabOf(p);
    if (!t) {
      let f;
      try {
        f = await ed.read(p);
      } catch (e) {
        return toast(errMsg(e), true);
      }
      t = { path: p, eol: f.eol || 'LF', dirty: false, info: f.binary ? 'Este archivo es binario (imagen, fuente…) y no se puede editar aquí.' : f.tooBig ? 'El archivo es demasiado grande para abrirlo aquí (más de 3 MB).' : null };
      if (!t.info) {
        const uri = E.monaco.Uri.file(`/${E.repo.name}/${p}`);
        t.model = E.monaco.editor.getModel(uri) || E.monaco.editor.createModel(f.text, undefined, uri);
        t.saved = t.model.getAlternativeVersionId();
        t.model.onDidChangeContent(() => {
          const d = t.model.getAlternativeVersionId() !== t.saved;
          if (d !== t.dirty) {
            t.dirty = d;
            renderTabs();
          }
        });
      }
      E.tabs.push(t);
    }
    activate(p);
  }
  function activate(p) {
    const prev = tabOf(E.active);
    if (prev?.model && E.editor) prev.view = E.editor.saveViewState();
    E.active = p;
    const t = tabOf(p);
    const info = $('#edInfo');
    if (t?.model) {
      info.hidden = true;
      $('#edMonaco').hidden = false;
      E.editor.setModel(t.model);
      requestAnimationFrame(() => E.editor.layout());
      if (t.view) E.editor.restoreViewState(t.view);
      E.editor.focus();
    } else {
      $('#edMonaco').hidden = true;
      info.hidden = false;
      info.textContent = t ? t.info : 'Abre un archivo del árbol de la izquierda.';
    }
    renderTabs();
    renderTree();
    statusBar();
  }
  function closeTab(p) {
    const t = tabOf(p);
    if (!t) return;
    if (t.dirty && !t.confirmClose) {
      t.confirmClose = true;
      toast(`${base(p)} tiene cambios sin guardar: vuelve a cerrar para descartarlos, o guarda con Ctrl+S.`, true);
      return;
    }
    t.model?.dispose();
    E.tabs = E.tabs.filter((x) => x !== t);
    if (E.active === p) activate(E.tabs[E.tabs.length - 1]?.path || null);
    else renderTabs();
  }
  async function save() {
    const t = tabOf(E.active);
    if (!t?.model) return;
    try {
      await ed.write(t.path, t.model.getValue(), t.eol);
      t.saved = t.model.getAlternativeVersionId();
      t.dirty = false;
      t.ownWrite = Date.now();
      renderTabs();
      toast(`${base(t.path)} guardado.`);
    } catch (e) {
      toast(errMsg(e), true);
    }
  }

  // cambios en disco (por ejemplo, Claude editando)
  ed.onFs(async (files) => {
    if (!E.repo) return;
    const dirs = new Set(files.map(dirOf));
    for (const d of dirs) if (E.tree[d] && E.expanded.has(d)) await loadDir(d);
    for (const f of files) {
      const t = tabOf(f);
      if (!t?.model || Date.now() - (t.ownWrite || 0) < 1500) continue;
      const r = await ed.read(f).catch(() => null);
      if (!r || r.text == null || r.text === t.model.getValue()) continue;
      if (t.dirty) {
        toast(`${base(f)} cambió en el disco, pero tienes cambios sin guardar: no lo recargo.`, true);
        continue;
      }
      const view = E.active === f ? E.editor.saveViewState() : null;
      t.model.setValue(r.text);
      t.saved = t.model.getAlternativeVersionId();
      t.dirty = false;
      t.flash = Date.now();
      if (view) E.editor.restoreViewState(view);
    }
    renderTree();
    renderTabs();
    refreshGit();
  });

  function fileForm(title, label, value, onOk) {
    const dlg = h('dialog', { class: 'rx-dlg ks-dlg' });
    const input = h('input', { class: 'rx-input', value: value || '', spellcheck: false });
    const f = h('form', { method: 'dialog' }, h('h2', { text: title }), h('label', { class: 'ks-field' }, h('span', { text: label }), input), h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', text: 'Cancelar', onclick: () => dlg.close() }), h('button', { class: 'btn primary', text: 'Aceptar' })));
    f.addEventListener('submit', () => input.value.trim() && onOk(input.value.trim().replace(/\\/g, '/')));
    dlg.append(f);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  const selectedDir = () => (E.active ? dirOf(E.active) : '');
  function newItem(isDir) {
    const d = selectedDir();
    fileForm(isDir ? 'Nueva carpeta' : 'Nuevo archivo', `Ruta dentro de ${E.repo.name}`, d ? `${d}/` : '', async (p) => {
      try {
        await ed.create(p, isDir);
        E.expanded.add(dirOf(p));
        await loadDir(dirOf(p));
        renderTree();
        if (!isDir) openFile(p);
      } catch (e) {
        toast(errMsg(e), true);
      }
    });
  }
  function renameItem(node) {
    fileForm('Renombrar', 'Nueva ruta', node.path, async (p) => {
      try {
        await ed.rename(node.path, p);
        await loadDir(dirOf(node.path));
        await loadDir(dirOf(p));
        const t = tabOf(node.path);
        if (t) closeTab(node.path);
        renderTree();
      } catch (e) {
        toast(errMsg(e), true);
      }
    });
  }
  async function trashItem(node) {
    if (node.confirm !== true) {
      node.confirm = true;
      toast(`Pulsa otra vez la papelera para mandar ${node.name} a la papelera de Windows.`);
      setTimeout(() => (node.confirm = false), 4000);
      return;
    }
    try {
      await ed.trash(node.path);
      if (tabOf(node.path)) closeTab(node.path);
      await loadDir(dirOf(node.path));
      renderTree();
      toast(`${node.name} está en la papelera de Windows.`);
    } catch (e) {
      toast(errMsg(e), true);
    }
  }

  // ---------------- vista: árbol, pestañas, estado ----------------
  const ICON_EXT = { js: 'JS', jsx: 'JSX', ts: 'TS', tsx: 'TSX', json: '{}', css: '#', scss: '#', html: '<>', md: 'MD', php: 'PHP', svg: 'SVG', png: 'IMG', jpg: 'IMG', jpeg: 'IMG', webp: 'IMG', gif: 'IMG', otf: 'Aa', ttf: 'Aa', woff: 'Aa', woff2: 'Aa', env: 'ENV', yml: 'YML', yaml: 'YML', mjs: 'JS', cjs: 'JS' };
  function nodeEl(n, depth) {
    const ext = n.name.includes('.') ? n.name.split('.').pop().toLowerCase() : '';
    const open = E.expanded.has(n.path);
    const row = h('div', { class: `ed-node ${n.dir ? 'dir' : 'file'} ${E.active === n.path ? 'on' : ''} ${n.heavy ? 'heavy' : ''} ${tabOf(n.path)?.dirty ? 'dirty' : ''}`, style: { '--d': depth }, role: 'treeitem', 'aria-expanded': n.dir ? String(open) : null, tabIndex: 0,
      onclick: () => (n.dir ? toggleDir(n.path) : openFile(n.path)),
      onkeydown: (e) => { if (e.key === 'Enter') n.dir ? toggleDir(n.path) : openFile(n.path); if (e.key === 'F2') renameItem(n); if (e.key === 'Delete') trashItem(n); } },
      h('span', { class: 'ed-caret', text: n.dir ? (open ? '▾' : '▸') : '' }),
      h('span', { class: `ed-ico ${n.dir ? 'folder' : `x-${ext}`}`, text: n.dir ? '' : ICON_EXT[ext] || '·' }),
      h('span', { class: 'ed-name', text: n.name }),
      h('span', { class: 'ed-node-act' },
        h('button', { class: 'ed-mini', title: 'Renombrar (F2)', 'aria-label': `Renombrar ${n.name}`, text: '✎', onclick: (e) => { e.stopPropagation(); renameItem(n); } }),
        h('button', { class: 'ed-mini', title: 'A la papelera (Supr)', 'aria-label': `Borrar ${n.name}`, text: '🗑', onclick: (e) => { e.stopPropagation(); trashItem(n); } })
      )
    );
    const kids = n.dir && open ? (E.tree[n.path] || []).map((c) => nodeEl(c, depth + 1)) : [];
    return [row, ...kids];
  }
  function renderTree() {
    const box = $('#edTree');
    if (!box || !E.repo) return;
    fill(box, (E.tree[''] || []).map((n) => nodeEl(n, 0)));
  }
  function renderTabs() {
    const box = $('#edTabs');
    if (!box) return;
    fill(box, E.tabs.map((t) => h('div', { class: `ed-tab ${E.active === t.path ? 'on' : ''} ${t.dirty ? 'dirty' : ''}`, title: t.path, onclick: () => activate(t.path), onauxclick: (e) => e.button === 1 && closeTab(t.path) },
      h('span', { text: base(t.path) }),
      h('button', { class: 'ed-x', 'aria-label': `Cerrar ${base(t.path)}`, text: t.dirty ? '●' : '×', onclick: (e) => { e.stopPropagation(); closeTab(t.path); } }))));
    const crumbs = $('#edCrumbs');
    if (crumbs) crumbs.textContent = E.active ? E.active.split('/').join('  ›  ') : '';
  }
  async function refreshGit() {
    E.git = await ed.git().catch(() => null);
    statusBar();
  }
  function ctxInfo() {
    const u = E.chat.usage;
    if (!u) return null;
    const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const max = /\[1m\]|1m/i.test(E.chat.modelUsed || '') ? 1000000 : 200000;
    return { used, max, pct: Math.min(100, Math.round((used / max) * 100)) };
  }
  const k = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  function statusBar() {
    const sb = $('#edStatus');
    if (!sb) return;
    const t = tabOf(E.active);
    const lang = t?.model ? t.model.getLanguageId() : '';
    const c = ctxInfo();
    const lim = E.chat.limit;
    fill(sb,
      h('span', { class: 'ed-sb-git', text: E.git?.branch ? `⎇ ${E.git.branch}${E.git.changes ? ` · ${E.git.changes} cambios` : ''}${E.git.behind ? ` · ↓${E.git.behind}` : ''}${E.git.ahead ? ` · ↑${E.git.ahead}` : ''}` : '' }),
      t?.model && E.cursor && h('span', { text: `Ln ${E.cursor.lineNumber}, Col ${E.cursor.column}` }),
      lang && h('span', { text: lang }),
      t?.model && h('span', { text: t.eol }),
      h('span', { class: 'ed-sb-sp' }),
      E.chat.busy && h('span', { class: 'ed-sb-busy', text: 'Claude trabajando…' }),
      lim && h('span', { class: `ed-sb-lim ${lim.status !== 'allowed' ? 'warn' : ''}`, title: 'Estado de tu límite de uso de Claude según Claude Code', text: `Límite ${lim.rateLimitType === 'five_hour' ? '5 h' : lim.rateLimitType === 'seven_day' ? 'semanal' : ''}: ${lim.status === 'allowed' ? 'OK' : lim.status === 'allowed_warning' ? 'cerca' : 'agotado'}${lim.utilization != null ? ` (${Math.round(lim.utilization * 100)} %)` : ''}${lim.resetsAt ? ` · se reinicia ${new Date(lim.resetsAt * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : ''}` }),
      h('span', { class: `ed-sb-ctx ${c && c.pct >= 80 ? 'hot' : c && c.pct >= 50 ? 'warm' : ''}`, title: c ? `${c.used.toLocaleString('es')} de ${c.max.toLocaleString('es')} tokens de contexto en la conversación con Claude` : 'Uso del contexto de Claude: aparece al enviar el primer mensaje' },
        h('i', { style: { '--p': `${c?.pct || 0}%` } }),
        c ? `Claude ${c.pct} % · ${k(c.used)}/${k(c.max)}` : 'Claude 0 %')
    );
  }

  // ---------------- chat con Claude ----------------
  function renderText(text) {
    // bloques de código ``` y párrafos, sin HTML
    const parts = String(text).split(/```/);
    return parts.map((p, i) => {
      if (i % 2) {
        const nl = p.indexOf('\n');
        const code = nl >= 0 ? p.slice(nl + 1) : p;
        return h('pre', { class: 'cl-code' }, h('code', { text: code.replace(/\n$/, '') }), h('button', { class: 'cl-copy', text: 'Copiar', onclick: () => window.api.workana.copy(code) }));
      }
      return p.split(/\n{2,}/).filter((x) => x.trim()).map((para) => h('p', {}, para.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s) => (s.startsWith('`') && s.endsWith('`') ? h('code', { text: s.slice(1, -1) }) : s.startsWith('**') && s.endsWith('**') ? h('b', { text: s.slice(2, -2) }) : s))));
    });
  }
  function toolLabel(name, input) {
    const f = (p) => (p ? String(p).replace(/\\/g, '/').replace(E.repo?.root?.replace(/\\/g, '/') + '/', '') : '');
    switch (name) {
      case 'Read': return ['Leyó', f(input.file_path)];
      case 'Edit': case 'MultiEdit': return ['Editó', f(input.file_path)];
      case 'Write': return ['Escribió', f(input.file_path)];
      case 'Glob': return ['Buscó archivos', input.pattern];
      case 'Grep': return ['Buscó en el código', input.pattern];
      case 'Bash': case 'PowerShell': return ['Ejecutó', input.command];
      case 'WebSearch': return ['Buscó en la web', input.query];
      case 'WebFetch': return ['Leyó la web', input.url];
      case 'TodoWrite': return ['Plan', (input.todos || []).map((t) => `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '›' : '○'} ${t.content}`).join('\n')];
      default: return [name, JSON.stringify(input).slice(0, 140)];
    }
  }
  function msgEl(m) {
    if (m.role === 'user') return h('div', { class: 'cl-msg user' }, h('p', { text: m.text }));
    if (m.role === 'tool') {
      const [verb, what] = toolLabel(m.name, m.input || {});
      const file = ['Read', 'Edit', 'MultiEdit', 'Write'].includes(m.name) ? String(m.input?.file_path || '').replace(/\\/g, '/').replace(E.repo?.root?.replace(/\\/g, '/') + '/', '') : null;
      return h('div', { class: `cl-tool ${m.error ? 'err' : ''} ${m.name === 'TodoWrite' ? 'todo' : ''}` }, h('b', { text: verb }), file ? h('button', { class: 'cl-file', text: what, onclick: () => openFile(file) }) : h('span', { text: what }), m.error && h('em', { text: ' · falló' }));
    }
    if (m.role === 'error') return h('div', { class: 'cl-msg error' }, h('p', { text: m.text }));
    if (m.role === 'meta') return h('p', { class: 'cl-meta', text: m.text });
    return h('div', { class: 'cl-msg assistant' }, renderText(m.text));
  }
  function renderChat() {
    const box = $('#clMsgs');
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    fill(box, E.chat.messages.length ? E.chat.messages.map(msgEl) : h('div', { class: 'cl-empty' }, h('b', { text: 'Pídele algo a Claude' }), h('p', { text: 'Trabaja sobre esta web con tu Claude Code: lee el código, edita archivos y te explica lo que hizo. Los archivos que cambie se recargan solos en el editor.' }), h('p', { class: 'hint', text: 'Ejemplos: «Cambia el color del botón de reservas a dorado», «¿Dónde se arma el menú?», «Corrige el error de build».' })));
    if (E.chat.busy) box.append(h('div', { class: 'cl-typing', text: E.chat.status || 'Pensando…' }));
    if (atBottom || E.chat.busy) box.scrollTop = box.scrollHeight;
    const btn = $('#clSend');
    if (btn) {
      btn.textContent = E.chat.busy ? 'Detener' : 'Enviar';
      btn.classList.toggle('stop', E.chat.busy);
    }
    statusBar();
  }
  let saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => cl.saveHistory(E.repo.dir, { session: E.chat.session, model: E.chat.model, messages: E.chat.messages, usage: E.chat.usage }), 500);
  }

  cl.onEvent(({ chatId, ev }) => {
    if (chatId !== 'main' || !E.repo) return;
    const c = E.chat;
    if (ev.type === 'system' && ev.subtype === 'init') {
      c.session = ev.session_id;
      c.modelUsed = ev.model;
      c.status = `Usando ${ev.model}`;
    } else if (ev.type === 'assistant') {
      const m = ev.message || {};
      if (m.usage) c.usage = m.usage;
      for (const part of m.content || []) {
        if (part.type === 'text' && part.text) {
          const last = c.messages[c.messages.length - 1];
          if (last?.role === 'assistant' && last.id === m.id) last.text += part.text;
          else c.messages.push({ role: 'assistant', id: m.id, text: part.text });
        } else if (part.type === 'tool_use') {
          c.messages.push({ role: 'tool', id: part.id, name: part.name, input: part.input });
          c.status = toolLabel(part.name, part.input || {}).join(' ').slice(0, 80) + '…';
        } else if (part.type === 'thinking') c.status = 'Pensando…';
      }
    } else if (ev.type === 'user') {
      for (const part of ev.message?.content || []) {
        if (part.type === 'tool_result' && part.is_error) {
          const t = c.messages.find((x) => x.role === 'tool' && x.id === part.tool_use_id);
          if (t) t.error = true;
        }
      }
    } else if (ev.type === 'rate_limit_event') {
      c.limit = ev.rate_limit_info;
    } else if (ev.type === 'result') {
      if (ev.is_error) c.messages.push({ role: 'error', text: ev.result || 'Claude no pudo terminar.' });
      if (ev.session_id) c.session = ev.session_id;
      const secs = Math.round((ev.duration_ms || 0) / 1000);
      c.messages.push({ role: 'meta', text: `${c.modelUsed || ''} · ${secs} s · ${ev.num_turns || 1} ${ev.num_turns === 1 ? 'paso' : 'pasos'}` });
    } else if (ev.type === 'vt-error') {
      c.messages.push({ role: 'error', text: ev.message });
    } else if (ev.type === 'vt-end') {
      c.busy = false;
      c.status = null;
      if (ev.code && ev.stderr) c.messages.push({ role: 'error', text: /login|auth|log in/i.test(ev.stderr) ? 'Claude Code no tiene sesión iniciada. Abre una terminal, escribe «claude» e inicia sesión una vez.' : ev.stderr });
      persist();
      refreshGit();
    }
    renderChat();
  });

  async function sendChat() {
    const c = E.chat;
    if (c.busy) {
      await cl.stop('main');
      c.messages.push({ role: 'meta', text: 'Detenido.' });
      return renderChat();
    }
    const ta = $('#clInput');
    const text = ta.value.trim();
    if (!text) return;
    let prompt = text;
    const t = tabOf(E.active);
    if (c.withFile && t?.model) {
      const sel = E.editor.getSelection();
      const selText = sel && !sel.isEmpty() ? t.model.getValueInRange(sel) : '';
      prompt = `${text}\n\n(Tengo abierto el archivo \`${t.path}\`${selText ? `; seleccioné las líneas ${sel.startLineNumber}-${sel.endLineNumber}:\n\`\`\`\n${selText.slice(0, 20000)}\n\`\`\`` : ''}.)`;
    }
    c.messages.push({ role: 'user', text: text + (c.withFile && t?.model ? `\n\n📄 ${t.path}` : '') });
    c.busy = true;
    c.status = 'Enviando…';
    ta.value = '';
    renderChat();
    try {
      await cl.send({ chatId: 'main', text: prompt, session: c.session, model: c.model, effort: c.effort, access: c.access });
    } catch (e) {
      c.busy = false;
      c.messages.push({ role: 'error', text: errMsg(e) });
      renderChat();
    }
  }

  // ---------------- armado de la vista ----------------
  function layout() {
    const body = $('#editorBody');
    const sel = (opts, value, label, onchange) => h('select', { class: 'sn-select cl-sel', 'aria-label': label, onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, text: l, selected: v === value })));
    const input = h('textarea', { id: 'clInput', class: 'cl-input', rows: 3, placeholder: 'Pídele algo a Claude… (Enter envía, Mayús+Enter salto de línea)', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } } });
    fill(body,
      h('header', { class: 'ed-head' },
        h('button', { class: 'btn subtle small', text: '‹ Websites', onclick: () => { showView('webs'); } }),
        h('b', { class: 'ed-title', text: E.repo.name }),
        h('span', { id: 'edCrumbs', class: 'ed-crumbs' }),
        h('span', { class: 'ed-sp' }),
        h('button', { class: 'btn subtle small', text: E.panels.tree ? 'Ocultar archivos' : 'Mostrar archivos', onclick: () => { E.panels.tree = !E.panels.tree; layout(); } }),
        h('button', { class: 'btn subtle small', text: E.panels.chat ? 'Ocultar Claude' : 'Mostrar Claude', onclick: () => { E.panels.chat = !E.panels.chat; layout(); } }),
        h('button', { class: 'btn ghost small', text: 'Abrir en VS Code', onclick: () => window.api.re.openDir(E.repo.dir, 'code') })
      ),
      h('div', { class: `ed-grid ${E.panels.tree ? '' : 'no-tree'} ${E.panels.chat ? '' : 'no-chat'}` },
        E.panels.tree && h('aside', { class: 'ed-side' },
          h('div', { class: 'ed-side-head' }, h('b', { text: 'Archivos' }), h('span', { class: 'ed-sp' }),
            h('button', { class: 'ed-mini', title: 'Nuevo archivo', 'aria-label': 'Nuevo archivo', text: '＋', onclick: () => newItem(false) }),
            h('button', { class: 'ed-mini', title: 'Nueva carpeta', 'aria-label': 'Nueva carpeta', text: '▣', onclick: () => newItem(true) }),
            h('button', { class: 'ed-mini', title: 'Recargar', 'aria-label': 'Recargar árbol', text: '↻', onclick: async () => { for (const d of E.expanded) await loadDir(d); renderTree(); } })),
          h('div', { id: 'edTree', class: 'ed-tree', role: 'tree' })
        ),
        h('section', { class: 'ed-main' },
          h('div', { id: 'edTabs', class: 'ed-tabs' }),
          h('div', { class: 'ed-surface' }, h('div', { id: 'edMonaco', class: 'ed-monaco', hidden: !E.active }), h('div', { id: 'edInfo', class: 'ed-info', hidden: !!E.active, text: 'Abre un archivo del árbol de la izquierda.' }))
        ),
        E.panels.chat && h('aside', { class: 'cl' },
          h('div', { class: 'cl-head' },
            h('b', { text: 'Claude' }),
            h('span', { class: 'ed-sp' }),
            h('button', { class: 'btn subtle small', text: 'Nueva conversación', onclick: () => { if (E.chat.busy) return; E.chat.session = null; E.chat.messages = []; E.chat.usage = null; persist(); renderChat(); } })
          ),
          h('div', { class: 'cl-opts' },
            sel(MODELS, E.chat.model, 'Modelo', (v) => { E.chat.model = v; persist(); }),
            sel(EFFORT, E.chat.effort, 'Esfuerzo', (v) => (E.chat.effort = v)),
            sel(ACCESS, E.chat.access, 'Permisos', (v) => (E.chat.access = v))
          ),
          h('div', { id: 'clMsgs', class: 'cl-msgs', 'aria-live': 'polite' }),
          h('div', { class: 'cl-compose' },
            input,
            h('div', { class: 'cl-row' },
              h('label', { class: 'rx-check' }, h('input', { type: 'checkbox', checked: E.chat.withFile, onchange: (e) => (E.chat.withFile = e.target.checked) }), h('span', { text: 'Incluir el archivo abierto' })),
              h('span', { class: 'ed-sp' }),
              h('button', { id: 'clSend', class: 'btn primary small', text: 'Enviar', onclick: sendChat })
            )
          )
        )
      ),
      h('footer', { id: 'edStatus', class: 'ed-status' })
    );
    // Monaco vive siempre en el mismo contenedor: al rehacer la vista se mueve ese contenedor
    const slot = $('#edMonaco');
    E.host ||= h('div', { class: 'ed-monaco-host' });
    slot.append(E.host);
    if (E.editor) requestAnimationFrame(() => E.editor.layout());
    renderTree();
    renderTabs();
    renderChat();
    statusBar();
    if (E.active) activate(E.active);
  }

  async function open(repo) {
    if (E.repo && E.repo.dir !== repo.dir) {
      if (E.tabs.some((t) => t.dirty) && !confirmSwitch) {
        confirmSwitch = true;
        toast('Hay archivos sin guardar en la otra web: vuelve a pulsar para descartarlos.', true);
        setTimeout(() => (confirmSwitch = false), 5000);
        return;
      }
      for (const t of E.tabs) t.model?.dispose();
      E.tabs = [];
      E.active = null;
      E.tree = {};
      E.expanded = new Set(['']);
      if (E.chat.busy) await cl.stop('main');
    }
    const r = await ed.open(repo.dir);
    E.repo = { dir: repo.dir, name: r.name, root: r.root };
    const hist = await cl.history(repo.dir);
    if (hist && (!E.chat.messages.length || E.chat.dir !== repo.dir)) Object.assign(E.chat, { session: hist.session, messages: hist.messages || [], usage: hist.usage || null, model: hist.model || E.chat.model, busy: false });
    else if (E.chat.dir !== repo.dir) Object.assign(E.chat, { session: null, messages: [], usage: null, busy: false });
    E.chat.dir = repo.dir;
    showView('editor');
    await loadDir('');
    layout();
    refreshGit();
    try {
      await ensureEditor();
      layout();
      const readme = (E.tree[''] || []).find((n) => /^(package\.json|readme\.md)$/i.test(n.name));
      if (!E.active && readme) openFile(readme.path);
    } catch (e) {
      toast(`El editor no pudo cargar: ${errMsg(e)}`, true);
    }
  }
  let confirmSwitch = false;

  window.addEventListener('keydown', (e) => {
    if ($('#editorView')?.hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });
  window.editorUI = { open };
})();
