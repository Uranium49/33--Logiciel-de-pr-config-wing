// Port JS du moteur d'allocation C# (WingConfigurator.Core.Allocation.ResourceAllocator).
//
// Architecture des retours (mix-minus via bus, pas via sends directs) :
//   Chaque retour (perso commentateur, bus partagé par langue, retour micro terrain) est une
//   MATRIX (prioritaire) qui agrège deux flux au niveau BUS, pas au niveau canal :
//     1. mainRef  -> le Main PGM de la langue (ou le mix salle pour un micro terrain) : ce que la
//        personne doit entendre en permanence (contient déjà les autres commentateurs de sa langue,
//        les micros terrain et les PC — inutile de le refaire au niveau canal).
//     2. un bus TALKBACK dédié à ce retour, dans lequel n'importe quel AUTRE participant du mesh
//        talkback (privé, un-à-un) peut envoyer sa voix via un send on/off individuel (Companion) —
//        c'est ce qui permet à A de parler à B sans que C entende, sans dupliquer les sends "programme".
//   "coveredNames" = les personnes déjà entendues en permanence via mainRef : elles n'ont PAS besoin
//   d'un send talkback vers ce bus (redondant).
//
// Talkback : TOUJOURS actif pour un commentateur (perso ou bus partagé). Une personne sans aucun
// retour mais qui veut du talkback (ReturnMode.None, ou micro sans retour) obtient un bus talkback
// nu, sans mainRef (pas de matrix, juste le bus).

const { ReturnMode, ChannelFormat, WingBusType, BusRole, WingIoGroup, WING_CAPACITY, createPhysicalRef } = require('./model');

function allocate(config, capacity = WING_CAPACITY) {
  const result = { inputPlan: [], busPlan: [], errors: [] };
  const automixByLangId = computeAutomixAssignments(config, capacity, result);
  allocateInputs(config, capacity, result, automixByLangId);
  allocateBuses(config, capacity, result);
  return result;
}

/** La Wing n'a que 2 groupes d'automix (gain-sharing) au total, doc officielle : "2 groups of gain
 * sharing on any 16 input channels". On donne un groupe dédié à chaque langue ayant 2+ commentateurs
 * (l'automix n'a de sens qu'avec plusieurs micros simultanés) — dans l'ordre, jusqu'à épuisement des
 * 2 groupes disponibles ; au-delà, erreur informative (les langues suivantes n'en profitent pas). */
function computeAutomixAssignments(config, capacity, result) {
  const qualifying = config.languages.filter((l) => l.commentators.length >= 2);
  const map = new Map();
  qualifying.slice(0, capacity.automixGroups).forEach((lang, idx) => map.set(lang.id, idx + 1));

  if (qualifying.length > capacity.automixGroups) {
    const left = qualifying.slice(0, capacity.automixGroups).map((l) => l.name).join(', ');
    const missed = qualifying.slice(capacity.automixGroups).map((l) => l.name).join(', ');
    result.errors.push({
      resource: 'Automix',
      requested: qualifying.length,
      available: capacity.automixGroups,
      detail: `${qualifying.length} langues ont 2+ commentateurs mais la Wing n'a que ${capacity.automixGroups} groupes d'automix. ` +
        `Automix appliqué à : ${left}. Pas d'automix pour : ${missed}.`,
    });
  }

  return map;
}

// ---------- Entrées ----------
//
// Zones fixes demandées explicitement (WING_CAPACITY.inputZones) : mêmes emplacements d'une prod à
// l'autre, même si une zone n'est pas remplie entièrement (l'espace inutilisé reste réservé, jamais
// récupéré par la zone suivante).
//   1-8   : casteurs (commentateurs) + ingé son + pistes de référence automix
//   9-32  : micros terrain ("ambiances")
//   33-48 : sources PC (canaux 33-40 puis aux 1-8, contigus dans notre numérotation de slot)

