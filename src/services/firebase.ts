import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getMessaging } from 'firebase/messaging';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
export const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;

// Validate Connection to Firestore
if (typeof window !== 'undefined') {
  const testConnection = async () => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error: any) {
      if (error.message?.includes('the client is offline')) {
        console.error("Please check your Firebase configuration.");
      }
    }
  };
  testConnection();
}

export default app;
