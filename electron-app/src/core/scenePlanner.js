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

function buildMessages(plan) {
  const messages = [];
  const slotBySourceName = new Map(plan.inputPlan.map((row) => [row.sourceName, row.firstSlot]));

  for (const input of plan.inputPlan) addInputMessages(messages, input);
  for (const bus of plan.busPlan) addBusMessages(messages, bus);
  addTalkbackMeshMessages(messages, plan, slotBySourceName);

  return messages;
}

function addInputMessages(messages, input) {
  for (let n = 0; n < input.slotCount; n++) {
    const slot = input.firstSlot + n;
    const isAux = slot > 40;
    const chOrAux = isAux ? slot - 40 : slot;

    const nameAddr = isAux ? AuxInput.name(chOrAux) : Channel.name(chOrAux);
    const label = input.slotCount > 1 ? `${input.displayName} ${n === 0 ? 'L' : 'R'}` : input.displayName;
    messages.push({ address: nameAddr, args: [s(label)] });

    if (input.physicalInput) {
      const grpAddr = isAux ? AuxInput.inputConnectionGroup(chOrAux) : Channel.inputConnectionGroup(chOrAux);
      const idxAddr = isAux ? AuxInput.inputConnectionIndex(chOrAux) : Channel.inputConnectionIndex(chOrAux);
      messages.push({ address: grpAddr, args: [s(WING_INPUT_GROUPS[input.physicalInput.group].oscCode)] });
      messages.push({ address: idxAddr, args: [i(input.physicalInput.index + n)] });
    }
  }
}

function addBusMessages(messages, bus) {
  let nameAddr, monoAddr;
  switch (bus.busType) {
    case WingBusType.MAIN: nameAddr = Main.name(bus.busNumber); monoAddr = Main.monoSwitch(bus.busNumber); break;
    case WingBusType.MATRIX: nameAddr = Matrix.name(bus.busNumber); monoAddr = Matrix.monoSwitch(bus.busNumber); break;
    case WingBusType.BUS: nameAddr = Bus.name(bus.busNumber); monoAddr = Bus.monoSwitch(bus.busNumber); break;
    default: throw new Error(`Type de bus inconnu: ${bus.busType}`);
  }

  messages.push({ address: nameAddr, args: [s(bus.name)] });
  messages.push({ address: monoAddr, args: [i(bus.format === ChannelFormat.MONO ? 1 : 0)] });

  // Patch de sortie (écran "Patch physique", section Sorties). EXPÉRIMENTAL : contrairement au
  // patch d'entrée (/ch/N/in/conn/...), aucune source publique (ni doc officielle, ni module
  // Companion open-source) ne documente l'adresse de routage d'un bus/matrix/main vers un port de
  // sortie physique. L'adresse ci-dessous est une supposition par symétrie avec l'entrée — à
  // vérifier/corriger en priorité une fois connecté à la console réelle.
  if (bus.physicalOutput) {
    const nodeAddr = bus.busType === WingBusType.MAIN ? Main.node(bus.busNumber)
      : bus.busType === WingBusType.MATRIX ? Matrix.node(bus.busNumber)
      : Bus.node(bus.busNumber);
    messages.push({ address: `${nodeAddr}/out/conn/grp`, args: [s(WING_OUTPUT_GROUPS[bus.physicalOutput.group].oscCode)] });
    messages.push({ address: `${nodeAddr}/out/conn/in`, args: [i(bus.physicalOutput.index)] });
  }
}

/** Prépare, pour chaque bus de retour d'un participant, un send coupé (off) depuis le canal de
 * chaque AUTRE participant — prêt à être basculé on/off en direct par un bouton Stream Deck/Companion. */
function addTalkbackMeshMessages(messages, plan, slotBySourceName) {
  const allParticipants = [...new Set(plan.busPlan.flatMap((b) => b.talkbackNames))];
  if (allParticipants.length < 2) return;

  for (const bus of plan.busPlan.filter((b) => b.talkbackNames.length > 0)) {
    const speakers = allParticipants.filter((name) => !bus.talkbackNames.includes(name));
    for (const speaker of speakers) {
      const slot = slotBySourceName.get(speaker);
      if (slot == null) continue;

      const { onAddr, levelAddr } = resolveSendAddresses(slot, bus);
      messages.push({ address: onAddr, args: [i(0)] });
      messages.push({ address: levelAddr, args: [f(0.0)] });
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
