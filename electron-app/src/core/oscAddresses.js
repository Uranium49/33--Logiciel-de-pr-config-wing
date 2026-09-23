// Port JS des adresses OSC Wing (WingConfigurator.Core.Osc.WingOscAddresses), transcrites depuis
// le module open-source bitfocus/companion-module-behringer-wing (src/commands/*.ts).

const Channel = {
  node: (ch) => `/ch/${ch}`,
  name: (ch) => `${Channel.node(ch)}/name`,
  color: (ch) => `${Channel.node(ch)}/col`,
  icon: (ch) => `${Channel.node(ch)}/icon`,
  mute: (ch) => `${Channel.node(ch)}/mute`,
  fader: (ch) => `${Channel.node(ch)}/fdr`,
  inputConnectionGroup: (ch) => `${Channel.node(ch)}/in/conn/grp`,
  inputConnectionIndex: (ch) => `${Channel.node(ch)}/in/conn/in`,
  // CONFIRMÉ par observation directe : l'automix n'est PAS un paramètre dédié ("autogrp") mais le
  // slot post-insert du channel, détourné en mode automix. /postins/mode vaut "FX" par défaut, ou
  // "AUTO_X"/"AUTO_Y" pour rejoindre le groupe d'automix 1 ou 2 — /postins/on doit être à 1 pour que
  // ce soit actif ($stat passe alors à "OK", confirmé en écoute). /postins/w est une télémétrie
  // lecture-seule (poids de gain-sharing en temps réel), jamais à écrire.
  postInsertMode: (ch) => `${Channel.node(ch)}/postins/mode`,
  postInsertOn: (ch) => `${Channel.node(ch)}/postins/on`,
  mainSendOn: (ch, main) => `${Channel.node(ch)}/main/${main}/on`,
  mainSendLevel: (ch, main) => `${Channel.node(ch)}/main/${main}/lvl`,
  sendOn: (ch, bus) => `${Channel.node(ch)}/send/${bus}/on`,
  sendLevel: (ch, bus) => `${Channel.node(ch)}/send/${bus}/lvl`,
  matrixSendOn: (ch, mtx) => `${Channel.node(ch)}/send/MX${mtx}/on`,
  matrixSendLevel: (ch, mtx) => `${Channel.node(ch)}/send/MX${mtx}/lvl`,
};

// Les 8 entrées physiques supplémentaires (/aux/1-8) — pas des bus de mix.
const AuxInput = {
  node: (aux) => `/aux/${aux}`,
  name: (aux) => `${AuxInput.node(aux)}/name`,
  color: (aux) => `${AuxInput.node(aux)}/col`,
  icon: (aux) => `${AuxInput.node(aux)}/icon`,
  inputConnectionGroup: (aux) => `${AuxInput.node(aux)}/in/conn/grp`,
  inputConnectionIndex: (aux) => `${AuxInput.node(aux)}/in/conn/in`,
  mainSendOn: (aux, main) => `${AuxInput.node(aux)}/main/${main}/on`,
  mainSendLevel: (aux, main) => `${AuxInput.node(aux)}/main/${main}/lvl`,
  sendOn: (aux, bus) => `${AuxInput.node(aux)}/send/${bus}/on`,
  sendLevel: (aux, bus) => `${AuxInput.node(aux)}/send/${bus}/lvl`,
  matrixSendOn: (aux, mtx) => `${AuxInput.node(aux)}/send/MX${mtx}/on`,
  matrixSendLevel: (aux, mtx) => `${AuxInput.node(aux)}/send/MX${mtx}/lvl`,
};

// Les 16 bus de mix stéréo (/bus/1-16), utilisés pour les retours casque et bus partagés par langue.
const Bus = {
  node: (bus) => `/bus/${bus}`,
  name: (bus) => `${Bus.node(bus)}/name`,
  color: (bus) => `${Bus.node(bus)}/col`,
  mute: (bus) => `${Bus.node(bus)}/mute`,
  fader: (bus) => `${Bus.node(bus)}/fdr`,
  monoSwitch: (bus) => `${Bus.node(bus)}/busmono`,
  // Un bus peut alimenter un autre bus, une matrice, OU un main (architecture confirmée : un bus
  // neuf a par défaut son send vers Main 1 activé — à couper explicitement, voir scenePlanner.js).
  sendOn: (bus, targetBus) => `${Bus.node(bus)}/send/${targetBus}/on`,
  sendLevel: (bus, targetBus) => `${Bus.node(bus)}/send/${targetBus}/lvl`,
  matrixSendOn: (bus, mtx) => `${Bus.node(bus)}/send/MX${mtx}/on`,
  matrixSendLevel: (bus, mtx) => `${Bus.node(bus)}/send/MX${mtx}/lvl`,
  mainSendOn: (bus, main) => `${Bus.node(bus)}/main/${main}/on`,
  mainSendLevel: (bus, main) => `${Bus.node(bus)}/main/${main}/lvl`,
};

