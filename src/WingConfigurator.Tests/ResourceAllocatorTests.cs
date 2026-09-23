using WingConfigurator.Core.Allocation;
using WingConfigurator.Core.Model;
using Xunit;

namespace WingConfigurator.Tests;

public class ResourceAllocatorTests
{
    private static ProductionConfig BuildTypicalSportConfig()
    {
        // 3 langues x 2 commentateurs (retour perso stéréo + talkback), 4 micros terrain
        // (2 avec retour mono), 3 sources PC (2 Dante stéréo, 1 ASIO mono), mix salle activé.
        var config = new ProductionConfig { TypologyName = "Sport multi-langues" };

        foreach (var langName in new[] { "FR", "EN", "ES" })
        {
            var lang = new Language { Name = langName };
            lang.Commentators.Add(new CommentatorPosition { Name = $"{langName}-Comm1" });
            lang.Commentators.Add(new CommentatorPosition { Name = $"{langName}-Comm2" });
            config.Languages.Add(lang);
        }

        config.FieldMics.Add(new FieldMic { Name = "Ambiance stade" });
        config.FieldMics.Add(new FieldMic { Name = "Terrain 1", HasReturn = true, ReturnFormat = ChannelFormat.Mono });
        config.FieldMics.Add(new FieldMic { Name = "Terrain 2", HasReturn = true, ReturnFormat = ChannelFormat.Mono });
        config.FieldMics.Add(new FieldMic { Name = "Interview" });

        config.PcSources.Add(new PcSource { Name = "Jingles", Category = PcSourceCategory.Jingle, ConnectionType = PcConnectionType.Dante, Format = ChannelFormat.Stereo });
        config.PcSources.Add(new PcSource { Name = "Nappe TV", Category = PcSourceCategory.Ambiance, ConnectionType = PcConnectionType.Dante, Format = ChannelFormat.Stereo });
        config.PcSources.Add(new PcSource { Name = "Talkback régie", Category = PcSourceCategory.Ambiance, ConnectionType = PcConnectionType.AsioLocal, Format = ChannelFormat.Mono });

        config.RoomMixEnabled = true;

        return config;
    }

    [Fact]
    public void TypicalSportScenario_FitsWithinCapacity_AndIsFullyAllocated()
    {
        var config = BuildTypicalSportConfig();
        var allocator = new ResourceAllocator();

        var result = allocator.Allocate(config);

        // Entrées : 6 commentateurs + 4 micros + (2+2+1) PC = 15 slots, largement sous 48.
        Assert.Equal(15, result.InputPlan.Sum(i => i.SlotCount));
        Assert.True(result.IsValid, string.Join("; ", result.Errors.Select(e => e.Detail)));

        // 3 PGM langue + 1 salle = 4 -> tient exactement dans les 4 Main.
        var mainBuses = result.BusPlan.Where(b => b.BusType == WingBusType.Main).ToList();
        Assert.Equal(4, mainBuses.Count);
        Assert.Contains(mainBuses, b => b.Name == "Salle");

        // 6 retours perso commentateurs + 2 retours micro = 8 -> tient exactement dans les 8 Matrix.
        var matrixBuses = result.BusPlan.Where(b => b.BusType == WingBusType.Matrix).ToList();
        Assert.Equal(8, matrixBuses.Count);

        // Talkback : chaque commentateur a déjà un retour perso (Matrix), donc le talkback se tague
        // sur ce bus existant -> aucun bus /bus/N supplémentaire n'est consommé pour ça.
        Assert.Empty(result.BusPlan.Where(b => b.BusType == WingBusType.Bus));
        var commentatorReturns = result.BusPlan.Where(b => b.Role == BusRole.CommentatorReturn).ToList();
        Assert.Equal(6, commentatorReturns.Count);
        Assert.All(commentatorReturns, b => Assert.Single(b.TalkbackNames));
    }

    [Fact]
    public void TooManyInputs_ProducesBlockingCapacityError()
    {
        var config = new ProductionConfig();
        var lang = new Language { Name = "FR" };
        for (int i = 0; i < 50; i++)
        {
            lang.Commentators.Add(new CommentatorPosition { Name = $"Comm{i}", ReturnMode = ReturnMode.None });
        }
        config.Languages.Add(lang);

        var result = new ResourceAllocator().Allocate(config);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Resource == "Entrées" && e.Requested == 50 && e.Available == 48);
    }

    [Fact]
    public void PersonalReturns_OverflowFromMatrixToBus_WhenMoreThanEightPositions()
    {
        // 10 commentateurs avec retour perso stéréo -> 8 tiennent en Matrix, 2 débordent en Bus.
        var config = new ProductionConfig();
        var lang = new Language { Name = "FR" };
        for (int i = 0; i < 10; i++)
        {
            lang.Commentators.Add(new CommentatorPosition
            {
                Name = $"Comm{i}",
                ReturnMode = ReturnMode.PersonalStereo
            });
        }
        config.Languages.Add(lang);

        var result = new ResourceAllocator().Allocate(config);

        var matrixReturns = result.BusPlan.Where(b => b.BusType == WingBusType.Matrix && b.Role == BusRole.CommentatorReturn).ToList();
        var busReturns = result.BusPlan.Where(b => b.BusType == WingBusType.Bus && b.Role == BusRole.CommentatorReturn).ToList();

        Assert.Equal(8, matrixReturns.Count);
        Assert.Equal(2, busReturns.Count);
        Assert.True(result.IsValid); // 10 <= 16 bus dispo, donc pas d'erreur bloquante
    }

    [Fact]
    public void FieldMic_StereoFormat_ConsumesTwoInputSlots()
    {
        var config = new ProductionConfig();
        config.FieldMics.Add(new FieldMic { Name = "Ambiance stéréo", Format = ChannelFormat.Stereo });
        config.FieldMics.Add(new FieldMic { Name = "Interview mono", Format = ChannelFormat.Mono });

        var result = new ResourceAllocator().Allocate(config);

        var stereo = result.InputPlan.Single(i => i.SourceName == "Ambiance stéréo");
        var mono = result.InputPlan.Single(i => i.SourceName == "Interview mono");

        Assert.Equal(2, stereo.SlotCount);
        Assert.Equal(1, mono.SlotCount);
        Assert.Equal(stereo.FirstSlot + 2, mono.FirstSlot);
    }

    [Fact]
    public void SharedLanguageBus_CreatesOneBusPerLanguage_NotOnePerCommentator()
    {
        var config = new ProductionConfig();
        var lang = new Language { Name = "FR" };
        lang.Commentators.Add(new CommentatorPosition { Name = "A", ReturnMode = ReturnMode.SharedLanguageBus });
        lang.Commentators.Add(new CommentatorPosition { Name = "B", ReturnMode = ReturnMode.SharedLanguageBus });
        lang.Commentators.Add(new CommentatorPosition { Name = "C", ReturnMode = ReturnMode.SharedLanguageBus });
        config.Languages.Add(lang);

        var result = new ResourceAllocator().Allocate(config);

        var sharedBuses = result.BusPlan.Where(b => b.Name == "Ret FR").ToList();
        Assert.Single(sharedBuses);
        Assert.Equal(3, sharedBuses[0].FeedingSourceNames.Count);
    }
}
