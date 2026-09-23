import { registerPlugin } from '@capacitor/core';

const AudioRouter = registerPlugin('AudioRouter');

export async function setSpeakerRoute(enabled) {
  if (!AudioRouter?.setSpeaker) return;
  await AudioRouter.setSpeaker({ enabled: Boolean(enabled) });
}

export async function getAudioRoutes() {
  try {
    return await AudioRouter.getRoutes();
  } catch {
    return { bluetooth: false, speaker: false };
  }
}

export async function setAudioRoute(route) {
  try {
    await AudioRouter.setRoute({ route });
    return true;
  } catch {
    if (route !== 'bluetooth') {
      try { await setSpeakerRoute(route === 'speaker'); return true; } catch {}
    }
    return false;
  }
}

export async function clearAudioRoute() {
  try {
    await AudioRouter.clearRoute();
  } catch {
    // Older generated Android builds may not have the native clearRoute method.
  }
}
