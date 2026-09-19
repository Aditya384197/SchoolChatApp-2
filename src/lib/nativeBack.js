import { App as CapApp } from '@capacitor/app';
import { popBack } from './backStack';

let lastPressAt = 0;
let onExitWarning = null;
let started = false;

// Called once from the root component with a function that shows a brief
// "press back again to exit" message.
export function setExitWarningHandler(fn) {
  onExitWarning = fn;
}

export function initNativeBack() {
  if (started) return;
  started = true;
  CapApp.addListener('backButton', () => {
    if (popBack()) return; // closed a screen/overlay -- one step back, done

    const now = Date.now();
    if (now - lastPressAt < 2000) {
      CapApp.exitApp();
    } else {
      lastPressAt = now;
      onExitWarning?.();
    }
  });
}
