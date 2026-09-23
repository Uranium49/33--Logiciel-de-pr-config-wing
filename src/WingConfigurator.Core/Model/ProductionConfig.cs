using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;

namespace WingConfigurator.Core.Model;

/// <summary>Un poste de commentateur : mic + retour casque + talkback.</summary>
public partial class CommentatorPosition : ObservableObject
{
    [ObservableProperty] private string _name = string.Empty;
    [ObservableProperty] private ReturnMode _returnMode = ReturnMode.PersonalStereo;
    [ObservableProperty] private bool _talkbackEnabled = true;
}

/// <summary>Une langue = un ou plusieurs postes de commentateurs + son mix PGM.</summary>
public partial class Language : ObservableObject
{
    [ObservableProperty] private string _name = string.Empty;
    public ObservableCollection<CommentatorPosition> Commentators { get; } = new();
}

/// <summary>Micro terrain / ambiance (hors commentateurs).</summary>
public partial class FieldMic : ObservableObject
{
    [ObservableProperty] private string _name = string.Empty;
    [ObservableProperty] private bool _hasReturn;
    [ObservableProperty] private ChannelFormat _returnFormat = ChannelFormat.Mono;
    [ObservableProperty] private bool _talkbackEnabled;
}

/// <summary>Source PC (jingles, vidéo, nappes...).</summary>
public partial class PcSource : ObservableObject
{
    [ObservableProperty] private string _name = string.Empty;
    [ObservableProperty] private PcSourceCategory _category = PcSourceCategory.Jingle;
    [ObservableProperty] private PcConnectionType _connectionType = PcConnectionType.Dante;
    [ObservableProperty] private ChannelFormat _format = ChannelFormat.Stereo;
}

/// <summary>Configuration complète d'une production, saisie par l'utilisateur.</summary>
public partial class ProductionConfig : ObservableObject
{
    [ObservableProperty] private string _typologyName = "Nouvelle production";
    public ObservableCollection<Language> Languages { get; } = new();
    public ObservableCollection<FieldMic> FieldMics { get; } = new();
    public ObservableCollection<PcSource> PcSources { get; } = new();
    [ObservableProperty] private bool _roomMixEnabled;
    [ObservableProperty] private bool _recordingMultitrackEnabled;

    public IEnumerable<CommentatorPosition> AllCommentators()
        => Languages.SelectMany(l => l.Commentators);
}
