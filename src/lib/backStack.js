// A tiny, app-wide "what's currently open on top" stack so the Android
// hardware/gesture back button can close just the topmost screen/overlay
// (a chat, a settings sub-panel, the status viewer, an action sheet...)
// instead of Capacitor's default behaviour of exiting the whole app from
// wherever you happen to be.
//
// Any dismissible screen calls useBackHandler(closeFn) while it's open; the
// hook pushes closeFn on mount and pops it on unmount. The single native
// listener (wired up in nativeBack.js) always calls whatever is currently on
// top. If the stack is empty, there's nothing to close -- that's the "how do
// we exit the app" case, handled separately with a double-press-to-exit.
import { useEffect } from 'react';

let stack = [];

export function pushBack(handler) {
  stack.push(handler);
  return () => {
    stack = stack.filter(h => h !== handler);
  };
}

// Returns true if something was open and got closed; false if the stack was
// empty (caller is then responsible for exit-app / do-nothing logic).
export function popBack() {
  if (stack.length === 0) return false;
  const handler = stack[stack.length - 1];
  handler();
  return true;
}

// React helper: call with a function that closes/steps back the calling
// screen. Pass null/undefined to temporarily not register (e.g. only while
// a condition is true) without having to conditionally call the hook.
export function useBackHandler(closeFn) {
  useEffect(() => {
    if (!closeFn) return undefined;
    return pushBack(closeFn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeFn]);
}
