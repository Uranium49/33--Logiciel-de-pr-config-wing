namespace WingConfigurator.Core.Osc;

/// <summary>
/// Adresses OSC de la Wing (firmware ≥ 1.08), transcrites depuis le module de référence
/// open-source `bitfocus/companion-module-behringer-wing` (src/commands/*.ts) — c'est la
/// source la plus fiable disponible publiquement, la doc PDF officielle Maillot n'étant
/// qu'un tutoriel de format binaire, pas une liste exhaustive d'adresses.
///
/// Non couvert ici (à confirmer avant utilisation) : le code exact des groupes de connexion
/// d'entrée physique (LOCAL/AES50-A/AES50-B/CARD-DANTE/USB...) pour <see cref="Channel.InputConnectionGroup"/>
/// — non trouvé dans les sources publiques consultées, à vérifier à la connexion (introspection
/// live de la console) ou via un test manuel sur le matériel.
/// </summary>
public static class WingOscAddresses
{
    public static class Channel
    {
        public static string Node(int ch) => $"/ch/{ch}";
        public static string Name(int ch) => $"{Node(ch)}/name";
        public static string Mute(int ch) => $"{Node(ch)}/mute";
        public static string Fader(int ch) => $"{Node(ch)}/fdr";
        public static string Pan(int ch) => $"{Node(ch)}/pan";

        public static string InputConnectionGroup(int ch) => $"{Node(ch)}/in/conn/grp";
        public static string InputConnectionIndex(int ch) => $"{Node(ch)}/in/conn/in";

        public static string MainSendOn(int ch, int main) => $"{Node(ch)}/main/{main}/on";
        public static string MainSendLevel(int ch, int main) => $"{Node(ch)}/main/{main}/lvl";

        public static string SendOn(int ch, int bus) => $"{Node(ch)}/send/{bus}/on";
        public static string SendLevel(int ch, int bus) => $"{Node(ch)}/send/{bus}/lvl";
        public static string SendPan(int ch, int bus) => $"{Node(ch)}/send/{bus}/pan";

        public static string MatrixSendOn(int ch, int mtx) => $"{Node(ch)}/send/MX{mtx}/on";
        public static string MatrixSendLevel(int ch, int mtx) => $"{Node(ch)}/send/MX{mtx}/lvl";
    }

    /// <summary>Les 8 entrées physiques supplémentaires (/aux/1-8) — pas des bus de mix.</summary>
    public static class AuxInput
    {
        public static string Node(int aux) => $"/aux/{aux}";
        public static string Name(int aux) => $"{Node(aux)}/name";
        public static string InputConnectionGroup(int aux) => $"{Node(aux)}/in/conn/grp";
        public static string InputConnectionIndex(int aux) => $"{Node(aux)}/in/conn/in";

        public static string MainSendOn(int aux, int main) => $"{Node(aux)}/main/{main}/on";
        public static string MainSendLevel(int aux, int main) => $"{Node(aux)}/main/{main}/lvl";

        public static string SendOn(int aux, int bus) => $"{Node(aux)}/send/{bus}/on";
        public static string SendLevel(int aux, int bus) => $"{Node(aux)}/send/{bus}/lvl";

        public static string MatrixSendOn(int aux, int mtx) => $"{Node(aux)}/send/MX{mtx}/on";
        public static string MatrixSendLevel(int aux, int mtx) => $"{Node(aux)}/send/MX{mtx}/lvl";
    }

    /// <summary>Les 16 bus de mix stéréo (/bus/1-16), utilisés ici pour les retours casque et
    /// bus partagés par langue.</summary>
    public static class Bus
    {
        public static string Node(int bus) => $"/bus/{bus}";
        public static string Name(int bus) => $"{Node(bus)}/name";
        public static string Mute(int bus) => $"{Node(bus)}/mute";
        public static string Fader(int bus) => $"{Node(bus)}/fdr";
        public static string MonoSwitch(int bus) => $"{Node(bus)}/busmono";

        public static string MainSendOn(int bus, int main) => $"{Node(bus)}/main/{main}/on";
        public static string MainSendLevel(int bus, int main) => $"{Node(bus)}/main/{main}/lvl";
    }

    public static class Matrix
    {
        public static string Node(int mtx) => $"/mtx/{mtx}";
        public static string Name(int mtx) => $"{Node(mtx)}/name";
        public static string Mute(int mtx) => $"{Node(mtx)}/mute";
        public static string Fader(int mtx) => $"{Node(mtx)}/fdr";
        public static string MonoSwitch(int mtx) => $"{Node(mtx)}/busmono";
    }

    public static class Main
    {
        public static string Node(int main) => $"/main/{main}";
        public static string Name(int main) => $"{Node(main)}/name";
        public static string Mute(int main) => $"{Node(main)}/mute";
        public static string Fader(int main) => $"{Node(main)}/fdr";
        public static string MonoSwitch(int main) => $"{Node(main)}/busmono";
    }

    public static class Dca
    {
        public static string Node(int dca) => $"/dca/{dca}";
        public static string Name(int dca) => $"{Node(dca)}/name";
        public static string Mute(int dca) => $"{Node(dca)}/mute";
        public static string Fader(int dca) => $"{Node(dca)}/fdr";
    }

    public static class MuteGroup
    {
        public static string Node(int group) => $"/mgrp/{group}";
        public static string Name(int group) => $"{Node(group)}/name";
        public static string Mute(int group) => $"{Node(group)}/mute";
    }
}
