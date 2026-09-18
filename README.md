# School Chat

React + Firebase Realtime Database + Capacitor Android.

## शामिल सुविधाएँ

- ईमेल/पासवर्ड खाता + चरणबद्ध (step-by-step) साइनअप: कोड → फ़ोन → प्रोफ़ाइल
- Invite code से सामान्य यूज़र, सही admin code से स्वतः एडमिन (सिर्फ़ पहली बार, हमेशा के लिए लॉक)
- इमोजी अवतार या प्रोफ़ाइल फ़ोटो चुनना
- एडमिन के लिए अलग, पूरे-पेज का Admin Dashboard (नीचे टैब-बार से)
- ऑनलाइन/ऑफलाइन स्थिति, Last Seen, Typing indicator
- Delivered ✓✓ और Seen ✓✓, Unread count
- चैट लिस्ट में आख़िरी मैसेज की झलक, हाल की चैट सबसे ऊपर
- Android foreground local notifications
- Private Chat to Admin
- Admin Dashboard से Invite/Admin code बदलना
- Admin के लिए सभी रिकॉर्ड की गई chats (मॉनिटरिंग — रजिस्ट्रेशन स्क्रीन पर सबको साफ़ बताया गया है)
- Mobile-friendly UI, GitHub Actions से APK build

## ज़रूरी सूचना

Realtime Database client से सीधे लिखे गए admin mirror को पूर्ण tamper-proof audit log नहीं माना जा सकता। बंद ऐप में वास्तविक push notification के लिए Firebase Cloud Messaging + trusted backend/Cloud Functions चाहिए। यहाँ native local notifications तभी दिखतीं हैं जब ऐप realtime listener चला रहा हो।

## Firebase setup

1. Firebase Authentication → Email/Password चालू करें।
2. Realtime Database में `database.rules.json` लागू करें।
3. Realtime Database → Data में सिर्फ़ यह डालें (adminUid जान-बूझकर खाली छोड़ें — सही admin code डालने वाला पहला व्यक्ति उसे अपने-आप क्लेम कर लेगा):
   ```json
   { "config": { "inviteCode": "अपना-कोड", "adminCode": "अपना-कोड" } }
   ```
4. `src/firebase.js` में project की असली `apiKey`/`messagingSenderId`/`appId` पहले से लिखे हैं (Firebase console की "Your apps" स्क्रीन से) — कोई GitHub secret ज़रूरी नहीं है।

पूरी डिटेल `FIREBASE_SETUP.md` में, और अब तक मिले/ठीक किए गए सभी bug `CROSS_CHECK.md` में हैं।

## Build

```bash
npm ci
npm run build
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```
