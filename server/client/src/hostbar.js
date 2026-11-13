// The "Share this game" bar at the top of the host page: the address, a QR code, how many other devices are connected,
// and the button that stops hosting. Only used inside the Android app.
import { qrSvg } from './qr.js';

const bar = document.getElementById('hostbar');
const host = window.__stratego_host;
const native = window.NativeHost;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let info = { ok: false, error: 'Could not start hosting.' };
try { info = JSON.parse(native.start(8080)); } catch (e) { info.error = String(e && e.message || e); }

function render() {
  if (!info.ok) {
    bar.innerHTML = `<h2>Hosting failed</h2><p>${esc(info.error)}</p><div class="row"><button id="hostback">Back</button></div>`;
  } else {
    const urls = info.addresses.map((a) => `http://${a}:${info.port}`);
    const links = urls.length
      ? urls.map((u) => `<div class="hosturl">${esc(u)}</div>`).join('')
      : '<p>No Wi-Fi or hotspot address found. Connect to a network (or turn on your hotspot) so others can join.</p>';
    const remote = host.remoteCount();
    bar.innerHTML = `<details open><summary>Hosting on this phone · ${remote} other device${remote === 1 ? '' : 's'} connected</summary>
      <div class="hostbody">
        <div class="hostinfo"><p>Others on the same Wi-Fi can open one of these addresses in a browser, scan the code, or pick this game in the Stratego app's Join screen:</p>${links}
          <p class="muted">Keep this app open and the screen on while others are playing.</p>
          <div class="row"><button id="hoststop">Stop hosting</button></div></div>
        ${urls.length ? `<div class="hostqr">${qrSvg(urls[0])}</div>` : ''}
      </div></details>`;
  }
  bar.hidden = false;
}

bar.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'hoststop') {
    if (host.remoteCount() > 0 && !confirm('Other devices are connected. Stop hosting for everyone?')) return;
    host.stop();
    native.stop();
    location.href = 'lan.html';
  } else if (t.id === 'hostback') {
    location.href = 'lan.html';
  }
});

render();
// keep the device count current without re-drawing while someone is using the page
let last = host.remoteCount();
setInterval(() => {
  const n = host.remoteCount();
  if (n !== last) { last = n; const s = bar.querySelector('summary'); if (s) s.textContent = `Hosting on this phone · ${n} other device${n === 1 ? '' : 's'} connected`; }
}, 1500);
