import React, { useEffect, useState, useRef } from 'react';
import { Mic, MicOff, PhoneOff, Signal, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { logCallRecord, clearCallSignal } from '../services/notifications';
import { motion, AnimatePresence } from 'motion/react';
import Peer, { MediaConnection } from 'peerjs';
import { db } from '../services/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../services/firestoreErrorHandler';

interface CallScreenProps {
  channelName: string;
  targetUid: string;
  isCaller: boolean;
  onEndCall: () => void;
}

export const CallScreen: React.FC<CallScreenProps> = ({ channelName, targetUid, isCaller, onEndCall }) => {
  const { profile, updateProfile } = useAuth();
  const [isMuted, setIsMuted] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remotePhotoURL, setRemotePhotoURL] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState('CONNECTING');
  const [remoteUserJoined, setRemoteUserJoined] = useState(false);
  const [liveDuration, setLiveDuration] = useState(0);
  const startTime = useRef<number>(Date.now());
  const peerRef = useRef<Peer | null>(null);
  const remoteStreamRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<MediaConnection | null>(null);

  useEffect(() => {
    let interval: any;
    if (remoteUserJoined) {
      interval = setInterval(() => {
        setLiveDuration(Math.floor((Date.now() - startTime.current) / 1000));
      }, 1000);
    } else {
      setLiveDuration(0);
    }
    return () => clearInterval(interval);
  }, [remoteUserJoined]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!profile) return;

    const initPeer = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;

        const peer = new Peer(`deathgod_${profile.displayUid}`, {
          debug: 2
        });
        peerRef.current = peer;

        peer.on('open', (id) => {
          console.log('Peer ID is: ' + id);
          setConnectionState('CONNECTED');
          
          if (isCaller) {
            // Give a small delay to ensure the remote peer is ready
            setTimeout(() => {
              const call = peer.call(`deathgod_${targetUid}`, stream);
              setupCall(call);
            }, 1000);
          }
        });

        peer.on('call', (call) => {
          call.answer(stream);
          setupCall(call);
        });

        peer.on('error', (err) => {
          console.error('Peer error:', err);
          if (err.type === 'peer-unavailable') {
            console.warn('Target peer not yet online, will retry...');
            return;
          }
          setConnectionState('ERROR');
          alert(`Connection Error: ${err.type}. Please ensure microphone permission is granted.`);
          onEndCall();
        });

        peer.on('disconnected', () => {
          setConnectionState('DISCONNECTED');
        });

      } catch (err) {
        console.error('Failed to get local stream or init peer:', err);
        onEndCall();
      }
    };

    const setupCall = (call: MediaConnection) => {
      callRef.current = call;
      
      const timeout = setTimeout(() => {
        if (!remoteUserJoined) {
          console.warn('Call connection timeout');
          // Don't hangup immediately, maybe target is slow
        }
      }, 15000);

      call.on('stream', (remoteStream) => {
        clearTimeout(timeout);
        setRemoteUserJoined(true);
        setConnectionState('CONNECTED');
        startTime.current = Date.now();
        
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new Audio();
        }
        remoteStreamRef.current.srcObject = remoteStream;
        remoteStreamRef.current.play().catch(e => console.error('Audio play failed:', e));
      });

      call.on('close', () => {
        clearTimeout(timeout);
        setRemoteUserJoined(false);
        handleHangup();
      });

      call.on('error', (err) => {
        clearTimeout(timeout);
        console.error('Call error:', err);
        alert('Call failed to establish. Please try again.');
        handleHangup();
      });
    };

    initPeer();

    // Listen to remote user profile (mute status, photo)
    const q = query(collection(db, 'users'), where('displayUid', '==', targetUid));
    const unsubscribeRemote = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const remoteData = snapshot.docs[0].data();
        setRemoteMuted(remoteData.isMuted || false);
        setRemotePhotoURL(remoteData.photoURL || null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => {
      if (callRef.current) callRef.current.close();
      if (peerRef.current) peerRef.current.destroy();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      unsubscribeRemote();
      updateProfile({ isMuted: false });
      if (!isCaller && profile?.displayUid) {
        clearCallSignal(profile.displayUid);
      }
    };
  }, [profile?.displayUid, targetUid]);

  const handleHangup = async () => {
    const duration = Math.floor((Date.now() - startTime.current) / 1000);
    if (profile) {
      await logCallRecord(profile.uid, {
        callerUid: isCaller ? profile.displayUid : targetUid,
        callerName: isCaller ? profile.displayName : 'Guest',
        targetUid: isCaller ? targetUid : profile.displayUid,
        targetName: isCaller ? 'Guest' : profile.displayName,
        timestamp: new Date(),
        duration: remoteUserJoined ? duration : 0,
        type: isCaller ? 'outgoing' : 'incoming'
      });
    }
    onEndCall();
  };

  const handleToggleMute = async () => {
    const newMute = !isMuted;
    setIsMuted(newMute);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !newMute;
      });
    }
    if (profile) {
      await updateProfile({ isMuted: newMute });
    }
  };

  return (
    <div className="fixed inset-0 bg-neutral-950 flex flex-col items-center justify-between p-8 z-50">
      {/* Top Info */}
      <div className="text-center mt-12">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-32 h-32 bg-neutral-800 rounded-full mx-auto mb-6 flex items-center justify-center border-4 border-blue-500/20 relative overflow-hidden"
        >
          {remotePhotoURL ? (
            <img src={remotePhotoURL} alt="Remote Profile" className="w-full h-full object-cover" />
          ) : (
            <div className="w-24 h-24 bg-neutral-700 rounded-full flex items-center justify-center animate-pulse">
              <span className="text-4xl font-bold text-blue-400">{targetUid.slice(0, 2)}</span>
            </div>
          )}
          <AnimatePresence>
            {remoteMuted && (
              <motion.div 
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className="absolute -bottom-1 -right-1 w-10 h-10 bg-red-500 rounded-full border-4 border-neutral-950 flex items-center justify-center text-white"
              >
                <MicOff size={16} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
        <h2 className="text-3xl font-bold mb-1">User {targetUid}</h2>
        <div className="h-6 mb-2">
          <AnimatePresence>
            {remoteMuted && remoteUserJoined && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-red-500/10 text-red-500 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1.5"
              >
                <MicOff size={10} /> Remote user is muted
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <p className="text-neutral-400 font-medium">
          {connectionState === 'CONNECTING' ? (
            'Preparing...'
          ) : connectionState === 'DISCONNECTED' ? (
            <span className="text-red-500">Disconnected</span>
          ) : remoteUserJoined ? (
            <div className="flex flex-col items-center gap-1">
              <span className="text-green-500 font-bold">Connected</span>
              <span className="text-2xl font-mono font-black text-white">{formatTime(liveDuration)}</span>
            </div>
          ) : (
            'Calling...'
          )}
        </p>
      </div>

      {/* Connection Info */}
      <div className="bg-neutral-900/50 rounded-3xl p-6 w-full max-w-sm border border-neutral-800 backdrop-blur-md">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold mb-1">PeerJS Network</p>
            <div className={`flex items-center gap-2 ${remoteUserJoined ? 'text-green-400' : 'text-neutral-500'}`}>
              <Signal size={16} />
              <span className="text-sm font-bold uppercase">{remoteUserJoined ? 'Direct P2P' : 'Establishing...'}</span>
            </div>
          </div>
          <div className={`${remoteUserJoined ? 'bg-green-400/10 text-green-400' : 'bg-neutral-500/10 text-neutral-500'} px-3 py-1 rounded-full text-[10px] font-bold`}>
            {remoteUserJoined ? 'ACTIVE' : 'IDLE'}
          </div>
        </div>
        <p className="text-xs text-neutral-500 text-center">
          Encrypted peer-to-peer audio connection via PeerJS.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center gap-6 mb-12">
        <AnimatePresence>
          {isMuted && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="bg-white/10 backdrop-blur-md border border-white/20 text-white px-4 py-2 rounded-2xl flex items-center gap-2 text-sm font-bold shadow-lg"
            >
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              MICROPHONE MUTED
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-8">
          <button
            onClick={handleToggleMute}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
              isMuted ? 'bg-red-500 text-white scale-110 shadow-lg shadow-red-500/20' : 'bg-neutral-800 text-white hover:bg-neutral-700'
            }`}
          >
            {isMuted ? <MicOff /> : <Mic />}
          </button>
          
          <button
            onClick={handleHangup}
            className="w-20 h-20 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-red-900/20 transition-all active:scale-95"
          >
            <PhoneOff size={32} />
          </button>
        </div>
      </div>
    </div>
  );
};