function allocateInputs(config, capacity, result, automixByLangId) {
  const zones = capacity.inputZones;

  let casterCursor = zones.casters.start;
  const placeCaster = (sourceName, displayName, physicalInput, kind, automixGroup = null) => {
    if (casterCursor > zones.casters.end) {
      result.errors.push({
        resource: 'Zone casteurs',
        requested: casterCursor - zones.casters.start,
        available: zones.casters.end - zones.casters.start + 1,
        detail: `Trop d'éléments pour la zone casteurs (canaux ${zones.casters.start}-${zones.casters.end}) : ` +
          `"${displayName}" n'a pas pu être placé. Réduis le nombre de commentateurs, désactive l'ingé son, ou limite l'automix.`,
      });
      return;
    }
    casterCursor = placeInput(result, sourceName, displayName, 1, casterCursor, physicalInput, kind, automixGroup);
  };

  for (const lang of config.languages) {
    const automixGroup = automixByLangId.get(lang.id) || null;
    for (const c of lang.commentators) {
      placeCaster(c.name, `${c.name} (${lang.name})`, c.physicalInput, 'commentator', automixGroup);
    }
  }

  if (config.soundEngineerEnabled) {
    const eng = config.soundEngineer;
    placeCaster(eng.name, eng.name, eng.physicalInput, 'engineer');
  }

  // Une piste de référence par groupe d'automix réellement utilisé : oscillateur en bruit rose à
  // -10dB, ne sort dans AUCUN bus/main/matrix (pas de sends -- juste un patch + un fader).
  const usedAutomixGroups = [...new Set(automixByLangId.values())].sort();
  for (const groupNum of usedAutomixGroups) {
    const name = `AMX Ref ${groupNum}`; // court exprès : la scribble strip tronque au-delà de 12 car.
    placeCaster(name, name, createPhysicalRef(WingIoGroup.OSCILLATOR, 1), 'automixRef', groupNum);
  }

  let ambianceCursor = zones.ambiances.start;
  for (const mic of config.fieldMics) {
    const slots = mic.format === ChannelFormat.STEREO ? 2 : 1;
    if (ambianceCursor + slots - 1 > zones.ambiances.end) {
      result.errors.push({
        resource: 'Zone ambiances',
        requested: ambianceCursor + slots - 1 - zones.ambiances.start + 1,
        available: zones.ambiances.end - zones.ambiances.start + 1,
        detail: `Trop de micros terrain pour la zone ambiances (canaux ${zones.ambiances.start}-${zones.ambiances.end}) : ` +
          `"${mic.name}" n'a pas pu être placé.`,
      });
      continue;
    }
    ambianceCursor = placeInput(result, mic.name, mic.name, slots, ambianceCursor, mic.physicalInput, 'fieldMic');
  }

  // Canal 40 réservé en dur pour le micro réel (patch fixe Local #24, position fixe) — demandé
  // explicitement, en dehors de toute logique séquentielle. Rien d'autre ne doit atterrir dessus.
  const REFERENCE_MIC_SLOT = 40;
  placeInput(result, 'Mic Real', 'Mic Real', 1, REFERENCE_MIC_SLOT, createPhysicalRef(WingIoGroup.LOCAL, 24), 'referenceMic');

  let pcCursor = zones.pc.start;
  for (const pc of config.pcSources) {
    const slots = pc.format === ChannelFormat.STEREO ? 2 : 1;
    // Le slot 40 est réservé : si la prochaine source PC le chevauche, elle saute directement après.
    if (pcCursor <= REFERENCE_MIC_SLOT && pcCursor + slots - 1 >= REFERENCE_MIC_SLOT) {
      pcCursor = REFERENCE_MIC_SLOT + 1;
    }
    if (pcCursor + slots - 1 > zones.pc.end) {
      result.errors.push({
        resource: 'Zone PC',
        requested: pcCursor + slots - 1 - zones.pc.start + 1,
        available: zones.pc.end - zones.pc.start + 1 - 1, // -1 : canal 40 réservé au micro réel
        detail: `Trop de sources PC pour la zone PC (canaux ${zones.pc.start}-40 + aux 1-8, canal 40 réservé) : ` +
          `"${pc.name}" n'a pas pu être placé.`,
      });
      continue;
    }
    pcCursor = placeInput(result, pc.name, pc.name, slots, pcCursor, pc.physicalInput, 'pcSource');
  }
}

function placeInput(result, sourceName, displayName, slots, cursor, physicalInput, kind, automixGroup = null) {
  result.inputPlan.push({
    sourceName, firstSlot: cursor, slotCount: slots, displayName, patchLabel: displayName,
    physicalInput: physicalInput || null, kind, automixGroup,
  });
  return cursor + slots;
}

// ---------- Bus ----------

