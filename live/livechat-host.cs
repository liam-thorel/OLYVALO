// Fenêtre d'affichage du livechat OLYCITY.
//
// Compilée sur le poste par le csc.exe du .NET Framework 4 livré avec Windows
// (voir livechat.js) : pas de binaire à distribuer, pas de dépendance. D'où le
// C# 5 : pas d'interpolation de chaînes ni d'opérateur ?.
//
// Pilotée par OLYCITY Live via stdin/stdout, une commande JSON par ligne :
//   → {"cmd":"show", ...}   ← {"evt":"shown"|"done"|"error", "id":...}
//   → {"cmd":"skip"} / {"cmd":"quit"}
// La fin de stdin (Live arrêté) ferme la fenêtre : jamais de processus orphelin.
//
// La fenêtre ne couvre que la zone du média (une fenêtre transparente plein
// écran coûterait une recomposition complète à chaque image de vidéo), ne
// prend jamais le focus et laisse passer les clics : le jeu reste jouable.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using Path = System.Windows.Shapes.Path;
using System.Windows.Threading;

namespace OlyLiveChat
{
    public static class Program
    {
        static readonly object OutLock = new object();
        static StreamWriter stdout;
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        public static void Emit(string evt, string id, string detail)
        {
            var payload = new Dictionary<string, object>();
            payload["evt"] = evt;
            if (id != null) payload["id"] = id;
            if (detail != null) payload["detail"] = detail;
            lock (OutLock)
            {
                try { stdout.WriteLine(Json.Serialize(payload)); } catch (Exception) { }
            }
        }

        [STAThread]
        public static void Main()
        {
            stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;

            var app = new Application();
            app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
            var overlay = new Overlay();
            new WindowInteropHelper(overlay).EnsureHandle();

            var reader = new Thread(delegate ()
            {
                var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
                string line;
                while ((line = stdin.ReadLine()) != null)
                {
                    var current = line;
                    app.Dispatcher.BeginInvoke(new Action(delegate { overlay.Handle(current); }));
                }
                app.Dispatcher.BeginInvoke(new Action(delegate { app.Shutdown(); }));
            });
            reader.IsBackground = true;
            reader.Start();

            Emit("ready", null, null);
            app.Run();
        }
    }

    // Élément préparé hors du thread d'affichage : image décodée, ou images
    // d'un GIF avec leurs délais.
    class Prepared
    {
        public BitmapSource Still;
        public List<BitmapSource> Frames;
        public List<int> Delays;
        public BitmapSource Avatar;
        public double NaturalWidth;
        public double NaturalHeight;
    }

    class Item
    {
        public string Id;
        public string Kind;
        public string Path;
        public string Text;
        public string TextPos;
        public string FromName;
        public string AvatarPath;
        public double Cx, Cy, W, H;
        public int DurationMs;
        public int MaxVideoMs;
        public bool Loop;
        public int StartMs;
        public int EndMs;
        public double Volume;
        // Touche « passer » choisie dans LIVECHAT.bat (0 : aucune).
        public int SkipVk;
        public bool SkipCtrl, SkipShift, SkipAlt, SkipWin;
    }

