// web/src/firebase.ts
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDi-PJVPSQN3Tt8fGl2vL9rjiIKYWheALE",
  authDomain: "capstone-fe988.firebaseapp.com",
  projectId: "capstone-fe988",
  storageBucket: "capstone-fe988.firebasestorage.app",
  messagingSenderId: "731882278333",
  appId: "1:731882278333:web:b615d79dee7307e284d6d4",
  measurementId: "G-T5CVC2V64J"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const firestore = getFirestore(app);
export const auth = getAuth(app);
export const analytics = getAnalytics(app);