import { registerPlugin } from '@capacitor/core';

const AudioRouter = registerPlugin('AudioRouter');

export async function setSpeakerRoute(enabled) {
  if (!AudioRouter?.setSpeaker) return;
  await AudioRouter.setSpeaker({ enabled: Boolean(enabled) });
}
