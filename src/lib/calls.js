import React from 'react';
import { onDisconnect, onValue, push, ref, remove, set, update } from 'firebase/database';
import { db } from '../firebase';
import { chatIdFor } from './chat';
import { clearAudioRoute } from './audioRoute';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const CALL_RING_TIMEOUT_MS = 30 * 1000;
const DISCONNECT_GRACE_MS = 8 * 1000;

async function updateCallFields(callId, patch) {
  if (!callId || !patch || typeof patch !== 'object') return;
  const writes = {};
  Object.entries(patch).forEach(([key, value]) => {
    writes[`calls/${callId}/${key}`] = value;
  });
  await update(ref(db), writes);
}

function errorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return 'माइक्रोफ़ोन की अनुमति नहीं मिली। Android में School Chat के लिए Microphone permission चालू करें।';
  }
  if (error?.name === 'NotFoundError') return 'इस डिवाइस पर माइक्रोफ़ोन नहीं मिला।';
  if (error?.name === 'NotReadableError') return 'माइक्रोफ़ोन किसी दूसरी ऐप द्वारा इस्तेमाल हो रहा है।';
  if (error?.name === 'SecurityError') return 'इस डिवाइस पर माइक्रोफ़ोन उपयोग की अनुमति उपलब्ध नहीं है।';
  return error?.message || 'वॉइस कॉल शुरू नहीं हो सकी।';
}

async function getMicrophoneStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('इस Android/WebView में WebRTC वॉइस कॉल उपलब्ध नहीं है।');
  }
  const constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    // A few older WebViews reject advanced audio constraints even though they
    // support ordinary microphone capture, so retry with the minimal request.
    if (error?.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    throw error;
  }
}

