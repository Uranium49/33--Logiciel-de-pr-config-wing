using CommunityToolkit.Mvvm.ComponentModel;

namespace WingConfigurator.Core.Model;

/// <summary>Groupe de connexion physique/réseau d'entrée sur la Wing.
/// ATTENTION : les codes OSC exacts (<see cref="WingInputGroups.OscCode"/>) n'ont pas pu être
/// vérifiés dans la documentation publique consultée (ni le PDF officiel, ni le module Companion
/// open-source ne les énumèrent). Ce sont les noms d'affichage standards Wing — à confirmer/ajuster
/// une fois connecté à la console réelle (l'écran de patch de la console les affiche directement).</summary>
public enum WingInputGroup
{
    Local,
    Aes50A,
    Aes50B,
    Card,
    Usb
}

public static class WingInputGroups
{
    /// <summary>Code OSC présumé pour le paramètre "grp" (à confirmer sur le matériel réel).</summary>
    public static readonly Dictionary<WingInputGroup, string> OscCode = new()
    {
        [WingInputGroup.Local] = "LCL",
        [WingInputGroup.Aes50A] = "A50A",
        [WingInputGroup.Aes50B] = "A50B",
        [WingInputGroup.Card] = "CRD",
        [WingInputGroup.Usb] = "USB",
    };

    public static readonly Dictionary<WingInputGroup, string> DisplayName = new()
    {
        [WingInputGroup.Local] = "Local (XLR console)",
        [WingInputGroup.Aes50A] = "AES50-A",
        [WingInputGroup.Aes50B] = "AES50-B",
        [WingInputGroup.Card] = "Carte d'extension (Dante...)",
        [WingInputGroup.Usb] = "USB",
    };
}

/// <summary>Référence à une entrée physique/réseau précise (groupe + numéro), assignée par
/// l'utilisateur sur l'écran de patch. Nullable côté source = "non patché encore".</summary>
public partial class PhysicalInputRef : ObservableObject
{
    [ObservableProperty] private WingInputGroup _group = WingInputGroup.Card;
    [ObservableProperty] private int _index = 1; // 1-based, premier canal (le second si stéréo = Index+1)
}

/// <summary>Implémenté par toute source patchable (commentateur, micro terrain, source PC) pour
/// que l'écran de patch physique puisse les traiter de façon uniforme.</summary>
public interface IHasPhysicalInput
{
    string Name { get; }
    PhysicalInputRef? PhysicalInput { get; set; }
}