function allocateBuses(config, capacity, result) {
  const mainDemands = [];
  const matrixDemands = [];
  const busDirectDemands = [];   // bus talkback dédiés + retours en débordement direct
  const talkbackBusDemands = []; // toujours dans le pool Bus (jamais Matrix)

  const allFieldMicNames = config.fieldMics.map((m) => m.name);
  const allPcNames = config.pcSources.map((p) => p.name);
  const { allCommentators } = require('./model');

  // ---- PGM par langue + salle (Main) ----
  for (const lang of config.languages) {
    const commentatorNames = lang.commentators.map((c) => c.name);
    const sends = [...commentatorNames, ...allFieldMicNames, ...allPcNames];
    mainDemands.push({ role: BusRole.LANGUAGE_PROGRAM, format: ChannelFormat.STEREO, name: `PGM ${lang.name}`, feeders: commentatorNames, sends, talkbackNames: [], owner: { kind: 'languagePgm', id: lang.id } });
  }

  let roomMixCoverage = null;
  if (config.roomMixEnabled) {
    const everyone = allCommentators(config).map((c) => c.name);
    const sends = [...everyone, ...allFieldMicNames, ...allPcNames];
    roomMixCoverage = sends;
    mainDemands.push({ role: BusRole.ROOM_MIX, format: ChannelFormat.STEREO, name: 'Salle', feeders: everyone, sends, talkbackNames: [], owner: { kind: 'roomMix', id: null } });
  }

  const fallbackTalkbackOnly = []; // { name, ownerKind, ownerId } — pas de mainRef, pas de matrix

  // ---- Retours commentateurs ----
  for (const lang of config.languages) {
    const langCommentatorNames = lang.commentators.map((c) => c.name);
    const coveredByPgm = [...langCommentatorNames, ...allFieldMicNames, ...allPcNames];
    const mainRef = { kind: 'languagePgm', id: lang.id };

    for (const c of lang.commentators) {
      switch (c.returnMode) {
        case ReturnMode.PERSONAL_MONO:
        case ReturnMode.PERSONAL_STEREO: {
          const format = c.returnMode === ReturnMode.PERSONAL_MONO ? ChannelFormat.MONO : ChannelFormat.STEREO;
          const owner = { kind: 'commentatorReturn', id: c.id };
          matrixDemands.push({ role: BusRole.COMMENTATOR_RETURN, format, name: `Ret ${c.name}`, feeders: [c.name], sends: [], talkbackNames: [c.name], owner, mainRef, coveredNames: coveredByPgm });
          talkbackBusDemands.push({ role: BusRole.TALKBACK, format: ChannelFormat.MONO, name: `TB ${c.name}`, feeders: [c.name], sends: [], talkbackNames: [c.name], owner, coveredNames: coveredByPgm });
          break;
        }
        case ReturnMode.SHARED_LANGUAGE_BUS:
          break; // le bus partagé est créé une fois par langue plus bas
        case ReturnMode.NONE:
        default:
          fallbackTalkbackOnly.push({ name: c.name, ownerKind: 'commentatorReturn', ownerId: c.id });
          break;
      }
    }

    const sharedMembers = lang.commentators.filter((c) => c.returnMode === ReturnMode.SHARED_LANGUAGE_BUS);
    if (sharedMembers.length > 0) {
      const feeders = sharedMembers.map((c) => c.name);
      const owner = { kind: 'languageSharedReturn', id: lang.id };
      matrixDemands.push({ role: BusRole.COMMENTATOR_RETURN, format: ChannelFormat.STEREO, name: `Ret ${lang.name}`, feeders, sends: [], talkbackNames: feeders, owner, mainRef, coveredNames: coveredByPgm });
      talkbackBusDemands.push({ role: BusRole.TALKBACK, format: ChannelFormat.MONO, name: `TB ${lang.name}`, feeders, sends: [], talkbackNames: feeders, owner, coveredNames: coveredByPgm });
    }
  }

  // ---- Retours micros terrain ----
  for (const mic of config.fieldMics) {
    if (mic.hasReturn) {
      const owner = { kind: 'fieldMicReturn', id: mic.id };
      const coveredNames = roomMixCoverage || [];
      const mainRef = config.roomMixEnabled ? { kind: 'roomMix', id: null } : null;
      const talkbackNames = mic.talkbackEnabled ? [mic.name] : [];
      matrixDemands.push({ role: BusRole.FIELD_MIC_RETURN, format: mic.returnFormat, name: `Ret ${mic.name}`, feeders: [mic.name], sends: [], talkbackNames, owner, mainRef, coveredNames });
      if (mic.talkbackEnabled) {
        talkbackBusDemands.push({ role: BusRole.TALKBACK, format: ChannelFormat.MONO, name: `TB ${mic.name}`, feeders: [mic.name], sends: [], talkbackNames: [mic.name], owner, coveredNames });
      }
    } else if (mic.talkbackEnabled) {
      fallbackTalkbackOnly.push({ name: mic.name, ownerKind: 'fieldMicReturn', ownerId: mic.id });
    }
  }

  // ---- Ingé son : Matrix qui agrège TOUS les Main (PGM de chaque langue + salle) + son propre
  // bus talkback (il participe au mesh comme n'importe quel commentateur, avec son propre micro).
  if (config.soundEngineerEnabled) {
    const eng = config.soundEngineer;
    const owner = { kind: 'soundEngineer', id: null };
    const allMainRefs = [
      ...config.languages.map((l) => ({ kind: 'languagePgm', id: l.id })),
      ...(config.roomMixEnabled ? [{ kind: 'roomMix', id: null }] : []),
    ];
    matrixDemands.push({ role: BusRole.ENGINEER_MONITOR, format: ChannelFormat.STEREO, name: `Ret ${eng.name}`, feeders: [eng.name], sends: [], talkbackNames: [eng.name], owner, mainRefs: allMainRefs, coveredNames: [] });
    talkbackBusDemands.push({ role: BusRole.TALKBACK, format: ChannelFormat.MONO, name: `TB ${eng.name}`, feeders: [eng.name], sends: [], talkbackNames: [eng.name], owner, coveredNames: [] });
  }

  // ---- Talkback nu (pas de retour du tout, mais talkback quand même) ----
  for (const t of fallbackTalkbackOnly) {
    busDirectDemands.push({ role: BusRole.TALKBACK, format: ChannelFormat.MONO, name: `TB ${t.name}`, feeders: [t.name], sends: [], talkbackNames: [t.name], owner: { kind: t.ownerKind, id: t.ownerId }, coveredNames: [] });
  }

  // ---- Remplissage : Main puis Matrix (débordement -> Bus), bus talkback dédiés toujours en Bus ----
  const busQueue = [];
  fillPool(result, mainDemands, WingBusType.MAIN, capacity.mainBuses, busQueue);
  fillPool(result, matrixDemands, WingBusType.MATRIX, capacity.matrixBuses, busQueue);
  busQueue.push(...talkbackBusDemands, ...busDirectDemands);

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
  // Les bus TALKBACK partagent leur owner avec le retour qu'ils alimentent (nécessaire pour les
  // apparier dans addAggregationSends), mais ne sont JAMAIS patchables en sortie eux-mêmes — demandé
  // explicitement : seule la Matrix de retour sort physiquement, le bus talkback reste interne.
  for (const bus of result.busPlan) {
    bus.physicalOutput = bus.role === BusRole.TALKBACK ? EMPTY_OUTPUT_REF : resolveOwnerOutput(config, bus.owner);
  }
}

