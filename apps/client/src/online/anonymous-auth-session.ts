import {
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  type Auth,
  type Unsubscribe,
  type User,
  type UserCredential,
} from 'firebase/auth';

export type AuthStateListener = (user: User | null) => void;

export interface AnonymousAuthDriver {
  signInAnonymously(auth: Auth): Promise<Pick<UserCredential, 'user'>>;
  signOut(auth: Auth): Promise<void>;
  onAuthStateChanged(auth: Auth, listener: AuthStateListener): Unsubscribe;
}

export interface AnonymousAuthSession {
  readonly currentUser: User | null;
  ensureSignedIn(): Promise<User>;
  logout(): Promise<void>;
  onAuthState(listener: AuthStateListener): Unsubscribe;
}

const firebaseAuthDriver: AnonymousAuthDriver = {
  signInAnonymously,
  signOut,
  onAuthStateChanged,
};

export function createAnonymousAuthSession(
  auth: Auth,
  driver: AnonymousAuthDriver = firebaseAuthDriver,
): AnonymousAuthSession {
  let signInFlight: Promise<User> | null = null;

  return {
    get currentUser() {
      return auth.currentUser;
    },

    async ensureSignedIn() {
      await auth.authStateReady();
      if (auth.currentUser !== null) return auth.currentUser;

      if (signInFlight === null) {
        const attempt = driver.signInAnonymously(auth).then(({ user }) => user);
        signInFlight = attempt;
        void attempt.then(
          () => {
            if (signInFlight === attempt) signInFlight = null;
          },
          () => {
            if (signInFlight === attempt) signInFlight = null;
          },
        );
      }

      return signInFlight;
    },

    async logout() {
      await driver.signOut(auth);
    },

    onAuthState(listener) {
      return driver.onAuthStateChanged(auth, listener);
    },
  };
}
