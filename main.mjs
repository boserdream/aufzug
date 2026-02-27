import { app, BrowserWindow, globalShortcut, shell } from "electron";

const DEFAULT_URL = "https://cineby.app";
const startUrl = process.env.CINEBY_URL || DEFAULT_URL;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    fullscreen: true,
    kiosk: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadURL(startUrl);

  // Open external links in the user's default browser if a new window is requested.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(() => {
  createWindow();

  globalShortcut.register("F11", () => {
    if (!mainWindow) return;
    mainWindow.setKiosk(!mainWindow.isKiosk());
  });
  globalShortcut.register("CommandOrControl+R", () => {
    if (!mainWindow) return;
    mainWindow.reload();
  });
  globalShortcut.register("CommandOrControl+Q", () => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
