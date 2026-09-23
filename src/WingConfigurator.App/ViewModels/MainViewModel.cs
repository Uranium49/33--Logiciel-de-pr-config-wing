using System.Collections.ObjectModel;
using System.IO;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Win32;
using WingConfigurator.Core.Allocation;
using WingConfigurator.Core.Model;
using WingConfigurator.Core.Osc;
using WingConfigurator.Core.Persistence;
using WingConfigurator.Core.Templates;

namespace WingConfigurator.App.ViewModels;

public partial class MainViewModel : ObservableObject
{
    [ObservableProperty] private ProductionConfig _config = ProductionTemplates.SportMultiLanguage();
    [ObservableProperty] private Language? _selectedLanguage;
    [ObservableProperty] private string _newLanguageName = "";

    [ObservableProperty] private AllocationResult? _allocationResult;
    [ObservableProperty] private ObservableCollection<InputAssignment> _inputRows = new();
    [ObservableProperty] private ObservableCollection<BusAssignment> _busRows = new();
    [ObservableProperty] private ObservableCollection<CapacityError> _errorRows = new();
    [ObservableProperty] private ObservableCollection<PatchRowViewModel> _patchRows = new();

    [ObservableProperty] private string _wingHost = "192.168.1.10";
    [ObservableProperty] private int _wingPort = WingOscClient.DefaultPort;
    [ObservableProperty] private string _statusMessage = "";

    private List<OscMessage>? _lastMessages;

    public MainViewModel()
    {
        Recalculate();
    }

    // ---------- Langues / commentateurs ----------

    [RelayCommand]
    private void AddLanguage()
    {
        if (string.IsNullOrWhiteSpace(NewLanguageName)) return;
        var lang = new Language { Name = NewLanguageName.Trim() };
        Config.Languages.Add(lang);
        NewLanguageName = "";
        SelectedLanguage = lang;
        Recalculate();
    }

    [RelayCommand]
    private void RemoveLanguage(Language? language)
    {
        if (language is null) return;
        Config.Languages.Remove(language);
        Recalculate();
    }

    [RelayCommand]
    private void AddCommentator()
    {
        if (SelectedLanguage is null) return;
        int n = SelectedLanguage.Commentators.Count + 1;
        SelectedLanguage.Commentators.Add(new CommentatorPosition { Name = $"{SelectedLanguage.Name}-Comm{n}" });
        Recalculate();
    }

    [RelayCommand]
    private void RemoveCommentator(CommentatorPosition? commentator)
    {
        if (commentator is null || SelectedLanguage is null) return;
        SelectedLanguage.Commentators.Remove(commentator);
        Recalculate();
    }

    // ---------- Micros terrain ----------

    [RelayCommand]
    private void AddFieldMic()
    {
        Config.FieldMics.Add(new FieldMic { Name = $"Micro {Config.FieldMics.Count + 1}" });
        Recalculate();
    }

    [RelayCommand]
    private void RemoveFieldMic(FieldMic? mic)
    {
        if (mic is null) return;
        Config.FieldMics.Remove(mic);
        Recalculate();
    }

    // ---------- Sources PC ----------

    [RelayCommand]
    private void AddPcSource()
    {
        Config.PcSources.Add(new PcSource { Name = $"PC {Config.PcSources.Count + 1}" });
        Recalculate();
    }

    [RelayCommand]
    private void RemovePcSource(PcSource? pc)
    {
        if (pc is null) return;
        Config.PcSources.Remove(pc);
        Recalculate();
    }

    // ---------- Calcul / capacité ----------

    [RelayCommand]
    private void Recalculate()
    {
        var allocator = new ResourceAllocator();
        AllocationResult = allocator.Allocate(Config);

        InputRows = new ObservableCollection<InputAssignment>(AllocationResult.InputPlan);
        BusRows = new ObservableCollection<BusAssignment>(AllocationResult.BusPlan);
        ErrorRows = new ObservableCollection<CapacityError>(AllocationResult.Errors);

        _lastMessages = WingScenePlanner.BuildMessages(AllocationResult);
        RebuildPatchRows();

        StatusMessage = AllocationResult.IsValid
            ? $"OK — {InputRows.Sum(i => i.SlotCount)} entrées, {BusRows.Count} bus utilisés."
            : $"{ErrorRows.Count} erreur(s) de capacité — voir l'onglet Récapitulatif.";
    }

