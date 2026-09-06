using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("DivineList Agentstation")]
[assembly: System.Reflection.AssemblyDescription("Lokal agentstation med Ollama och Obsidian")]
[assembly: System.Reflection.AssemblyVersion("2.4.0.0")]

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool created;
        using (Mutex mutex = new Mutex(true, @"Local\DivineList.Station.Windows", out created))
        {
            if (!created)
            {
                MessageBox.Show("DivineList är redan startat. Välj Öppna DivineList via skeppsikonen vid Windows-klockan.", "DivineList", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (StationWindow window = new StationWindow(args))
            {
                Application.Run(window);
                return window.ExitCode;
            }
        }
    }
}

internal sealed class StationWindow : Form
{
    private readonly string packageRoot = AppDomain.CurrentDomain.BaseDirectory;
    private readonly string logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DivineList", "logs");
    private readonly object logLock = new object();
    private readonly string token = Guid.NewGuid().ToString("N");
    private readonly ManualResetEvent ready = new ManualResetEvent(false);
    private readonly Label label = new Label();
    private readonly NotifyIcon tray = new NotifyIcon();
    private readonly string[] arguments;
    private Process child;
    private StreamWriter log;
    private string latestError = "";
    private bool quitting;
    private bool started;
    private bool stopping;
    private int port = 8790;
    private bool verifying;
    internal int ExitCode { get; private set; }

    internal StationWindow(string[] args)
    {
        arguments = args;
        verifying = Array.IndexOf(args, "--verify-package") >= 0;
        Text = "DivineList · Agentstation";
        ClientSize = new Size(440, 128);
        BackColor = Color.FromArgb(17, 34, 40);
        ForeColor = Color.FromArgb(224, 235, 221);
        Font = new Font("Segoe UI", 10);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        label.Text = "Startar ditt skepp…\nKontrollerar programfiler och den lokala stationen.";
        label.Location = new Point(26, 26);
        label.Size = new Size(390, 75);
        Controls.Add(label);
        Icon = CreateShipIcon();
        tray.Icon = Icon;
        tray.Text = "DivineList · Lokal agentstation";
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("Öppna DivineList", null, delegate { OpenBrowser(); });
        menu.Items.Add("Visa loggmapp", null, delegate { OpenPath(logDirectory); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Avsluta stationen", null, delegate { Quit(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenBrowser(); };
        Shown += delegate { if (verifying) Hide(); ThreadPool.QueueUserWorkItem(delegate { StartStation(); }); };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!quitting) { e.Cancel = true; Quit(); } };
        FormClosed += delegate
        {
            tray.Dispose();
            lock (logLock) { if (log != null) { log.Dispose(); log = null; } }
            ready.Dispose();
            if (child != null) child.Dispose();
        };
    }