// Toujours { l, r } (jamais null) : L et R sont patchables indépendamment (voir createStereoOutputRef).
const EMPTY_OUTPUT_REF = { l: null, r: null };

function resolveOwnerOutput(config, owner) {
  if (!owner) return EMPTY_OUTPUT_REF;
  switch (owner.kind) {
    case 'languagePgm': return config.languages.find((l) => l.id === owner.id)?.pgmOutput ?? EMPTY_OUTPUT_REF;
    case 'languageSharedReturn': return config.languages.find((l) => l.id === owner.id)?.sharedReturnOutput ?? EMPTY_OUTPUT_REF;
    case 'roomMix': return config.roomMixOutput ?? EMPTY_OUTPUT_REF;
    case 'commentatorReturn': {
      for (const lang of config.languages) {
        const c = lang.commentators.find((x) => x.id === owner.id);
        if (c) return c.returnOutput ?? EMPTY_OUTPUT_REF;
      }
      return EMPTY_OUTPUT_REF;
    }
    case 'fieldMicReturn': return config.fieldMics.find((m) => m.id === owner.id)?.returnOutput ?? EMPTY_OUTPUT_REF;
    case 'soundEngineer': return config.soundEngineer?.returnOutput ?? EMPTY_OUTPUT_REF;
    default: return EMPTY_OUTPUT_REF;
  }
}

function fillPool(result, demands, type, capacity, overflow) {
  demands.forEach((d, i) => {
    if (i < capacity) {
      result.busPlan.push({
        role: d.role, busType: type, busNumber: i + 1, format: d.format, name: d.name,
        feedingSourceNames: d.feeders, sends: d.sends || [], talkbackNames: d.talkbackNames,
        owner: d.owner, mainRef: d.mainRef || null, mainRefs: d.mainRefs || null, coveredNames: d.coveredNames || [],
      });
    } else if (overflow) {
      overflow.push(d);
    }
  });
}

module.exports = { allocate };
