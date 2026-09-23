using WingConfigurator.Core.Model;

namespace WingConfigurator.App.Common;

/// <summary>Expose les valeurs d'énum pour le binding XAML (ItemsSource des ComboBox).</summary>
public static class EnumValues
{
    public static ReturnMode[] ReturnModes { get; } = Enum.GetValues<ReturnMode>();
    public static ChannelFormat[] ChannelFormats { get; } = Enum.GetValues<ChannelFormat>();
    public static PcSourceCategory[] PcSourceCategories { get; } = Enum.GetValues<PcSourceCategory>();
    public static PcConnectionType[] PcConnectionTypes { get; } = Enum.GetValues<PcConnectionType>();
}