    private static Icon CreateShipIcon()
    {
        using (Bitmap bitmap = new Bitmap(32, 32))
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.FromArgb(17, 34, 40));
            using (Brush hull = new SolidBrush(Color.FromArgb(180, 209, 180)))
            using (Brush glass = new SolidBrush(Color.FromArgb(68, 157, 151)))
            using (Brush flame = new SolidBrush(Color.FromArgb(255, 169, 73)))
            {
                graphics.FillRectangle(hull, 8, 8, 18, 16);
                graphics.FillRectangle(hull, 26, 12, 4, 8);
                graphics.FillRectangle(glass, 20, 12, 6, 8);
                graphics.FillRectangle(glass, 12, 10, 4, 12);
                graphics.FillRectangle(flame, 2, 10, 6, 4);
                graphics.FillRectangle(flame, 0, 18, 8, 4);
            }
            IntPtr handle = bitmap.GetHicon();
            try { return (Icon)Icon.FromHandle(handle).Clone(); }
            finally { DestroyIcon(handle); }
        }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr handle);

    private void WriteLog(string line)
    {
        lock (logLock)
        {
            if (log != null) { log.WriteLine(DateTime.Now.ToString("s") + " " + line); log.Flush(); }
        }
    }

    private static string HashFile(string path)
    {
        using (SHA256 hash = SHA256.Create())
        using (FileStream stream = File.OpenRead(path)) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }

    private void VerifyPackage()
    {
        string manifestPath = Path.Combine(packageRoot, "package-manifest.json");
        if (!File.Exists(manifestPath)) throw new InvalidOperationException("Paketets filförteckning saknas. Packa upp hela ZIP-filen innan du startar DivineList.");
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        Dictionary<string, object> manifest = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(manifestPath, Encoding.UTF8));
        if (Convert.ToInt32(manifest["version"]) != 1) throw new InvalidOperationException("Paketversionen stöds inte.");
        HashSet<string> paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Dictionary<string, object> item in (ArrayList)manifest["files"])
        {
            string name = (string)item["path"];
            if (String.IsNullOrWhiteSpace(name) || !System.Text.RegularExpressions.Regex.IsMatch(name, @"^[A-Za-z0-9_./-]+$") || !paths.Add(name)) throw new InvalidOperationException("Paketet innehåller en otillåten sökväg.");
            string cursor = packageRoot;
            foreach (string part in name.Split('/'))
            {
                if (part.Length == 0 || part == "." || part == "..") throw new InvalidOperationException("Paketet innehåller en otillåten sökväg.");
                cursor = Path.Combine(cursor, part);
                if ((File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Paketresurser får inte vara länkar.");
            }
            if (!File.Exists(cursor) || new FileInfo(cursor).Length != Convert.ToInt64(item["bytes"]) || HashFile(cursor) != (string)item["sha256"]) throw new InvalidOperationException("Programfilen " + name + " har ändrats. Packa upp ZIP-filen igen.");
        }
        foreach (string required in new[] { "DivineList.exe", "node.exe", "station-server.mjs", "dist/station/manifest.json", "dist/station/index.html", "dist/station/assets/station.js", "dist/station/assets/station.css" })
            if (!paths.Contains(required)) throw new InvalidOperationException("Paketet saknar " + required + ".");
    }

    private void StartStation()
    {
        try
        {
            string dataDir = null;
            for (int i = 0; i < arguments.Length; i += 2)
            {
                if (arguments[i] == "--verify-package") { i--; continue; }
                if (i + 1 >= arguments.Length) throw new InvalidOperationException("Ogiltiga startargument.");
                if (arguments[i] == "--port" && Int32.TryParse(arguments[i + 1], out port) && port > 0 && port <= 65535) continue;
                if (arguments[i] == "--data-dir" && Path.IsPathRooted(arguments[i + 1]) && !arguments[i + 1].StartsWith(@"\\") && !arguments[i + 1].Contains("\"")) { dataDir = Path.GetFullPath(arguments[i + 1]); continue; }
                throw new InvalidOperationException("Endast --port och --data-dir med lokala värden stöds.");
            }
            if (verifying && dataDir == null) throw new InvalidOperationException("Pakettest kräver en uttrycklig separat --data-dir.");
            Directory.CreateDirectory(logDirectory);
            log = new StreamWriter(Path.Combine(logDirectory, "station-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Process.GetCurrentProcess().Id + ".log"), false, new UTF8Encoding(false));
            VerifyPackage();
            if (quitting) return;
            ProcessStartInfo info = new ProcessStartInfo(Path.Combine(packageRoot, "node.exe"), "\"" + Path.Combine(packageRoot, "station-server.mjs") + "\" --port " + port + (dataDir == null ? "" : " --data-dir \"" + dataDir.TrimEnd('\\') + "\""));
            info.WorkingDirectory = packageRoot;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            info.EnvironmentVariables["DIVINELIST_LAUNCH_TOKEN"] = token;
            child = new Process();
            child.StartInfo = info;
            child.EnableRaisingEvents = true;
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                WriteLog(e.Data);
                if (e.Data == "DIVINELIST_READY:" + token + ":" + port) ready.Set();
            };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) { latestError = e.Data; WriteLog(e.Data); } };
            child.Exited += delegate
            {
                if (started && !quitting && !stopping) OnUi(delegate { ShowFailure("Stationen avslutades oväntat. " + latestError); });
            };
            child.Start();
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            DateTime deadline = DateTime.UtcNow.AddSeconds(40);
            while (!ready.WaitOne(100))
            {
                if (quitting) { StopChild(); return; }
                if (child.HasExited) { child.WaitForExit(); throw new InvalidOperationException(latestError.Length > 0 ? latestError : "Stationen kunde inte startas. Se loggmappen."); }
                if (DateTime.UtcNow > deadline) throw new InvalidOperationException("Stationen svarade inte inom 40 sekunder. Se loggmappen.");
            }
            if (quitting) { StopChild(); return; }
            started = true;
            if (verifying)
            {
                HttpWebRequest check = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/state");
                check.Timeout = 5000;
                check.Proxy = null;
                check.AllowAutoRedirect = false;
                string json;
                using (WebResponse response = check.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) json = reader.ReadToEnd();
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                Dictionary<string, object> state = serializer.Deserialize<Dictionary<string, object>>(json);
                if ((bool)state["running"] || ((ArrayList)state["companies"]).Count != 0) throw new InvalidOperationException("Pakettest kräver en tom, inaktiv arbetskopia.");
                StopChild();
                if (File.Exists(Path.Combine(dataDir, "process.lock"))) throw new InvalidOperationException("Pakettest: arbetskopians lås frigjordes inte.");
                File.WriteAllText(Path.Combine(dataDir, "launcher-verification.json"), serializer.Serialize(new { status = "PASS", launcher = Path.Combine(packageRoot, "DivineList.exe"), node = Path.Combine(packageRoot, "node.exe"), port = port, stationRunning = false, companies = 0, shutdown = "graceful" }), new UTF8Encoding(false));
                WriteLog("PACKAGE_LAUNCHER_TEST_PASS");
                OnUi(delegate { Quit(); });
                return;
            }
            TryStartOllama();
            OnUi(delegate { Hide(); tray.Visible = true; OpenBrowser(); });
        }
        catch (Exception error) { WriteLog(error.ToString()); StopChild(); OnUi(delegate { ShowFailure(error.Message); }); }
    }

    private void TryStartOllama()
    {
        try
        {
            HttpWebRequest probe = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:11434/api/version");
            probe.Timeout = 1000;
            probe.Proxy = null;
            probe.AllowAutoRedirect = false;
            using (WebResponse response = probe.GetResponse()) { WriteLog("Befintlig lokal Ollama används."); return; }
        }
        catch (WebException) { }
        string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DivineList");
        string executable = Path.Combine(directory, "ollama-0.33.3", "ollama.exe");
        if (!File.Exists(executable)) { WriteLog("Ollama saknas. Stationen visar installationsbehovet."); return; }
        try
        {
            ProcessStartInfo info = new ProcessStartInfo(executable, "serve");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WorkingDirectory = Path.GetDirectoryName(executable);
            info.EnvironmentVariables["OLLAMA_HOST"] = "127.0.0.1:11434";
            info.EnvironmentVariables["OLLAMA_NO_CLOUD"] = "1";
            info.EnvironmentVariables["OLLAMA_NUM_PARALLEL"] = "1";
            info.EnvironmentVariables["OLLAMA_MAX_LOADED_MODELS"] = "1";
            info.EnvironmentVariables["OLLAMA_CONTEXT_LENGTH"] = "4096";
            info.EnvironmentVariables["OLLAMA_MODELS"] = Path.Combine(directory, "models");
            using (Process engine = Process.Start(info)) WriteLog("Lokal Ollama-motor startad. Motorn har separat livslängd från stationen.");
        }
        catch (Exception error) { WriteLog("Ollama kunde inte startas: " + error.Message); }
    }

    private void OnUi(MethodInvoker action)
    {
        if (!IsDisposed && IsHandleCreated) { try { BeginInvoke(action); } catch (InvalidOperationException) { } }
    }

    private void OpenBrowser() { if (started && !quitting) OpenPath("http://127.0.0.1:" + port + "/"); }

    private void OpenPath(string path)
    {
        try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
        catch (Exception error) { MessageBox.Show("Kunde inte öppna " + path + "\n" + error.Message, "DivineList", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private void ShowFailure(string message)
    {
        if (quitting) return;
        ExitCode = 1;
        if (!verifying) MessageBox.Show(message + "\n\nLoggar: " + logDirectory, "DivineList kunde inte starta", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Quit();
    }

    private void StopChild()
    {
        Process process = child;
        if (process == null) return;
        stopping = true;
        try
        {
            if (process.HasExited) return;
            process.StandardInput.WriteLine("DIVINELIST_STOP");
            process.StandardInput.Flush();
            process.StandardInput.Close();
            if (!process.WaitForExit(20000)) { WriteLog("Det egna serverbarnet svarade inte på avslut. Avslutar endast denna process."); process.Kill(); process.WaitForExit(5000); }
            else process.WaitForExit();
        }
        catch (Exception error) { WriteLog("Avslutsinformation: " + error.Message); }
    }

    private void Quit()
    {
        if (quitting) return;
        quitting = true;
        tray.Visible = false;
        label.Text = "Avslutar stationen…\nSparar arbetskön innan programmet stängs.";
        if (!verifying) Show();
        ThreadPool.QueueUserWorkItem(delegate { StopChild(); OnUi(delegate { Close(); }); });
    }
}
