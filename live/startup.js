const fs = require('fs');
const path = require('path');

const STARTUP_FILENAME = 'OLYCITY-Live.vbs';

function startupLauncherPath(appData = process.env.APPDATA) {
  if (!appData) return '';
  return path.join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    STARTUP_FILENAME,
  );
}

function startupLauncherContents(installDir) {
  const silentPath = path.join(installDir, 'silent.vbs').replace(/"/g, '""');
  return [
    'Dim WshShell',
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.Run "wscript.exe ""${silentPath}""", 0, False`,
    '',
  ].join('\r\n');
}

function ensureStartupLauncher(installDir = __dirname, appData = process.env.APPDATA) {
  if (process.platform !== 'win32' || !appData) return { installed: false, changed: false, path: '' };
  const launcherPath = startupLauncherPath(appData);
  const contents = startupLauncherContents(path.resolve(installDir));
  fs.mkdirSync(path.dirname(launcherPath), { recursive: true });

  const current = fs.existsSync(launcherPath) ? fs.readFileSync(launcherPath, 'utf8') : '';
  if (current !== contents) fs.writeFileSync(launcherPath, contents, 'utf8');
  return { installed: true, changed: current !== contents, path: launcherPath };
}

function removeStartupLauncher(appData = process.env.APPDATA) {
  const launcherPath = startupLauncherPath(appData);
  if (!launcherPath || !fs.existsSync(launcherPath)) return false;
  fs.unlinkSync(launcherPath);
  return true;
}

if (require.main === module) {
  try {
    const action = process.argv[2] || 'install';
    if (action === 'remove') removeStartupLauncher();
    else ensureStartupLauncher(__dirname);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  STARTUP_FILENAME,
  ensureStartupLauncher,
  removeStartupLauncher,
  startupLauncherContents,
  startupLauncherPath,
};
