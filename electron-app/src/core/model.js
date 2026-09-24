// Modèle métier — port JS du modèle C# (WingConfigurator.Core.Model).
// Enums représentés par des chaînes ; pas de classes, des objets JSON simples + factories.

const ReturnMode = {
  NONE: 'none',
  PERSONAL_MONO: 'personalMono',
  PERSONAL_STEREO: 'personalStereo',
  SHARED_LANGUAGE_BUS: 'sharedLanguageBus',
};

const ChannelFormat = { MONO: 'mono', STEREO: 'stereo' };

const PcSourceCategory = { JINGLE: 'jingle', VIDEO: 'video', AMBIANCE: 'ambiance' };

const WingBusType = { MAIN: 'main', MATRIX: 'matrix', BUS: 'bus' };

const BusRole = {
  LANGUAGE_PROGRAM: 'languageProgram',
  ROOM_MIX: 'roomMix',
  COMMENTATOR_RETURN: 'commentatorReturn',
  FIELD_MIC_RETURN: 'fieldMicReturn',
  ENGINEER_MONITOR: 'engineerMonitor',
  TALKBACK: 'talkback',
};

// Groupes de connexion physique/réseau, calqués sur le matériel réel WING RACK (24 entrées XLR
// locales, 8 sorties XLR locales, 3 ports AES50, StageConnect, AES/EBU, USB) — vérifié via les
// spécifications Behringer publiques (pas d'Aux In/Out 1/4" sur le Rack, contrairement à la Wing
// complète). ATTENTION : les codes OSC exacts ("oscCode") n'ont pas pu être vérifiés dans la
// documentation publique (ni le PDF officiel, ni le module Companion open-source ne les
// énumèrent) — à confirmer/ajuster une fois connecté à la console réelle.
const WingIoGroup = {
  LOCAL: 'local',
  DANTE: 'dante',
  AES50_A: 'aes50A',
  AES50_B: 'aes50B',
  AES50_C: 'aes50C',
  AESEBU: 'aesebu',
  STAGECONNECT: 'stageconnect',
  USB_AUDIO: 'usbAudio',
  USB_PLAYER: 'usbPlayer',
  OSCILLATOR: 'oscillator',
};

// Codes de groupe CONFIRMÉS par observation directe sur console réelle (journal de diagnostic,
// /io/in/{grp}/{idx}/... et /ch/N/in/conn/grp) : "LCL", "A"/"B" (AES50), "USB", et "MOD" pour la
// carte d'extension (Dante) — le code générique nomme l'emplacement physique de la carte ("Module"),
// pas la marque du réseau qui y est installée. AESEBU/StageConnect/USB Player restent des
// suppositions non vérifiées.
// Dante arrive via une carte d'extension optionnelle (pas de port dédié natif sur le Rack) — la
// taille exacte dépend du modèle de carte installée (32x32 ou 64x64 selon la génération). 64 est
// pris par défaut ; ajuste `count` ici si ta carte est plus petite.
const WING_INPUT_GROUPS = {
  [WingIoGroup.LOCAL]: { oscCode: 'LCL', label: 'Local (XLR console)', count: 24 },
  [WingIoGroup.DANTE]: { oscCode: 'MOD', label: 'Dante (carte)', count: 64 },
  [WingIoGroup.AES50_A]: { oscCode: 'A', label: 'AES50-A', count: 48 },
  [WingIoGroup.AES50_B]: { oscCode: 'B', label: 'AES50-B', count: 48 },
  [WingIoGroup.AES50_C]: { oscCode: 'C', label: 'AES50-C', count: 48 },
  [WingIoGroup.AESEBU]: { oscCode: 'AESEBU', label: 'AES/EBU', count: 2 },
  [WingIoGroup.STAGECONNECT]: { oscCode: 'ST', label: 'StageConnect', count: 32 },
  [WingIoGroup.USB_AUDIO]: { oscCode: 'USB', label: 'USB Audio (PC)', count: 48 },
  [WingIoGroup.USB_PLAYER]: { oscCode: 'USBP', label: 'USB Player', count: 4 },
  // Générateur de test interne (confirmé comme groupe source par la doc marketing officielle : "11
  // input sources: Local, Aux In, AES/EBU, Oscillator, ..."), mais ni son code OSC ni ses paramètres
  // de forme d'onde/niveau ne sont documentés publiquement — tout est expérimental ici.
  [WingIoGroup.OSCILLATOR]: { oscCode: 'OSC', label: 'Oscillateur (test)', count: 1 },
};

// Sorties : mêmes réseaux que les entrées, sauf Local (8 XLR out sur le Rack, pas 24) et pas de
// "USB Player" en sortie (c'est un lecteur, pas un enregistreur, côté patch de sortie).
const WING_OUTPUT_GROUPS = {
  [WingIoGroup.LOCAL]: { oscCode: 'LCL', label: 'Local (XLR console)', count: 8 },
  [WingIoGroup.DANTE]: { oscCode: 'MOD', label: 'Dante (carte)', count: 64 },
  [WingIoGroup.AES50_A]: { oscCode: 'A', label: 'AES50-A', count: 48 },
  [WingIoGroup.AES50_B]: { oscCode: 'B', label: 'AES50-B', count: 48 },
  [WingIoGroup.AES50_C]: { oscCode: 'C', label: 'AES50-C', count: 48 },
  [WingIoGroup.AESEBU]: { oscCode: 'AESEBU', label: 'AES/EBU', count: 2 },
  [WingIoGroup.STAGECONNECT]: { oscCode: 'ST', label: 'StageConnect', count: 32 },
  [WingIoGroup.USB_AUDIO]: { oscCode: 'USB', label: 'USB Audio (PC)', count: 48 },
};

