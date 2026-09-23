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

  // PGM par langue + salle -> Main
  for (const lang of config.languages) {
    const feeders = lang.commentators.map((c) => c.name);
    mainDemands.push({ role: BusRole.LANGUAGE_PROGRAM, format: ChannelFormat.STEREO, name: `PGM ${lang.name}`, feeders, talkbackNames: [] });
  }
  if (config.roomMixEnabled) {
    const { allCommentators } = require('./model');
    mainDemands.push({ role: BusRole.ROOM_MIX, format: ChannelFormat.STEREO, name: 'Salle', feeders: allCommentators(config).map((c) => c.name), talkbackNames: [] });
  }

  const namesWithoutOwnReturnButWantTalkback = [];

  for (const lang of config.languages) {
    for (const c of lang.commentators) {
      switch (c.returnMode) {
        case ReturnMode.PERSONAL_MONO:
          matrixDemands.push({ role: BusRole.COMMENTATOR_RETURN, format: ChannelFormat.MONO, name: `Ret ${c.name}`, feeders: [c.name], talkbackNames: [c.name] });
          break;
        case ReturnMode.PERSONAL_STEREO:
          matrixDemands.push({ role: BusRole.COMMENTATOR_RETURN, format: ChannelFormat.STEREO, name: `Ret ${c.name}`, feeders: [c.name], talkbackNames: [c.name] });
          break;
        case ReturnMode.SHARED_LANGUAGE_BUS:
          break; // le bus partagé est créé une fois par langue plus bas, avec ses talkbacks
        case ReturnMode.NONE:
        default:
          namesWithoutOwnReturnButWantTalkback.push(c.name); // talkback obligatoire malgré tout
          break;
      }
    }

    const sharedMembers = lang.commentators.filter((c) => c.returnMode === ReturnMode.SHARED_LANGUAGE_BUS);
    if (sharedMembers.length > 0) {
      const feeders = sharedMembers.map((c) => c.name);
      busDirectDemands.push({ role: BusRole.COMMENTATOR_RETURN, format: ChannelFormat.STEREO, name: `Ret ${lang.name}`, feeders, talkbackNames: feeders });
    }
  }

  for (const mic of config.fieldMics) {
    const tb = mic.talkbackEnabled ? [mic.name] : [];
    if (mic.hasReturn) {
      matrixDemands.push({ role: BusRole.FIELD_MIC_RETURN, format: mic.returnFormat, name: `Ret ${mic.name}`, feeders: [mic.name], talkbackNames: tb });
    } else if (mic.talkbackEnabled) {
      namesWithoutOwnReturnButWantTalkback.push(mic.name);
    }
  }

  for (const name of namesWithoutOwnReturnButWantTalkback) {
    busDirectDemands.push({ role: BusRole.TALKBACK, format: ChannelFormat.MONO, name: `TB ${name}`, feeders: [name], talkbackNames: [name] });
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
}

function fillPool(result, demands, type, capacity, overflow) {
  demands.forEach((d, i) => {
    if (i < capacity) {
      result.busPlan.push({
        role: d.role, busType: type, busNumber: i + 1, format: d.format, name: d.name,
        feedingSourceNames: d.feeders, talkbackNames: d.talkbackNames,
      });
    } else if (overflow) {
      overflow.push(d);
    }
  });
}

module.exports = { allocate };
