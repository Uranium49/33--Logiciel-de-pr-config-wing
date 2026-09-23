using System.Text.Json;
using System.Text.Json.Serialization;
using WingConfigurator.Core.Model;

namespace WingConfigurator.Core.Persistence;

/// <summary>Sauvegarde/chargement d'une <see cref="ProductionConfig"/> en JSON, pour réutiliser une
/// typologie de production d'un événement à l'autre.</summary>
public static class ProjectStore
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public static void Save(ProductionConfig config, string filePath)
    {
        var json = JsonSerializer.Serialize(config, Options);
        File.WriteAllText(filePath, json);
    }

    public static ProductionConfig Load(string filePath)
    {
        var json = File.ReadAllText(filePath);
        return JsonSerializer.Deserialize<ProductionConfig>(json, Options)
               ?? throw new InvalidDataException($"Fichier de projet invalide : {filePath}");
    }
}
