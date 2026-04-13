import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, setPersistence, browserSessionPersistence } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyD52mGoUynNXojxwK7s1WzUQOY8wznvewo",
  authDomain: "l3tt3r.firebaseapp.com",
  projectId: "l3tt3r",
  storageBucket: "l3tt3r.firebasestorage.app",
  messagingSenderId: "1029380131968",
  appId: "1:1029380131968:web:65fd7baf63801211a4ea65",
  measurementId: "G-CVD17H5V5W",
  databaseURL: "https://l3tt3r-default-rtdb.firebaseio.com"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Use SESSION persistence so each browser tab gets its own unique anonymous UID.
// Without this, two tabs in the same browser share the same user = both think they're player1.
const initAuth = () => setPersistence(auth, browserSessionPersistence).then(() => signInAnonymously(auth));

export { auth, db, initAuth };
