# SchoolChat — Voice Call & Image Sharing Setup

This version adds one-to-one voice calling with WebRTC and Firebase Realtime Database signaling, plus chat image uploads through Firebase Storage.

## Firebase console

1. Keep **Authentication → Email/Password** enabled.
2. Make sure **Realtime Database** and **Storage** are enabled for the same Firebase project.
3. Deploy the included `database.rules.json` as the Realtime Database rules.
4. Deploy the included `storage.rules` as the Storage rules.

## Voice calls

The app uses:

- WebRTC for the actual audio connection.
- Firebase Realtime Database under `/calls/{chatId}` for offer/answer/ICE-candidate signaling.
- Google public STUN: `stun:stun.l.google.com:19302`.
- Android `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` permissions are injected by the GitHub Actions APK workflow.

STUN does not guarantee connectivity through every restrictive NAT/firewall. The current version is intentionally STUN-only so it needs no extra paid/server infrastructure. A TURN server can be added later for difficult networks without changing the chat data model.

## Image sharing

Chat images are uploaded to:

`chatMedia/{chatId}/{uid}/{messageId}`

Images larger than about 2.5 MB are compressed client-side before upload; the final allowed size is 8 MB.

## Important Android/WebView note

Microphone access must be granted by the Android operating system when requested. WebRTC microphone capture also requires a secure context in browser environments; the native Capacitor Android app runs through its local app origin.

## Current limitations

Incoming-call listening works while the app process is running. Full incoming-call alerts after the app has been force-stopped or completely terminated would require a push-notification backend (for example Firebase Cloud Messaging) and is intentionally not part of this version.


## 1.5.0 media hosting

Chat images/videos/PDF/.bin attachments and image/video statuses up to 15 MB are uploaded anonymously to Catbox through a native Android bridge. The Firebase Storage bucket is no longer used for these uploads. Catbox's anonymous files are public-by-URL and are intended to remain available; deleting a chat/status record in Firebase does not delete the Catbox object because anonymous uploads do not provide an app-side deletion credential. Catbox currently documents a 200 MB upload limit and anonymous uploads through `fileToUpload`.


## 1.5.0 file hosting
Chat attachments and image/video statuses are no longer uploaded to Firebase Storage. Android uses the native Capacitor `CatboxUploader` plugin to send images, videos, PDFs and `.bin` files up to 15 MB to Catbox, then the returned `https://files.catbox.moe/...` URL is stored in Realtime Database. This avoids Firebase Storage quota use for these media objects.

Because anonymous Catbox files are public by URL, do not use this path for passwords, private documents, school records, or other sensitive material. Deleting a message/status from Firebase does not delete the anonymous Catbox object.

The Android build workflow is intentionally delivered as `.github/workflows/build.yml`, while the application source lives in the sibling `SchoolChatApp/` directory so the ZIP opens as two top-level folders.
