// Décrit en texte le contenu réel du mix d'un bus, pour l'affichage (UI récapitulatif, CSV) —
// distinct de bus.sends qui ne liste que le contenu canal-par-canal (PGM/salle). Pour un retour,
// le vrai contenu est agrégé au niveau bus (voir scenePlanner.addAggregationSends) : Main PGM/salle
// + son bus talkback dédié.

const { BusRole } = require('./model');

function sameOwner(a, b) {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

function describeBusMix(bus, plan) {
  const parts = [];

  if (bus.sends && bus.sends.length > 0) {
    parts.push(bus.sends.join(', '));
  }

  for (const ref of bus.mainRef ? [bus.mainRef] : bus.mainRefs || []) {
    const source = plan.busPlan.find((b) => sameOwner(b.owner, ref));
    if (source) parts.push(source.name);
  }

  if (bus.role === BusRole.COMMENTATOR_RETURN || bus.role === BusRole.FIELD_MIC_RETURN || bus.role === BusRole.ENGINEER_MONITOR) {
    const talkBus = plan.busPlan.find((b) => b.role === BusRole.TALKBACK && sameOwner(b.owner, bus.owner));
    if (talkBus) parts.push(`${talkBus.name} (talkback)`);
  }

  return parts.length > 0 ? parts.join(' + ') : '—';
}

module.exports = { describeBusMix };
