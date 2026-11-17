// Cloud layer: Firebase sign-in + Firestore storage.
// The config below is NOT secret. It only says which Firebase project to talk to.
// Your data is protected by the sign-in plus the database rules (only your user can read/write).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot, terminate, clearIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCldKHEi_zMsDWmgFxoZjf7h5K0NJkfPXg",
  authDomain: "checklist-app-2f190.firebaseapp.com",
  projectId: "checklist-app-2f190",
  storageBucket: "checklist-app-2f190.firebasestorage.app",
  messagingSenderId: "657743131344",
  appId: "1:657743131344:web:1212f22a711801f744e4d5",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Local cache so the app works offline; changes sync when you're back online.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const listsCol = uid => collection(db, "users", uid, "lists");

export function onUser(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signIn(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const messages = {
      "auth/invalid-credential": "Wrong email or password.",
      "auth/wrong-password": "Wrong email or password.",
      "auth/user-not-found": "Wrong email or password.",
      "auth/invalid-email": "That doesn't look like an email address.",
      "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
      "auth/network-request-failed": "No connection. Check your internet and try again.",
      "auth/user-disabled": "This account is disabled.",
    };
    throw new Error(messages[e.code] || "Couldn't sign in. Please try again.");
  }
}

// Start listening for changes to the user's lists. Returns a function that stops listening.
export function subscribe(uid, onChange, onError) {
  return onSnapshot(listsCol(uid), onChange, onError);
}

export function pushList(uid, list) {
  const { id, ...data } = list;
  return setDoc(doc(db, "users", uid, "lists", id), data);
}

export function removeList(uid, id) {
  return deleteDoc(doc(db, "users", uid, "lists", id));
}

// Sign out and erase the offline copy of the data from this device.
export async function signOutAndClear() {
  await signOut(auth);
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (e) { console.warn("Could not clear offline cache", e); }
}
