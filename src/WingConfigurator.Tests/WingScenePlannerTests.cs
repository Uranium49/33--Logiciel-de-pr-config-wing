using WingConfigurator.Core.Allocation;
using WingConfigurator.Core.Model;
using WingConfigurator.Core.Osc;
using Xunit;

namespace WingConfigurator.Tests;

public class WingScenePlannerTests
{
    [Fact]
    public void BuildMessages_NamesLanguagePgmOnMain_AndAssignsTalkbackOnPersonalReturn()
    {
        var config = new ProductionConfig();
        var lang = new Language { Name = "FR" };
        lang.Commentators.Add(new CommentatorPosition
        {
            Name = "Comm1",
            ReturnMode = ReturnMode.PersonalStereo,
            TalkbackEnabled = true
        });
        config.Languages.Add(lang);

        var plan = new ResourceAllocator().Allocate(config);
        var messages = WingScenePlanner.BuildMessages(plan);

        // Nom du canal d'entrée (slot 1 -> /ch/1/name)
        Assert.Contains(messages, m => m.Address == "/ch/1/name" && (string)m.Arguments[0] == "Comm1 (FR)");

        // PGM FR -> Main 1
        Assert.Contains(messages, m => m.Address == "/main/1/name" && (string)m.Arguments[0] == "PGM FR");

        // Retour perso Comm1 -> Matrix 1, avec assignation talkback A
        Assert.Contains(messages, m => m.Address == "/mtx/1/name" && (string)m.Arguments[0] == "Ret Comm1");
        Assert.Contains(messages, m => m.Address == "/cfg/talk/A/MX1" && (int)m.Arguments[0] == 1);
    }
}
