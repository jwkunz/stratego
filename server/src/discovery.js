// Lets nearby Stratego apps find this server: advertises it as "_stratego._tcp" with mDNS / DNS-SD (the same service
// the Android app advertises and browses). Nothing is required for it to work: devices can always type the address.
import os from 'node:os';
import { Bonjour } from 'bonjour-service';

// network interfaces that belong to containers, VMs and tunnels rather than to the LAN other devices are on
const VIRTUAL = /^(lo|docker|veth|br-|virbr|vboxnet|vmnet|tun|tap|tailscale|zt|wg|utun)/i;

/** Private IPv4 addresses other devices on the LAN can use to reach this machine, without container/VM bridges. */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [x, y] = a.address.split('.').map(Number);
      const priv = x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
      if (priv && !out.includes(a.address)) out.push(a.address);
    }
  }
  return out;
}

/**
 * Starts advertising. The best LAN address goes into the service's text record as `addr`: the machine may also have
 * container or VM addresses, and a phone must not be told to connect to those.
 * Returns { name, addr, stop() }, or null when there is no LAN address to advertise.
 */
export function advertise({ port, name = `Stratego on ${os.hostname()}`, interfaces } = {}) {
  const [addr] = lanAddresses(interfaces);
  if (!addr) return null;
  const bonjour = new Bonjour();
  bonjour.publish({ name, type: 'stratego', protocol: 'tcp', port, txt: { app: 'stratego', v: '2', addr }, disableIPv6: true });
  return {
    name, addr,
    stop: () => new Promise((resolve) => { try { bonjour.unpublishAll(() => { bonjour.destroy(); resolve(); }); } catch { resolve(); } }),
  };
}

/** Finds Stratego servers on the network (used by tests and handy for debugging). Returns { stop() }. */
export function browse(onFound) {
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'stratego', protocol: 'tcp' }, (s) => onFound({ name: s.name, port: s.port, txt: s.txt, addresses: s.addresses }));
  return { stop: () => { browser.stop(); bonjour.destroy(); } };
}
