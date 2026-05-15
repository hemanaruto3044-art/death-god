import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import Peer from 'peerjs';
import { useAuth } from './AuthContext';
import { db } from '../services/firebase';
import { doc, updateDoc } from 'firebase/firestore';

interface PeerContextType {
  peer: Peer | null;
  peerId: string | null;
  isReady: boolean;
}

const PeerContext = createContext<PeerContextType | undefined>(undefined);

export const PeerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const [peer, setPeer] = useState<Peer | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const reconnectTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (!profile?.displayUid) {
      if (peer) {
        peer.destroy();
        setPeer(null);
        setPeerId(null);
        setIsReady(false);
      }
      return;
    }

    const initPeer = () => {
      // Use a timestamp to avoid "ID taken" errors on refresh
      const uniqueId = `deathgod_${profile.displayUid}_${Math.floor(Date.now() / 1000)}`;
      const newPeer = new Peer(uniqueId, {
        debug: 1, // Only errors
      });

      newPeer.on('open', async (id) => {
        console.log('PeerJS: Connected with ID', id);
        setPeerId(id);
        setIsReady(true);
        // Update profile with current peerId so others can call us
        try {
          await updateDoc(doc(db, 'users', profile.uid), {
            peerId: id
          });
        } catch (err) {
          console.error('Failed to update peerId in profile:', err);
        }
      });

      newPeer.on('disconnected', () => {
        console.warn('PeerJS: Disconnected from server');
        setIsReady(false);
        // Try to reconnect
        reconnectTimeoutRef.current = setTimeout(() => {
          if (newPeer && !newPeer.destroyed) {
            newPeer.reconnect();
          }
        }, 5000);
      });

      newPeer.on('error', (err) => {
        console.error('PeerJS: Error', err);
        if (err.type === 'peer-unavailable') return;
        setIsReady(false);
        if (err.type === 'network' || err.type === 'server-error') {
           // Retry later
        }
      });

      setPeer(newPeer);
    };

    initPeer();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (peer) {
        peer.destroy();
      }
    };
  }, [profile?.displayUid, profile?.uid]);

  return (
    <PeerContext.Provider value={{ peer, peerId, isReady }}>
      {children}
    </PeerContext.Provider>
  );
};

export const usePeer = () => {
  const context = useContext(PeerContext);
  if (context === undefined) {
    throw new Error('usePeer must be used within a PeerProvider');
  }
  return context;
};
