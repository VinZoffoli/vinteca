// Lee el texto de una imagen con el OCR que trae Windows (Windows.Media.Ocr), sin
// conexión ni programas extra. Se usa para pasar tus misiones de Genshin a la
// lista de prioridades a partir de una captura del diario de misiones: el juego
// no da sus misiones a ningún programa, y leer su memoria podría costarte un baneo.
const { execFile } = require('child_process');

const SCRIPT = (file) => `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${file.replace(/'/g, "''")}')) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'Windows no tiene el OCR de ningún idioma instalado.' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = foreach ($l in $result.Lines) { $r = ($l.Words | Select-Object -First 1).BoundingRect; [pscustomobject]@{ text = $l.Text; x = [int]$r.X; y = [int]$r.Y; h = [int]$r.Height } }
@{ width = $bitmap.PixelWidth; height = $bitmap.PixelHeight; lang = $engine.RecognizerLanguage.LanguageTag; lines = @($lines) } | ConvertTo-Json -Depth 4 -Compress
`;

function recognize(file) {
  const encoded = Buffer.from(SCRIPT(file), 'utf16le').toString('base64');
  return new Promise((resolve, reject) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: 60000, maxBuffer: 8 << 20 }, (e, out, err) => {
      if (e) return reject(new Error(`No se pudo leer la imagen: ${String(err || e.message).split('\n')[0]}`));
      try {
        resolve(JSON.parse(String(out).trim()));
      } catch {
        reject(new Error('El OCR de Windows no devolvió texto.'));
      }
    })
  );
}

// Textos de la interfaz del diario de misiones que no son misiones
const UI_WORDS = /^(misiones?|todas?|seguir|dejar de seguir|navegar|recompensas?|detalles|requisitos?|objetivo|ir|rastrear|cerrar|esc|volver|nivel de aventura|rango de aventura|progreso|completad[ao]s?|en curso|nueva|nuevo|pendiente|filtrar|ordenar|mostrar|ocultar|historial|ajustes|mapa|inventario|personajes?|deseos|tienda|eventos?|correo|logros?|amigos?|archivo|la vida en teyvat|cap[ií]tulo [ivxlc\d]+|acto [ivxlc\d]+|preludio|interludio)$/i;
const KIND = [
  [/arconte/i, 'Arconte'],
  [/leyenda|historia/i, 'Leyenda'],
  [/mundo/i, 'Mundo'],
  [/encargo/i, 'Encargo'],
  [/evento/i, 'Evento'],
];

/** Posibles misiones a partir del texto de una captura del diario de misiones. */
function questsFromOcr(res) {
  const lines = (res.lines || []).filter((l) => l.text && l.text.trim());
  if (!lines.length) return [];
  // El diario pone la lista de misiones a la izquierda y el detalle a la derecha
  const left = lines.filter((l) => l.x < res.width * 0.5).sort((a, b) => a.y - b.y);
  const out = [];
  let kind = 'Misión';
  for (const l of left) {
    const t = l.text.replace(/\bEI\b/g, 'El').replace(/\s+/g, ' ').replace(/^[^\p{L}\d«"¡¿]+/u, '').trim();
    const k = KIND.find(([re]) => re.test(t) && /misi[oó]n/i.test(t));
    if (k) {
      kind = k[1];
      continue;
    }
    if (t.length < 4 || t.length > 70 || UI_WORDS.test(t) || /^[\d\s/:%.,-]+$/.test(t)) continue;
    if (!/\p{L}{3}/u.test(t)) continue;
    if (out.some((q) => q.text.toLowerCase() === t.toLowerCase())) continue;
    out.push({ text: t, kind });
  }
  return out.slice(0, 40);
}

module.exports = { recognize, questsFromOcr };
