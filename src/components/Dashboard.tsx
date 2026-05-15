import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Phone, Hash, LogOut, PhoneIncoming, Clock, ArrowUpRight, ArrowDownLeft, MicOff, Camera, User, Loader2, Shield, ShieldOff } from 'lucide-react';
import { db, storage } from '../services/firebase';
import { collection, query, orderBy, onSnapshot, limit, where, getDocs } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../services/firestoreErrorHandler';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signalIncomingCall, setupCallSignal, respondToCall, clearCallSignal, requestNotificationPermission } from '../services/notifications';
import { motion, AnimatePresence } from 'motion/react';
import { CallRecord, UserProfile } from '../types';
import { Search, UserPlus } from 'lucide-react';

interface DashboardProps {
  onStartCall: (targetUid: string, channelName: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onStartCall }) => {
  const { profile, logout, updateProfile } = useAuth();
  const [targetUid, setTargetUid] = useState('');
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [contacts, setContacts] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (history.length === 0) {
      setContacts([]);
      return;
    }

    // Get unique other UIDs from history
    const uniqueUids = Array.from(new Set(
      history.map(record => record.type === 'outgoing' ? record.targetUid : record.callerUid)
    )).slice(0, 10);

    if (uniqueUids.length === 0) return;

    // We use displayUid to find users
    const q = query(collection(db, 'users'), where('displayUid', 'in', uniqueUids));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => doc.data() as UserProfile);
      // Sort them to match history order
      const sortedUsers = users.sort((a, b) => {
        const indexA = uniqueUids.indexOf(a.displayUid);
        const indexB = uniqueUids.indexOf(b.displayUid);
        return indexA - indexB;
      });
      setContacts(sortedUsers);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return unsubscribe;
  }, [history]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    try {
      setIsUploading(true);
      const storageRef = ref(storage, `profile_pictures/${profile.uid}`);
      await uploadBytes(storageRef, file);
      const photoURL = await getDownloadURL(storageRef);
      await updateProfile({ photoURL });
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchTerm.trim().length >= 2) {
        setIsSearching(true);
        try {
          // Search by UID (exact) or Name (prefix)
          const qUid = query(collection(db, 'users'), where('displayUid', '==', searchTerm));
          const qName = query(
            collection(db, 'users'), 
            where('displayName', '>=', searchTerm),
            where('displayName', '<=', searchTerm + '\uf8ff'),
            limit(5)
          );

          const [snapUid, snapName] = await Promise.all([
            getDocs(qUid).catch(err => { handleFirestoreError(err, OperationType.LIST, 'users'); throw err; }),
            getDocs(qName).catch(err => { handleFirestoreError(err, OperationType.LIST, 'users'); throw err; })
          ]);
          
          const results: UserProfile[] = [];
          const seenUids = new Set();

          snapUid.forEach(doc => {
            const data = doc.data() as UserProfile;
            if (data.uid !== profile?.uid) {
              results.push(data);
              seenUids.add(data.uid);
            }
          });

          snapName.forEach(doc => {
            const data = doc.data() as UserProfile;
            if (data.uid !== profile?.uid && !seenUids.has(data.uid)) {
              results.push(data);
            }
          });

          setSearchResults(results);
        } catch (error) {
          console.error("Search failed:", error);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, profile?.uid]);

  useEffect(() => {
    // Request notification permission and save token
    const initNotifications = async () => {
      const token = await requestNotificationPermission();
      if (token && profile && profile.fcmToken !== token) {
        await updateProfile({ fcmToken: token });
      }
    };
    initNotifications();

    if (profile?.displayUid) {
      const unsubscribe = setupCallSignal(profile.displayUid, (data) => {
        // Block check: If caller is in our blockedUids, ignore
        if (profile.blockedUids?.includes(data.callerUid)) {
          console.log(`Blocked call attempt from ${data.callerUid}`);
          return;
        }
        setIncomingCall(data);
      });
      return () => {
        unsubscribe();
        clearCallSignal(profile.displayUid);
      };
    }
  }, [profile?.displayUid]);

  useEffect(() => {
    if (incomingCall) {
      const ringtone = new Audio('https://assets.mixkit.co/active_storage/sfx/1359/1359-preview.mp3');
      let count = 0;
      
      const playRingtone = () => {
        ringtone.play().catch(e => console.error('Audio play failed:', e));
        count++;
      };

      playRingtone();
      const interval = setInterval(() => {
        if (count < 5 && incomingCall) {
          playRingtone();
        } else {
          clearInterval(interval);
        }
      }, 3000);

      return () => {
        clearInterval(interval);
        ringtone.pause();
        ringtone.currentTime = 0;
      };
    }
  }, [incomingCall]);

  useEffect(() => {
    if (profile?.uid) {
      const q = query(
        collection(db, 'users', profile.uid, 'history'),
        orderBy('timestamp', 'desc'),
        limit(10)
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const records = snapshot.docs.map(doc => doc.data() as CallRecord);
        setHistory(records);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `users/${profile.uid}/history`);
      });
      return unsubscribe;
    }
  }, [profile?.uid]);

  const handleCall = async () => {
    if (targetUid.length === 5 && profile) {
      if (profile.blockedUids?.includes(targetUid)) {
        if (!confirm('You have blocked this user. Unblock and call?')) return;
        await handleBlockUser(targetUid);
      }
      const channelName = `call_${profile.displayUid}_to_${targetUid}`;
      try {
        await signalIncomingCall(targetUid, {
          callerUid: profile.displayUid,
          callerName: profile.displayName,
          channelName
        });
        onStartCall(targetUid, channelName);
      } catch (err: any) {
        if (err.message.includes('permission-denied')) {
          alert('Could not initiate call. You might be blocked by this user or the user does not exist.');
        } else {
          console.error('Call failed:', err);
        }
      }
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const handleAnswer = async () => {
    if (incomingCall && profile) {
      await respondToCall(profile.displayUid, 'accepted');
      onStartCall(incomingCall.callerUid, incomingCall.channelName);
      setIncomingCall(null);
    }
  };

  const handleBlockUser = async (displayUid: string) => {
    if (!profile) return;
    const currentBlocked = profile.blockedUids || [];
    let newBlocked;
    if (currentBlocked.includes(displayUid)) {
      newBlocked = currentBlocked.filter(id => id !== displayUid);
    } else {
      newBlocked = [...currentBlocked, displayUid];
    }
    await updateProfile({ blockedUids: newBlocked });
  };

  const handleReject = async () => {
    if (incomingCall && profile) {
      await respondToCall(profile.displayUid, 'rejected');
      setIncomingCall(null);
    }
  };

  return (
    <div className="bg-neutral-950 p-6 pb-24 max-w-md mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-10 mt-6">
        <div>
          <h2 className="text-2xl font-bold">Hello, {profile?.displayName}</h2>
          <p className="text-neutral-500 text-sm">Welcome back</p>
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          <div className="flex items-center gap-3">
            <label className="relative cursor-pointer group">
              <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-neutral-800 overflow-hidden flex items-center justify-center">
                {isUploading ? (
                  <Loader2 className="animate-spin text-blue-500" size={18} />
                ) : profile?.photoURL ? (
                  <img src={profile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User className="text-neutral-600" size={18} />
                )}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="text-white" size={14} />
                </div>
              </div>
              <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
            </label>
            <button onClick={logout} className="p-2 text-neutral-400 hover:text-white transition-colors">
              <LogOut size={20} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${
              profile?.status === 'online' ? 'bg-green-500' : 
              profile?.status === 'busy' ? 'bg-yellow-500' : 'bg-neutral-600'
            }`} />
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-tighter">
              {profile?.status || 'offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Your ID Card */}
      <div className="bg-blue-600 rounded-3xl p-8 mb-10 shadow-2xl shadow-blue-900/30 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl"></div>
        <div className="relative z-10">
          <p className="text-blue-100 text-sm font-medium mb-1">Your Unique ID</p>
          <div className="flex items-center gap-3">
            <span className="text-5xl font-mono font-black tracking-widest">{profile?.displayUid}</span>
            <Hash className="text-blue-200/50" size={24} />
            {profile?.isMuted && (
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="bg-red-500/20 text-red-100 p-2 rounded-full border border-red-500/30"
              >
                <MicOff size={16} />
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Dialer */}
      <div className="space-y-6">
        <div className="relative">
          <input
            type="text"
            maxLength={5}
            value={targetUid}
            onChange={(e) => setTargetUid(e.target.value.replace(/\D/g, ''))}
            placeholder="00000"
            className="w-full bg-neutral-900 border border-neutral-800 text-center text-5xl font-mono tracking-[0.5em] py-6 rounded-3xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-neutral-800"
          />
        </div>

        <button
          onClick={handleCall}
          disabled={targetUid.length !== 5}
          className="w-full h-20 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:grayscale text-white rounded-3xl flex items-center justify-center gap-4 transition-all shadow-xl shadow-blue-900/20 active:scale-95"
        >
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
            <Phone fill="white" size={20} />
          </div>
          <span className="text-xl font-bold tracking-tight">Call User</span>
        </button>

        {/* Search Bar */}
        <div className="mt-8 space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by Name or UID..."
              className="w-full bg-neutral-900/50 border border-neutral-800 rounded-2xl pl-12 pr-4 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
            />
            {isSearching && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>

          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden divide-y divide-neutral-800"
              >
                {searchResults.map((result) => (
                  <div
                    key={result.uid}
                    className="w-full px-4 py-4 flex items-center justify-between hover:bg-neutral-800 transition-colors text-left"
                  >
                    <button 
                      onClick={() => {
                        setTargetUid(result.displayUid);
                        setSearchTerm('');
                      }}
                      className="flex items-center gap-3 grow"
                    >
                      <div className="w-10 h-10 bg-neutral-800 rounded-xl flex items-center justify-center text-blue-500 relative overflow-hidden flex-shrink-0">
                        {result.photoURL ? (
                          <img src={result.photoURL} alt={result.displayName} className="w-full h-full object-cover" />
                        ) : result.isMuted ? (
                          <MicOff size={18} className="text-red-500" />
                        ) : (
                          <User size={18} />
                        )}
                        <div className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-neutral-900 ${
                          result.status === 'online' ? 'bg-green-500' : 
                          result.status === 'busy' ? 'bg-yellow-500' : 'bg-neutral-600'
                        }`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-sm">{result.displayName}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            result.status === 'online' ? 'bg-green-500/10 text-green-500' :
                            result.status === 'busy' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-neutral-800 text-neutral-500'
                          }`}>
                            {result.status || 'offline'}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 font-mono">ID: {result.displayUid}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleBlockUser(result.displayUid)}
                        className={`p-2 rounded-lg transition-colors ${
                          profile?.blockedUids?.includes(result.displayUid)
                            ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                            : 'bg-neutral-800 text-neutral-500 hover:text-white'
                        }`}
                        title={profile?.blockedUids?.includes(result.displayUid) ? 'Unblock' : 'Block'}
                      >
                        {profile?.blockedUids?.includes(result.displayUid) ? <ShieldOff size={16} /> : <Shield size={16} />}
                      </button>
                      <button
                        onClick={() => {
                          setTargetUid(result.displayUid);
                          setSearchTerm('');
                        }}
                        className="bg-blue-500/10 text-blue-500 px-3 py-1 rounded-full text-[10px] font-bold uppercase hover:bg-blue-500/20"
                      >
                        Select
                      </button>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Recent Contacts */}
      {contacts.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-bold text-neutral-600 uppercase tracking-widest">Recent Contacts</h3>
            <User size={14} className="text-neutral-600" />
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
            {contacts.map((contact) => (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                key={contact.uid}
                className="flex-shrink-0 flex flex-col items-center gap-2 group relative"
              >
                <div className="relative">
                  <button
                    onClick={() => setTargetUid(contact.displayUid)}
                    className="w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 p-0.5 group-hover:border-blue-500/50 transition-colors"
                  >
                    <div className="w-full h-full rounded-[14px] overflow-hidden flex items-center justify-center bg-neutral-800">
                      {contact.photoURL ? (
                        <img src={contact.photoURL} alt={contact.displayName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl font-bold text-blue-500">{contact.displayName.charAt(0)}</span>
                      )}
                    </div>
                  </button>
                  {/* Status Ring */}
                  <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-4 border-neutral-950 flex items-center justify-center ${
                    contact.status === 'online' ? 'bg-green-500' : 
                    contact.status === 'busy' ? 'bg-yellow-500' : 'bg-neutral-600'
                  }`} />
                  
                  {/* Block Overlay Toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleBlockUser(contact.displayUid);
                    }}
                    className={`absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center shadow-lg transition-all ${
                      profile?.blockedUids?.includes(contact.displayUid)
                        ? 'bg-red-500 text-white'
                        : 'bg-neutral-800 text-neutral-500 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {profile?.blockedUids?.includes(contact.displayUid) ? <ShieldOff size={12} /> : <Shield size={12} />}
                  </button>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-bold text-white max-w-[64px] truncate">{contact.displayName}</p>
                  <p className="text-[8px] text-neutral-500 font-mono tracking-tighter">ID: {contact.displayUid}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Call History */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xs font-bold text-neutral-600 uppercase tracking-widest">Call History</h3>
          <Clock size={14} className="text-neutral-600" />
        </div>
        
        <div className="space-y-3">
          {history.length > 0 ? (
            history.map((record, i) => (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                key={i}
                className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    record.type === 'outgoing' ? 'bg-blue-500/10 text-blue-500' : 'bg-green-500/10 text-green-500'
                  }`}>
                    {record.type === 'outgoing' ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
                  </div>
                  <div>
                    <p className="font-bold text-sm">
                      {record.type === 'outgoing' ? record.targetUid : record.callerUid}
                    </p>
                    <p className="text-[10px] text-neutral-500 font-medium">
                      {record.timestamp?.toDate ? record.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono font-bold text-neutral-400">
                    {record.duration > 0 ? formatDuration(record.duration) : 'Missed'}
                  </p>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="text-center py-8">
              <p className="text-neutral-600 text-sm italic">No recent calls</p>
            </div>
          )}
        </div>
      </div>

      {/* Incoming Call Overlay */}
      <AnimatePresence>
        {incomingCall && (
          <motion.div
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            className="fixed bottom-6 left-6 right-6 bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl z-[60] flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-green-500/20 rounded-2xl flex items-center justify-center text-green-500 animate-pulse">
                <PhoneIncoming />
              </div>
              <div>
                <p className="text-xs text-neutral-500 font-bold uppercase tracking-wide">Incoming Call</p>
                <p className="font-bold text-lg">{incomingCall.callerName}</p>
                <p className="text-sm font-mono text-neutral-400">ID: {incomingCall.callerUid}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={handleReject}
                className="w-12 h-12 bg-neutral-800 hover:bg-red-500/20 text-red-500 rounded-2xl flex items-center justify-center transition-all"
              >
                <LogOut className="rotate-90" />
              </button>
              <button 
                onClick={handleAnswer}
                className="w-16 h-16 bg-green-600 hover:bg-green-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-green-900/20 transition-all animate-bounce"
              >
                <Phone fill="white" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
