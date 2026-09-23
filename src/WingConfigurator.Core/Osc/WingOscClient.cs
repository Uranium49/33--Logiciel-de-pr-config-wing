using System.Net;
using System.Net.Sockets;

namespace WingConfigurator.Core.Osc;

/// <summary>
/// Client UDP pour piloter une Behringer Wing en OSC (port officiel 2223, firmware ≥ 1.08).
/// </summary>
public sealed class WingOscClient : IDisposable
{
    public const int DefaultPort = 2223;

    private readonly UdpClient _udp;
    private readonly IPEndPoint _endpoint;

    public WingOscClient(string host, int port = DefaultPort)
    {
        _endpoint = new IPEndPoint(IPAddress.Parse(ResolveIp(host)), port);
        _udp = new UdpClient();
    }

    private static string ResolveIp(string host)
    {
        if (IPAddress.TryParse(host, out _)) return host;
        var entry = Dns.GetHostEntry(host);
        return entry.AddressList.First(a => a.AddressFamily == AddressFamily.InterNetwork).ToString();
    }

    public Task SendAsync(OscMessage message)
    {
        var bytes = message.Encode();
        return _udp.SendAsync(bytes, bytes.Length, _endpoint);
    }

    public async Task SendAllAsync(IEnumerable<OscMessage> messages, int delayMsBetweenMessages = 5)
    {
        foreach (var m in messages)
        {
            await SendAsync(m);
            if (delayMsBetweenMessages > 0)
                await Task.Delay(delayMsBetweenMessages);
        }
    }

    /// <summary>Test de connexion simple : demande le nom du canal 1 et attend une réponse UDP.
    /// La Wing répond aux requêtes "get" (message sans argument) par le même message avec sa valeur.</summary>
    public async Task<bool> PingAsync(TimeSpan timeout)
    {
        try
        {
            await SendAsync(new OscMessage(WingOscAddresses.Channel.Name(1)));

            using var cts = new CancellationTokenSource(timeout);
            var receiveTask = _udp.ReceiveAsync();
            var completed = await Task.WhenAny(receiveTask, Task.Delay(timeout, cts.Token));
            return completed == receiveTask && receiveTask.IsCompletedSuccessfully;
        }
        catch
        {
            return false;
        }
    }

    public void Dispose() => _udp.Dispose();
}
