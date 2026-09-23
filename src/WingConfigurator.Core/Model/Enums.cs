namespace WingConfigurator.Core.Model;

/// <summary>Type de bus physique de la console Wing.
/// Attention terminologie Wing : "Bus" = les 16 bus stéréo de mix (adresse OSC /bus/N) ;
/// "Aux" désigne les 8 entrées physiques supplémentaires (/aux/N), pas un type de bus.</summary>
public enum WingBusType
{
    Main,
    Matrix,
    Bus
}

/// <summary>Format d'un canal ou d'un bus.</summary>
public enum ChannelFormat
{
    Mono,
    Stereo
}

/// <summary>Mode de retour casque pour un commentateur.</summary>
public enum ReturnMode
{
    /// <summary>Pas de retour dédié.</summary>
    None,

    /// <summary>Bus personnel mono.</summary>
    PersonalMono,

    /// <summary>Bus personnel stéréo.</summary>
    PersonalStereo,

    /// <summary>Bus partagé avec les autres commentateurs de la même langue.</summary>
    SharedLanguageBus
}

/// <summary>Catégorie d'une source PC.</summary>
public enum PcSourceCategory
{
    Jingle,
    Video,
    Ambiance
}

/// <summary>Comment la source PC arrive physiquement dans la Wing.
/// ASIO est un pilote local Windows : la Wing ne le "voit" pas directement — c'est une étiquette
/// de patch, pas un routage piloté par l'app. Seul Dante est réellement routable en réseau.</summary>
public enum PcConnectionType
{
    AsioLocal,
    Dante
}

/// <summary>Rôle logique d'un bus alloué, utilisé pour le nommage et le règlage des sends.</summary>
public enum BusRole
{
    LanguageProgram,     // mix PGM d'une langue
    RoomMix,             // mix salle
    CommentatorReturn,   // retour casque perso ou partagé d'un commentateur
    FieldMicReturn,      // retour casque d'un micro terrain
    Talkback             // talkback perso d'une personne
}
