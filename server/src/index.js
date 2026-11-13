// Command line entry point: `npm start`.   PORT=8080 HOST=0.0.0.0
import os from 'node:os';
import { createGameServer } from './server.js';
import { advertise } from './discovery.js';

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0'; // all interfaces, so other devices on the LAN can connect

const game = createGameServer({ log: (...a) => console.log(new Date().toLocaleTimeString(), ...a) });

try {
  await game.listen(port, host);
} catch (e) {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try: PORT=${port + 1} npm start` : e.message);
  process.exit(1);
}

const lan = Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);

console.log('\nStratego server is running.\n');
console.log(`  This machine:   http://localhost:${port}`);
if (host === '0.0.0.0' || host === '::') {
  for (const a of lan) console.log(`  On your LAN:    http://${a}:${port}   <- share this with the other players`);
  if (!lan.length) console.log('  (no network interface found; only this machine can connect)');
}
// let nearby Stratego apps find this game (MDNS=0 turns it off); failing to advertise never matters
let advertisement = null;
if (process.env.MDNS !== '0' && (host === '0.0.0.0' || host === '::')) {
  try { advertisement = advertise({ port }); } catch { advertisement = null; }
  if (advertisement) console.log(`  Stratego apps on your network can find it as "${advertisement.name}" (${advertisement.addr}).`);
}
console.log('\nPress Ctrl+C to stop.\n');

const stop = async () => { if (advertisement) await advertisement.stop(); await game.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
