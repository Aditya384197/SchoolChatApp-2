package com.aditya.schoolchat;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Android-10-safe system-bar appearance helper. */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {
    @PluginMethod
    public void getInsets(PluginCall call) {
        try {
            View decor = getActivity().getWindow().getDecorView();
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
            Insets bars = insets == null
                    ? Insets.NONE
                    : insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets == null
                    ? Insets.NONE
                    : insets.getInsets(WindowInsetsCompat.Type.ime());

            JSObject result = new JSObject();
            result.put("top", bars.top);
            result.put("bottom", bars.bottom);
            result.put("left", bars.left);
            result.put("right", bars.right);
            result.put("imeBottom", ime.bottom);
            call.resolve(result);
        } catch (Exception e) {
            JSObject result = new JSObject();
            result.put("top", 0);
            result.put("bottom", 0);
            result.put("left", 0);
            result.put("right", 0);
            result.put("imeBottom", 0);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void setAppearance(PluginCall call) {
        boolean dark = call.getBoolean("dark", false);
        try {
            apply(getActivity().getWindow(), dark);
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not apply system-bar appearance", e);
        }
    }

    public static void apply(Window window, boolean dark) {
        if (window == null) return;

        // Android 10 (API 29) is deliberately kept on the legacy-compatible
        // decor-layout path. Android 11+ can additionally use WindowCompat's
        // edge-to-edge API. This avoids startup crashes on older WebViews/OSes.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowCompat.setDecorFitsSystemWindows(window, false);
        }

        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
            window.setNavigationBarDividerColor(Color.TRANSPARENT);
        }

        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        if (!dark) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        window.getDecorView().setSystemUiVisibility(flags);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
        }
    }
}
