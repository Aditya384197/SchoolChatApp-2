package com.aditya.schoolchat;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Build;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

@CapacitorPlugin(name = "AudioRouter")
public class AudioRouterPlugin extends Plugin {
    private static Ringtone activeRingtone;

    @PluginMethod
    public void startRingtone(PluginCall call) {
        try {
            stopRingtoneInternal();
            Context context = getContext();
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            Ringtone ringtone = uri == null ? null : RingtoneManager.getRingtone(context, uri);
            if (ringtone == null) {
                call.resolve();
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                ringtone.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
            }
            activeRingtone = ringtone;
            ringtone.play();
            call.resolve();
        } catch (Exception e) {
            call.resolve();
        }
    }

    @PluginMethod
    public void stopRingtone(PluginCall call) {
        stopRingtoneInternal();
        call.resolve();
    }

    private static synchronized void stopRingtoneInternal() {
        try {
            if (activeRingtone != null && activeRingtone.isPlaying()) activeRingtone.stop();
        } catch (Exception ignored) {
        } finally {
            activeRingtone = null;
        }
    }

    private AudioManager audioManager() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void getRoutes(PluginCall call) {
        AudioManager audio = audioManager();
        JSObject result = new JSObject();
        boolean bluetooth = false;
        boolean speaker = false;

        if (audio != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                List<AudioDeviceInfo> devices = audio.getAvailableCommunicationDevices();
                for (AudioDeviceInfo device : devices) {
                    if (isBluetoothDevice(device.getType())) bluetooth = true;
                    if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) speaker = true;
                }
                AudioDeviceInfo current = audio.getCommunicationDevice();
                if (current != null && current.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    speaker = true;
                }
            } else {
                bluetooth = audio.isBluetoothA2dpOn() || audio.isBluetoothScoOn();
                speaker = audio.isSpeakerphoneOn();
            }
        }

        result.put("bluetooth", bluetooth);
        result.put("speaker", speaker);
        call.resolve(result);
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        String route = call.getString("route", "earpiece");
        AudioManager audio = audioManager();
        if (audio == null) {
            call.reject("Audio service unavailable");
            return;
        }

        try {
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            boolean applied;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                applied = applyModernRoute(audio, route);
            } else {
                applied = applyLegacyRoute(audio, route);
            }
            if (!applied) {
                call.reject("Requested audio route is not available.");
                return;
            }
            JSObject result = new JSObject();
            result.put("route", route);
            call.resolve(result);
        } catch (SecurityException e) {
            call.reject("Bluetooth/audio permission is required for this route.", e);
        } catch (Exception e) {
            call.reject("Could not change audio route", e);
        }
    }

    @PluginMethod
    public void clearRoute(PluginCall call) {
        AudioManager audio = audioManager();
        if (audio == null) {
            call.resolve();
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audio.clearCommunicationDevice();
            } else {
                audio.setSpeakerphoneOn(false);
                if (audio.isBluetoothScoOn()) {
                    audio.setBluetoothScoOn(false);
                    try { audio.stopBluetoothSco(); } catch (Exception ignored) { }
                }
                audio.setMode(AudioManager.MODE_NORMAL);
            }
            call.resolve();
        } catch (Exception e) {
            call.resolve();
        }
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        setRouteDirect(enabled ? "speaker" : "earpiece", call);
    }

    private void setRouteDirect(String route, PluginCall call) {
        AudioManager audio = audioManager();
        if (audio == null) {
            call.reject("Audio service unavailable");
            return;
        }
        try {
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            boolean applied = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? applyModernRoute(audio, route)
                    : applyLegacyRoute(audio, route);
            if (!applied) {
                call.reject("Requested audio route is not available.");
                return;
            }
            JSObject result = new JSObject();
            result.put("enabled", "speaker".equals(route));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not change audio route", e);
        }
    }

    private static boolean applyModernRoute(AudioManager audio, String route) {
        if ("earpiece".equals(route)) {
            return applyDeviceType(audio, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE);
        }
        if ("speaker".equals(route)) {
            return applyDeviceType(audio, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
        }
        if ("bluetooth".equals(route)) {
            for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
                if (isBluetoothDevice(device.getType()) && audio.setCommunicationDevice(device)) {
                    return true;
                }
            }
            return false;
        }
        return false;
    }

    private static boolean applyDeviceType(AudioManager audio, int type) {
        for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
            if (device.getType() == type) return audio.setCommunicationDevice(device);
        }
        return false;
    }

    private static boolean applyLegacyRoute(AudioManager audio, String route) {
        if ("speaker".equals(route)) {
            audio.setBluetoothScoOn(false);
            try { audio.stopBluetoothSco(); } catch (Exception ignored) { }
            audio.setSpeakerphoneOn(true);
            return true;
        }
        if ("earpiece".equals(route)) {
            audio.setBluetoothScoOn(false);
            try { audio.stopBluetoothSco(); } catch (Exception ignored) { }
            audio.setSpeakerphoneOn(false);
            return true;
        }
        if ("bluetooth".equals(route)) {
            if (!audio.isBluetoothScoAvailableOffCall()) return false;
            audio.setSpeakerphoneOn(false);
            audio.startBluetoothSco();
            audio.setBluetoothScoOn(true);
            return true;
        }
        return false;
    }

    private static boolean isBluetoothDevice(int type) {
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
            return true;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET) {
            return true;
        }
        return type == AudioDeviceInfo.TYPE_HEARING_AID;
    }
}