    class Overlay : Window
    {
        const int GWL_EXSTYLE = -20;
        const int WS_EX_TRANSPARENT = 0x20;
        const int WS_EX_TOOLWINDOW = 0x80;
        const int WS_EX_LAYERED = 0x80000;
        const int WS_EX_NOACTIVATE = 0x8000000;
        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;

        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hWnd, int nIndex, int value);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);

        readonly Canvas root = new Canvas();
        readonly DispatcherTimer endTimer = new DispatcherTimer();
        readonly DispatcherTimer frameTimer = new DispatcherTimer();
        // Pendant l'affichage : raccourci « passer » (Ctrl+Maj+F9 par défaut) et retour
        // au premier plan si le jeu est repassé devant. Lecture de l'état des
        // touches plutôt que RegisterHotKey, que LoL bloque quand il a le focus.
        readonly DispatcherTimer watchTimer = new DispatcherTimer();
        IntPtr hwnd;
        Item current;
        MediaPlayer player;
        List<BitmapSource> frames;
        List<int> delays;
        int frameIndex;
        Image frameTarget;
        bool closing;
        bool skipHeld;
        int watchTicks;

        public Overlay()
        {
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Topmost = true;
            ShowInTaskbar = false;
            ShowActivated = false;
            Focusable = false;
            IsHitTestVisible = false;
            ResizeMode = ResizeMode.NoResize;
            Title = "OLYCITY Livechat";
            Content = root;

            SourceInitialized += delegate
            {
                hwnd = new WindowInteropHelper(this).Handle;
                int style = GetWindowLong(hwnd, GWL_EXSTYLE);
                SetWindowLong(hwnd, GWL_EXSTYLE, style | WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
            };

            endTimer.Tick += delegate { endTimer.Stop(); Finish("end"); };
            frameTimer.Tick += delegate { NextFrame(); };
            watchTimer.Interval = TimeSpan.FromMilliseconds(50);
            watchTimer.Tick += delegate { Watch(); };
        }

        // ─── Commandes ──────────────────────────────────────────────────────

        public void Handle(string line)
        {
            Dictionary<string, object> cmd;
            try { cmd = new JavaScriptSerializer().DeserializeObject(line) as Dictionary<string, object>; }
            catch (Exception) { return; }
            if (cmd == null) return;
            string name = Str(cmd, "cmd");
            if (name == "quit") { Application.Current.Shutdown(); return; }
            if (name == "skip") { if (current != null) Finish("skip"); return; }
            if (name != "show") return;

            var item = new Item();
            item.Id = Str(cmd, "id");
            item.Kind = Str(cmd, "kind");
            item.Path = Str(cmd, "path");
            item.Text = Str(cmd, "text");
            item.TextPos = Str(cmd, "textPos");
            item.FromName = Str(cmd, "fromName");
            item.AvatarPath = Str(cmd, "avatarPath");
            item.Cx = Num(cmd, "cx", 0.5);
            item.Cy = Num(cmd, "cy", 0.45);
            item.W = Num(cmd, "w", 0.46);
            item.H = Num(cmd, "h", 0.52);
            item.DurationMs = (int)Num(cmd, "durationMs", 7000);
            item.MaxVideoMs = (int)Num(cmd, "maxVideoMs", 30000);
            item.Loop = Num(cmd, "loop", 0) > 0;
            item.StartMs = Math.Max(0, (int)Num(cmd, "startMs", 0));
            item.EndMs = Math.Max(0, (int)Num(cmd, "endMs", 0));
            item.Volume = Num(cmd, "volume", 0.6);
            item.SkipVk = (int)Num(cmd, "skipVk", 0x78);
            item.SkipCtrl = Num(cmd, "skipCtrl", 1) > 0;
            item.SkipShift = Num(cmd, "skipShift", 1) > 0;
            item.SkipAlt = Num(cmd, "skipAlt", 0) > 0;
            item.SkipWin = Num(cmd, "skipWin", 0) > 0;

            if (current != null) Finish("replaced");
            current = item;
            if (item.Kind == "video") OpenVideo(item);
            else ThreadPool.QueueUserWorkItem(delegate { PrepareOffThread(item); });
        }

        static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            return d.TryGetValue(key, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : "";
        }

        static double Num(Dictionary<string, object> d, string key, double fallback)
        {
            object v;
            if (!d.TryGetValue(key, out v) || v == null) return fallback;
            if (v is bool) return (bool)v ? 1 : 0;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch (Exception) { return fallback; }
        }

        // ─── Préparation ────────────────────────────────────────────────────

        void PrepareOffThread(Item item)
        {
            try
            {
                var prepared = new Prepared();
                if (item.Kind == "gif") DecodeGif(item.Path, prepared);
                else if (item.Kind == "image")
                {
                    prepared.Still = LoadBitmap(item.Path, 1920);
                    prepared.NaturalWidth = prepared.Still.PixelWidth;
                    prepared.NaturalHeight = prepared.Still.PixelHeight;
                }
                prepared.Avatar = TryLoadBitmap(item.AvatarPath, 128);
                Dispatcher.BeginInvoke(new Action(delegate { Present(item, prepared, null); }));
            }
            catch (Exception error)
            {
                Dispatcher.BeginInvoke(new Action(delegate { Fail(item, error.Message); }));
            }
        }

        static BitmapSource LoadBitmap(string path, int maxWidth)
        {
            var probe = BitmapFrame.Create(new Uri(path), BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
            var image = new BitmapImage();
            image.BeginInit();
            image.UriSource = new Uri(path);
            image.CacheOption = BitmapCacheOption.OnLoad;
            if (probe.PixelWidth > maxWidth) image.DecodePixelWidth = maxWidth;
            image.EndInit();
            image.Freeze();
            return image;
        }

        static BitmapSource TryLoadBitmap(string path, int maxWidth)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
            try { return LoadBitmap(path, maxWidth); } catch (Exception) { return null; }
        }

        // GDI+ recompose correctement les images partielles d'un GIF, ce que
        // le décodeur WPF ne fait pas. Les images sont réduites à la taille
        // d'affichage maximale et leur nombre plafonné : un GIF de 20 Mo ne
        // doit pas consommer un gigaoctet de mémoire.
        static void DecodeGif(string path, Prepared prepared)
        {
            using (var gif = System.Drawing.Image.FromFile(path))
            {
                var dimension = new System.Drawing.Imaging.FrameDimension(gif.FrameDimensionsList[0]);
                int count = Math.Min(gif.GetFrameCount(dimension), 400);
                int width = Math.Min(gif.Width, 900);
                int height = Math.Max(1, (int)Math.Round(gif.Height * (double)width / gif.Width));
                long budget = 600L * 1024 * 1024;
                while ((long)width * height * 4 * count > budget && width > 160)
                {
                    width = (int)(width * 0.8);
                    height = Math.Max(1, (int)Math.Round(gif.Height * (double)width / gif.Width));
                }

                byte[] delayBytes = null;
                foreach (var property in gif.PropertyItems)
                    if (property.Id == 0x5100) delayBytes = property.Value;

                prepared.Frames = new List<BitmapSource>();
                prepared.Delays = new List<int>();
                for (int i = 0; i < count; i++)
                {
                    gif.SelectActiveFrame(dimension, i);
                    using (var bitmap = new System.Drawing.Bitmap(width, height, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
                    {
                        using (var g = System.Drawing.Graphics.FromImage(bitmap))
                        {
                            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
                            g.DrawImage(gif, 0, 0, width, height);
                        }
                        var rect = new System.Drawing.Rectangle(0, 0, width, height);
                        var data = bitmap.LockBits(rect, System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                        try
                        {
                            var source = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgra32, null, data.Scan0, data.Stride * height, data.Stride);
                            source.Freeze();
                            prepared.Frames.Add(source);
                        }
                        finally { bitmap.UnlockBits(data); }
                    }
                    int delay = 100;
                    if (delayBytes != null && delayBytes.Length >= (i + 1) * 4)
                        delay = BitConverter.ToInt32(delayBytes, i * 4) * 10;
                    // Comme les navigateurs : un délai nul ou quasi nul vaut 100 ms.
                    prepared.Delays.Add(delay <= 10 ? 100 : delay);
                }
                prepared.NaturalWidth = gif.Width;
                prepared.NaturalHeight = gif.Height;
            }
        }

        void OpenVideo(Item item)
        {
            var media = new MediaPlayer();
            player = media;
            bool opened = false;
            media.Volume = Math.Max(0, Math.Min(1, item.Volume));
            media.MediaOpened += delegate
            {
                if (current != item || opened) return;
                opened = true;
                var prepared = new Prepared();
                prepared.NaturalWidth = Math.Max(1, media.NaturalVideoWidth);
                prepared.NaturalHeight = Math.Max(1, media.NaturalVideoHeight);
                prepared.Avatar = TryLoadBitmap(item.AvatarPath, 128);
                Present(item, prepared, media);
            };
            media.MediaFailed += delegate (object sender, ExceptionEventArgs e)
            {
                if (current == item) Fail(item, "Vidéo illisible : " + e.ErrorException.Message);
            };
            media.MediaEnded += delegate
            {
                if (current != item) return;
                if (item.Loop) { media.Position = TimeSpan.FromMilliseconds(item.StartMs); media.Play(); }
                else Finish("end");
            };
            media.Open(new Uri(item.Path));
            // MediaPlayer ne charge la vidéo qu'une fois la lecture demandée ;
            // le volume reste à zéro tant qu'elle n'est pas affichée.
            media.IsMuted = true;
            media.Play();

            var timeout = new DispatcherTimer();
            // Une vidéo lue en continu depuis Internet (lien YouTube) met plus
            // de temps à démarrer qu'un fichier déjà téléchargé.
            timeout.Interval = TimeSpan.FromSeconds(item.Path.StartsWith("http") ? 25 : 10);
            timeout.Tick += delegate
            {
                timeout.Stop();
                if (current == item && !opened) Fail(item, "Vidéo trop longue à ouvrir");
            };
            timeout.Start();
        }

        // ─── Affichage ──────────────────────────────────────────────────────

        void Present(Item item, Prepared prepared, MediaPlayer media)
        {
            if (current != item) return;
            root.Children.Clear();

            double screenW = SystemParameters.PrimaryScreenWidth;
            double screenH = SystemParameters.PrimaryScreenHeight;
            double boxW = item.W * screenW, boxH = item.H * screenH;
            double cx = item.Cx * screenW, cy = item.Cy * screenH;
            bool hasMedia = prepared.NaturalWidth > 0 && prepared.NaturalHeight > 0;

            Rect mediaRect;
            if (hasMedia)
            {
                double ratio = prepared.NaturalWidth / prepared.NaturalHeight;
                double w = Math.Min(boxW, boxH * ratio);
                double h = w / ratio;
                mediaRect = new Rect(cx - w / 2, cy - h / 2, w, h);
            }
            else mediaRect = new Rect(cx - boxW / 2, cy, boxW, 0);

            double fontSize = hasMedia
                ? Clamp(mediaRect.Width * 0.072, 20, screenH * 0.06)
                : Clamp(boxW * 0.085, 26, screenH * 0.075);
            double pixelsPerDip = VisualTreeHelper.GetDpi(this).PixelsPerDip;

            // Le contenu est d'abord placé en coordonnées écran, puis la
            // fenêtre est ajustée à son encombrement.
            var parts = new List<KeyValuePair<UIElement, Rect>>();

            if (hasMedia)
            {
                var image = new Image();
                image.Stretch = Stretch.Fill;
                image.Width = mediaRect.Width;
                image.Height = mediaRect.Height;
                double radius = Math.Max(8, mediaRect.Width * 0.018);
                image.Clip = new RectangleGeometry(new Rect(0, 0, mediaRect.Width, mediaRect.Height), radius, radius);
                RenderOptions.SetBitmapScalingMode(image, BitmapScalingMode.HighQuality);
                if (media != null)
                {
                    var drawing = new VideoDrawing();
                    drawing.Player = media;
                    drawing.Rect = new Rect(0, 0, prepared.NaturalWidth, prepared.NaturalHeight);
                    image.Source = new DrawingImage(drawing);
                }
                else if (prepared.Frames != null && prepared.Frames.Count > 0)
                {
                    image.Source = prepared.Frames[0];
                    frames = prepared.Frames;
                    delays = prepared.Delays;
                    frameIndex = 0;
                    frameTarget = image;
                }
                else image.Source = prepared.Still;
                parts.Add(new KeyValuePair<UIElement, Rect>(image, mediaRect));
            }

            if (!string.IsNullOrEmpty(item.Text))
            {
                double maxWidth = hasMedia ? Math.Max(mediaRect.Width * 1.08, screenW * 0.18) : boxW;
                var caption = OutlinedText(item.Text, fontSize, maxWidth, pixelsPerDip, TextAlignment.Center);
                double top;
                if (!hasMedia) top = cy - caption.Height / 2;
                else if (item.TextPos == "haut") top = mediaRect.Top - caption.Height * 0.4;
                else top = mediaRect.Bottom - caption.Height * 0.62;
                parts.Add(new KeyValuePair<UIElement, Rect>(caption, new Rect(cx - maxWidth / 2, top, maxWidth, caption.Height)));
            }

            if (!string.IsNullOrEmpty(item.FromName))
            {
                double tagSize = Clamp(fontSize * 0.95, 26, 58);
                var tag = NameTag(item.FromName, prepared.Avatar, tagSize, pixelsPerDip);
                tag.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                double anchorTop = hasMedia ? mediaRect.Top : (parts.Count > 0 ? parts[0].Value.Top : cy);
                double left = hasMedia ? mediaRect.Left - tagSize * 0.2 : cx - tag.DesiredSize.Width / 2;
                // Un média collé au bord de l'écran ne doit pas faire sortir le nom.
                double tagTop = Math.Max(4, anchorTop - tagSize * (hasMedia ? 0.55 : 1.5));
                left = Math.Max(4, Math.Min(left, screenW - tag.DesiredSize.Width - 4));
                parts.Add(new KeyValuePair<UIElement, Rect>(tag, new Rect(left, tagTop, tag.DesiredSize.Width, tag.DesiredSize.Height)));
            }

            if (parts.Count == 0) { Fail(item, "Rien à afficher"); return; }

            Rect bounds = parts[0].Value;
            foreach (var part in parts) bounds.Union(part.Value);
            bounds.Inflate(12, 12);
            bounds.Intersect(new Rect(0, 0, screenW, screenH));
            if (bounds.IsEmpty) { Fail(item, "Hors de l'écran"); return; }

            foreach (var part in parts)
            {
                Canvas.SetLeft(part.Key, part.Value.Left - bounds.Left);
                Canvas.SetTop(part.Key, part.Value.Top - bounds.Top);
                root.Children.Add(part.Key);
            }

            Left = bounds.Left;
            Top = bounds.Top;
            Width = bounds.Width;
            Height = bounds.Height;

            root.Opacity = 0;
            var scale = new ScaleTransform(0.94, 0.94, bounds.Width / 2, bounds.Height / 2);
            root.RenderTransform = scale;
            Show();
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);

            var ease = new CubicEase();
            ease.EasingMode = EasingMode.EaseOut;
            var fade = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(180));
            var grow = new DoubleAnimation(0.94, 1, TimeSpan.FromMilliseconds(260));
            grow.EasingFunction = ease;
            root.BeginAnimation(OpacityProperty, fade);
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, grow);
            scale.BeginAnimation(ScaleTransform.ScaleYProperty, grow);

            int duration = item.DurationMs;
            if (media != null)
            {
                media.IsMuted = item.Volume <= 0;
                // Extrait choisi sur le site : on part de son début et on
                // s'arrête à sa fin, dans la limite de durée du poste.
                media.Position = TimeSpan.FromMilliseconds(item.StartMs);
                if (!item.Loop)
                {
                    duration = item.MaxVideoMs;
                    if (item.EndMs > item.StartMs)
                        duration = Math.Min(duration, item.EndMs - item.StartMs);
                    else if (media.NaturalDuration.HasTimeSpan)
                        duration = (int)Math.Min(duration, media.NaturalDuration.TimeSpan.TotalMilliseconds - item.StartMs + 300);
                }
            }
            else if (frames != null)
            {
                // Un GIF plus long que la durée prévue est montré en entier
                // (dans une limite raisonnable) plutôt que coupé au milieu.
                int loop = 0;
                foreach (var d in delays) loop += d;
                if (loop > duration) duration = Math.Min(loop, 20000);
                frameTimer.Interval = TimeSpan.FromMilliseconds(delays[0]);
                frameTimer.Start();
            }

            endTimer.Interval = TimeSpan.FromMilliseconds(Math.Max(1500, duration));
            endTimer.Start();
            skipHeld = KeysDown();
            watchTicks = 0;
            watchTimer.Start();
            Program.Emit("shown", item.Id, null);
        }

        void NextFrame()
        {
            if (frames == null || frameTarget == null) { frameTimer.Stop(); return; }
            frameIndex = (frameIndex + 1) % frames.Count;
            frameTarget.Source = frames[frameIndex];
            frameTimer.Interval = TimeSpan.FromMilliseconds(delays[frameIndex]);
        }

        static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

        // Modificateurs exacts : « F9 » seul ne se déclenche pas sur Ctrl+F9.
        bool KeysDown()
        {
            var item = current;
            if (item == null || item.SkipVk <= 0) return false;
            return Down(item.SkipVk)
                && Down(0x11) == item.SkipCtrl
                && Down(0x10) == item.SkipShift
                && Down(0x12) == item.SkipAlt
                && (Down(0x5B) || Down(0x5C)) == item.SkipWin;
        }

        void Watch()
        {
            if (current == null) { watchTimer.Stop(); return; }
            bool down = KeysDown();
            if (down && !skipHeld) { skipHeld = true; Finish("skip"); return; }
            skipHeld = down;
            if (++watchTicks % 20 == 0)
                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        void Fail(Item item, string message)
        {
            if (current != item) return;
            Program.Emit("error", item.Id, message);
            Finish("error");
        }

        void Finish(string reason)
        {
            var item = current;
            if (item == null || closing) return;
            closing = true;
            endTimer.Stop();
            watchTimer.Stop();
            var media = player;
            player = null;

            Action cleanup = delegate
            {
                frameTimer.Stop();
                frames = null;
                delays = null;
                frameTarget = null;
                if (media != null) { media.Stop(); media.Close(); }
                root.BeginAnimation(OpacityProperty, null);
                root.Children.Clear();
                Hide();
                closing = false;
                if (current == item) current = null;
                if (reason != "error") Program.Emit("done", item.Id, reason);
                else Program.Emit("done", item.Id, "error");
            };

            if (!IsVisible) { cleanup(); return; }
            var fade = new DoubleAnimation(root.Opacity, 0, TimeSpan.FromMilliseconds(reason == "skip" ? 90 : 220));
            fade.Completed += delegate { cleanup(); };
            if (media != null) media.Volume = 0;
            root.BeginAnimation(OpacityProperty, fade);
        }

        // ─── Éléments graphiques ────────────────────────────────────────────

        // Texte blanc cerné de noir, lisible sur n'importe quelle image : le
        // contour est un trait épais tracé SOUS le remplissage.
        static FrameworkElement OutlinedText(string text, double size, double maxWidth, double pixelsPerDip, TextAlignment alignment)
        {
            var typeface = new Typeface(new FontFamily("Arial Black, Segoe UI Black, Segoe UI Emoji"), FontStyles.Normal, FontWeights.Black, FontStretches.Normal);
            var formatted = new FormattedText(text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, typeface, size, Brushes.White, pixelsPerDip);
            formatted.MaxTextWidth = maxWidth;
            formatted.TextAlignment = alignment;
            formatted.MaxLineCount = 4;
            formatted.Trimming = TextTrimming.CharacterEllipsis;
            var geometry = formatted.BuildGeometry(new Point(0, 0));
            geometry.Freeze();

            var stroke = new Path();
            stroke.Data = geometry;
            stroke.Stroke = Brushes.Black;
            stroke.StrokeThickness = Math.Max(3, size * 0.17);
            stroke.StrokeLineJoin = PenLineJoin.Round;
            var fill = new Path();
            fill.Data = geometry;
            fill.Fill = Brushes.White;

            var canvas = new Canvas();
            canvas.Width = maxWidth;
            canvas.Height = formatted.Height + size * 0.2;
            canvas.Children.Add(stroke);
            canvas.Children.Add(fill);
            return canvas;
        }

        static FrameworkElement NameTag(string name, BitmapSource avatar, double size, double pixelsPerDip)
        {
            var panel = new StackPanel();
            panel.Orientation = Orientation.Horizontal;

            var ring = new Ellipse();
            ring.Width = size;
            ring.Height = size;
            ring.Stroke = new SolidColorBrush(Color.FromRgb(0xff, 0x46, 0x56));
            ring.StrokeThickness = Math.Max(2, size * 0.09);
            if (avatar != null)
            {
                var brush = new ImageBrush(avatar);
                brush.Stretch = Stretch.UniformToFill;
                ring.Fill = brush;
            }
            else ring.Fill = new SolidColorBrush(Color.FromRgb(0x1b, 0x1f, 0x2a));
            ring.VerticalAlignment = VerticalAlignment.Center;
            panel.Children.Add(ring);

            var label = OutlinedText(name.ToUpperInvariant(), size * 0.62, 900, pixelsPerDip, TextAlignment.Left);
            var typeface = new Typeface(new FontFamily("Arial Black, Segoe UI Black"), FontStyles.Normal, FontWeights.Black, FontStretches.Normal);
            var measured = new FormattedText(name.ToUpperInvariant(), CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, typeface, size * 0.62, Brushes.White, pixelsPerDip);
            label.Width = measured.WidthIncludingTrailingWhitespace + size * 0.2;
            label.Margin = new Thickness(size * 0.18, 0, 0, 0);
            label.VerticalAlignment = VerticalAlignment.Center;
            panel.Children.Add(label);
            return panel;
        }

        static double Clamp(double value, double min, double max)
        {
            return Math.Max(min, Math.Min(max, value));
        }
    }
}
