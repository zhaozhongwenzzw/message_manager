console.log('starting');
const { app, BrowserWindow } = require('electron');
console.log('typeof app:', typeof app);
console.log('typeof BrowserWindow:', typeof BrowserWindow);
if (app && app.whenReady) {
  app.whenReady().then(() => { console.log('ready'); app.quit(); });
} else {
  console.log('app destructure failed');
  process.exit(1);
}
