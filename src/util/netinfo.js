// =============================================================================
//  DETECCIÓN DE LA IP LOCAL (para que los celulares sepan a dónde conectarse)
// -----------------------------------------------------------------------------
//  Lista las direcciones IPv4 de la red local y elige la más probable (WiFi/LAN,
//  descartando adaptadores virtuales como VirtualBox/Hyper-V/VMware).
// =============================================================================

import os from 'node:os';

const VIRTUAL = /virtual|vethernet|hyper-v|vmware|docker|loopback|bluetooth|tailscale|zerotier|radmin/i;

/** Todas las IPv4 locales no internas: [{ iface, address }]. */
export function lanAddresses() {
  const out = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ iface, address: a.address });
    }
  }
  return out;
}

function score({ iface, address }) {
  let s = 0;
  if (/wi-?fi|wlan|wireless/i.test(iface)) s += 100;
  else if (/ethernet|eth\d|en\d|lan/i.test(iface)) s += 60;
  if (VIRTUAL.test(iface)) s -= 200;
  if (address.startsWith('169.254.')) s -= 300;       // link-local (sin red real)
  if (address.startsWith('192.168.56.')) s -= 150;    // rango por defecto de VirtualBox
  if (address.startsWith('192.168.')) s += 30;
  else if (address.startsWith('10.')) s += 20;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 10;
  return s;
}

/** La IP local más probable para que entren los celulares (o null si no hay). */
export function bestLan() {
  const all = lanAddresses();
  return all.length ? [...all].sort((a, b) => score(b) - score(a))[0] : null;
}
