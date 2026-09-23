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

const PcConnectionType = { ASIO_LOCAL: 'asioLocal', DANTE: 'dante' };

const WingBusType = { MAIN: 'main', MATRIX: 'matrix', BUS: 'bus' };

const BusRole = {
  LANGUAGE_PROGRAM: 'languageProgram',
  ROOM_MIX: 'roomMix',
  COMMENTATOR_RETURN: 'commentatorReturn',
  FIELD_MIC_RETURN: 'fieldMicReturn',
  TALKBACK: 'talkback',
};

// Groupes de connexion physique/réseau d'entrée sur la Wing.
// ATTENTION : les codes OSC exacts n'ont pas pu être vérifiés dans la documentation publique
// (ni le PDF officiel, ni le module Companion open-source ne les énumèrent). Ce sont les noms
// standards Wing — à confirmer/ajuster une fois connecté à la console réelle.
const WingInputGroup = { LOCAL: 'local', AES50_A: 'aes50A', AES50_B: 'aes50B', CARD: 'card', USB: 'usb' };

const WING_INPUT_GROUPS = {
  [WingInputGroup.LOCAL]: { oscCode: 'LCL', label: 'Local (XLR console)' },
  [WingInputGroup.AES50_A]: { oscCode: 'A50A', label: 'AES50-A' },
  [WingInputGroup.AES50_B]: { oscCode: 'A50B', label: 'AES50-B' },
  [WingInputGroup.CARD]: { oscCode: 'CRD', label: "Carte d'extension (Dante...)" },
  [WingInputGroup.USB]: { oscCode: 'USB', label: 'USB' },
};

const WING_CAPACITY = {
  inputSlots: 48,  // 40 canaux /ch + 8 entrées /aux
  mainBuses: 4,    // /main/1-4
  matrixBuses: 8,  // /mtx/1-8
  buses: 16,       // /bus/1-16
};

let idCounter = 1;
function nextId() {
  return `id${idCounter++}`;
}

function createPhysicalInput(group = WingInputGroup.CARD, index = 1) {
  return { group, index };
}

function createCommentator(name) {
  return { id: nextId(), name, returnMode: ReturnMode.PERSONAL_STEREO, physicalInput: null };
}

function createLanguage(name) {
  return { id: nextId(), name, commentators: [] };
}

function createFieldMic(name) {
  return {
    id: nextId(), name,
    format: ChannelFormat.MONO,
    hasReturn: false,
    returnFormat: ChannelFormat.MONO,
    talkbackEnabled: false,
    physicalInput: null,
  };
}

function createPcSource(name) {
  return {
    id: nextId(), name,
    category: PcSourceCategory.JINGLE,
    connectionType: PcConnectionType.DANTE,
    format: ChannelFormat.STEREO,
    physicalInput: null,
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
  ReturnMode, ChannelFormat, PcSourceCategory, PcConnectionType, WingBusType, BusRole, WingInputGroup,
  WING_INPUT_GROUPS, WING_CAPACITY,
  createPhysicalInput, createCommentator, createLanguage, createFieldMic, createPcSource,
  createProductionConfig, sportMultiLanguageTemplate, allCommentators,
};
