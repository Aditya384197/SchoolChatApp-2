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
