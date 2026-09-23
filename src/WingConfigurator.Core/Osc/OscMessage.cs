using System.Text;

namespace WingConfigurator.Core.Osc;

/// <summary>
/// Encodeur/décodeur minimal du format binaire OSC 1.0 (spec officielle : Address Pattern,
/// Type Tag String, arguments — chaque bloc padded à un multiple de 4 octets avec des \0).
/// Pas de dépendance externe : les messages Wing n'utilisent que string/int32/float32.
/// </summary>
public sealed class OscMessage
{
    public string Address { get; }
    public IReadOnlyList<object> Arguments { get; }

    public OscMessage(string address, params object[] arguments)
    {
        if (string.IsNullOrWhiteSpace(address) || !address.StartsWith('/'))
            throw new ArgumentException("L'adresse OSC doit commencer par '/'.", nameof(address));

        Address = address;
        Arguments = arguments;
    }

    public byte[] Encode()
    {
        using var ms = new MemoryStream();

        WritePaddedString(ms, Address);

        var typeTags = new StringBuilder(",");
        foreach (var arg in Arguments)
        {
            typeTags.Append(arg switch
            {
                int => 'i',
                float => 'f',
                double => 'f',
                string => 's',
                _ => throw new NotSupportedException($"Type OSC non supporté : {arg.GetType()}")
            });
        }
        WritePaddedString(ms, typeTags.ToString());

        foreach (var arg in Arguments)
        {
            switch (arg)
            {
                case int i:
                    WriteInt32(ms, i);
                    break;
                case float f:
                    WriteFloat32(ms, f);
                    break;
                case double d:
                    WriteFloat32(ms, (float)d);
                    break;
                case string s:
                    WritePaddedString(ms, s);
                    break;
            }
        }

        return ms.ToArray();
    }

    private static void WritePaddedString(Stream s, string value)
    {
        var bytes = Encoding.ASCII.GetBytes(value);
        s.Write(bytes, 0, bytes.Length);
        int pad = 4 - (bytes.Length % 4);
        if (pad == 0) pad = 4; // toujours au moins un \0 terminal
        s.Write(new byte[pad], 0, pad);
    }

    private static void WriteInt32(Stream s, int value)
    {
        var bytes = BitConverter.GetBytes(value);
        if (BitConverter.IsLittleEndian) Array.Reverse(bytes); // OSC = big-endian
        s.Write(bytes, 0, 4);
    }

    private static void WriteFloat32(Stream s, float value)
    {
        var bytes = BitConverter.GetBytes(value);
        if (BitConverter.IsLittleEndian) Array.Reverse(bytes);
        s.Write(bytes, 0, 4);
    }
}