export function useVoiceCall({ uid, users }) {
  const [activeCall, setActiveCall] = React.useState(null);
  const [incomingCall, setIncomingCall] = React.useState(null);
  const [remoteStream, setRemoteStream] = React.useState(null);
  const [callError, setCallError] = React.useState('');
  const [muted, setMuted] = React.useState(false);

  const activeRef = React.useRef(null);
  const incomingRef = React.useRef(null);
  const pcRef = React.useRef(null);
  const localStreamRef = React.useRef(null);
  const currentCallIdRef = React.useRef(null);
  const roleRef = React.useRef(null);
  const peerUidRef = React.useRef(null);
  const candidateStopRef = React.useRef(null);
  const processedCandidatesRef = React.useRef(new Set());
  const pendingCandidatesRef = React.useRef([]);
  const remoteDescriptionSetRef = React.useRef(false);
  const ringTimerRef = React.useRef(null);
  const disconnectedTimerRef = React.useRef(null);
  const finishingRef = React.useRef(false);

  React.useEffect(() => { activeRef.current = activeCall; }, [activeCall]);
  React.useEffect(() => { incomingRef.current = incomingCall; }, [incomingCall]);
  React.useEffect(() => {
    if (!activeCall?.peer?.uid) return undefined;
    const peerUid = activeCall.peer.uid;
    return onValue(ref(db, `users/${peerUid}/online`), snap => {
      const online = snap.val() === true;
      setActiveCall(prev => prev && prev.peer?.uid === peerUid ? { ...prev, peer: { ...prev.peer, online } } : prev);
    });
  }, [activeCall?.peer?.uid]);

  function clearTimers() {
    clearTimeout(ringTimerRef.current);
    clearTimeout(disconnectedTimerRef.current);
    ringTimerRef.current = null;
    disconnectedTimerRef.current = null;
  }

  function stopCandidateListener() {
    candidateStopRef.current?.();
    candidateStopRef.current = null;
    processedCandidatesRef.current.clear();
    pendingCandidatesRef.current = [];
  }

  function cleanupPeer() {
    clearTimers();
    stopCandidateListener();
    try { pcRef.current?.close(); } catch { /* already closed */ }
    pcRef.current = null;
    localStreamRef.current?.getTracks?.().forEach(track => track.stop());
    localStreamRef.current = null;
    currentCallIdRef.current = null;
    roleRef.current = null;
    peerUidRef.current = null;
    remoteDescriptionSetRef.current = false;
    clearAudioRoute().catch(() => {});
    setRemoteStream(null);
    setMuted(false);
  }

  async function finishCall(callId, { removeRemote = true } = {}) {
    clearTimers();
    if (finishingRef.current && currentCallIdRef.current === callId) return;
    finishingRef.current = true;
    if (callId) {
      await updateCallFields(callId, {
        status: 'ended',
        endedAt: Date.now(),
        endedBy: uid,
      }).catch(() => {});
      if (removeRemote) {
        setTimeout(() => remove(ref(db, `calls/${callId}`)).catch(() => {}), 1200);
      }
    }
    cleanupPeer();
    finishingRef.current = false;
    setActiveCall(null);
    setIncomingCall(null);
  }

  async function addCandidate(candidate) {
    const pc = pcRef.current;
    if (!pc || !candidate) return;
    if (!remoteDescriptionSetRef.current || !pc.remoteDescription) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // ICE candidates can become stale while a peer is reconnecting.
    }
  }

  async function flushCandidates() {
    const pending = pendingCandidatesRef.current.splice(0);
    for (const candidate of pending) await addCandidate(candidate);
  }

  function listenCandidates(callId, remoteUid) {
    stopCandidateListener();
    candidateStopRef.current = onValue(ref(db, `calls/${callId}/candidates`), snapshot => {
      const all = snapshot.val() || {};
      const remote = all[remoteUid] || {};
      Object.entries(remote).forEach(([candidateId, value]) => {
        const key = `${remoteUid}:${candidateId}`;
        if (processedCandidatesRef.current.has(key) || !value) return;
        processedCandidatesRef.current.add(key);
        let candidate;
        try {
          candidate = new RTCIceCandidate(value);
        } catch {
          return;
        }
        addCandidate(candidate).catch(() => {});
      });
    });
  }

  async function createPeer(callId, remoteUid, role) {
    const stream = await getMicrophoneStream();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.ontrack = event => {
      const [streamFromPeer] = event.streams || [];
      if (streamFromPeer) setRemoteStream(streamFromPeer);
    };
    pc.onicecandidate = event => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
      set(push(ref(db, `calls/${callId}/candidates/${uid}`)), candidate).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        clearTimeout(disconnectedTimerRef.current);
        disconnectedTimerRef.current = null;
        setActiveCall(prev => prev ? {
          ...prev,
          status: 'active',
          startedAt: prev.startedAt || Date.now(),
        } : prev);
      } else if (state === 'disconnected') {
        clearTimeout(disconnectedTimerRef.current);
        disconnectedTimerRef.current = setTimeout(() => {
          if (pcRef.current === pc && pc.connectionState === 'disconnected') {
            finishCall(callId).catch(() => {});
          }
        }, DISCONNECT_GRACE_MS);
      } else if (state === 'failed' || state === 'closed') {
        finishCall(callId).catch(() => {});
      }
    };

    localStreamRef.current = stream;
    pcRef.current = pc;
    currentCallIdRef.current = callId;
    roleRef.current = role;
    peerUidRef.current = remoteUid;
    listenCandidates(callId, remoteUid);
    return pc;
  }

  async function startCall(peer) {
    if (!peer?.uid || peer.uid === uid || activeRef.current || incomingRef.current) return;
    setCallError('');
    const callId = chatIdFor(uid, peer.uid);
    try {
      const pc = await createPeer(callId, peer.uid, 'caller');
      // Create the parent call record BEFORE setLocalDescription() starts ICE
      // gathering. Otherwise an early candidate can hit RTDB before the
      // participant record exists and be rejected by the security rule.
      await set(ref(db, `calls/${callId}`), {
        callerId: uid,
        receiverId: peer.uid,
        participants: { [uid]: true, [peer.uid]: true },
        status: 'ringing',
        createdAt: Date.now(),
      });
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      setActiveCall({ chatId: callId, peer, direction: 'outgoing', status: 'ringing', startedAt: null });
      await onDisconnect(ref(db, `calls/${callId}/status`)).set('ended').catch(() => {});
      await updateCallFields(callId, {
        offer: { type: offer.type, sdp: offer.sdp },
      });
      ringTimerRef.current = setTimeout(() => {
        if (activeRef.current?.chatId === callId && activeRef.current?.status === 'ringing') {
          set(ref(db, `missedCalls/${peer.uid}/${callId}`), {
            callerId: uid, callerName: peer.name || 'School Chat', receiverId: peer.uid,
            createdAt: Date.now(), notified: false
          }).catch(() => {});
          finishCall(callId).catch(() => {});
        }
      }, CALL_RING_TIMEOUT_MS);
    } catch (error) {
      await remove(ref(db, `calls/${callId}`)).catch(() => {});
      cleanupPeer();
      setActiveCall(null);
      setCallError(errorMessage(error));
    }
  }

  async function acceptCall(call) {
    if (!call?.chatId || activeRef.current) return;
    setCallError('');
    const callerUid = call.callerId;
    setIncomingCall(null);
    try {
      const peer = call.peer || users.find(user => user.uid === callerUid) || { uid: callerUid, name: 'वॉइस कॉल' };
      const pc = await createPeer(call.chatId, callerUid, 'callee');
      remoteDescriptionSetRef.current = false;
      await pc.setRemoteDescription(call.offer);
      remoteDescriptionSetRef.current = true;
      await flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      setActiveCall({ chatId: call.chatId, peer, direction: 'incoming', status: 'connecting', startedAt: null });
      await onDisconnect(ref(db, `calls/${call.chatId}/status`)).set('ended').catch(() => {});
      await updateCallFields(call.chatId, {
        status: 'accepted',
        acceptedAt: Date.now(),
        answer: { type: answer.type, sdp: answer.sdp },
      });
    } catch (error) {
      setCallError(errorMessage(error));
      await updateCallFields(call.chatId, { status: 'ended', endedAt: Date.now(), endedBy: uid }).catch(() => {});
      cleanupPeer();
      setActiveCall(null);
    }
  }

  async function declineCall(call = incomingRef.current) {
    if (!call?.chatId) return;
    await updateCallFields(call.chatId, { status: 'ended', endedAt: Date.now(), endedBy: uid }).catch(() => {});
    setIncomingCall(null);
    setTimeout(() => remove(ref(db, `calls/${call.chatId}`)).catch(() => {}), 800);
  }

  function hangUp() {
    finishCall(currentCallIdRef.current).catch(() => {});
  }

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks?.().forEach(track => { track.enabled = !next; });
    setMuted(next);
  }

  React.useEffect(() => {
    if (!db || !uid || !Array.isArray(users)) return undefined;
    const stops = users
      .filter(user => user?.uid && user.uid !== uid)
      .map(user => {
        const callId = chatIdFor(uid, user.uid);
        return onValue(ref(db, `calls/${callId}`), snapshot => {
          const data = snapshot.val();
          if (!data) return;
          if (data.status === 'ended') {
            if (currentCallIdRef.current === callId) finishCall(callId, { removeRemote: false }).catch(() => {});
            if (incomingRef.current?.chatId === callId) setIncomingCall(null);
            return;
          }

          const peer = user;
          if (data.receiverId === uid && data.status === 'ringing' && data.callerId !== uid && data.offer) {
            const age = Date.now() - Number(data.createdAt || 0);
            if (age > CALL_RING_TIMEOUT_MS) {
              updateCallFields(callId, { status: 'ended', endedAt: Date.now(), endedBy: uid }).catch(() => {});
              return;
            }
            if (!activeRef.current && !incomingRef.current) {
              setIncomingCall({ chatId: callId, ...data, peer });
            }
          }

          if (data.callerId === uid && currentCallIdRef.current === callId && data.answer && pcRef.current && !remoteDescriptionSetRef.current) {
            pcRef.current.setRemoteDescription(data.answer)
              .then(() => {
                remoteDescriptionSetRef.current = true;
                return flushCandidates();
              })
              .catch(() => {});
            setActiveCall(prev => prev ? { ...prev, status: 'connecting' } : prev);
            clearTimeout(ringTimerRef.current);
            ringTimerRef.current = null;
          }
        });
      });
    return () => stops.forEach(stop => stop && stop());
  }, [uid, users]);

  React.useEffect(() => () => {
    const callId = currentCallIdRef.current;
    if (callId) updateCallFields(callId, { status: 'ended', endedAt: Date.now(), endedBy: uid }).catch(() => {});
    cleanupPeer();
  }, [uid]);

  return {
    activeCall,
    incomingCall,
    remoteStream,
    callError,
    setCallError,
    muted,
    startCall,
    acceptCall,
    declineCall,
    hangUp,
    toggleMute,
  };
}
