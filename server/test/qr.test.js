import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { qrMatrix, qrSvg } from '../client/src/qr.js';

/** Draws the matrix to pixels (with a quiet zone) the way a phone camera would see it, then decodes it. */
function decode(text, scale = 6) {
  const m = qrMatrix(text);
  const q = 4, n = m.length + q * 2, size = n * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  m.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + q) * scale + y) * size + (c + q) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }));
  return jsQR(data, size, size);
}

test('QR codes for host addresses decode back to the exact address', () => {
  for (const url of ['http://192.168.1.20:8080', 'http://10.0.0.7:8081', 'http://172.20.10.1:8080', 'http://192.168.43.1:8080/']) {
    const result = decode(url);
    assert.ok(result, `decodes ${url}`);
    assert.equal(result.data, url);
  }
});

test('the SVG has a quiet zone, a viewBox and no markup injection from the text', () => {
  const svg = qrSvg('http://192.168.1.20:8080');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 (\d+) \1"/);
  assert.match(svg, /<path d="M\d+,\d+h1v1h-1z/);
  const evil = qrSvg('http://x/"><script>alert(1)</script>');
  assert.ok(!evil.includes('<script>'));
});
