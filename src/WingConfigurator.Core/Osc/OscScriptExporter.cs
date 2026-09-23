using System.Globalization;
using System.Text;
using WingConfigurator.Core.Allocation;
using WingConfigurator.Core.Model;

namespace WingConfigurator.Core.Osc;

/// <summary>
/// Fallback hors-réseau : pas de format de scène binaire Wing (.wsg) documenté publiquement,
/// donc on exporte (a) un script texte des messages OSC, rejouable par notre appli ou un outil
/// tiers (Companion, TouchOSC...), et (b) une fiche de patch lisible en CSV pour l'ingé son.
/// </summary>
public static class OscScriptExporter
{
    /// <summary>Un message par ligne : adresse puis arguments séparés par des espaces.
    /// Les chaînes contenant des espaces sont entre guillemets.</summary>
    public static void WriteOscScript(IEnumerable<OscMessage> messages, string filePath)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# Script OSC Wing — généré par WingConfigurator");
        sb.AppendLine("# Une ligne = une adresse OSC suivie de ses arguments.");

        foreach (var m in messages)
        {
            sb.Append(m.Address);
            foreach (var arg in m.Arguments)
            {
                sb.Append(' ');
                sb.Append(arg switch
                {
                    string s when s.Contains(' ') => $"\"{s}\"",
                    string s => s,
                    float f => f.ToString("0.0000", CultureInfo.InvariantCulture),
                    double d => d.ToString("0.0000", CultureInfo.InvariantCulture),
                    _ => arg.ToString()
                });
            }
            sb.AppendLine();
        }

        File.WriteAllText(filePath, sb.ToString(), Encoding.UTF8);
    }

    public static void WritePatchSheetCsv(AllocationResult plan, string filePath)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Type;Numéro;Nom;Format/Slots;Source(s);Talkback;Patch physique");

        foreach (var input in plan.InputPlan)
        {
            string addressHint = input.FirstSlot <= 40 ? $"ch{input.FirstSlot}" : $"aux{input.FirstSlot - 40}";
            string patch = input.PhysicalInput is { } p
                ? $"{WingInputGroups.DisplayName[p.Group]} #{p.Index}"
                : "(non patché)";
            sb.AppendLine($"Entrée;{addressHint};{Csv(input.PatchLabel)};{input.SlotCount} slot(s);;;{Csv(patch)}");
        }

        foreach (var bus in plan.BusPlan)
        {
            sb.AppendLine($"{bus.BusType};{bus.BusNumber};{Csv(bus.Name)};{bus.Format};" +
                          $"{Csv(string.Join(", ", bus.FeedingSourceNames))};{Csv(string.Join(", ", bus.TalkbackNames))};");
        }

        if (plan.Errors.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("ERREURS DE CAPACITÉ;;;;;;");
            foreach (var e in plan.Errors)
            {
                sb.AppendLine($"{Csv(e.Resource)};{e.Requested};{e.Available};{Csv(e.Detail)};;;");
            }
        }

        File.WriteAllText(filePath, sb.ToString(), Encoding.UTF8);
    }

    private static string Csv(string value) => value.Contains(';') ? $"\"{value}\"" : value;
}
