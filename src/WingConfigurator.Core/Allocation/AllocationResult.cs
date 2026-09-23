using WingConfigurator.Core.Model;

namespace WingConfigurator.Core.Allocation;

/// <summary>Une entrée assignée à un slot d'entrée physique/Dante de la Wing.</summary>
public sealed record InputAssignment(
    string SourceName,
    int FirstSlot,          // 1-based
    int SlotCount,          // 1 (mono) ou 2 (stéréo)
    string PatchLabel,      // libellé à afficher dans le patch Wing
    PcConnectionType? ConnectionType); // null si ce n'est pas une source PC

/// <summary>Un bus (Main/Matrix/Bus) assigné à un rôle logique.</summary>
public sealed record BusAssignment(
    BusRole Role,
    WingBusType BusType,
    int BusNumber,          // 1-based au sein de son type
    ChannelFormat Format,
    string Name,            // nom affiché sur la console
    IReadOnlyList<string> FeedingSourceNames,  // sources qui alimentent ce bus (pour les sends)
    IReadOnlyList<string> TalkbackNames);      // sous-ensemble de personnes pour qui ce bus doit
                                                // recevoir la coupure talkback (/cfg/talk/{id}/...)

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
