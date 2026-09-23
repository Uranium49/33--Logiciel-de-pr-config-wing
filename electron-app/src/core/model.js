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
};

// Codes de groupe : "LCL" et "A"/"B" CONFIRMÉS par observation directe sur console réelle (journal
// de diagnostic, /io/in/{grp}/{idx}/... et /ch/N/in/conn/grp). Le schéma n'est pas uniforme (LCL =
// 3 lettres, AES50 = 1 seule lettre) donc DANTE/AESEBU/StageConnect/USB restent des suppositions
// non vérifiées — à corriger avec la même méthode (écoute + patch manuel) dès que possible.
// Dante arrive via une carte d'extension optionnelle (pas de port dédié natif sur le Rack) — la
// taille exacte dépend du modèle de carte installée (32x32 ou 64x64 selon la génération). 64 est
// pris par défaut ; ajuste `count` ici si ta carte est plus petite.
const WING_INPUT_GROUPS = {
  [WingIoGroup.LOCAL]: { oscCode: 'LCL', label: 'Local (XLR console)', count: 24 },
  [WingIoGroup.DANTE]: { oscCode: 'DANTE', label: 'Dante (carte)', count: 64 },
  [WingIoGroup.AES50_A]: { oscCode: 'A', label: 'AES50-A', count: 48 },
  [WingIoGroup.AES50_B]: { oscCode: 'B', label: 'AES50-B', count: 48 },
  [WingIoGroup.AES50_C]: { oscCode: 'C', label: 'AES50-C', count: 48 },
  [WingIoGroup.AESEBU]: { oscCode: 'AESEBU', label: 'AES/EBU', count: 2 },
  [WingIoGroup.STAGECONNECT]: { oscCode: 'ST', label: 'StageConnect', count: 32 },
  [WingIoGroup.USB_AUDIO]: { oscCode: 'USBA', label: 'USB Audio (PC)', count: 48 },
  [WingIoGroup.USB_PLAYER]: { oscCode: 'USBP', label: 'USB Player', count: 4 },
};

// Sorties : mêmes réseaux que les entrées, sauf Local (8 XLR out sur le Rack, pas 24) et pas de
// "USB Player" en sortie (c'est un lecteur, pas un enregistreur, côté patch de sortie).
const WING_OUTPUT_GROUPS = {
  [WingIoGroup.LOCAL]: { oscCode: 'LCL', label: 'Local (XLR console)', count: 8 },
  [WingIoGroup.DANTE]: { oscCode: 'DANTE', label: 'Dante (carte)', count: 64 },
  [WingIoGroup.AES50_A]: { oscCode: 'A', label: 'AES50-A', count: 48 },
  [WingIoGroup.AES50_B]: { oscCode: 'B', label: 'AES50-B', count: 48 },
  [WingIoGroup.AES50_C]: { oscCode: 'C', label: 'AES50-C', count: 48 },
  [WingIoGroup.AESEBU]: { oscCode: 'AESEBU', label: 'AES/EBU', count: 2 },
  [WingIoGroup.STAGECONNECT]: { oscCode: 'ST', label: 'StageConnect', count: 32 },
  [WingIoGroup.USB_AUDIO]: { oscCode: 'USBA', label: 'USB Audio (PC)', count: 48 },
};

const WING_CAPACITY = {
  inputSlots: 48,   // 40 canaux /ch + 8 entrées /aux
  mainChannels: 40, // /ch/1-40
  auxChannels: 8,   // /aux/1-8
  mainBuses: 4,     // /main/1-4
  matrixBuses: 8,   // /mtx/1-8
  buses: 16,        // /bus/1-16
  automixGroups: 2, // gain-sharing sur max 16 canaux chacun (doc officielle Wing)
};

let idCounter = 1;
function nextId() {
  return `id${idCounter++}`;
}

/** Référence à un port physique/réseau précis (groupe + numéro). null = non patché. */
function createPhysicalRef(group = WingIoGroup.LOCAL, index = 1) {
  return { group, index };
}

function createCommentator(name) {
  return {
    id: nextId(), name, returnMode: ReturnMode.PERSONAL_STEREO,
    physicalInput: null,   // entrée mic
    returnOutput: null,    // sortie de son bus de retour perso (ou du bus talk-only de secours)
  };
}

function createLanguage(name) {
  return {
    id: nextId(), name, commentators: [],
    pgmOutput: null,          // sortie du mix PGM de cette langue
    sharedReturnOutput: null, // sortie du bus de retour partagé (si des commentateurs l'utilisent)
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
    returnOutput: null,
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
    physicalInput: null,  // son micro
    returnOutput: null,   // sortie de sa Matrix de retour (tous les mix)
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
    roomMixOutput: null,
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
  createPhysicalRef, createCommentator, createLanguage, createFieldMic, createPcSource,
  createSoundEngineer, createProductionConfig, sportMultiLanguageTemplate, allCommentators,
};
