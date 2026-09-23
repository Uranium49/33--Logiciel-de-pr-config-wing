// Port JS de WingScenePlanner : traduit un plan d'allocation (allocator.js) en une liste de
// messages OSC concrets { address, args }. args est un tableau de nombres/chaînes ; le type OSC
// (i/f/s) est déduit à l'encodage (voir osc.js), donc on encode explicitement ici :
//   - entier -> { type: 'i', value } / flottant -> { type: 'f', value } / chaîne -> { type: 's', value }
// pour rester sans ambiguïté (contrairement à C#, JS n'a qu'un type "number").

const { Channel, AuxInput, Bus, Matrix, Main, IoInput, IoOutput, Oscillator } = require('./oscAddresses');
const { ChannelFormat, WingBusType, BusRole, WING_INPUT_GROUPS, WING_OUTPUT_GROUPS, WING_CAPACITY } = require('./model');

const AUTOMIX_REF_LEVEL_DB = -10.0;

function i(value) { return { type: 'i', value }; }
function f(value) { return { type: 'f', value }; }
function s(value) { return { type: 's', value }; }

// Couleurs/icônes par défaut — purement visuelles (palette Wing 1-18, icônes mic 100+ confirmées
// dans le module Companion). Choix arbitraire mais cohérent, à ajuster si besoin.
const CHANNEL_STYLE = {
  commentator: { col: 5, icon: 107 },  // Vert, casque/micro headset
  fieldMic: { col: 9, icon: 100 },     // Rouge, micro générique
  pcSource: { col: 14, icon: null },   // Bleu clair, pas d'icône dédiée confirmée
  engineer: { col: 7, icon: 100 },     // Jaune, micro générique
  automixRef: { col: 12, icon: null }, // Violet, piste technique
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

  const hasAutomixRef = plan.inputPlan.some((row) => row.kind === 'automixRef');
  if (hasAutomixRef) {
    // Réglage global du générateur — EXPÉRIMENTAL, voir oscAddresses.Oscillator. Une seule fois,
    // pas par piste : sur la Wing comme sur la plupart des consoles de cette famille, l'oscillateur
    // est un générateur unique partagé, pas une instance par canal patché sur lui.
    messages.push({ address: Oscillator.wave(), args: [s('PINK')] });
    messages.push({ address: Oscillator.level(), args: [f(AUTOMIX_REF_LEVEL_DB)] });
  }

  for (const input of plan.inputPlan) addInputMessages(messages, input);

  for (const bus of plan.busPlan) {
    addBusMessages(messages, bus);
    addProgramSends(messages, bus, inputBySourceName);   // PGM / mix salle : contenu direct des canaux
    addAggregationSends(messages, bus, plan);            // retours : agrégation Main/Bus -> Matrix/Bus
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
    let groupCode = null;
    let sourceIndex = null;
    if (input.physicalInput) {
      groupCode = WING_INPUT_GROUPS[input.physicalInput.group].oscCode;
      sourceIndex = input.physicalInput.index + n;
      messages.push({ address: addr.inputConnectionGroup(chOrAux), args: [s(groupCode)] });
      messages.push({ address: addr.inputConnectionIndex(chOrAux), args: [i(sourceIndex)] });
    }

    // sourceName (identité courte, ex. "FR-Comm1") plutôt que displayName (ex. "FR-Comm1 (FR)",
    // réservé à l'UI) pour éviter une troncature disgracieuse sur la scribble strip.
    const label = truncateName(input.slotCount > 1 ? `${input.sourceName} ${n === 0 ? 'L' : 'R'}` : input.sourceName);
    messages.push({ address: addr.name(chOrAux), args: [s(label)] });
    if (style.col != null) messages.push({ address: addr.color(chOrAux), args: [i(style.col)] });
    if (style.icon != null) messages.push({ address: addr.icon(chOrAux), args: [i(style.icon)] });

    // Automix : les 2 casteurs d'une même langue partagent un groupe de gain-sharing (EXPÉRIMENTAL,
    // adresse non confirmée — voir oscAddresses.js). Uniquement sur les 40 canaux principaux.
    if (input.automixGroup && !isAux) {
      messages.push({ address: Channel.autoMixGroup(chOrAux), args: [i(input.automixGroup)] });
    }

    // Piste de référence automix : fader à -10dB, ne sort dans AUCUN bus/main/matrix. On ne se
    // contente pas de "ne rien envoyer" (un résidu de patch d'une précédente prod pourrait laisser
    // cette piste active sur un ancien routage) : on COUPE explicitement tous les sends possibles.
    if (input.kind === 'automixRef') {
      messages.push({ address: addr.fader(chOrAux), args: [f(AUTOMIX_REF_LEVEL_DB)] });
      for (let m = 1; m <= WING_CAPACITY.mainBuses; m++) {
        messages.push({ address: addr.mainSendOn(chOrAux, m), args: [i(0)] });
      }
      for (let b = 1; b <= WING_CAPACITY.buses; b++) {
        messages.push({ address: addr.sendOn(chOrAux, b), args: [i(0)] });
      }
      for (let mx = 1; mx <= WING_CAPACITY.matrixBuses; mx++) {
        messages.push({ address: addr.matrixSendOn(chOrAux, mx), args: [i(0)] });
      }
    }

    // Nomme/colore AUSSI la source physique elle-même (pas seulement le channel) — CONFIRMÉ par
    // observation directe sur une Wing réelle : /io/in/LCL/8/col et /io/in/LCL/8/icon s'affichent
    // en écho quand le channel patché sur ce port est modifié. /name suit la même logique par
    // symétrie avec col/icon.
    if (groupCode) {
      messages.push({ address: IoInput.name(groupCode, sourceIndex), args: [s(label)] });
      if (style.col != null) messages.push({ address: IoInput.color(groupCode, sourceIndex), args: [i(style.col)] });
      if (style.icon != null) messages.push({ address: IoInput.icon(groupCode, sourceIndex), args: [i(style.icon)] });
    }
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
  // EXPÉRIMENTAL : contrairement à IoInput (confirmé sur console réelle), rien ne confirme l'existence
  // ni l'adresse de /io/out/... ou de /main-matrix-bus/N/out/conn/... — supposition par symétrie.
  if (bus.physicalOutput) {
    const outGroupCode = WING_OUTPUT_GROUPS[bus.physicalOutput.group].oscCode;
    messages.push({ address: `${nodeAddr}/out/conn/grp`, args: [s(outGroupCode)] });
    messages.push({ address: `${nodeAddr}/out/conn/in`, args: [i(bus.physicalOutput.index)] });
    messages.push({ address: IoOutput.name(outGroupCode, bus.physicalOutput.index), args: [s(truncateName(bus.name))] });
    messages.push({ address: IoOutput.color(outGroupCode, bus.physicalOutput.index), args: [i(colorForBusName(bus.name))] });
  }

  messages.push({ address: nameAddr, args: [s(truncateName(bus.name))] });
  messages.push({ address: colorAddr, args: [i(colorForBusName(bus.name))] });
  messages.push({ address: monoAddr, args: [i(bus.format === ChannelFormat.MONO ? 1 : 0)] });
}

/** Envoie le contenu direct des bus PGM / mix salle (bus.sends, calculé par l'allocateur) : ce sont
 * les seuls bus alimentés canal par canal — les retours sont agrégés au niveau bus (voir plus bas). */
function addProgramSends(messages, bus, inputBySourceName) {
  for (const sourceName of bus.sends) {
    const input = inputBySourceName.get(sourceName);
    if (!input) continue;
    for (let n = 0; n < input.slotCount; n++) {
      const { onAddr, levelAddr } = resolveChannelSendAddresses(input.firstSlot + n, bus);
      messages.push({ address: onAddr, args: [i(1)] });
      messages.push({ address: levelAddr, args: [f(0.0)] });
    }
  }
}

/** Agrège, pour un bus de retour, deux flux au niveau BUS (pas canal) :
 *   - mainRef (ou mainRefs, pluriel pour l'ingé son qui écoute TOUS les PGM+salle à la fois) : déjà
 *     rempli — toujours actif.
 *   - le bus talkback dédié à ce retour (même owner, role TALKBACK) — toujours actif ; c'est CE bus
 *     qui reçoit le mesh privé un-à-un (voir addTalkbackMeshMessages), pas la matrix directement. */
function addAggregationSends(messages, bus, plan) {
  for (const ref of bus.mainRef ? [bus.mainRef] : bus.mainRefs || []) {
    const source = findBusByOwner(plan, ref);
    const addrs = source && resolveInterBusSendAddresses(source, bus);
    if (addrs) {
      messages.push({ address: addrs.onAddr, args: [i(1)] });
      messages.push({ address: addrs.levelAddr, args: [f(0.0)] });
    }
  }

  if (bus.role === BusRole.COMMENTATOR_RETURN || bus.role === BusRole.FIELD_MIC_RETURN || bus.role === BusRole.ENGINEER_MONITOR) {
    const talkBus = plan.busPlan.find((b) => b.role === BusRole.TALKBACK && sameOwner(b.owner, bus.owner));
    const addrs = talkBus && resolveInterBusSendAddresses(talkBus, bus);
    if (addrs) {
      messages.push({ address: addrs.onAddr, args: [i(1)] });
      messages.push({ address: addrs.levelAddr, args: [f(0.0)] });
    }
  }
}

function findBusByOwner(plan, ownerRef) {
  return plan.busPlan.find((b) => sameOwner(b.owner, ownerRef)) || null;
}

function sameOwner(a, b) {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

/** Résout l'adresse d'un send BUS -> BUS ou BUS -> MATRIX ou MAIN -> MATRIX. MAIN -> BUS n'existe
 * pas sur la Wing (un Main ne peut alimenter qu'une matrice) — retourne null dans ce cas, dégradé
 * silencieusement (arrive seulement si un PGM déborde du pool Main vers le pool Bus). */
function resolveInterBusSendAddresses(source, target) {
  if (source.busType === WingBusType.MAIN) {
    if (target.busType === WingBusType.MATRIX) {
      return { onAddr: Main.matrixSendOn(source.busNumber, target.busNumber), levelAddr: Main.matrixSendLevel(source.busNumber, target.busNumber) };
    }
    return null; // Main -> Bus non supporté
  }
  if (source.busType === WingBusType.BUS) {
    if (target.busType === WingBusType.MATRIX) {
      return { onAddr: Bus.matrixSendOn(source.busNumber, target.busNumber), levelAddr: Bus.matrixSendLevel(source.busNumber, target.busNumber) };
    }
    if (target.busType === WingBusType.BUS) {
      return { onAddr: Bus.sendOn(source.busNumber, target.busNumber), levelAddr: Bus.sendLevel(source.busNumber, target.busNumber) };
    }
  }
  return null;
}

/** Pour chaque bus TALKBACK (dédié à un retour, ou nu si la personne n'a pas de retour), prépare un
 * send coupé (off) depuis le canal de chaque AUTRE participant du mesh — sauf ceux déjà entendus en
 * permanence via mainRef (coveredNames) ou qui SONT ce bus (talkbackNames). Un bouton Stream Deck /
 * Companion bascule ensuite ce send on/off en direct : c'est ce qui permet le privé un-à-un. */
function addTalkbackMeshMessages(messages, plan, inputBySourceName) {
  const allParticipants = [...new Set(plan.busPlan.flatMap((b) => b.talkbackNames))];
  if (allParticipants.length < 2) return;

  for (const bus of plan.busPlan.filter((b) => b.role === BusRole.TALKBACK)) {
    const excluded = new Set([...bus.talkbackNames, ...bus.coveredNames]);
    const speakers = allParticipants.filter((name) => !excluded.has(name));

    for (const speaker of speakers) {
      const input = inputBySourceName.get(speaker);
      if (!input) continue;
      for (let n = 0; n < input.slotCount; n++) {
        const { onAddr, levelAddr } = resolveChannelSendAddresses(input.firstSlot + n, bus);
        messages.push({ address: onAddr, args: [i(0)] });
        messages.push({ address: levelAddr, args: [f(0.0)] });
      }
    }
  }
}

function resolveChannelSendAddresses(slot, destination) {
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

/** Remet à zéro TOUS les channels/aux/bus/matrix/main de la console (nom vide, couleur/icône par
 * défaut, patch d'entrée/sortie débranché "OFF" — valeur confirmée par observation directe : la
 * console affiche "OFF" sur /ch/N/in/conn/grp quand rien n'est patché). Balaye la totalité de la
 * plage matérielle (WING_CAPACITY), pas seulement ce qui est utilisé par la config actuelle —
 * pensé pour effacer les traces d'une précédente production avant d'en charger une nouvelle. */
function buildClearAllMessages(capacity) {
  const messages = [];
  const DEFAULT_COLOR = 1;

  for (let ch = 1; ch <= capacity.mainChannels; ch++) {
    messages.push({ address: Channel.inputConnectionGroup(ch), args: [s('OFF')] });
    messages.push({ address: Channel.name(ch), args: [s('')] });
    messages.push({ address: Channel.color(ch), args: [i(DEFAULT_COLOR)] });
    messages.push({ address: Channel.icon(ch), args: [i(0)] });
  }
  for (let aux = 1; aux <= capacity.auxChannels; aux++) {
    messages.push({ address: AuxInput.inputConnectionGroup(aux), args: [s('OFF')] });
    messages.push({ address: AuxInput.name(aux), args: [s('')] });
    messages.push({ address: AuxInput.color(aux), args: [i(DEFAULT_COLOR)] });
    messages.push({ address: AuxInput.icon(aux), args: [i(0)] });
  }
  for (let bus = 1; bus <= capacity.buses; bus++) {
    messages.push({ address: `${Bus.node(bus)}/out/conn/grp`, args: [s('OFF')] });
    messages.push({ address: Bus.name(bus), args: [s('')] });
    messages.push({ address: Bus.color(bus), args: [i(DEFAULT_COLOR)] });
  }
  for (let mtx = 1; mtx <= capacity.matrixBuses; mtx++) {
    messages.push({ address: `${Matrix.node(mtx)}/out/conn/grp`, args: [s('OFF')] });
    messages.push({ address: Matrix.name(mtx), args: [s('')] });
    messages.push({ address: Matrix.color(mtx), args: [i(DEFAULT_COLOR)] });
  }
  for (let main = 1; main <= capacity.mainBuses; main++) {
    messages.push({ address: `${Main.node(main)}/out/conn/grp`, args: [s('OFF')] });
    messages.push({ address: Main.name(main), args: [s('')] });
    messages.push({ address: Main.color(main), args: [i(DEFAULT_COLOR)] });
  }

  return messages;
}

module.exports = { buildMessages, buildClearAllMessages };
