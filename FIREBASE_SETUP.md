# Firebase Setup — School Chat

## 1. Authentication
Firebase Console → Authentication → Sign-in method → Email/Password → Enable.

## 2. Realtime Database
Database → Rules में `database.rules.json` की पूरी सामग्री लागू करें (यह हर fix के साथ अपडेट होती रहती है — हमेशा नवीनतम इस्तेमाल करें)।

कोई invite code या admin code अब सेट करने की ज़रूरत नहीं है — साइनअप अब सिर्फ़ ईमेल/पासवर्ड/फ़ोन/नाम से होता है, कोई कोड नहीं माँगा जाता।

## 3. एडमिन एक्सेस — एक तय ईमेल से, चुपचाप
`src/adminAccess.js` में एक ईमेल पहले से भरा है (`ADMIN_ACCESS_EMAIL`)। जो भी व्यक्ति ऐप में **ठीक उसी ईमेल** से पहली बार **नया खाता बनाता है** (रजिस्टर करता है, लॉगिन नहीं — क्योंकि वो ईमेल अभी Firebase में मौजूद नहीं है), उसे अपने-आप, चुपचाप, हमेशा के लिए एडमिन एक्सेस मिल जाता है — UI में कहीं इसका ज़िक्र नहीं है।

यह एक बार का दावा (claim) है: `config/adminUid` सिर्फ़ एक ही बार लिखा जा सकता है, इसलिए उसी ईमेल से बाद में कोई दूसरा व्यक्ति खाता बनाने की कोशिश करे तो भी वो एडमिन नहीं बन सकता — पहला वाला ही स्थायी एडमिन रहता है।

अगर एडमिन ईमेल बदलना हो, तो `src/adminAccess.js` की एक लाइन बदलकर दोबारा बिल्ड करें (यह सिर्फ़ अभी तक किसी ने claim न किया हो तभी असर करेगा — claim हो चुकने के बाद बदलाव का कोई असर नहीं, चूँकि `config/adminUid` पहले ही लॉक हो चुका होगा)।

## 4. Firebase Web configuration
`apiKey`, `messagingSenderId` और `appId` सीधे `src/firebase.js` में लिखे हुए हैं (आपके Firebase console की "Your apps" स्क्रीन से लिए गए असली वैल्यू)। GitHub secrets या `.env` की ज़रूरत नहीं — Firebase का web `apiKey` वैसे भी गुप्त रखने वाली चीज़ नहीं होती (Google खुद यही कहता है); असली सुरक्षा Authentication + `database.rules.json` से आती है।

## 5. Android notifications
Capacitor Local Notifications plugin Android पर permission संभालता है। Android 13+ पर notification permission माँगी जाती है।

ध्यान दें: यह local notification है। ऐप पूरी तरह बंद होने पर RTDB सुनने वाला JavaScript नहीं चलता। वास्तविक background push के लिए FCM + trusted server/Cloud Function जोड़ना होगा।

## 6. Admin monitoring — disclosed, by design
हर यूज़र की और दो यूज़र्स की आपस की चैट भी `adminMirror` में कॉपी होकर एडमिन को दिखती है — यह जान-बूझकर बनाया गया फीचर है, इसलिए रजिस्ट्रेशन स्क्रीन और Settings दोनों जगह इसका साफ़ डिस्क्लोज़र दिखाया गया है। "सबके लिए हटाएं" (5 मिनट के अंदर) से डिलीट किया गया मैसेज adminMirror से भी हट जाता है, इसलिए वो एडमिन को भी नहीं दिखता।

## 7. सदस्य हटाना (admin से)
Admin Dashboard में किसी सदस्य पर "हटाएं" दबाने से उनकी प्रोफ़ाइल, उनकी सारी चैट (दोनों तरफ़ + adminMirror) डेटाबेस से मिट जाती हैं, और उनका uid स्थायी रूप से बैन लिस्ट (`config/banned`) में चला जाता है — अगली बार वो उसी लॉगिन से घुसने की कोशिश करें तो ऐप उन्हें तुरंत साइन-आउट कर देगा।

**सीमा**: यह उनका Firebase Authentication खाता (ईमेल/पासवर्ड क्रेडेंशियल) खुद नहीं मिटाता — क्लाइंट-केवल ऐप से यह संभव नहीं, इसके लिए Firebase Admin SDK और एक सर्वर/Cloud Function चाहिए। व्यवहारिक रूप से उनकी एक्सेस पूरी तरह बंद हो जाती है, बस असली क्रेडेंशियल Firebase Authentication के डैशबोर्ड में तब तक दिखता रहेगा जब तक आप उसे वहाँ से मैन्युअली न हटाएं (Firebase console → Authentication → Users)।

## 8. जानी हुई सीमाएँ
- फ़ोन कॉन्टैक्ट मैचिंग (`getPhoneContacts`) ब्राउज़र के Contact Picker API पर निर्भर है, जो सामान्य Capacitor Android WebView में उपलब्ध नहीं होता — असली APK में यह फ़ीचर चुपचाप खाली लिस्ट लौटाएगा। काम करने के लिए `@capacitor-community/contacts` जैसा नेटिव प्लगइन जोड़ना होगा।
- सुरक्षा नियम पूरी तरह क्लाइंट-साइड जाँच पर भरोसा करते हैं (कोई Cloud Function नहीं) — दोस्तों के छोटे, भरोसेमंद ग्रुप के लिए ठीक है।
- ऐप लॉक सिर्फ़ PIN सपोर्ट करता है, पैटर्न लॉक नहीं (स्कोप से बाहर रखा गया — चाहें तो अलग से जोड़ सकता हूं)।
- भाषा टॉगल मुख्य स्क्रीन (auth, settings, chat list, chat) कवर करता है; Admin Dashboard के अंदर के लेबल अभी हिंदी में ही हैं।
