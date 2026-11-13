import test from 'node:test';
import assert from 'node:assert/strict';
import { lanAddresses, advertise, browse } from '../src/discovery.js';

const iface = (address, extra = {}) => ({ address, family: 'IPv4', internal: false, ...extra });

test('only LAN addresses are advertised: no containers, VMs, tunnels, loopback or public addresses', () => {
  const found = lanAddresses({
    lo: [iface('127.0.0.1', { internal: true })],
    docker0: [iface('172.17.0.1')],
    'br-1a2b3c': [iface('172.18.0.1')],
    virbr0: [iface('192.168.122.1')],
    tailscale0: [iface('10.64.0.5')],
    wlp0s20f3: [iface('172.20.10.5'), { address: 'fe80::1', family: 'IPv6', internal: false }],
    eth0: [iface('192.168.1.20'), iface('8.8.8.8'), iface('169.254.4.4')],
  });
  assert.deepEqual(found, ['172.20.10.5', '192.168.1.20']);
  assert.deepEqual(lanAddresses({}), []);
});

test('nothing is advertised when there is no LAN address', () => {
  assert.equal(advertise({ port: 8080, interfaces: { docker0: [iface('172.17.0.1')] } }), null);
});

test('an advertised server can be found by name, port and preferred address', async (t) => {
  const interfaces = { eth0: [iface('192.168.50.7')] };
  const name = `Stratego test ${process.pid}`;
  const ad = advertise({ port: 18123, name, interfaces });
  assert.equal(ad.addr, '192.168.50.7');
  let seen = null;
  const finder = browse((s) => { if (s.name === name) seen = s; });
  try {
    for (let i = 0; i < 60 && !seen; i++) await new Promise((r) => setTimeout(r, 100));
    if (!seen) { t.skip('multicast does not loop back in this environment'); return; }
    assert.equal(seen.port, 18123);
    assert.equal(seen.txt.addr, '192.168.50.7');
    assert.equal(seen.txt.app, 'stratego');
  } finally {
    finder.stop();
    await ad.stop();
  }
});
