// Port JS de WingScenePlanner : traduit un plan d'allocation (allocator.js) en une liste de
// messages OSC concrets { address, args }. args est un tableau de nombres/chaînes ; le type OSC
// (i/f/s) est déduit à l'encodage (voir osc.js), donc on encode explicitement ici :
//   - entier -> { type: 'i', value } / flottant -> { type: 'f', value } / chaîne -> { type: 's', value }
// pour rester sans ambiguïté (contrairement à C#, JS n'a qu'un type "number").

const { Channel, AuxInput, Bus, Matrix, Main } = require('./oscAddresses');
const { ChannelFormat, WingBusType, WING_INPUT_GROUPS, WING_OUTPUT_GROUPS } = require('./model');

function i(value) { return { type: 'i', value }; }
function f(value) { return { type: 'f', value }; }
function s(value) { return { type: 's', value }; }

// Couleurs/icônes par défaut — purement visuelles (palette Wing 1-18, icônes mic 100+ confirmées
// dans le module Companion). Choix arbitraire mais cohérent, à ajuster si besoin.
const CHANNEL_STYLE = {
  commentator: { col: 5, icon: 107 },  // Vert, casque/micro headset
  fieldMic: { col: 9, icon: 100 },     // Rouge, micro générique
  pcSource: { col: 14, icon: null },   // Bleu clair, pas d'icône dédiée confirmée
};
const BUS_COLOR_PALETTE = [2, 5, 7, 11, 13, 16, 4, 9, 15, 6]; // rotation de couleurs distinctes

function colorForBusName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return BUS_COLOR_PALETTE[hash % BUS_COLOR_PALETTE.length];
}

// Les scribble-strips de la famille X32/Wing tronquent/rejettent silencieusement les noms trop
// longs (limite historique ~12 car.). On tronque proactivement pour éviter un nom qui ne "prend"
// pas du tout plutôt que d'être juste raccourci.
const MAX_NAME_LENGTH = 12;
function truncateName(name) {
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH) : name;
}

function buildMessages(plan) {
  const messages = [];
  const inputBySourceName = new Map(plan.inputPlan.map((row) => [row.sourceName, row]));

  for (const input of plan.inputPlan) addInputMessages(messages, input);
  for (const bus of plan.busPlan) {
    addBusMessages(messages, bus);
    addProgramSends(messages, bus, inputBySourceName);
  }
  addTalkbackMeshMessages(messages, plan, inputBySourceName);

  return messages;
}

function addInputMessages(messages, input) {
  const style = CHANNEL_STYLE[input.kind] || {};

  for (let n = 0; n < input.slotCount; n++) {
    const slot = input.firstSlot + n;
    const isAux = slot > 40;
    const chOrAux = isAux ? slot - 40 : slot;
    const addr = isAux ? AuxInput : Channel;

    // Patcher l'entrée AVANT de nommer/colorer : certaines consoles réappliquent un nom "auto"
    // basé sur la source dès qu'on change le patch, ce qui écraserait un nom envoyé avant.
    if (input.physicalInput) {
      messages.push({ address: addr.inputConnectionGroup(chOrAux), args: [s(WING_INPUT_GROUPS[input.physicalInput.group].oscCode)] });
      messages.push({ address: addr.inputConnectionIndex(chOrAux), args: [i(input.physicalInput.index + n)] });
    }

    // Utilise sourceName (identité courte, ex. "FR-Comm1") plutôt que displayName (ex. "FR-Comm1
    // (FR)", réservé à l'UI) pour éviter une troncature disgracieuse sur la scribble strip.
    const label = truncateName(input.slotCount > 1 ? `${input.sourceName} ${n === 0 ? 'L' : 'R'}` : input.sourceName);
    messages.push({ address: addr.name(chOrAux), args: [s(label)] });

    if (style.col != null) messages.push({ address: addr.color(chOrAux), args: [i(style.col)] });
    if (style.icon != null) messages.push({ address: addr.icon(chOrAux), args: [i(style.icon)] });
  }
}

