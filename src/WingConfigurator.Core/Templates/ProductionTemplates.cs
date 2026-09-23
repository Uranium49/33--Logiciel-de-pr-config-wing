using WingConfigurator.Core.Model;

namespace WingConfigurator.Core.Templates;

/// <summary>Gabarits de départ pour ne pas repartir d'une config vide à chaque fois.</summary>
public static class ProductionTemplates
{
    public static ProductionConfig Empty() => new();

    /// <summary>Gabarit "Sport multi-langues" : 2 langues x 2 commentateurs (retour perso stéréo +
    /// talkback), 2 micros terrain, 1 source PC jingles — à ajuster ensuite dans l'assistant.</summary>
    public static ProductionConfig SportMultiLanguage()
    {
        var config = new ProductionConfig { TypologyName = "Sport multi-langues", RoomMixEnabled = true };

        foreach (var langName in new[] { "FR", "EN" })
        {
            var lang = new Language { Name = langName };
            lang.Commentators.Add(new CommentatorPosition { Name = $"{langName}-Comm1" });
            lang.Commentators.Add(new CommentatorPosition { Name = $"{langName}-Comm2" });
            config.Languages.Add(lang);
        }

        config.FieldMics.Add(new FieldMic { Name = "Ambiance stade" });
        config.FieldMics.Add(new FieldMic { Name = "Terrain 1", HasReturn = true, ReturnFormat = ChannelFormat.Mono });

        config.PcSources.Add(new PcSource { Name = "Jingles", Category = PcSourceCategory.Jingle, ConnectionType = PcConnectionType.Dante, Format = ChannelFormat.Stereo });

        return config;
    }
}
