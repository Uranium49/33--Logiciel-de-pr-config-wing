// Fallback hors-réseau : pas de format de scène binaire Wing (.wsg) documenté publiquement.
// On exporte (a) un script texte des messages OSC, rejouable par notre appli ou un outil tiers, et
// (b) une fiche de patch lisible en CSV pour l'ingé son.

const { WING_INPUT_GROUPS, WING_OUTPUT_GROUPS } = require('./model');
const { describeBusMix } = require('./describe');

function formatArg(arg) {
  if (arg.type === 's') return arg.value.includes(' ') ? `"${arg.value}"` : arg.value;
  if (arg.type === 'f') return arg.value.toFixed(4);
  return String(arg.value);
}

function buildOscScriptText(messages) {
  const lines = [
    '# Script OSC Wing — généré par WingConfigurator',
    '# Une ligne = une adresse OSC suivie de ses arguments.',
  ];
  for (const m of messages) {
    lines.push([m.address, ...m.args.map(formatArg)].join(' '));
  }
  return lines.join('\n') + '\n';
}

function csv(value) {
  const str = String(value);
  return str.includes(';') ? `"${str}"` : str;
}

function describeOutputRef(ref) {
  const part = (r) => (r ? `${WING_OUTPUT_GROUPS[r.group].label} #${r.index}` : '—');
  if (!ref || (!ref.l && !ref.r)) return '(non patché)';
  if (ref.l && !ref.r) return part(ref.l); // mono, ou stéréo pas encore complété
  return `L:${part(ref.l)} R:${part(ref.r)}`;
}

function buildPatchCsvText(plan) {
  const lines = ['Type;Numéro;Nom;Format/Slots;Mix (sends réels);Talkback;Patch physique'];

  for (const input of plan.inputPlan) {
    const addressHint = input.firstSlot <= 40 ? `ch${input.firstSlot}` : `aux${input.firstSlot - 40}`;
    const patch = input.physicalInput
      ? `${WING_INPUT_GROUPS[input.physicalInput.group].label} #${input.physicalInput.index}`
      : '(non patché)';
    lines.push(`Entrée;${addressHint};${csv(input.patchLabel)};${input.slotCount} slot(s);;;${csv(patch)}`);
  }

  for (const bus of plan.busPlan) {
    const outPatch = describeOutputRef(bus.physicalOutput);
    lines.push(`${bus.busType};${bus.busNumber};${csv(bus.name)};${bus.format};` +
      `${csv(describeBusMix(bus, plan))};${csv(bus.talkbackNames.join(', '))};${csv(outPatch)}`);
  }

  if (plan.errors.length > 0) {
    lines.push('');
    lines.push('ERREURS DE CAPACITÉ;;;;;;');
    for (const e of plan.errors) {
      lines.push(`${csv(e.resource)};${e.requested};${e.available};${csv(e.detail)};;;`);
    }
  }

  return lines.join('\n') + '\n';
}

module.exports = { buildOscScriptText, buildPatchCsvText };
