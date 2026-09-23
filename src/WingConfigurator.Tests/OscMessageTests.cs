using WingConfigurator.Core.Osc;
using Xunit;

namespace WingConfigurator.Tests;

public class OscMessageTests
{
    [Fact]
    public void Encode_PadsAddressAndTypeTags_ToFourByteBoundary()
    {
        // "/ch/1/mute" (10 car.) -> paddé à 12 ; type tag ",i" (2 car.) -> paddé à 4 ; arg int32 (4 octets).
        var msg = new OscMessage("/ch/1/mute", 1);
        var bytes = msg.Encode();

        Assert.Equal(12 + 4 + 4, bytes.Length);
        Assert.Equal("/ch/1/mute", System.Text.Encoding.ASCII.GetString(bytes, 0, 10));
        Assert.Equal(0, bytes[10]);
        Assert.Equal(0, bytes[11]);
    }

    [Fact]
    public void Encode_Int32_IsBigEndian()
    {
        var msg = new OscMessage("/x", 1);
        var bytes = msg.Encode();
        var last4 = bytes[^4..];
        Assert.Equal(new byte[] { 0, 0, 0, 1 }, last4);
    }

    [Fact]
    public void Encode_StringArgument_IsNullPaddedToFourBytes()
    {
        var msg = new OscMessage("/ch/1/name", "FR-Comm1"); // 8 caractères -> +4 padding (\0\0\0\0)
        var bytes = msg.Encode();

        // Adresse "/ch/1/name" = 10 car. -> paddé à 12 ; type tag ",s" -> paddé à 4 ; arg "FR-Comm1" (8) -> paddé à 12.
        Assert.Equal(12 + 4 + 12, bytes.Length);
    }
}
