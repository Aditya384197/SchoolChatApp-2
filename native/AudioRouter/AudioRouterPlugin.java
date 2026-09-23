package com.aditya.schoolchat;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "AudioRouter")
public class AudioRouterPlugin extends Plugin {
    @PluginMethod
    public void getRoutes(PluginCall call) {
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        JSObject result = new JSObject();
        result.put("bluetooth", audio != null && (audio.isBluetoothA2dpOn() || audio.isBluetoothScoOn()));
        result.put("speaker", audio != null && audio.isSpeakerphoneOn());
        call.resolve(result);
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        String route = call.getString("route", "earpiece");
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) { call.reject("Audio service unavailable"); return; }
        try {
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            if ("speaker".equals(route)) { audio.setSpeakerphoneOn(true); }
            else if ("earpiece".equals(route)) { audio.setSpeakerphoneOn(false); }
            else if ("bluetooth".equals(route)) {
                audio.setSpeakerphoneOn(false);
                if (audio.isBluetoothScoAvailableOffCall()) audio.startBluetoothSco();
                audio.setBluetoothScoOn(true);
            }
            JSObject result = new JSObject(); result.put("route", route); call.resolve(result);
        } catch (Exception e) { call.reject("Could not change audio route", e); }
    }

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
