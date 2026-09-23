package com.aditya.schoolchat;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "AudioRouter")
public class AudioRouterPlugin extends Plugin {
    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) {
            call.reject("Audio service unavailable");
            return;
        }
        try {
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audio.setSpeakerphoneOn(enabled);
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not change audio route", e);
        }
    }
}
