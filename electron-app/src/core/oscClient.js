// Client OSC UDP vers la Wing (port officiel 2223, firmware >= 1.08), basé sur le package `osc`
// (le format d'argument {type, value} qu'il attend est déjà celui produit par scenePlanner.js).

const osc = require('osc');

const DEFAULT_PORT = 2223;

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

/** Demande le nom du canal 1 et attend une réponse UDP dans le délai donné. */
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
    udpPort.on('ready', () => udpPort.send({ address: '/ch/1/name', args: [] }));
    udpPort.open();

    setTimeout(() => finish(false), timeoutMs);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { sendAllMessages, testConnection, DEFAULT_PORT };
