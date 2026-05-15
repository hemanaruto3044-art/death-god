importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker by passing in the messagingSenderId.
firebase.initializeApp({
  apiKey: "AIzaSyDoRaANczbFHp1ViSoWyyLiX3AK7mAbFnk",
  authDomain: "ai-studio-applet-webapp-48612.firebaseapp.com",
  projectId: "ai-studio-applet-webapp-48612",
  storageBucket: "ai-studio-applet-webapp-48612.firebasestorage.app",
  messagingSenderId: "152339856364",
  appId: "1:152339856364:web:ba92bfd839ba9df6711ec9"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const { channelName, callerUID, callerName } = payload.data;
  
  const notificationTitle = 'Incoming Call';
  const notificationOptions = {
    body: `${callerName || 'Someone'} (${callerUID}) is calling you...`,
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: 'incoming-call',
    data: {
      channelName: channelName,
      url: `/?channel=${channelName}&caller=${callerUID}`
    },
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200, 100, 200, 100, 200], // 5 buzzes
    actions: [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' }
    ],
  };

  // Note: Continuous ringing in background is hard for browser notifications.
  // Standard practice is to show the notification.
  // We can try to play sound if the notification click or show allows it, 
  // but background audio is restricted.
  
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'answer' || !event.action) {
    const urlToOpen = new URL(event.notification.data.url, self.location.origin).href;

    const promiseChain = clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((windowClients) => {
      let matchingClient = null;

      for (let i = 0; i < windowClients.length; i++) {
        const windowClient = windowClients[i];
        if (windowClient.url === urlToOpen) {
          matchingClient = windowClient;
          break;
        }
      }

      if (matchingClient) {
        return matchingClient.focus();
      } else {
        return clients.openWindow(urlToOpen);
      }
    });

    event.waitUntil(promiseChain);
  }
});
