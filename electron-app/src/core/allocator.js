// Port JS du moteur d'allocation C# (WingConfigurator.Core.Allocation.ResourceAllocator).
// Règles de priorité pour le pool de bus {Main, Matrix, Bus} :
//   - PGM par langue + mix salle -> Main d'abord, débordement -> Bus
//   - Retours casque personnels (commentateurs + micros terrain) -> Matrix d'abord, débordement -> Bus
//   - Bus de langue partagé -> Bus directement
//
// Talkback : TOUJOURS actif pour un commentateur. Perso -> talkback ciblé sur lui seul (tagué sur son
// bus perso, aucune capacité supplémentaire). Bus de langue partagé -> talkback commun à tout le groupe.
// Une personne sans aucun retour mais qui veut du talkback (micro terrain) obtient un petit bus mono dédié.

const { ReturnMode, ChannelFormat, WingBusType, BusRole, WING_CAPACITY } = require('./model');

function allocate(config, capacity = WING_CAPACITY) {
  const result = { inputPlan: [], busPlan: [], errors: [] };
  allocateInputs(config, capacity, result);
  allocateBuses(config, capacity, result);
  return result;
}

// ---------- Entrées ----------

function allocateInputs(config, capacity, result) {
  let cursor = 1; // prochain slot libre (1-based)

  for (const lang of config.languages) {
    for (const c of lang.commentators) {
      cursor = placeInput(result, c.name, `${c.name} (${lang.name})`, 1, cursor, null, c.physicalInput);
    }
  }

  for (const mic of config.fieldMics) {
    const slots = mic.format === ChannelFormat.STEREO ? 2 : 1;
    cursor = placeInput(result, mic.name, mic.name, slots, cursor, null, mic.physicalInput);
  }

  for (const pc of config.pcSources) {
    const slots = pc.format === ChannelFormat.STEREO ? 2 : 1;
    cursor = placeInput(result, pc.name, pc.name, slots, cursor, pc.connectionType, pc.physicalInput);
  }

  const totalRequested = cursor - 1;
  if (totalRequested > capacity.inputSlots) {
    result.errors.push({
      resource: 'Entrées',
      requested: totalRequested,
      available: capacity.inputSlots,
      detail: `${totalRequested} slots d'entrée requis pour ${capacity.inputSlots} disponibles. ` +
        'Réduis le nombre de commentateurs/micros/sources PC, ou passe des sources stéréo en mono.',
    });
  }
}

function placeInput(result, sourceName, displayName, slots, cursor, connectionType, physicalInput) {
  const patchLabel = connectionType == null
    ? displayName
    : `${displayName} [${connectionType === 'dante' ? 'Dante' : 'ASIO local'}]`;

  result.inputPlan.push({
    sourceName, firstSlot: cursor, slotCount: slots, displayName, patchLabel, connectionType,
    physicalInput: physicalInput || null,
  });
  return cursor + slots;
}

// ---------- Bus ----------

