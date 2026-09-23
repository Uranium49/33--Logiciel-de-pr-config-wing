using WingConfigurator.Core.Allocation;
using WingConfigurator.Core.Model;
using WingConfigurator.Core.Osc;
using Xunit;

namespace WingConfigurator.Tests;

public class WingScenePlannerTests
{
    [Fact]
    public void BuildMessages_NamesLanguagePgmOnMain_AndPreparesTalkbackReturn()
    {
        var config = new ProductionConfig();
        var lang = new Language { Name = "FR" };
        lang.Commentators.Add(new CommentatorPosition
        {
            Name = "Comm1",
            ReturnMode = ReturnMode.PersonalStereo
        });
        config.Languages.Add(lang);

        var plan = new ResourceAllocator().Allocate(config);
        var messages = WingScenePlanner.BuildMessages(plan);

        // Nom du canal d'entrée (slot 1 -> /ch/1/name), avec la langue en indication d'affichage.
        Assert.Contains(messages, m => m.Address == "/ch/1/name" && (string)m.Arguments[0] == "Comm1 (FR)");

        // PGM FR -> Main 1
        Assert.Contains(messages, m => m.Address == "/main/1/name" && (string)m.Arguments[0] == "PGM FR");

        // Retour perso Comm1 -> Matrix 1
        Assert.Contains(messages, m => m.Address == "/mtx/1/name" && (string)m.Arguments[0] == "Ret Comm1");
    }

    [Fact]
    public void BuildMessages_TalkbackMesh_PreparesCutOffSendFromEachOtherParticipant()
    {
        // 2 commentateurs, chacun avec retour perso + talkback -> chacun doit avoir un send (coupé)
        // depuis le canal de l'autre vers son propre bus de retour.
        var config = new ProductionConfig();
        var lang = new Language { Name = "FR" };
        lang.Commentators.Add(new CommentatorPosition { Name = "A", ReturnMode = ReturnMode.PersonalMono });
        lang.Commentators.Add(new CommentatorPosition { Name = "B", ReturnMode = ReturnMode.PersonalMono });
        config.Languages.Add(lang);

        var plan = new ResourceAllocator().Allocate(config);
        var messages = WingScenePlanner.BuildMessages(plan);

        var aReturn = plan.BusPlan.Single(b => b.Name == "Ret A");
        var bReturn = plan.BusPlan.Single(b => b.Name == "Ret B");

        // B (canal 2) doit avoir un send coupé vers le retour de A (Matrix 1).
        Assert.Contains(messages, m => m.Address == "/ch/2/send/MX1/on" && (int)m.Arguments[0] == 0);
        // A (canal 1) doit avoir un send coupé vers le retour de B (Matrix 2).
        Assert.Contains(messages, m => m.Address == "/ch/1/send/MX2/on" && (int)m.Arguments[0] == 0);

        // Pas de send de A vers son propre retour.
        Assert.DoesNotContain(messages, m => m.Address == "/ch/1/send/MX1/on");
    }

    [Fact]
    public void BuildMessages_WithPhysicalInputPatched_EmitsConnectionGroupAndIndex()
    {
        var config = new ProductionConfig();
        config.FieldMics.Add(new FieldMic
        {
            Name = "Ambiance",
            PhysicalInput = new PhysicalInputRef { Group = WingInputGroup.Aes50A, Index = 5 }
        });

        var plan = new ResourceAllocator().Allocate(config);
        var messages = WingScenePlanner.BuildMessages(plan);

        Assert.Contains(messages, m => m.Address == "/ch/1/in/conn/grp" && (string)m.Arguments[0] == "A50A");
        Assert.Contains(messages, m => m.Address == "/ch/1/in/conn/in" && (int)m.Arguments[0] == 5);
    }
}
