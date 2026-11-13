// QR codes for sharing the host's address. The matrix comes from qrcode-generator; we draw it as one SVG path.
import qrcode from 'qrcode-generator';

/** The QR matrix as an array of rows of booleans (true = dark module). */
export function qrMatrix(text) {
  const qr = qrcode(0, 'M'); // type 0 = pick the smallest version that fits, error correction M
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** An SVG string (dark modules on white, with the 4-module quiet zone scanners need). */
export function qrSvg(text, pixels = 168) {
  const m = qrMatrix(text);
  const q = 4, n = m.length + q * 2;
  let d = '';
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c + q},${r + q}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${pixels}" height="${pixels}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${text.replace(/[<>&"]/g, '')}">` +
    `<rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
