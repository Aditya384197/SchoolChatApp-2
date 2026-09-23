import { registerPlugin } from '@capacitor/core';

const AudioRouter = registerPlugin('AudioRouter');

export async function setSpeakerRoute(enabled) {
  if (!AudioRouter?.setSpeaker) return;
  await AudioRouter.setSpeaker({ enabled: Boolean(enabled) });
}
export async function getAudioRoutes() {
  try { return await AudioRouter.getRoutes(); } catch { return { bluetooth: false, speaker: false }; }
}
export async function setAudioRoute(route) {
  try { await AudioRouter.setRoute({ route }); } catch { if (route !== 'bluetooth') await setSpeakerRoute(route === 'speaker'); }
}
