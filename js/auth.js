import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('submit-btn');
const toggleBtn = document.getElementById('toggle-btn');
const formTitle = document.getElementById('form-title');
const authMessage = document.getElementById('auth-message');
const toggleText = document.getElementById('toggle-text');

let isLoginMode = true;

// Only execute UI logic if on login.html
if (authForm) {
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value;
        const password = passwordInput.value;

        authMessage.textContent = 'Bearbetar...';
        authMessage.className = '';

        try {
            if (isLoginMode) {
                await signInWithEmailAndPassword(auth, email, password);
                // Redirect on success (onAuthStateChanged will handle it generally, but we can force it here for speed)
                window.location.href = 'dashboard.html';
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
                authMessage.textContent = 'Konto skapat! Loggar in...';
                authMessage.className = 'success-message';
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1000);
            }
        } catch (error) {
            console.error("Auth error:", error);
            let message = 'Ett fel uppstod.';
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                message = 'Fel e-post eller lösenord.';
            } else if (error.code === 'auth/email-already-in-use') {
                message = 'E-postadressen används redan.';
            } else if (error.code === 'auth/weak-password') {
                message = 'Lösenordet är för svagt (minst 6 tecken).';
            }
            authMessage.textContent = message;
            authMessage.className = 'error-message';
        }
    });

    toggleBtn.addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        if (isLoginMode) {
            formTitle.textContent = 'Logga in';
            submitBtn.textContent = 'Logga in';
            toggleText.textContent = 'Har du inget konto?';
            toggleBtn.textContent = 'Registrera dig';
        } else {
            formTitle.textContent = 'Skapa konto';
            submitBtn.textContent = 'Registrera';
            toggleText.textContent = 'Har du redan ett konto?';
            toggleBtn.textContent = 'Logga in';
        }
        authMessage.textContent = '';
    });
}

// Global Auth State Monitor
onAuthStateChanged(auth, (user) => {
    const path = window.location.pathname;
    const isLoginPage = path.includes('login.html') || path.endsWith('/login');

    if (user) {
        // User is signed in
        if (isLoginPage) {
            // Prevent auto-redirect loop. Only redirect if we just logged in (handled by form submit)
            // Or show a message "You are logged in".
            console.log("User already logged in. Navigate to index manually if needed or wait for manual redirect.");
            // Optional: Auto-redirect ONLY if not coming from index? Hard to know.
            // SAFEST: Let the user click or just rely on the form submit redirect?
            // Form submit does: window.location.href = 'index.html';

            // For now, let's STOP the auto-redirect here to break the loop the user is seeing.
            // We can replace the form content with a "Go to App" button if we want, but let's just log it.
            // window.location.href = 'index.html'; // Wait, checking this IS the loop cause. 
        }
        // If needed, we can expose the user globally or simple dispatch an event
        window.currentUser = user;
        console.log("User logged in:", user.email);
    } else {
        // User is signed out
        if (!isLoginPage) {
            window.location.href = 'login.html';
        }
    }
});

// Logout Helper (attach to window for easy access from non-module scripts if needed, though we will try to stick to modules)
window.logoutUser = async () => {
    try {
        await signOut(auth);
        window.location.href = 'login.html';
    } catch (error) {
        console.error("Logout failed", error);
    }
};
