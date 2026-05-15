import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { GuestLogin } from './components/GuestLogin';
import { Dashboard } from './components/Dashboard';
import { CallScreen } from './components/CallScreen';
import { CallState } from './types';

function AppContent() {
  const { user, profile, loading, updateProfile } = useAuth();
  const [callState, setCallState] = useState<CallState>('idle');
  const [activeCall, setActiveCall] = useState<{ targetUid: string; channelName: string; isCaller: boolean } | null>(null);

  useEffect(() => {
    // Check URL parameters for direct join (from notification click)
    const params = new URLSearchParams(window.location.search);
    const channel = params.get('channel');
    const caller = params.get('caller');
    
    if (channel && caller && profile) {
      handleStartCall(caller, channel, false);
      // Clean URL
      window.history.replaceState({}, document.title, '/');
    }
  }, [profile]);

  const handleStartCall = async (targetUid: string, channelName: string, isCaller = true) => {
    if (profile) {
      await updateProfile({ status: 'busy' });
    }
    setActiveCall({ targetUid, channelName, isCaller });
    setCallState('active');
  };

  const handleEndCall = async () => {
    if (profile) {
      await updateProfile({ status: 'online' });
    }
    setCallState('idle');
    setActiveCall(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 font-sans selection:bg-blue-500/30 flex justify-center">
      <div className="w-full max-w-md bg-neutral-950 min-h-screen shadow-2xl border-x border-neutral-900 overflow-x-hidden">
        {!user || !profile ? (
          <GuestLogin />
        ) : callState === 'active' && activeCall ? (
          <CallScreen 
            channelName={activeCall.channelName}
            targetUid={activeCall.targetUid}
            isCaller={activeCall.isCaller}
            onEndCall={handleEndCall}
          />
        ) : (
          <Dashboard onStartCall={handleStartCall} />
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
