// Client OSC UDP vers la Wing (port officiel 2223, firmware >= 1.08), basé sur le package `osc`
// (le format d'argument {type, value} qu'il attend est déjà celui produit par scenePlanner.js).
//
// Abonnement ("Subscribing to OSC Data", doc officielle Maillot) : la Wing n'envoie JAMAIS de
// message non sollicité (ex: un changement fait à la main sur l'écran tactile) sans qu'un client
// s'y soit abonné avec l'adresse "/*s" (abonnement aux messages OSC — "/*b" existe aussi pour le
// format binaire natif, non utilisé ici). Un seul abonnement actif à la fois sur toute la console,
// et il expire après 10s s'il n'est pas renouvelé — exactement ce que font Wing-Edit et Mixing
// Station en tâche de fond. Les requêtes "get" ponctuelles (adresse envoyée sans argument) elles,
// fonctionnent indépendamment de l'abonnement et répondent toujours.

const osc = require('osc');
const os = require('os');

const DEFAULT_PORT = 2223;
const SUBSCRIBE_ADDRESS = '/*s';
const SUBSCRIBE_RENEW_MS = 8000; // renouvelé avant l'expiration à 10s

function openPort(host, port) {
  return new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: 0,
    remoteAddress: host,
    remotePort: port,
  });
}

function sendAllMessages(host, port, messages, delayMsBetweenMessages = 20) {
  return new Promise((resolve, reject) => {
    const udpPort = openPort(host, port || DEFAULT_PORT);
    udpPort.on('error', reject);
    udpPort.on('ready', async () => {
      try {
        for (const m of messages) {
          udpPort.send({ address: m.address, args: m.args });
          if (delayMsBetweenMessages > 0) await sleep(delayMsBetweenMessages);
        }
        udpPort.close();
        resolve(messages.length);
      } catch (err) {
        udpPort.close();
        reject(err);
      }
    });
    udpPort.open();
  });
}

/** "/?" est la commande officielle d'identification de la console (nom, IP, session, version) —
 * documentée comme le moyen standard de vérifier qu'un client OSC est bien reçu. */
function testConnection(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const udpPort = openPort(host, port || DEFAULT_PORT);
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try { udpPort.close(); } catch { /* déjà fermé */ }
      resolve(ok);
    };

    udpPort.on('error', () => finish(false));
    udpPort.on('message', () => finish(true));
    udpPort.on('ready', () => udpPort.send({ address: '/?', args: [] }));
    udpPort.open();

    setTimeout(() => finish(false), timeoutMs);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ouvre une écoute persistante + s'abonne aux messages non sollicités ("/*s", renouvelé toutes les
 * 8s). Appelle onMessage(address, args) pour tout ce que la console renvoie : réponses aux "get",
 * ET DÉSORMAIS aussi les changements faits à la main sur la console (écran tactile, Wing-Edit) grâce
 * à l'abonnement — c'est ce qui manquait pour voir quoi que ce soit dans le journal de diagnostic.
 * Retourne { query(address), send(address, args), stop() }. */
function startMonitor(host, port, onMessage, onError) {
  const udpPort = openPort(host, port || DEFAULT_PORT);
  udpPort.on('message', (msg) => onMessage(msg.address, msg.args || []));
  if (onError) udpPort.on('error', onError);

  let renewInterval = null;
  udpPort.on('ready', () => {
    udpPort.send({ address: SUBSCRIBE_ADDRESS, args: [] });
    renewInterval = setInterval(() => {
      udpPort.send({ address: SUBSCRIBE_ADDRESS, args: [] });
    }, SUBSCRIBE_RENEW_MS);
  });
  udpPort.open();

  return {
    query: (address) => udpPort.send({ address, args: [] }),
    send: (address, args) => udpPort.send({ address, args }),
    stop: () => {
      if (renewInterval) clearInterval(renewInterval);
      try { udpPort.close(); } catch { /* déjà fermé */ }
    },
  };
}

/** Adresse(s) de broadcast à utiliser : 255.255.255.255 (broadcast "limité", générique) + l'adresse
 * de broadcast calculée de chaque interface IPv4 locale (ex: 192.168.1.255) — certains réseaux/
 * routeurs Windows laissent passer l'une mais pas l'autre, donc on tente les deux pour fiabiliser. */
function getBroadcastAddresses() {
  const addrs = new Set(['255.255.255.255']);
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list || []) {
      if (iface.family !== 'IPv4' || iface.internal || !iface.netmask) continue;
      const ip = iface.address.split('.').map(Number);
      const mask = iface.netmask.split('.').map(Number);
      const bcast = ip.map((octet, idx) => (octet | (~mask[idx] & 0xff)) & 0xff);
      addrs.add(bcast.join('.'));
    }
  }
  return [...addrs];
}

/** Découvre les consoles Wing sur le réseau local : diffuse "/?" (commande officielle d'identification,
 * doc Maillot) en broadcast UDP sur le port 2223 et collecte les réponses. La réponse est une seule
 * chaîne "WING,<ip>,<session>,<modèle>,<série>,<version>" — confirmé par observation directe.
 * Retourne une liste de { ip, name, session, model, version, raw }. */
function discoverConsoles(timeoutMs = 2500, port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    // Le broadcast se configure via l'option du CONSTRUCTEUR (osc.js l'applique lui-même une fois le
    // socket lié, avant l'événement "ready") — un appel manuel à socket.setBroadcast() après coup,
    // comme précédemment, arrive trop tard et n'a aucun effet : c'était le bug empêchant toute réponse.
    const udpPort = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, broadcast: true });
    const found = new Map(); // ip -> info

    udpPort.on('message', (msg, _timeTag, info) => {
      if (msg.address !== '/?' || !info) return;
      const raw = msg.args?.[0]?.value ?? msg.args?.[0];
      if (typeof raw !== 'string') return;
      const parts = raw.split(',');
      found.set(info.address, {
        ip: info.address,
        name: parts[0] || 'WING',
        session: parts[2] || '',
        model: parts[3] || '',
        version: parts[5] || '',
        raw,
      });
    });

    udpPort.on('ready', () => {
      for (const addr of getBroadcastAddresses()) {
        try {
          udpPort.send({ address: '/?', args: [] }, addr, port);
        } catch { /* une des adresses peut échouer (ex: pas de route) -- on tente les autres */ }
      }
    });
    udpPort.on('error', () => { /* on collecte simplement ce qu'on a pu obtenir avant l'erreur */ });
    udpPort.open();

    setTimeout(() => {
      try { udpPort.close(); } catch { /* déjà fermé */ }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

module.exports = { sendAllMessages, testConnection, startMonitor, discoverConsoles, DEFAULT_PORT };
