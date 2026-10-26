/*
 * Firebase web configuration is safe to expose in a static site. It identifies
 * the Firebase project; Firestore rules and Google OAuth still protect data.
 * Copy the values from Firebase Console > Project settings > Your apps.
 */
window.PACE_FIREBASE_CONFIG = {
  apiKey: '請填入 Firebase apiKey',
  authDomain: '請填入 Firebase authDomain',
  projectId: '請填入 Firebase projectId',
  storageBucket: '請填入 Firebase storageBucket',
  messagingSenderId: '請填入 Firebase messagingSenderId',
  appId: '請填入 Firebase appId'
};
