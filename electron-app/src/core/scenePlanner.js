// Port JS de WingScenePlanner : traduit un plan d'allocation (allocator.js) en une liste de
// messages OSC concrets { address, args }. args est un tableau de nombres/chaînes ; le type OSC
// (i/f/s) est déduit à l'encodage (voir osc.js), donc on encode explicitement ici :
//   - entier -> { type: 'i', value } / flottant -> { type: 'f', value } / chaîne -> { type: 's', value }
// pour rester sans ambiguïté (contrairement à C#, JS n'a qu'un type "number").

const { Channel, AuxInput, Bus, Matrix, Main, IoInput, IoOutput, Oscillator } = require('./oscAddresses');
const { ChannelFormat, WingBusType, BusRole, WING_INPUT_GROUPS, WING_OUTPUT_GROUPS, WING_CAPACITY } = require('./model');

const AUTOMIX_REF_LEVEL_DB = -10.0;
// Seuls 2 groupes existent sur la Wing (doc officielle) -> "AUTO_X"/"AUTO_Y", confirmés en écoute.
const AUTOMIX_POSTINS_MODE = { 1: 'AUTO_X', 2: 'AUTO_Y' };
// CONFIRMÉ en écoute : valeurs exactes attendues par /io/out/{grp}/{idx}/grp.
const OUTPUT_SOURCE_TYPE = { [WingBusType.MAIN]: 'MAIN', [WingBusType.BUS]: 'BUS', [WingBusType.MATRIX]: 'MTX' };

function i(value) { return { type: 'i', value }; }
function f(value) { return { type: 'f', value }; }
function s(value) { return { type: 's', value }; }

// CONFIRMÉ indirectement (comportement observé) : les paramètres de fader/niveau ("/fdr", "/lvl")
// de la Wing ne prennent PAS un dB brut en float — c'est un float NORMALISÉ 0.0-1.0, avec le même
// barème non-linéaire que toute la famille X32/M32 (même moteur audio/OSC, doc officielle Wing
// écrite par le même auteur — Patrick-Gilles Maillot — que la doc X32). 0.0 = -∞dB, 0.75 = 0dB
// (unité), 1.0 = +10dB. Ça explique le bug rapporté : on envoyait 0.0 (ou même -10.0, hors plage)
// en pensant écrire "0dB"/"−10dB" directement, ce qui retombe/clampe à -∞ côté console. Barème
// standard, largement documenté/répliqué dans l'écosystème (TouchOSC, node-easymidi, etc.).
function dbToFloatRaw(db) {
  if (db <= -90) return 0.0;
  if (db < -60) return (db + 90) / 480;
  if (db < -30) return (db + 70) / 160;
  if (db < -10) return (db + 50) / 80;
  return (db + 30) / 40;
}

// CALIBRATION MATÉRIELLE (mesurée sur console réelle) : le barème X32 "standard" ci-dessus donne
// 0.75 pour 0dB en théorie, mais la Wing affiche en réalité 0.8dB pour cette valeur — la courbe
// réelle de la Wing est décalée d'environ +0.8dB par rapport au barème X32 générique repris ici.
// On compense en ciblant systématiquement (db - CALIBRATION_OFFSET_DB) plutôt que db directement,
// pour que le 0dB demandé tombe bien sur 0dB affiché. À réajuster si un futur relevé le précise.
const CALIBRATION_OFFSET_DB = 0.8;
function dbToFloat(db) {
  return dbToFloatRaw(db - CALIBRATION_OFFSET_DB);
}
const UNITY_GAIN = dbToFloat(0.0); // ~0.73 — volume "0 dB" (calibré) par défaut de tout ce qu'on active.

