import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDjh0GFcCwiPY5IYWhFUHYPFtZmTJd4Nd4",
    authDomain: "fysiosport-47b9a.firebaseapp.com",
    projectId: "fysiosport-47b9a",
    storageBucket: "fysiosport-47b9a.firebasestorage.app",
    messagingSenderId: "899044917630",
    appId: "1:899044917630:web:f3513c3c791fee1bf8f32f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };
