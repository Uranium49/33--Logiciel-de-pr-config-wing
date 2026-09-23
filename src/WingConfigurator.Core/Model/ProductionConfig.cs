namespace WingConfigurator.Core.Model;

/// <summary>Un poste de commentateur : mic + retour casque + talkback.</summary>
public sealed class CommentatorPosition
{
    public required string Name { get; set; }
    public ReturnMode ReturnMode { get; set; } = ReturnMode.PersonalStereo;
    public bool TalkbackEnabled { get; set; } = true;
}

/// <summary>Une langue = un ou plusieurs postes de commentateurs + son mix PGM.</summary>
public sealed class Language
{
    public required string Name { get; set; }
    public List<CommentatorPosition> Commentators { get; set; } = new();
}

/// <summary>Micro terrain / ambiance (hors commentateurs).</summary>
public sealed class FieldMic
{
    public required string Name { get; set; }
    public bool HasReturn { get; set; }
    public ChannelFormat ReturnFormat { get; set; } = ChannelFormat.Mono;
    public bool TalkbackEnabled { get; set; }
}

/// <summary>Source PC (jingles, vidéo, nappes...).</summary>
public sealed class PcSource
{
    public required string Name { get; set; }
    public PcSourceCategory Category { get; set; } = PcSourceCategory.Jingle;
    public PcConnectionType ConnectionType { get; set; } = PcConnectionType.Dante;
    public ChannelFormat Format { get; set; } = ChannelFormat.Stereo;
}

/// <summary>Configuration complète d'une production, saisie par l'utilisateur.</summary>
public sealed class ProductionConfig
{
    public string TypologyName { get; set; } = "Nouvelle production";
    public List<Language> Languages { get; set; } = new();
    public List<FieldMic> FieldMics { get; set; } = new();
    public List<PcSource> PcSources { get; set; } = new();
    public bool RoomMixEnabled { get; set; }
    public bool RecordingMultitrackEnabled { get; set; }

    public IEnumerable<CommentatorPosition> AllCommentators()
        => Languages.SelectMany(l => l.Commentators);
}