// Couleurs/icônes par défaut — purement visuelles (palette Wing 1-18, icônes mic 100+ confirmées
// dans le module Companion). Choix arbitraire mais cohérent, à ajuster si besoin.
const CHANNEL_STYLE = {
  commentator: { col: 5, icon: 107 },  // Vert, casque/micro headset
  fieldMic: { col: 9, icon: 100 },     // Rouge, micro générique
  pcSource: { col: 14, icon: null },   // Bleu clair, pas d'icône dédiée confirmée
  engineer: { col: 7, icon: 100 },     // Jaune, micro générique
  automixRef: { col: 12, icon: null }, // Violet, piste technique
  referenceMic: { col: 16, icon: 100 }, // Teal, micro générique
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

// CONFIRMÉ : les canaux Wing sont NATIVEMENT stéréo (spec officielle "40 Stereo Input Channels") —
// contrairement à un X32, une source stéréo n'a besoin que d'UN SEUL canal (voir allocator.js). Le
// canal patche sur le PREMIER des 2 ports physiques liés en stéréo (/io/in/.../mode = "ST") et
// reçoit L+R automatiquement. Donc : messages CANAL émis une seule fois (nom/couleur/icône/automix/
// patch), messages PORT PHYSIQUE émis 1 ou 2 fois selon le format (mono/stéréo de la SOURCE).
function addInputMessages(messages, input) {
  const style = CHANNEL_STYLE[input.kind] || {};
  const isStereo = input.format === ChannelFormat.STEREO;

  const slot = input.firstSlot;
  const isAux = slot > 40;
  const chOrAux = isAux ? slot - 40 : slot;
  const addr = isAux ? AuxInput : Channel;

  // Patcher l'entrée AVANT de nommer/colorer : certaines consoles réappliquent un nom "auto"
  // basé sur la source dès qu'on change le patch, ce qui écraserait un nom envoyé avant. Le canal ne
  // référence que le PREMIER port physique — c'est le lien stéréo côté port (mode=ST) qui lui
  // apporte aussi le second canal, pas un second patch côté canal.
  let groupCode = null;
  if (input.physicalInput) {
    groupCode = WING_INPUT_GROUPS[input.physicalInput.group].oscCode;
    messages.push({ address: addr.inputConnectionGroup(chOrAux), args: [s(groupCode)] });
    messages.push({ address: addr.inputConnectionIndex(chOrAux), args: [i(input.physicalInput.index)] });
  }

  const label = truncateName(input.sourceName);
  messages.push({ address: addr.name(chOrAux), args: [s(label)] });
  if (style.col != null) messages.push({ address: addr.color(chOrAux), args: [i(style.col)] });
  if (style.icon != null) messages.push({ address: addr.icon(chOrAux), args: [i(style.icon)] });

  // Fader du canal lui-même à 0dB (unité) pour TOUT canal utilisé — pas seulement ses sends vers
  // les bus/mix (voir dbToFloat plus haut). Sans ça, le fader garde la valeur laissée par une
  // précédente prod (potentiellement -∞). La piste de référence automix écrase cette valeur juste
  // après avec son propre niveau dédié (-10dB), voir plus bas.
  messages.push({ address: addr.fader(chOrAux), args: [f(UNITY_GAIN)] });

  // Automix : CONFIRMÉ — passe par le slot post-insert du channel (/postins/mode = "AUTO_X"/
  // "AUTO_Y"), pas un paramètre dédié. Uniquement sur les 40 canaux principaux.
  if (input.automixGroup && !isAux) {
    messages.push({ address: Channel.postInsertMode(chOrAux), args: [s(AUTOMIX_POSTINS_MODE[input.automixGroup])] });
    messages.push({ address: Channel.postInsertOn(chOrAux), args: [i(1)] });
  }

  // Piste de référence automix : fader à -10dB, ne sort dans AUCUN bus/main/matrix. On ne se
  // contente pas de "ne rien envoyer" (un résidu de patch d'une précédente prod pourrait laisser
  // cette piste active sur un ancien routage) : on COUPE explicitement tous les sends possibles.
  if (input.kind === 'automixRef') {
    messages.push({ address: addr.fader(chOrAux), args: [f(dbToFloat(AUTOMIX_REF_LEVEL_DB))] });
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

  // Ports physiques : nomme/colore AUSSI la source physique elle-même (pas seulement le channel) —
  // CONFIRMÉ par observation directe : /io/in/LCL/8/col et /io/in/LCL/8/icon s'affichent en écho
  // quand le channel patché sur ce port est modifié. Sur 1 port (mono) ou 2 (stéréo, L puis R) :
  // sans le paramètre "mode" explicite sur CHAQUE port, une paire reste en MONO côté console.
  if (groupCode) {
    const portCount = isStereo ? 2 : 1;
    for (let p = 0; p < portCount; p++) {
      const idx = input.physicalInput.index + p;
      const portLabel = truncateName(isStereo ? `${input.sourceName} ${p === 0 ? 'L' : 'R'}` : input.sourceName);
      messages.push({ address: IoInput.name(groupCode, idx), args: [s(portLabel)] });
      if (style.col != null) messages.push({ address: IoInput.color(groupCode, idx), args: [i(style.col)] });
      if (style.icon != null) messages.push({ address: IoInput.icon(groupCode, idx), args: [i(style.icon)] });
      messages.push({ address: IoInput.mode(groupCode, idx), args: [s(isStereo ? 'ST' : 'M')] });
    }
  }
}

function addBusMessages(messages, bus) {
  let nameAddr, colorAddr, monoAddr;
  switch (bus.busType) {
    case WingBusType.MAIN: nameAddr = Main.name(bus.busNumber); colorAddr = Main.color(bus.busNumber); monoAddr = Main.monoSwitch(bus.busNumber); break;
    case WingBusType.MATRIX: nameAddr = Matrix.name(bus.busNumber); colorAddr = Matrix.color(bus.busNumber); monoAddr = Matrix.monoSwitch(bus.busNumber); break;
    case WingBusType.BUS: nameAddr = Bus.name(bus.busNumber); colorAddr = Bus.color(bus.busNumber); monoAddr = Bus.monoSwitch(bus.busNumber); break;
    default: throw new Error(`Type de bus inconnu: ${bus.busType}`);
  }

  // Patch de sortie AVANT le nommage (même raisonnement que pour les entrées, voir addInputMessages).
  // CONFIRMÉ par observation directe : l'architecture est INVERSÉE par rapport à l'entrée — c'est le
  // PORT PHYSIQUE de sortie qui choisit sa source (/io/out/{grp}/{idx}/grp = "MAIN"/"BUS"/"MTX").
  // CONFIRMÉ aussi : /in n'est PAS le numéro du bus stéréo (1-16) mais un index MONO — "les bus sont
  // notés de 1 à 32" (16 bus stéréo x 2 canaux). Un port physique de sortie est intrinsèquement mono
  // (une paire de broches XLR/AES = un seul canal audio), donc il lui faut désigner PRÉCISÉMENT quel
  // canal (L ou R) d'un bus stéréo il reçoit — pas juste "le bus". Sans ça, envoyer le même numéro de
  // bus pour L et R revenait toujours à désigner son canal L (bug rapporté : "toujours L même pour R").
  // Formule : canal L d'un bus N -> (N-1)*2+1, canal R -> (N-1)*2+2. Appliquée uniformément aux 3
  // types (Bus confirmé ; Main/Matrix par cohérence, non vérifiés séparément).
  const sourceType = OUTPUT_SOURCE_TYPE[bus.busType];
  const monoIndexFor = (channel) => (bus.busNumber - 1) * 2 + (channel === 'r' ? 2 : 1);
  const outRefs = bus.format === ChannelFormat.MONO
    ? [{ ref: bus.physicalOutput?.l, monoIndex: monoIndexFor('l') }]
    : [{ ref: bus.physicalOutput?.l, monoIndex: monoIndexFor('l') }, { ref: bus.physicalOutput?.r, monoIndex: monoIndexFor('r') }];
  for (const { ref, monoIndex } of outRefs) {
    if (!ref) continue;
    const outGroupCode = WING_OUTPUT_GROUPS[ref.group].oscCode;
    messages.push({ address: IoOutput.sourceType(outGroupCode, ref.index), args: [s(sourceType)] });
    messages.push({ address: IoOutput.sourceNumber(outGroupCode, ref.index), args: [i(monoIndex)] });
    messages.push({ address: IoOutput.name(outGroupCode, ref.index), args: [s(truncateName(bus.name))] });
    messages.push({ address: IoOutput.color(outGroupCode, ref.index), args: [i(colorForBusName(bus.name))] });
  }

  messages.push({ address: nameAddr, args: [s(truncateName(bus.name))] });
  messages.push({ address: colorAddr, args: [i(colorForBusName(bus.name))] });
  messages.push({ address: monoAddr, args: [i(bus.format === ChannelFormat.MONO ? 1 : 0)] });

  // CONFIRMÉ sur console réelle : un bus /bus/N a par défaut son send vers Main 1 activé. On ne
  // route jamais nos propres bus (retours, talkback) vers un Main dans cette architecture — on coupe
  // donc explicitement tous les Main sends pour éviter une fuite audio par défaut non désirée.
  if (bus.busType === WingBusType.BUS) {
    for (let m = 1; m <= WING_CAPACITY.mainBuses; m++) {
      messages.push({ address: Bus.mainSendOn(bus.busNumber, m), args: [i(0)] });
    }
  }
}

/** Envoie le contenu direct des bus PGM / mix salle (bus.sends, calculé par l'allocateur) : ce sont
 * les seuls bus alimentés canal par canal — les retours sont agrégés au niveau bus (voir plus bas). */
function addProgramSends(messages, bus, inputBySourceName) {
  for (const sourceName of bus.sends) {
    const input = inputBySourceName.get(sourceName);
    if (!input) continue;
    // Un seul canal par source, même stéréo (voir addInputMessages) — un seul send, pas un par port.
    const { onAddr, levelAddr } = resolveChannelSendAddresses(input.firstSlot, bus);
    messages.push({ address: onAddr, args: [i(1)] });
    messages.push({ address: levelAddr, args: [f(UNITY_GAIN)] });
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
      messages.push({ address: addrs.levelAddr, args: [f(UNITY_GAIN)] });
    }
  }

  if (bus.role === BusRole.COMMENTATOR_RETURN || bus.role === BusRole.FIELD_MIC_RETURN || bus.role === BusRole.ENGINEER_MONITOR) {
    const talkBus = plan.busPlan.find((b) => b.role === BusRole.TALKBACK && sameOwner(b.owner, bus.owner));
    const addrs = talkBus && resolveInterBusSendAddresses(talkBus, bus);
    if (addrs) {
      messages.push({ address: addrs.onAddr, args: [i(1)] });
      messages.push({ address: addrs.levelAddr, args: [f(UNITY_GAIN)] });
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
      const { onAddr, levelAddr } = resolveChannelSendAddresses(input.firstSlot, bus);
      messages.push({ address: onAddr, args: [i(0)] });
      messages.push({ address: levelAddr, args: [f(UNITY_GAIN)] });
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
    // CONFIRMÉ : les channels ont aussi par défaut leur send vers Main 1 activé -- coupé pour tous
    // les Main, pas seulement le 1er, par précaution symétrique avec ce qu'on fait pour les bus.
    for (let m = 1; m <= capacity.mainBuses; m++) {
      messages.push({ address: Channel.mainSendOn(ch, m), args: [i(0)] });
    }
  }
  for (let aux = 1; aux <= capacity.auxChannels; aux++) {
    messages.push({ address: AuxInput.inputConnectionGroup(aux), args: [s('OFF')] });
    messages.push({ address: AuxInput.name(aux), args: [s('')] });
    messages.push({ address: AuxInput.color(aux), args: [i(DEFAULT_COLOR)] });
    messages.push({ address: AuxInput.icon(aux), args: [i(0)] });
    for (let m = 1; m <= capacity.mainBuses; m++) {
      messages.push({ address: AuxInput.mainSendOn(aux, m), args: [i(0)] });
    }
  }
  for (let bus = 1; bus <= capacity.buses; bus++) {
    messages.push({ address: Bus.name(bus), args: [s('')] });
    messages.push({ address: Bus.color(bus), args: [i(DEFAULT_COLOR)] });
    // CONFIRMÉ : un bus a par défaut son send vers Main 1 activé -- on le coupe explicitement.
    for (let m = 1; m <= capacity.mainBuses; m++) {
      messages.push({ address: Bus.mainSendOn(bus, m), args: [i(0)] });
    }
  }
  for (let mtx = 1; mtx <= capacity.matrixBuses; mtx++) {
    messages.push({ address: Matrix.name(mtx), args: [s('')] });
    messages.push({ address: Matrix.color(mtx), args: [i(DEFAULT_COLOR)] });
  }
  for (let main = 1; main <= capacity.mainBuses; main++) {
    messages.push({ address: Main.name(main), args: [s('')] });
    messages.push({ address: Main.color(main), args: [i(DEFAULT_COLOR)] });
  }

  // Patch de SORTIE : architecture inversée (voir addBusMessages) -- c'est le port physique de
  // sortie qui déclare sa source, donc pour tout débrancher il faut balayer tous les ports de
  // sortie physiques possibles (pas les bus/main/matrix, qui n'ont pas cette notion côté sortie).
  for (const meta of Object.values(WING_OUTPUT_GROUPS)) {
    for (let idx = 1; idx <= meta.count; idx++) {
      messages.push({ address: IoOutput.sourceType(meta.oscCode, idx), args: [s('OFF')] });
    }
  }

  return messages;
}

module.exports = { buildMessages, buildClearAllMessages };
