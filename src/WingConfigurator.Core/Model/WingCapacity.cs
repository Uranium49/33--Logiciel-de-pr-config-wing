namespace WingConfigurator.Core.Model;

/// <summary>
/// Capacités matérielles de la console Wing (identiques Wing / Wing Compact).
/// Source : specs Behringer + doc OSC Patrick-Gilles Maillot (firmware 3.0.x).
/// </summary>
public sealed record WingCapacity(
    int InputSlots,   // 40 canaux /ch (stéréo-capables) + 8 entrées /aux = 48 slots mono
    int MainBuses,    // 4 stéréo (/main/1-4)
    int MatrixBuses,  // 8 stéréo (/mtx/1-8)
    int Buses,        // 16 stéréo (/bus/1-16 — bus de mix, distinct des entrées /aux)
    int DcaGroups,    // 8 (/dca/1-8)
    int MuteGroups)   // 8 (/mgrp/1-8)
{
    public static readonly WingCapacity Default = new(
        InputSlots: 48,
        MainBuses: 4,
        MatrixBuses: 8,
        Buses: 16,
        DcaGroups: 8,
        MuteGroups: 8);

    /// <summary>Total de slots de bus disponibles, tous types confondus (Main+Matrix+Bus).</summary>
    public int TotalBusSlots => MainBuses + MatrixBuses + Buses;
}
