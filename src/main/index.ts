import { app, BrowserWindow, shell, nativeImage } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc';
import { ensureAppDirs, readConfig, writeConfig } from './store';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// App icon — try a few locations: in dev we read from source, in prod from resources.
// Windows taskbar prefers .ico; PNG works for the window title bar but may look blurry on the taskbar.
function resolveAppIcon(): Electron.NativeImage | undefined {
  const candidates = [
    join(__dirname, '../../src/assets/image/icon.ico'),
    join(__dirname, '../../src/assets/image/icon.png'),
    join(process.resourcesPath ?? '', 'app/src/assets/image/icon.ico'),
    join(process.resourcesPath ?? '', 'app/src/assets/image/icon.png'),
    join(process.cwd(), 'src/assets/image/icon.ico'),
    join(process.cwd(), 'src/assets/image/icon.png')
  ];
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        console.log('[app] using icon:', p);
        return img;
      }
    } catch {
      // try next
    }
  }
  console.warn('[app] no icon resolved from candidates:', candidates);
  return undefined;
}

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  const config = await readConfig();
  const bounds = config.windowBounds ?? { width: 1400, height: 900 };
  const appIcon = resolveAppIcon();

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Recall',
    icon: appIcon,
    backgroundColor:
      config.appearance === 'dark'
        ? '#0C0E13'
        : config.appearance === 'light'
        ? '#FAFAFB'
        : '#FAFAFB', // 'system' — renderer will swap immediately after load anyway
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    // Wire updater after window is shown so it can stream status events to renderer.
    // Skip in dev mode — autoUpdater needs a packaged build, and importing
    // electron-updater under Electron's Node ESM loader fails in dev.
    if (mainWindow && !process.env['ELECTRON_RENDERER_URL']) {
      void import('./updater').then(({ initUpdater }) => {
        if (mainWindow) initUpdater(mainWindow);
      });
    }
  });

  // Surface renderer console + load errors to main stdout so we can debug in dev.
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    const tag = ['VERB', 'INFO', 'WARN', 'ERR '][level] ?? '???';
    console.log(`[renderer ${tag}] ${message}  (${source}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] did-fail-load ${code} ${desc} ${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] render-process-gone', details);
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', async () => {
    if (!mainWindow) return;
    const b = mainWindow.getBounds();
    const cfg = await readConfig();
    await writeConfig({ ...cfg, windowBounds: b });
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  // On Windows, taskbar groups apps by AppUserModelID. Without this, dev mode
  // groups under electron.exe and uses its embedded icon. Setting our own ID
  // lets the window icon show in the taskbar correctly.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.recall.app');
  }
  await ensureAppDirs();
  registerIpc();
  const iconForDock = resolveAppIcon();
  if (process.platform === 'darwin' && iconForDock) app.dock?.setIcon(iconForDock);
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void import('./updater').then(({ disposeUpdater }) => disposeUpdater()).catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});
