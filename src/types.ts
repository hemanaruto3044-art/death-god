export interface UserProfile {
  uid: string; // Firebase Auth UID
  displayUid: string; // 5-digit numeric UID
  displayName: string;
  fcmToken?: string;
  isMuted?: boolean;
  status?: 'online' | 'offline' | 'busy';
  photoURL?: string;
  blockedUids?: string[];
  peerId?: string;
  updatedAt: any;
}

export interface CallInfo {
  channelName: string;
  targetUid: string;
  callerUid: string;
  callerName: string;
  callerPeerId?: string;
}

export interface CallRecord {
  callerUid: string;
  callerName: string;
  targetUid: string;
  targetName?: string;
  timestamp: any;
  duration: number;
  type: 'incoming' | 'outgoing';
}

export type CallState = 'idle' | 'calling' | 'incoming' | 'active' | 'ended';
