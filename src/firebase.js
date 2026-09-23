import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

// These values come straight from Firebase console -> Project settings ->
// General -> Your apps -> SDK setup and configuration. A Firebase Web
// apiKey is NOT a secret (Google's own docs say so) -- it just identifies
// which Firebase project to talk to. Real protection comes from
// Authentication + the Realtime Database security rules (database.rules.json),
// not from hiding this value. So it's fine, and much simpler, to keep it
// directly in source instead of routing it through GitHub Actions secrets.
const firebaseConfig = {
  apiKey: 'AIzaSyDt8nKhc-nE2DjapBxWvan1eYNZpaiRPV4',
  authDomain: 'schoolchatapp-2cc47.firebaseapp.com',
  databaseURL: 'https://schoolchatapp-2cc47-default-rtdb.firebaseio.com',
  projectId: 'schoolchatapp-2cc47',
  storageBucket: 'schoolchatapp-2cc47.firebasestorage.app',
  messagingSenderId: '446661026439',
  appId: '1:446661026439:web:381e04d2a8da162f5dce22'
};

// firebase.js must never throw at import time -- if it does, the whole app
// fails before React even mounts and the WebView just shows a permanent
// blank/white screen with no error visible anywhere. So: catch everything
// here and let App.jsx show a real, readable message instead.
export let auth = null;
export let db = null;
export let firebaseInitError = null;

try {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
} catch (e) {
  firebaseInitError = 'Firebase शुरू नहीं हो पाया: ' + (e?.message || String(e));
}
