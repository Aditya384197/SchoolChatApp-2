# School Chat

React + Firebase Realtime Database + Capacitor Android.

## शामिल सुविधाएँ

- ईमेल/पासवर्ड से सीधा साइनअप — कोई invite या admin code नहीं, कोई भी जुड़ सकता है
- एक तय ईमेल से रजिस्टर करने पर चुपचाप, स्थायी एडमिन एक्सेस (कहीं ज़िक्र नहीं — देखें `src/adminAccess.js` और `FIREBASE_SETUP.md` #3)
- इमोजी अवतार या असली प्रोफ़ाइल फ़ोटो — ड्रैग + ज़ूम वाला क्रॉप टूल
- साइनअप के तुरंत बाद कॉन्टैक्ट परमिशन माँगना और बैकग्राउंड में चुपचाप नंबर मैच करना
- एडमिन के लिए अलग, पूरे-पेज का Admin Dashboard (नीचे टैब-बार से)
- Admin Dashboard: live stats (कुल/ऑनलाइन/कुल चैट/अभी सक्रिय), सदस्य लिस्ट, नाम/नंबर से सर्च, किसी सदस्य को हटाना (बैन)
- ऑनलाइन/ऑफलाइन स्थिति, Last Seen, Typing indicator
- Delivered ✓✓ और Seen ✓✓, Unread count, चैट लिस्ट में आख़िरी मैसेज की झलक
- मैसेज डिलीट: "मेरे लिए" (कभी भी) और "सबके लिए" (5 मिनट के अंदर — admin mirror से भी हट जाता है)
- लंबे मैसेज अब सही से कई लाइन में wrap होते हैं
- भाषा (हिंदी/English) और थीम (Light/Dark/System) — Settings से
- PIN-based ऐप लॉक (सेट/बदलें/हटाएं)
- प्रोफ़ाइल एडिट (फ़ोटो, अवतार, नाम, फ़ोन) — ईमेल लॉगिन-आईडी है, बदला नहीं जा सकता
- Private Chat to Admin, Logout (confirm स्क्रीन के साथ)
- Status (टेक्स्ट/फ़ोटो/वीडियो, WhatsApp जैसा) — 24 घंटे बाद अपने-आप गायब, इमोजी रिएक्शन + कमेंट, "किसने देखा" (सिर्फ़ मालिक/एडमिन को)
- मैसेज पर टैप किए रहने से एक्शन शीट: कॉपी, शेयर, मेरे लिए हटाएं, सबके लिए हटाएं (5 मिनट के अंदर)
- Android foreground local notifications
- Admin के लिए सभी रिकॉर्ड की गई chats — रजिस्ट्रेशन स्क्रीन और Settings दोनों जगह साफ़ बताया गया है
- Mobile-friendly UI, GitHub Actions से APK build

## ज़रूरी सूचना

Realtime Database client से सीधे लिखे गए admin mirror को पूर्ण tamper-proof audit log नहीं माना जा सकता। बंद ऐप में वास्तविक push notification के लिए Firebase Cloud Messaging + trusted backend/Cloud Functions चाहिए। सदस्य हटाने पर उनका Firebase Auth क्रेडेंशियल खुद नहीं मिटता, सिर्फ़ एक्सेस स्थायी रूप से बंद होता है — विस्तार से `FIREBASE_SETUP.md` #7 में।

## Firebase setup

1. Firebase Authentication → Email/Password चालू करें।
2. Realtime Database में `database.rules.json` लागू करें।
3. `src/firebase.js` में project की असली `apiKey`/`messagingSenderId`/`appId` पहले से लिखे हैं — कोई GitHub secret ज़रूरी नहीं।
4. `src/adminAccess.js` में एडमिन ईमेल पहले से सेट है।

पूरी डिटेल `FIREBASE_SETUP.md` में, और अब तक मिले/ठीक किए गए सभी bug व फ़ीचर `CROSS_CHECK.md` में हैं।

## Build

```bash
npm ci
npm run build
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```
