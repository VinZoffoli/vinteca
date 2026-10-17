// Chat con Claude Code dentro del editor de Websites. Usa el Claude Code que ya
// tienes instalado (con tu sesión y tu plan): cada mensaje lanza `claude -p`
// en la carpeta de la web y la respuesta llega en vivo. La conversación sigue
// con --resume, así que Claude recuerda lo hablado.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

let exePath = null;
function findClaude() {
  if (exePath && fs.existsSync(exePath)) return exePath;
  const home = os.homedir();
  const cands = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(home, '.local', 'bin', 'claude.exe'),
    path.join(home, '.claude', 'local', 'claude.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
  ];
  for (const c of cands) if (fs.existsSync(c)) return (exePath = c);
  try {
    const out = execFileSync('where.exe', ['claude.exe'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).split(/\r?\n/).find((l) => l.trim());
    if (out && fs.existsSync(out.trim())) return (exePath = out.trim());
  } catch {}
  return null;
}

const MODES = {
  read: { mode: 'default', tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'] },
  edit: { mode: 'acceptEdits', tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebSearch', 'WebFetch', 'TodoWrite'] },
  run: { mode: 'acceptEdits', tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebSearch', 'WebFetch', 'TodoWrite', 'Bash', 'PowerShell'] },
};

const running = new Map(); // id de chat → proceso

/**
 * Envía un mensaje. onEvent recibe los eventos de stream-json de Claude Code.
 * opts: { cwd, text, session, model, effort, access, chatId }
 */
function send(opts, onEvent) {
  const exe = findClaude();
  if (!exe) throw new Error('No encuentro Claude Code en este PC. Instálalo (npm install -g @anthropic-ai/claude-code) e inicia sesión una vez en una terminal con «claude».');
  const m = MODES[opts.access] || MODES.edit;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', m.mode, '--allowedTools', m.tools.join(' ')];
  if (opts.model) args.push('--model', opts.model);
  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.session) args.push('--resume', opts.session);
  const child = spawn(exe, args, { cwd: opts.cwd, windowsHide: true, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'viperteca' } });
  running.set(opts.chatId, child);
  let buf = '';
  let errBuf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {}
    }
  });
  child.stderr.on('data', (d) => (errBuf += d.toString('utf8')).slice(-4000));
  child.on('error', (e) => onEvent({ type: 'vt-error', message: e.message }));
  child.on('close', (code) => {
    running.delete(opts.chatId);
    if (buf.trim()) {
      try {
        onEvent(JSON.parse(buf.trim()));
      } catch {}
    }
    onEvent({ type: 'vt-end', code, stderr: code ? errBuf.trim().split('\n').slice(-3).join('\n') : '' });
  });
  child.stdin.end(String(opts.text || ''), 'utf8');
  return true;
}

function stop(chatId) {
  const c = running.get(chatId);
  if (!c) return false;
  try {
    // en Windows, matar también los procesos hijos (comandos que Claude lanzó)
    spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { windowsHide: true });
  } catch {
    c.kill();
  }
  return true;
}

function available() {
  const exe = findClaude();
  if (!exe) return { ok: false };
  let version = null;
  try {
    version = execFileSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  } catch {}
  return { ok: true, version };
}

module.exports = { send, stop, available, findClaude };
