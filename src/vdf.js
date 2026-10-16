// Parser mínimo del formato de texto KeyValues (VDF) de Valve:
// libraryfolders.vdf, appmanifest_*.acf, localconfig.vdf...
function parseVdf(text) {
  const root = {};
  const stack = [root];
  let i = 0;
  let pendingKey = null;
  const n = text.length;

  const readString = () => {
    // Asume que text[i] === '"'
    i++;
    let out = '';
    while (i < n && text[i] !== '"') {
      if (text[i] === '\\' && i + 1 < n) {
        const c = text[i + 1];
        out += c === 'n' ? '\n' : c === 't' ? '\t' : c;
        i += 2;
      } else {
        out += text[i++];
      }
    }
    i++; // cierre
    return out;
  };

  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const s = readString();
      if (pendingKey === null) pendingKey = s;
      else {
        stack[stack.length - 1][pendingKey] = s;
        pendingKey = null;
      }
    } else if (c === '{') {
      const obj = {};
      if (pendingKey !== null) stack[stack.length - 1][pendingKey] = obj;
      stack.push(obj);
      pendingKey = null;
      i++;
    } else if (c === '}') {
      if (stack.length > 1) stack.pop();
      pendingKey = null;
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (/\s/.test(c)) {
      i++;
    } else {
      // Token sin comillas (poco habitual)
      let s = '';
      while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
      if (pendingKey === null) pendingKey = s;
      else {
        stack[stack.length - 1][pendingKey] = s;
        pendingKey = null;
      }
    }
  }
  return root;
}

module.exports = { parseVdf };
