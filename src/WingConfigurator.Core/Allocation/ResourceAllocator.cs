using WingConfigurator.Core.Model;

namespace WingConfigurator.Core.Allocation;

/// <summary>
/// Cœur métier : transforme une <see cref="ProductionConfig"/> en plan d'entrées + plan de bus,
/// en respectant les capacités matérielles de la Wing (<see cref="WingCapacity"/>).
///
/// Règles de priorité pour le pool de bus {Main, Matrix, Bus} :
///   - PGM par langue + mix salle -> Main d'abord, débordement -> Bus
///   - Retours casque personnels (commentateurs + micros terrain) -> Matrix d'abord, débordement -> Bus
///   - Bus de langue partagé -> Bus directement
///
/// Talkback : sur la Wing, le talkback n'est PAS un bus séparé — c'est une assignation d'un générateur
/// de talkback (/cfg/talk/{id}) vers un bus/mtx/main déjà existant (/cfg/talk/{id}/B{n}, /MX{n}, /M{n}).
/// Donc si une personne a déjà un bus de retour (perso ou partagé), le talkback se contente de le taguer
/// (aucune capacité supplémentaire consommée). Seule une personne sans AUCUN bus de retour mais qui
/// demande le talkback nécessite qu'on lui crée un petit bus mono dédié juste pour le recevoir.
/// </summary>
public sealed class ResourceAllocator
{
    private readonly WingCapacity _capacity;

    public ResourceAllocator(WingCapacity? capacity = null)
    {
        _capacity = capacity ?? WingCapacity.Default;
    }

    public AllocationResult Allocate(ProductionConfig config)
    {
        var result = new AllocationResult();

        AllocateInputs(config, result);
        AllocateBuses(config, result);

        return result;
    }

    // ---------- Entrées ----------

    private void AllocateInputs(ProductionConfig config, AllocationResult result)
    {
        int cursor = 1; // prochain slot libre (1-based)

        foreach (var lang in config.Languages)
        {
            foreach (var c in lang.Commentators)
            {
                cursor = PlaceInput(result, c.Name, $"{c.Name} ({lang.Name})", slots: 1, cursor,
                    connectionType: null);
            }
        }

        foreach (var mic in config.FieldMics)
        {
            cursor = PlaceInput(result, mic.Name, mic.Name, slots: 1, cursor, connectionType: null);
        }

        foreach (var pc in config.PcSources)
        {
            int slots = pc.Format == ChannelFormat.Stereo ? 2 : 1;
            cursor = PlaceInput(result, pc.Name, pc.Name, slots, cursor, pc.ConnectionType);
        }

        int totalRequested = cursor - 1;
        if (totalRequested > _capacity.InputSlots)
        {
            result.Errors.Add(new CapacityError(
                Resource: "Entrées",
                Requested: totalRequested,
                Available: _capacity.InputSlots,
                Detail: $"{totalRequested} slots d'entrée requis pour {_capacity.InputSlots} disponibles. " +
                        "Réduis le nombre de commentateurs/micros/sources PC, ou passe des sources stéréo en mono."));
        }
    }

    private static int PlaceInput(AllocationResult result, string sourceName, string displayName, int slots,
        int cursor, PcConnectionType? connectionType)
    {
        string patchLabel = connectionType is null
            ? displayName
            : $"{displayName} [{(connectionType == PcConnectionType.Dante ? "Dante" : "ASIO local")}]";

        result.InputPlan.Add(new InputAssignment(sourceName, cursor, slots, displayName, patchLabel, connectionType));
        return cursor + slots;
    }

    // ---------- Bus ----------

    private sealed record BusDemand(BusRole Role, ChannelFormat Format, string Name, WingBusType PreferredType,
        IReadOnlyList<string> Feeders, IReadOnlyList<string> TalkbackNames);

