import { messaging, db } from './firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc, onSnapshot, updateDoc, serverTimestamp, deleteDoc, collection, addDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';
import { UserProfile, CallRecord } from '../types';

export const requestNotificationPermission = async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging!, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || 'YOUR_PUBLIC_VAPID_KEY'
      });
      return token;
    }
  } catch (err) {
    console.error('An error occurred while retrieving token:', err);
  }
  return null;
};

export const logCallRecord = async (userAuthId: string, record: CallRecord) => {
  try {
    await addDoc(collection(db, 'users', userAuthId, 'history'), {
      ...record,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${userAuthId}/history`);
  }
};

// Firestore-based signaling for real-time alerts (since we don't have a backend for FCM)
export const setupCallSignal = (myUid: string, onIncomingCall: (data: any) => void) => {
  return onSnapshot(doc(db, 'calls', myUid), (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      if (data.status === 'ringing') {
        onIncomingCall(data);
      }
    }
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, `calls/${myUid}`);
  });
};

export const signalIncomingCall = async (targetUid: string, data: { callerUid: string; callerName: string; channelName: string }) => {
  try {
    await setDoc(doc(db, 'calls', targetUid), {
      ...data,
      status: 'ringing',
      timestamp: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `calls/${targetUid}`);
  }
};

export const respondToCall = async (myUid: string, status: 'accepted' | 'rejected') => {
  try {
    if (status === 'accepted') {
      await updateDoc(doc(db, 'calls', myUid), { status: 'accepted' });
    } else {
      // Delete the call doc to signal rejection
      await deleteDoc(doc(db, 'calls', myUid));
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `calls/${myUid}`);
  }
};

export const clearCallSignal = async (uid: string) => {
  try {
    await deleteDoc(doc(db, 'calls', uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `calls/${uid}`);
  }
};