function addBusMessages(messages, bus) {
  let nameAddr, colorAddr, monoAddr, nodeAddr;
  switch (bus.busType) {
    case WingBusType.MAIN: nodeAddr = Main.node(bus.busNumber); nameAddr = Main.name(bus.busNumber); colorAddr = Main.color(bus.busNumber); monoAddr = Main.monoSwitch(bus.busNumber); break;
    case WingBusType.MATRIX: nodeAddr = Matrix.node(bus.busNumber); nameAddr = Matrix.name(bus.busNumber); colorAddr = Matrix.color(bus.busNumber); monoAddr = Matrix.monoSwitch(bus.busNumber); break;
    case WingBusType.BUS: nodeAddr = Bus.node(bus.busNumber); nameAddr = Bus.name(bus.busNumber); colorAddr = Bus.color(bus.busNumber); monoAddr = Bus.monoSwitch(bus.busNumber); break;
    default: throw new Error(`Type de bus inconnu: ${bus.busType}`);
  }

  // Patch de sortie AVANT le nommage (même raisonnement que pour les entrées, voir addInputMessages).
  // EXPÉRIMENTAL : contrairement au patch d'entrée (/ch/N/in/conn/...), aucune source publique (ni
  // doc officielle, ni module Companion open-source) ne documente l'adresse de routage d'un
  // bus/matrix/main vers un port de sortie physique. L'adresse ci-dessous est une supposition par
  // symétrie avec l'entrée — à vérifier/corriger en priorité une fois connecté à la console réelle.
  if (bus.physicalOutput) {
    messages.push({ address: `${nodeAddr}/out/conn/grp`, args: [s(WING_OUTPUT_GROUPS[bus.physicalOutput.group].oscCode)] });
    messages.push({ address: `${nodeAddr}/out/conn/in`, args: [i(bus.physicalOutput.index)] });
  }

  messages.push({ address: nameAddr, args: [s(truncateName(bus.name))] });
  messages.push({ address: colorAddr, args: [i(colorForBusName(bus.name))] });
  messages.push({ address: monoAddr, args: [i(bus.format === ChannelFormat.MONO ? 1 : 0)] });
}

/** Envoie réellement le contenu du mix (bus.sends, calculé par l'allocateur : PGM, mix salle,
 * mix-minus des retours...) — c'est ce qui manquait pour que les bus/matrices/mains portent du son. */
function addProgramSends(messages, bus, inputBySourceName) {
  for (const sourceName of bus.sends) {
    const input = inputBySourceName.get(sourceName);
    if (!input) continue;
    for (let n = 0; n < input.slotCount; n++) {
      const { onAddr, levelAddr } = resolveSendAddresses(input.firstSlot + n, bus);
      messages.push({ address: onAddr, args: [i(1)] });
      messages.push({ address: levelAddr, args: [f(0.0)] });
    }
  }
}

/** Prépare, pour chaque bus de retour d'un participant, un send coupé (off) depuis le canal de
 * chaque AUTRE participant — prêt à être basculé on/off en direct par un bouton Stream Deck/Companion.
 * Les participants déjà entendus en permanence via bus.sends (mix-minus normal) sont ignorés : pas
 * besoin d'un talkback pour quelqu'un qu'on entend déjà tout le temps sur ce bus. */
function addTalkbackMeshMessages(messages, plan, inputBySourceName) {
  const allParticipants = [...new Set(plan.busPlan.flatMap((b) => b.talkbackNames))];
  if (allParticipants.length < 2) return;

  for (const bus of plan.busPlan.filter((b) => b.talkbackNames.length > 0)) {
    const speakers = allParticipants.filter((name) => !bus.talkbackNames.includes(name) && !bus.sends.includes(name));
    for (const speaker of speakers) {
      const input = inputBySourceName.get(speaker);
      if (!input) continue;
      for (let n = 0; n < input.slotCount; n++) {
        const { onAddr, levelAddr } = resolveSendAddresses(input.firstSlot + n, bus);
        messages.push({ address: onAddr, args: [i(0)] });
        messages.push({ address: levelAddr, args: [f(0.0)] });
      }
    }
  }
}

function resolveSendAddresses(slot, destination) {
  const isAux = slot > 40;
  const chOrAux = isAux ? slot - 40 : slot;
  const src = isAux ? AuxInput : Channel;

  switch (destination.busType) {
    case WingBusType.BUS:
      return { onAddr: src.sendOn(chOrAux, destination.busNumber), levelAddr: src.sendLevel(chOrAux, destination.busNumber) };
    case WingBusType.MATRIX:
      return { onAddr: src.matrixSendOn(chOrAux, destination.busNumber), levelAddr: src.matrixSendLevel(chOrAux, destination.busNumber) };
    case WingBusType.MAIN:
      return { onAddr: src.mainSendOn(chOrAux, destination.busNumber), levelAddr: src.mainSendLevel(chOrAux, destination.busNumber) };
    default:
      throw new Error(`Type de bus inconnu: ${destination.busType}`);
  }
}

module.exports = { buildMessages };
