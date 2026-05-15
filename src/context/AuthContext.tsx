import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../services/firebase';
import { signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../services/firestoreErrorHandler';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  loginAsGuest: (displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch profile
        try {
          const profileDoc = await getDoc(doc(db, 'users', u.uid));
          if (profileDoc.exists()) {
            const profileData = profileDoc.data() as UserProfile;
            setProfile(profileData);
            // Set status to online on load
            const profileRef = doc(db, 'users', u.uid);
            await setDoc(profileRef, { status: 'online', updatedAt: serverTimestamp() }, { merge: true });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const loginAsGuest = async (displayName: string) => {
    try {
      const cred = await signInAnonymously(auth);
      const u = cred.user;
      
      // Check if profile exists, if not create one with a 5-digit UID
      const profileRef = doc(db, 'users', u.uid);
      const profileSnap = await getDoc(profileRef);
      
      if (!profileSnap.exists()) {
        const displayUid = Math.floor(10000 + Math.random() * 90000).toString();
        const newProfile: UserProfile = {
          uid: u.uid,
          displayUid,
          displayName,
          status: 'online',
          updatedAt: serverTimestamp(),
        };
        
        try {
          await setDoc(profileRef, newProfile);
          
          // Also add to lookup table
          await setDoc(doc(db, 'uids', displayUid), {
            ownerId: u.uid,
            displayUid,
            displayName,
            updatedAt: serverTimestamp()
          });
          
          setProfile(newProfile);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `users/${u.uid}`);
        }
      } else {
        setProfile(profileSnap.data() as UserProfile);
      }
    } catch (error) {
      console.error('Error logging in as guest:', error);
      throw error;
    }
  };

  const logout = async () => {
    if (user) {
      const profileRef = doc(db, 'users', user.uid);
      await setDoc(profileRef, { status: 'offline', updatedAt: serverTimestamp() }, { merge: true });
    }
    await auth.signOut();
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    if (!user) return;
    const profileRef = doc(db, 'users', user.uid);
    const updatedData = { ...data, updatedAt: serverTimestamp() };
    try {
      await setDoc(profileRef, updatedData, { merge: true });
      setProfile(prev => prev ? { ...prev, ...data } : null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, loginAsGuest, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
