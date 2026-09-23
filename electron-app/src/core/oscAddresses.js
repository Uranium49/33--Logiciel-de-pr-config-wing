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
};

module.exports = { Channel, AuxInput, Bus, Matrix, Main };
