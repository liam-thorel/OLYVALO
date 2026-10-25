// Touches du livechat OLYCITY : couper/réactiver, et capture d'une touche.
//
// Compilé sur le poste comme livechat-host.cs (csc.exe du .NET Framework 4,
// C# 5). Aucune fenêtre : lecture de l'état des touches (GetAsyncKeyState)
// toutes les 40 ms. Pas de RegisterHotKey, que LoL bloque quand il a le
// focus ; pas de hook clavier non plus : on ne voit passer aucune frappe, on
// demande seulement si la combinaison choisie est enfoncée.
//
// Deux modes :
//   livechat-keys.exe          surveillance, pilotée par OLYCITY Live :
//     → {"cmd":"keys","toggle":{"vk":121,"ctrl":true,...}|null}
//     ← {"evt":"key","action":"toggle"}
//     La fin de stdin (Live arrêté) termine le programme.
//   livechat-keys.exe capture  attend qu'on appuie sur une touche (avec ou
//     sans Ctrl/Maj/Alt/Win), écrit {"vk":..,"ctrl":..,...} et s'arrête.
//     Échap seul annule ({"cancel":true}) ; rien au bout de 20 s : {"timeout":true}.

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace OlyLiveChatKeys
{
    class Combo
    {
        public int Vk;
        public bool Ctrl, Shift, Alt, Win;
    }

    public static class Program
    {
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);

        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        static readonly object Lock = new object();
        static Combo toggle;

        static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
        static bool CtrlDown() { return Down(0x11); }
        static bool ShiftDown() { return Down(0x10); }
        static bool AltDown() { return Down(0x12); }
        static bool WinDown() { return Down(0x5B) || Down(0x5C); }

        static bool IsModifier(int vk)
        {
            return vk == 0x10 || vk == 0x11 || vk == 0x12 || vk == 0x5B || vk == 0x5C || (vk >= 0xA0 && vk <= 0xA5);
        }

        // Modificateurs exacts : « F10 » seul ne se déclenche pas sur Ctrl+F10.
        static bool Pressed(Combo combo)
        {
            return combo != null && combo.Vk > 0 && Down(combo.Vk)
                && CtrlDown() == combo.Ctrl && ShiftDown() == combo.Shift
                && AltDown() == combo.Alt && WinDown() == combo.Win;
        }

        static Combo ParseCombo(object raw)
        {
            var d = raw as Dictionary<string, object>;
            if (d == null) return null;
            object vk;
            if (!d.TryGetValue("vk", out vk) || vk == null) return null;
            var combo = new Combo();
            try { combo.Vk = Convert.ToInt32(vk); } catch (Exception) { return null; }
            combo.Ctrl = Flag(d, "ctrl");
            combo.Shift = Flag(d, "shift");
            combo.Alt = Flag(d, "alt");
            combo.Win = Flag(d, "win");
            return combo.Vk > 0 && combo.Vk < 255 ? combo : null;
        }

        static bool Flag(Dictionary<string, object> d, string key)
        {
            object v;
            return d.TryGetValue(key, out v) && v is bool && (bool)v;
        }

        [STAThread]
        public static int Main(string[] args)
        {
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;
            if (args.Length > 0 && args[0] == "capture") return Capture(stdout);
            return Watch(stdout);
        }

        static int Watch(StreamWriter stdout)
        {
            var done = false;
            var reader = new Thread(delegate ()
            {
                var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
                string line;
                while ((line = stdin.ReadLine()) != null)
                {
                    Dictionary<string, object> cmd = null;
                    try { cmd = Json.DeserializeObject(line) as Dictionary<string, object>; } catch (Exception) { }
                    if (cmd == null) continue;
                    object name;
                    if (!cmd.TryGetValue("cmd", out name) || !"keys".Equals(name)) continue;
                    object raw;
                    cmd.TryGetValue("toggle", out raw);
                    lock (Lock) toggle = ParseCombo(raw);
                }
                done = true;
            });
            reader.IsBackground = true;
            reader.Start();

            bool held = true; // une combinaison déjà tenue au démarrage ne compte pas
            while (!done)
            {
                Combo combo;
                lock (Lock) combo = toggle;
                bool down = Pressed(combo);
                if (down && !held)
                {
                    try { stdout.WriteLine("{\"evt\":\"key\",\"action\":\"toggle\"}"); } catch (Exception) { return 0; }
                }
                held = down;
                Thread.Sleep(40);
            }
            return 0;
        }

        static int Capture(StreamWriter stdout)
        {
            // Attendre que tout soit relâché (la touche Entrée qui a lancé la
            // capture est peut-être encore enfoncée).
            var start = DateTime.UtcNow;
            while (AnyDown() && (DateTime.UtcNow - start).TotalSeconds < 3) Thread.Sleep(30);

            start = DateTime.UtcNow;
            while ((DateTime.UtcNow - start).TotalSeconds < 20)
            {
                for (int vk = 3; vk < 255; vk++)
                {
                    if (IsModifier(vk) || !Down(vk)) continue;
                    bool ctrl = CtrlDown(), shift = ShiftDown(), alt = AltDown(), win = WinDown();
                    if (vk == 0x1B && !ctrl && !shift && !alt && !win)
                    {
                        stdout.WriteLine("{\"cancel\":true}");
                        return 0;
                    }
                    while (Down(vk)) Thread.Sleep(20);
                    var result = new Dictionary<string, object>();
                    result["vk"] = vk;
                    result["ctrl"] = ctrl;
                    result["shift"] = shift;
                    result["alt"] = alt;
                    result["win"] = win;
                    stdout.WriteLine(Json.Serialize(result));
                    return 0;
                }
                Thread.Sleep(15);
            }
            stdout.WriteLine("{\"timeout\":true}");
            return 0;
        }

        // Clics gauche/droit exclus : on ne choisit pas une touche en cliquant.
        static bool AnyDown()
        {
            for (int vk = 3; vk < 255; vk++) if (Down(vk)) return true;
            return false;
        }
    }
}