const WING_CAPACITY = {
  inputSlots: 48,   // 40 canaux /ch + 8 entrées /aux
  mainChannels: 40, // /ch/1-40
  auxChannels: 8,   // /aux/1-8
  mainBuses: 4,     // /main/1-4
  matrixBuses: 8,   // /mtx/1-8
  buses: 16,        // /bus/1-16
  automixGroups: 2, // gain-sharing sur max 16 canaux chacun (doc officielle Wing)

  // Zones fixes de rangement des entrées, demandées explicitement : toujours les mêmes emplacements
  // d'une prod à l'autre, même si une zone n'est pas entièrement remplie (l'espace non utilisé reste
  // réservé, il n'est jamais récupéré par la zone suivante — prévisibilité pour l'opérateur).
  inputZones: {
    casters: { start: 1, end: 8 },     // commentateurs + ingé son + pistes de référence automix
    ambiances: { start: 9, end: 32 },  // micros terrain
    pc: { start: 33, end: 48 },        // sources PC : canaux 33-40 puis aux 1-8 (slots 41-48)
  },
};

let idCounter = 1;
function nextId() {
  return `id${idCounter++}`;
}

/** Référence à un port physique/réseau précis (groupe + numéro). null = non patché. */
function createPhysicalRef(group = WingIoGroup.LOCAL, index = 1) {
  return { group, index };
}

/** Sortie physique d'un bus stéréo : L et R sont CONFIRMÉS indépendants sur la Wing (chaque port
 * physique choisit sa propre source), donc chacun peut être patché sur un port différent, pas
 * forcément adjacent. Un bus mono n'utilise que .l. */
function createStereoOutputRef() {
  return { l: null, r: null };
}

function createCommentator(name) {
  return {
    id: nextId(), name, returnMode: ReturnMode.PERSONAL_STEREO,
    physicalInput: null,               // entrée mic
    returnOutput: createStereoOutputRef(), // sortie de son bus de retour perso (ou du bus talk-only de secours)
  };
}

function createLanguage(name) {
  return {
    id: nextId(), name, commentators: [],
    pgmOutput: createStereoOutputRef(),          // sortie du mix PGM de cette langue
    sharedReturnOutput: createStereoOutputRef(), // sortie du bus de retour partagé (si utilisé)
  };
}

function createFieldMic(name) {
  return {
    id: nextId(), name,
    format: ChannelFormat.MONO,
    hasReturn: false,
    returnFormat: ChannelFormat.MONO,
    talkbackEnabled: false,
    physicalInput: null,
    returnOutput: createStereoOutputRef(),
  };
}

function createPcSource(name) {
  return {
    id: nextId(), name,
    category: PcSourceCategory.JINGLE,
    format: ChannelFormat.STEREO,
    physicalInput: null, // patché comme n'importe quelle source depuis l'écran Patch physique
  };
}

/** Poste ingé son : écoute TOUS les mix (PGM de chaque langue + salle) sur une Matrix dédiée, et
 * participe au mesh talkback comme n'importe quel commentateur (son propre bus + son propre micro). */
function createSoundEngineer(name = 'Ingé son') {
  return {
    id: nextId(), name,
    physicalInput: null,                   // son micro
    returnOutput: createStereoOutputRef(), // sortie de sa Matrix de retour (tous les mix)
  };
}

function createProductionConfig() {
  return {
    typologyName: 'Nouvelle production',
    languages: [],
    fieldMics: [],
    pcSources: [],
    roomMixEnabled: false,
    recordingMultitrackEnabled: false,
    roomMixOutput: createStereoOutputRef(),
    soundEngineerEnabled: true,
    soundEngineer: createSoundEngineer(),
  };
}

function sportMultiLanguageTemplate() {
  const config = createProductionConfig();
  config.typologyName = 'Sport multi-langues';
  config.roomMixEnabled = true;

  for (const langName of ['FR', 'EN']) {
    const lang = createLanguage(langName);
    lang.commentators.push(createCommentator(`${langName}-Comm1`));
    lang.commentators.push(createCommentator(`${langName}-Comm2`));
    config.languages.push(lang);
  }

  config.fieldMics.push(createFieldMic('Ambiance stade'));
  const terrain1 = createFieldMic('Terrain 1');
  terrain1.hasReturn = true;
  config.fieldMics.push(terrain1);

  config.pcSources.push(createPcSource('Jingles'));

  return config;
}

function allCommentators(config) {
  return config.languages.flatMap((l) => l.commentators);
}

module.exports = {
  ReturnMode, ChannelFormat, PcSourceCategory, WingBusType, BusRole, WingIoGroup,
  WING_INPUT_GROUPS, WING_OUTPUT_GROUPS, WING_CAPACITY,
  createPhysicalRef, createStereoOutputRef, createCommentator, createLanguage, createFieldMic, createPcSource,
  createSoundEngineer, createProductionConfig, sportMultiLanguageTemplate, allCommentators,
};
