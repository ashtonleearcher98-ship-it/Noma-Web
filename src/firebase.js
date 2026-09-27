import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyBOlICgtLy8m2qO66A_XnOCKIccPno08TI',
  authDomain: 'noma-f813b.firebaseapp.com',
  projectId: 'noma-f813b',
  storageBucket: 'noma-f813b.firebasestorage.app',
  messagingSenderId: '758845156561',
  appId: '1:758845156561:web:c35a2fc5e9096e8b4669f0',
};
export const callTokenUrl = 'https://mild-moose-1657.noma.deno.net/token';
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
