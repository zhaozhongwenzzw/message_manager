const e = require('electron');
console.log('typeof:', typeof e);
console.log('keys:', typeof e === 'object' ? Object.keys(e).slice(0, 5) : 'n/a');
if (e.app) {
  e.app.whenReady().then(() => { console.log('ready ok'); e.app.quit(); });
} else {
  process.exit(1);
}
