using WingConfigurator.Core.Model;

namespace WingConfigurator.Core.Allocation;

/// <summary>Une entrée assignée à un slot d'entrée physique/Dante de la Wing.</summary>
public sealed record InputAssignment(
    string SourceName,       // clé d'identité stable (ex: "Comm1"), utilisée pour recouper avec BusPlan
    int FirstSlot,           // 1-based
    int SlotCount,           // 1 (mono) ou 2 (stéréo)
    string DisplayName,      // nom affiché sur la scribble strip de la console (ex: "Comm1 (FR)")
    string PatchLabel,       // libellé complet pour la fiche de patch (avec ASIO/Dante)
    PcConnectionType? ConnectionType); // null si ce n'est pas une source PC

/// <summary>Un bus (Main/Matrix/Bus) assigné à un rôle logique.</summary>
public sealed record BusAssignment(
    BusRole Role,
    WingBusType BusType,
    int BusNumber,          // 1-based au sein de son type
    ChannelFormat Format,
    string Name,            // nom affiché sur la console
    IReadOnlyList<string> FeedingSourceNames,  // sources qui alimentent ce bus (pour les sends)
    IReadOnlyList<string> TalkbackNames);      // sous-ensemble de personnes dont ce bus est le retour
                                                // "talkback" dédié : chaque AUTRE participant du mesh
                                                // talkback reçoit un send (off par défaut) vers ce bus,
                                                // à basculer on/off en direct via Stream Deck/Companion.

/// <summary>Une erreur de capacité : demande > disponible pour une ressource donnée.</summary>
public sealed record CapacityError(string Resource, int Requested, int Available, string Detail);

/// <summary>Résultat complet du moteur d'allocation.</summary>
public sealed class AllocationResult
{
    public List<InputAssignment> InputPlan { get; } = new();
    public List<BusAssignment> BusPlan { get; } = new();
    public List<CapacityError> Errors { get; } = new();

    public bool IsValid => Errors.Count == 0;
}