    /// <summary>Reconstruit la liste des sources patchables (écran "Patch physique") en recoupant le
    /// plan d'entrées calculé avec les objets modèle d'origine (par nom, identité stable).</summary>
    private void RebuildPatchRows()
    {
        if (AllocationResult is null) return;

        var slotBySourceName = AllocationResult.InputPlan.ToDictionary(i => i.SourceName, i => i);
        var sources = new List<IHasPhysicalInput>();
        sources.AddRange(Config.AllCommentators());
        sources.AddRange(Config.FieldMics);
        sources.AddRange(Config.PcSources);

        var rows = new List<PatchRowViewModel>();
        foreach (var source in sources)
        {
            if (!slotBySourceName.TryGetValue(source.Name, out var input)) continue;

            // On garantit une instance non-nulle pour permettre le binding direct Group/Index en XAML.
            source.PhysicalInput ??= new PhysicalInputRef();

            string slotInfo = input.SlotCount > 1
                ? $"Canaux {input.FirstSlot}-{input.FirstSlot + input.SlotCount - 1} (stéréo)"
                : $"Canal {input.FirstSlot}";

            rows.Add(new PatchRowViewModel(input.DisplayName, slotInfo, source));
        }

        PatchRows = new ObservableCollection<PatchRowViewModel>(rows);
    }

    // ---------- Réseau / export ----------

    [RelayCommand]
    private async Task TestConnectionAsync()
    {
        try
        {
            using var client = new WingOscClient(WingHost, WingPort);
            bool ok = await client.PingAsync(TimeSpan.FromSeconds(2));
            StatusMessage = ok ? $"Connexion OK avec {WingHost}:{WingPort}." : "Pas de réponse de la console (vérifie l'IP/le réseau).";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Erreur de connexion : {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task SendToWingAsync()
    {
        Recalculate();
        if (AllocationResult is null || !AllocationResult.IsValid)
        {
            StatusMessage = "Envoi annulé : des erreurs de capacité doivent être corrigées d'abord.";
            return;
        }

        try
        {
            using var client = new WingOscClient(WingHost, WingPort);
            await client.SendAllAsync(_lastMessages ?? WingScenePlanner.BuildMessages(AllocationResult));
            StatusMessage = $"{_lastMessages?.Count ?? 0} messages OSC envoyés à {WingHost}:{WingPort}.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Erreur d'envoi : {ex.Message}";
        }
    }

    [RelayCommand]
    private void ExportOscScript()
    {
        if (AllocationResult is null) Recalculate();
        var dialog = new SaveFileDialog { Filter = "Script OSC (*.txt)|*.txt", FileName = "wing-scene.txt" };
        if (dialog.ShowDialog() == true)
        {
            OscScriptExporter.WriteOscScript(_lastMessages ?? Enumerable.Empty<OscMessage>(), dialog.FileName);
            StatusMessage = $"Script OSC exporté : {dialog.FileName}";
        }
    }

    [RelayCommand]
    private void ExportPatchSheet()
    {
        if (AllocationResult is null) Recalculate();
        var dialog = new SaveFileDialog { Filter = "Fiche de patch CSV (*.csv)|*.csv", FileName = "fiche-patch.csv" };
        if (dialog.ShowDialog() == true)
        {
            OscScriptExporter.WritePatchSheetCsv(AllocationResult!, dialog.FileName);
            StatusMessage = $"Fiche de patch exportée : {dialog.FileName}";
        }
    }

    [RelayCommand]
    private void SaveProject()
    {
        var dialog = new SaveFileDialog { Filter = "Projet WingConfigurator (*.json)|*.json", FileName = $"{Config.TypologyName}.json" };
        if (dialog.ShowDialog() == true)
        {
            ProjectStore.Save(Config, dialog.FileName);
            StatusMessage = $"Projet enregistré : {dialog.FileName}";
        }
    }

    [RelayCommand]
    private void LoadProject()
    {
        var dialog = new OpenFileDialog { Filter = "Projet WingConfigurator (*.json)|*.json" };
        if (dialog.ShowDialog() == true)
        {
            Config = ProjectStore.Load(dialog.FileName);
            SelectedLanguage = Config.Languages.FirstOrDefault();
            Recalculate();
            StatusMessage = $"Projet chargé : {dialog.FileName}";
        }
    }

    [RelayCommand]
    private void LoadTemplateSport()
    {
        Config = ProductionTemplates.SportMultiLanguage();
        SelectedLanguage = Config.Languages.FirstOrDefault();
        Recalculate();
    }

    [RelayCommand]
    private void NewEmptyProject()
    {
        Config = ProductionTemplates.Empty();
        SelectedLanguage = null;
        Recalculate();
    }
}

/// <summary>Une carte de l'écran "Patch physique" : une source + où l'assigner sur la console.</summary>
public sealed record PatchRowViewModel(string DisplayName, string SlotInfo, IHasPhysicalInput Source);