    private void AllocateBuses(ProductionConfig config, AllocationResult result)
    {
        var mainDemands = new List<BusDemand>();
        var matrixDemands = new List<BusDemand>();
        var busDirectDemands = new List<BusDemand>();

        // PGM par langue + salle -> Main
        foreach (var lang in config.Languages)
        {
            var feeders = lang.Commentators.Select(c => c.Name).ToList();
            mainDemands.Add(new BusDemand(BusRole.LanguageProgram, ChannelFormat.Stereo,
                $"PGM {lang.Name}", WingBusType.Main, feeders, Array.Empty<string>()));
        }
        if (config.RoomMixEnabled)
        {
            AddRoomMixDemand(config, mainDemands);
        }

        // Retours perso -> Matrix. Le talkback d'une personne est simplement tagué sur le bus qui la
        // concerne (ici son retour perso) ; il n'y a rien de plus à allouer.
        var namesWithoutOwnReturnButWantTalkback = new List<string>();

        foreach (var lang in config.Languages)
        {
            foreach (var c in lang.Commentators)
            {
                var tb = c.TalkbackEnabled ? new[] { c.Name } : Array.Empty<string>();
                switch (c.ReturnMode)
                {
                    case ReturnMode.PersonalMono:
                        matrixDemands.Add(new BusDemand(BusRole.CommentatorReturn, ChannelFormat.Mono,
                            $"Ret {c.Name}", WingBusType.Matrix, new[] { c.Name }, tb));
                        break;
                    case ReturnMode.PersonalStereo:
                        matrixDemands.Add(new BusDemand(BusRole.CommentatorReturn, ChannelFormat.Stereo,
                            $"Ret {c.Name}", WingBusType.Matrix, new[] { c.Name }, tb));
                        break;
                    case ReturnMode.SharedLanguageBus:
                        break; // le bus partagé est créé une fois par langue plus bas, avec ses talkbacks
                    case ReturnMode.None:
                        if (c.TalkbackEnabled)
                        {
                            namesWithoutOwnReturnButWantTalkback.Add(c.Name);
                        }
                        break;
                }
            }

            // Un seul bus partagé par langue si au moins un commentateur le demande.
            var sharedMembers = lang.Commentators.Where(c => c.ReturnMode == ReturnMode.SharedLanguageBus).ToList();
            if (sharedMembers.Count > 0)
            {
                var feeders = sharedMembers.Select(c => c.Name).ToList();
                var tb = sharedMembers.Where(c => c.TalkbackEnabled).Select(c => c.Name).ToList();
                busDirectDemands.Add(new BusDemand(BusRole.CommentatorReturn, ChannelFormat.Stereo,
                    $"Ret {lang.Name}", WingBusType.Bus, feeders, tb));
            }
        }

        // Retours micros terrain -> Matrix
        foreach (var mic in config.FieldMics)
        {
            var tb = mic.TalkbackEnabled ? new[] { mic.Name } : Array.Empty<string>();
            if (mic.HasReturn)
            {
                matrixDemands.Add(new BusDemand(BusRole.FieldMicReturn, mic.ReturnFormat,
                    $"Ret {mic.Name}", WingBusType.Matrix, new[] { mic.Name }, tb));
            }
            else if (mic.TalkbackEnabled)
            {
                namesWithoutOwnReturnButWantTalkback.Add(mic.Name);
            }
        }

        // Personnes sans aucun bus de retour mais qui veulent quand même recevoir le talkback :
        // il leur faut un petit bus mono dédié uniquement à ça.
        foreach (var name in namesWithoutOwnReturnButWantTalkback)
        {
            busDirectDemands.Add(new BusDemand(BusRole.Talkback, ChannelFormat.Mono,
                $"TB {name}", WingBusType.Bus, new[] { name }, new[] { name }));
        }

        // Remplissage Main puis Matrix, avec débordement vers la file Bus (dans l'ordre : main puis matrix).
        var busQueue = new List<BusDemand>();
        FillPool(result, mainDemands, WingBusType.Main, _capacity.MainBuses, busQueue);
        FillPool(result, matrixDemands, WingBusType.Matrix, _capacity.MatrixBuses, busQueue);
        busQueue.AddRange(busDirectDemands);

        FillPool(result, busQueue, WingBusType.Bus, _capacity.Buses, overflow: null);

        int busOverflowCount = busQueue.Count - Math.Min(busQueue.Count, _capacity.Buses);
        if (busOverflowCount > 0)
        {
            result.Errors.Add(new CapacityError(
                Resource: "Bus (après débordement Main/Matrix)",
                Requested: busQueue.Count,
                Available: _capacity.Buses,
                Detail: $"{busOverflowCount} bus n'ont pas pu être placés : {string.Join(", ", busQueue.Skip(_capacity.Buses).Select(d => d.Name))}. " +
                        "Réduis le nombre de retours personnels/talkback, ou passe certains retours en bus partagé par langue."));
        }

        // Note : dépasser la capacité Main ou Matrix seul n'est pas une erreur bloquante tant que le
        // surplus tient dans le pool Bus — c'est le rôle du débordement. Seule l'insuffisance du pool
        // Bus total (vérifiée ci-dessus) est bloquante.
    }

    private static void AddRoomMixDemand(ProductionConfig config, List<BusDemand> mainDemands)
    {
        mainDemands.Add(new BusDemand(BusRole.RoomMix, ChannelFormat.Stereo, "Salle", WingBusType.Main,
            config.AllCommentators().Select(c => c.Name).ToList(), Array.Empty<string>()));
    }

    /// <summary>Place jusqu'à <paramref name="capacity"/> demandes dans le pool donné ; le reste part dans
    /// <paramref name="overflow"/> (si fourni), sinon reste non placé.</summary>
    private static void FillPool(AllocationResult result, List<BusDemand> demands, WingBusType type, int capacity,
        List<BusDemand>? overflow)
    {
        for (int i = 0; i < demands.Count; i++)
        {
            if (i < capacity)
            {
                var d = demands[i];
                result.BusPlan.Add(new BusAssignment(d.Role, type, i + 1, d.Format, d.Name, d.Feeders, d.TalkbackNames));
            }
            else
            {
                overflow?.Add(demands[i]);
            }
        }
    }
}
