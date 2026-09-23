const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#1b1d23',
    autoHideMenuBar: true,
    webPreferences: {
      // Outil local de confiance, pas de contenu distant chargé : on simplifie en donnant au
      // renderer un accès direct à Node (fs, dgram) plutôt que de tout faire passer par IPC.
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src/renderer/index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Les boîtes de dialogue fichier ne sont accessibles que depuis le process principal.
ipcMain.handle('dialog:saveFile', async (_event, options) => {
  const result = await dialog.showSaveDialog(options);
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:openFile', async (_event, options) => {
  const result = await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});
