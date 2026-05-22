const e = require('electron');
console.log('keys:', Object.keys(e).slice(0, 10));
console.log('app:', typeof e.app);
console.log('default:', typeof e.default);
console.log('typeof e:', typeof e);
if (typeof e === 'string') console.log('e is path:', e);
