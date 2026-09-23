using WingConfigurator.Core.Allocation;
using WingConfigurator.Core.Model;

namespace WingConfigurator.Core.Osc;

/// <summary>
/// Traduit un <see cref="AllocationResult"/> (neutre) en une séquence concrète de messages OSC
/// Wing : nommage des canaux/bus, format mono/stéréo, et le mesh de talkback (voir plus bas). Le
/// patch d'entrée physique (groupe de connexion) n'est PAS émis automatiquement : le code exact des
/// groupes (LOCAL/AES50/Dante/USB) n'a pas pu être confirmé depuis la documentation publique —
/// voir <see cref="WingOscAddresses"/>.
///
/// Talkback : on n'utilise PAS le système de talkback natif de la Wing (/cfg/talk). À la demande,
/// chaque participant du talkback (commentateur/mic avec TalkbackEnabled) parle avec SON PROPRE
/// micro : on crée donc, pour chaque bus de retour dédié à une personne X, un send (initialement
/// coupé, niveau 0 dB) depuis le canal de chaque AUTRE participant Y vers ce bus. Un Stream Deck /
/// Companion bascule ensuite le "on" de ce send en direct — l'app se contente de préparer le
/// routing, pas de gérer le on/off en tant que tel.
/// </summary>
public static class WingScenePlanner
{
    public static List<OscMessage> BuildMessages(AllocationResult plan)
    {
        var messages = new List<OscMessage>();
        var slotBySourceName = plan.InputPlan.ToDictionary(i => i.SourceName, i => i.FirstSlot);

        foreach (var input in plan.InputPlan)
        {
            AddInputMessages(messages, input);
        }

        foreach (var bus in plan.BusPlan)
        {
            AddBusMessages(messages, bus);
        }

        AddTalkbackMeshMessages(messages, plan, slotBySourceName);

        return messages;
    }

    private static void AddInputMessages(List<OscMessage> messages, InputAssignment input)
    {
        // Slots 1-40 -> canaux /ch, slots 41-48 -> entrées /aux (voir WingCapacity.InputSlots).
        for (int i = 0; i < input.SlotCount; i++)
        {
            int slot = input.FirstSlot + i;
            string nameAddr = slot <= 40
                ? WingOscAddresses.Channel.Name(slot)
                : WingOscAddresses.AuxInput.Name(slot - 40);

            string label = input.SlotCount > 1 ? $"{input.DisplayName} {(i == 0 ? "L" : "R")}" : input.DisplayName;
            messages.Add(new OscMessage(nameAddr, label));
        }
    }

    private static void AddBusMessages(List<OscMessage> messages, BusAssignment bus)
    {
        string nameAddr;
        string monoAddr;

        switch (bus.BusType)
        {
            case WingBusType.Main:
                nameAddr = WingOscAddresses.Main.Name(bus.BusNumber);
                monoAddr = WingOscAddresses.Main.MonoSwitch(bus.BusNumber);
                break;
            case WingBusType.Matrix:
                nameAddr = WingOscAddresses.Matrix.Name(bus.BusNumber);
                monoAddr = WingOscAddresses.Matrix.MonoSwitch(bus.BusNumber);
                break;
            case WingBusType.Bus:
                nameAddr = WingOscAddresses.Bus.Name(bus.BusNumber);
                monoAddr = WingOscAddresses.Bus.MonoSwitch(bus.BusNumber);
                break;
            default:
                throw new NotSupportedException(bus.BusType.ToString());
        }

        messages.Add(new OscMessage(nameAddr, bus.Name));
        messages.Add(new OscMessage(monoAddr, bus.Format == ChannelFormat.Mono ? 1 : 0));
    }

    /// <summary>Prépare, pour chaque bus de retour dédié à un participant, un send coupé (off) depuis
    /// le canal de chaque autre participant — prêt à être basculé en direct par un bouton Stream Deck.</summary>
    private static void AddTalkbackMeshMessages(List<OscMessage> messages, AllocationResult plan,
        Dictionary<string, int> slotBySourceName)
    {
        var allParticipants = plan.BusPlan.SelectMany(b => b.TalkbackNames).Distinct().ToList();
        if (allParticipants.Count < 2) return; // pas de mesh possible avec 0 ou 1 participant

        foreach (var bus in plan.BusPlan.Where(b => b.TalkbackNames.Count > 0))
        {
            var speakers = allParticipants.Except(bus.TalkbackNames);
            foreach (var speaker in speakers)
            {
                if (!slotBySourceName.TryGetValue(speaker, out int slot))
                {
                    continue; // ce participant n'a pas de canal d'entrée connu (config incohérente)
                }

                var (sendOnAddr, sendLevelAddr) = ResolveSendAddresses(slot, bus);
                messages.Add(new OscMessage(sendOnAddr, 0));       // coupé par défaut
                messages.Add(new OscMessage(sendLevelAddr, 0.0f)); // 0 dB, prêt à être ouvert
            }
        }
    }

    private static (string on, string level) ResolveSendAddresses(int slot, BusAssignment destination)
    {
        bool isAux = slot > 40;
        int channelOrAux = isAux ? slot - 40 : slot;

        return (destination.BusType, isAux) switch
        {
            (WingBusType.Bus, false) => (WingOscAddresses.Channel.SendOn(channelOrAux, destination.BusNumber),
                WingOscAddresses.Channel.SendLevel(channelOrAux, destination.BusNumber)),
            (WingBusType.Bus, true) => (WingOscAddresses.AuxInput.SendOn(channelOrAux, destination.BusNumber),
                WingOscAddresses.AuxInput.SendLevel(channelOrAux, destination.BusNumber)),
            (WingBusType.Matrix, false) => (WingOscAddresses.Channel.MatrixSendOn(channelOrAux, destination.BusNumber),
                WingOscAddresses.Channel.MatrixSendLevel(channelOrAux, destination.BusNumber)),
            (WingBusType.Matrix, true) => (WingOscAddresses.AuxInput.MatrixSendOn(channelOrAux, destination.BusNumber),
                WingOscAddresses.AuxInput.MatrixSendLevel(channelOrAux, destination.BusNumber)),
            (WingBusType.Main, false) => (WingOscAddresses.Channel.MainSendOn(channelOrAux, destination.BusNumber),
                WingOscAddresses.Channel.MainSendLevel(channelOrAux, destination.BusNumber)),
            (WingBusType.Main, true) => (WingOscAddresses.AuxInput.MainSendOn(channelOrAux, destination.BusNumber),
                WingOscAddresses.AuxInput.MainSendLevel(channelOrAux, destination.BusNumber)),
            _ => throw new NotSupportedException()
        };
    }
}