function allocateBuses(config, capacity, result) {
  const mainDemands = [];
  const matrixDemands = [];
  const busDirectDemands = [];

  // PGM par langue + salle -> Main. "owner" identifie l'objet modèle propriétaire de CE bus, pour
  // que l'écran de patch de sortie sache où stocker/lire l'assignation physique (stable même si
  // le numéro de bus change après un recalcul, contrairement à l'index dans busPlan).
  for (const lang of config.languages) {
    const feeders = lang.commentators.map((c) => c.name);
    mainDemands.push({ role: BusRole.LANGUAGE_PROGRAM, format: ChannelFormat.STEREO, name: `PGM ${lang.name}`, feeders, talkbackNames: [], owner: { kind: 'languagePgm', id: lang.id } });
  }
  if (config.roomMixEnabled) {
    const { allCommentators } = require('./model');
    mainDemands.push({ role: BusRole.ROOM_MIX, format: ChannelFormat.STEREO, name: 'Salle', feeders: allCommentators(config).map((c) => c.name), talkbackNames: [], owner: { kind: 'roomMix', id: null } });
  }

  const fallbackTalkbackOnly = []; // { name, ownerKind, ownerId }

  for (const lang of config.languages) {
    for (const c of lang.commentators) {
      switch (c.returnMode) {
        case ReturnMode.PERSONAL_MONO:
          matrixDemands.push({ role: BusRole.COMMENTATOR_RETURN, format: ChannelFormat.MONO, name: `Ret ${c.name}`, feeders: [c.name], talkbackNames: [c.name], owner: { kind: 'commentatorReturn', id: c.id } });
          break;
        case ReturnMode.PERSONAL_STEREO:
          matrixDemands.push({ role: BusRole.COMMENTATOR_RETURN, format: ChannelFormat.STEREO, name: `Ret ${c.name}`, feeders: [c.name], talkbackNames: [c.name], owner: { kind: 'commentatorReturn', id: c.id } });
          break;
        case ReturnMode.SHARED_LANGUAGE_BUS:
          break; // le bus partagé est créé une fois par langue plus bas, avec ses talkbacks
        case ReturnMode.NONE:
        default:
          // Talkback obligatoire malgré tout : même owner (commentatorReturn) que le cas perso,
          // puisqu'un commentateur n'a jamais les deux à la fois.
          fallbackTalkbackOnly.push({ name: c.name, ownerKind: 'commentatorReturn', ownerId: c.id });
          break;
      }
    }

    const sharedMembers = lang.commentators.filter((c) => c.returnMode === ReturnMode.SHARED_LANGUAGE_BUS);
    if (sharedMembers.length > 0) {
      const feeders = sharedMembers.map((c) => c.name);
      busDirectDemands.push({ role: BusRole.COMMENTATOR_RETURN, format: ChannelFormat.STEREO, name: `Ret ${lang.name}`, feeders, talkbackNames: feeders, owner: { kind: 'languageSharedReturn', id: lang.id } });
    }
  }

  for (const mic of config.fieldMics) {
    const tb = mic.talkbackEnabled ? [mic.name] : [];
    if (mic.hasReturn) {
      matrixDemands.push({ role: BusRole.FIELD_MIC_RETURN, format: mic.returnFormat, name: `Ret ${mic.name}`, feeders: [mic.name], talkbackNames: tb, owner: { kind: 'fieldMicReturn', id: mic.id } });
    } else if (mic.talkbackEnabled) {
      fallbackTalkbackOnly.push({ name: mic.name, ownerKind: 'fieldMicReturn', ownerId: mic.id });
    }
  }

  for (const t of fallbackTalkbackOnly) {
    busDirectDemands.push({ role: BusRole.TALKBACK, format: ChannelFormat.MONO, name: `TB ${t.name}`, feeders: [t.name], talkbackNames: [t.name], owner: { kind: t.ownerKind, id: t.ownerId } });
  }

  const busQueue = [];
  fillPool(result, mainDemands, WingBusType.MAIN, capacity.mainBuses, busQueue);
  fillPool(result, matrixDemands, WingBusType.MATRIX, capacity.matrixBuses, busQueue);
  busQueue.push(...busDirectDemands);

  fillPool(result, busQueue, WingBusType.BUS, capacity.buses, null);

  const busOverflowCount = busQueue.length - Math.min(busQueue.length, capacity.buses);
  if (busOverflowCount > 0) {
    result.errors.push({
      resource: 'Bus (après débordement Main/Matrix)',
      requested: busQueue.length,
      available: capacity.buses,
      detail: `${busOverflowCount} bus n'ont pas pu être placés : ${busQueue.slice(capacity.buses).map((d) => d.name).join(', ')}. ` +
        'Réduis le nombre de retours personnels/talkback, ou passe certains retours en bus partagé par langue.',
    });
  }

  // Recopie la sortie physique déjà choisie par l'utilisateur (écran de patch) sur chaque bus, en
  // relisant l'objet modèle propriétaire — stable même si la numérotation des bus a changé.
  for (const bus of result.busPlan) {
    bus.physicalOutput = resolveOwnerOutput(config, bus.owner);
  }
}

function resolveOwnerOutput(config, owner) {
  if (!owner) return null;
  switch (owner.kind) {
    case 'languagePgm': return config.languages.find((l) => l.id === owner.id)?.pgmOutput ?? null;
    case 'languageSharedReturn': return config.languages.find((l) => l.id === owner.id)?.sharedReturnOutput ?? null;
    case 'roomMix': return config.roomMixOutput ?? null;
    case 'commentatorReturn': {
      for (const lang of config.languages) {
        const c = lang.commentators.find((x) => x.id === owner.id);
        if (c) return c.returnOutput ?? null;
      }
      return null;
    }
    case 'fieldMicReturn': return config.fieldMics.find((m) => m.id === owner.id)?.returnOutput ?? null;
    default: return null;
  }
}

function fillPool(result, demands, type, capacity, overflow) {
  demands.forEach((d, i) => {
    if (i < capacity) {
      result.busPlan.push({
        role: d.role, busType: type, busNumber: i + 1, format: d.format, name: d.name,
        feedingSourceNames: d.feeders, talkbackNames: d.talkbackNames, owner: d.owner,
      });
    } else if (overflow) {
      overflow.push(d);
    }
  });
}

module.exports = { allocate };
