using WingConfigurator.Core.Model;

namespace WingConfigurator.App.Common;

/// <summary>Option de ComboBox liant une valeur d'énum à un libellé lisible.</summary>
public sealed record EnumOption<T>(T Value, string Label);

/// <summary>Expose les valeurs d'énum pour le binding XAML (ItemsSource des ComboBox).</summary>
public static class EnumValues
{
    public static ReturnMode[] ReturnModes { get; } = Enum.GetValues<ReturnMode>();
    public static ChannelFormat[] ChannelFormats { get; } = Enum.GetValues<ChannelFormat>();
    public static PcSourceCategory[] PcSourceCategories { get; } = Enum.GetValues<PcSourceCategory>();
    public static PcConnectionType[] PcConnectionTypes { get; } = Enum.GetValues<PcConnectionType>();

    public static EnumOption<ReturnMode>[] ReturnModeOptions { get; } =
    {
        new(ReturnMode.None, "Aucun retour"),
        new(ReturnMode.PersonalMono, "Perso — mono"),
        new(ReturnMode.PersonalStereo, "Perso — stéréo"),
        new(ReturnMode.SharedLanguageBus, "Partagé (langue) + talkback commun"),
    };

    public static EnumOption<WingInputGroup>[] WingInputGroupOptions { get; } =
        WingInputGroups.DisplayName.Select(kv => new EnumOption<WingInputGroup>(kv.Key, kv.Value)).ToArray();
}
