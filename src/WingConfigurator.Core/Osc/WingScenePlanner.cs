using WingConfigurator.Core.Allocation;
using WingConfigurator.Core.Model;

namespace WingConfigurator.Core.Osc;

/// <summary>
/// Traduit un <see cref="AllocationResult"/> (neutre) en une séquence concrète de messages OSC
/// Wing : nommage des bus, format mono/stéréo, assignation talkback. Le patch d'entrée physique
/// (groupe de connexion) n'est PAS émis automatiquement : le code exact des groupes (LOCAL/AES50/
/// Dante/USB) n'a pas pu être confirmé depuis la documentation publique — voir <see cref="WingOscAddresses"/>.
/// Utilise le slot d'entrée pour au moins nommer le canal, ce qui reste utile même sans patch auto.
/// </summary>
public static class WingScenePlanner
{
    /// <summary>Générateur de talkback à utiliser par défaut ("A" sur le matériel Wing).</summary>
    public const string DefaultTalkbackId = "A";

    public static List<OscMessage> BuildMessages(AllocationResult plan)
    {
        var messages = new List<OscMessage>();

        foreach (var input in plan.InputPlan)
        {
            AddInputMessages(messages, input);
        }

        foreach (var bus in plan.BusPlan)
        {
            AddBusMessages(messages, bus);
        }

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

            string label = input.SlotCount > 1 ? $"{input.SourceName} {(i == 0 ? "L" : "R")}" : input.SourceName;
            messages.Add(new OscMessage(nameAddr, label));
        }
    }

    private static void AddBusMessages(List<OscMessage> messages, BusAssignment bus)
    {
        string nameAddr;
        string monoAddr;
        Func<string, string> talkbackAssign;

        switch (bus.BusType)
        {
            case WingBusType.Main:
                nameAddr = WingOscAddresses.Main.Name(bus.BusNumber);
                monoAddr = WingOscAddresses.Main.MonoSwitch(bus.BusNumber);
                talkbackAssign = id => WingOscAddresses.Talkback.MainAssign(id, bus.BusNumber);
                break;
            case WingBusType.Matrix:
                nameAddr = WingOscAddresses.Matrix.Name(bus.BusNumber);
                monoAddr = WingOscAddresses.Matrix.MonoSwitch(bus.BusNumber);
                talkbackAssign = id => WingOscAddresses.Talkback.MatrixAssign(id, bus.BusNumber);
                break;
            case WingBusType.Bus:
                nameAddr = WingOscAddresses.Bus.Name(bus.BusNumber);
                monoAddr = WingOscAddresses.Bus.MonoSwitch(bus.BusNumber);
                talkbackAssign = id => WingOscAddresses.Talkback.BusAssign(id, bus.BusNumber);
                break;
            default:
                throw new NotSupportedException(bus.BusType.ToString());
        }

        messages.Add(new OscMessage(nameAddr, bus.Name));
        messages.Add(new OscMessage(monoAddr, bus.Format == ChannelFormat.Mono ? 1 : 0));

        if (bus.TalkbackNames.Count > 0)
        {
            messages.Add(new OscMessage(talkbackAssign(DefaultTalkbackId), 1));
        }
    }
}
