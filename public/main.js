// The page's entry point. app.js and the feature modules (features/*.js) import each other, so the app is loaded
// through this file: the build-id query string the server adds here (main.js?v=…) then never gives app.js a second
// copy under another URL.
import './app.js';