const Matrix = {
  node: (mtx) => `/mtx/${mtx}`,
  name: (mtx) => `${Matrix.node(mtx)}/name`,
  color: (mtx) => `${Matrix.node(mtx)}/col`,
  mute: (mtx) => `${Matrix.node(mtx)}/mute`,
  fader: (mtx) => `${Matrix.node(mtx)}/fdr`,
  monoSwitch: (mtx) => `${Matrix.node(mtx)}/busmono`,
};

const Main = {
  node: (main) => `/main/${main}`,
  name: (main) => `${Main.node(main)}/name`,
  color: (main) => `${Main.node(main)}/col`,
  mute: (main) => `${Main.node(main)}/mute`,
  fader: (main) => `${Main.node(main)}/fdr`,
  monoSwitch: (main) => `${Main.node(main)}/busmono`,
  // Un Main ne peut alimenter qu'une matrice (pas un autre bus) — architecture Wing.
  matrixSendOn: (main, mtx) => `${Main.node(main)}/send/MX${mtx}/on`,
  matrixSendLevel: (main, mtx) => `${Main.node(main)}/send/MX${mtx}/lvl`,
};

// Port physique/réseau lui-même (pas le channel qui le lit) — CONFIRMÉ par observation directe sur
// une Wing réelle (journal de diagnostic, écoute abonnée /*s) : renommer/colorer le channel 1 patché
// sur "Local #8" fait apparaître en écho /io/in/LCL/8/col et /io/in/LCL/8/icon avec les mêmes
// valeurs. Le groupe "LCL" confirme aussi le code utilisé pour Local ; /name suit très probablement
// le même schéma par symétrie avec col/icon (non observé directement, mais cohérent).
const IoInput = {
  node: (groupCode, index) => `/io/in/${groupCode}/${index}`,
  name: (groupCode, index) => `${IoInput.node(groupCode, index)}/name`,
  color: (groupCode, index) => `${IoInput.node(groupCode, index)}/col`,
  icon: (groupCode, index) => `${IoInput.node(groupCode, index)}/icon`,
  // CONFIRMÉ par observation directe : /io/in/{grp}/{idx}/mode ("M" ou "ST") est le paramètre
  // ÉCRIVABLE qui lie une paire de canaux en stéréo — sans lui, une source stéréo reste en mono même
  // avec deux index consécutifs patchés. Les deux membres de la paire reçoivent la même valeur.
  mode: (groupCode, index) => `${IoInput.node(groupCode, index)}/mode`,
};

// Sortie physique/réseau — EXPÉRIMENTAL, par symétrie avec IoInput (non observé/confirmé).
const IoOutput = {
  node: (groupCode, index) => `/io/out/${groupCode}/${index}`,
  name: (groupCode, index) => `${IoOutput.node(groupCode, index)}/name`,
  color: (groupCode, index) => `${IoOutput.node(groupCode, index)}/col`,
};

// Générateur de test interne (bruit rose/blanc/sinus). EXPÉRIMENTAL : la doc marketing confirme
// juste l'existence d'"Oscillator" comme source patchable ; ni l'adresse de configuration (forme
// d'onde, niveau) ni sa structure exacte ne sont documentées publiquement. Suppose un sous-nœud
// /cfg/osc/... par cohérence avec les autres réglages globaux observés (/cfg/rta/..., /cfg/mtr/...).
const Oscillator = {
  wave: () => '/cfg/osc/wave',
  level: () => '/cfg/osc/lvl',
};

module.exports = { Channel, AuxInput, Bus, Matrix, Main, IoInput, IoOutput, Oscillator };
