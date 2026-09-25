package app.nura.claude

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * The only door between the NURA website and Android. Each method does one real thing.
 * Nothing here reads content from other apps.
 */
class NativeBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun version(): String = "1"

    @JavascriptInterface
    fun getStatus(): String {
        val cfg = Store.getConfig(activity)
        val beat = Store.lastHeartbeat(activity)
        val age = if (beat == 0L) -1L else System.currentTimeMillis() - beat
        val missing = JSONArray()
        val apps = cfg.getJSONObject("apps")
        for (pkg in apps.keys()) {
            if (activity.packageManager.getLaunchIntentForPackage(pkg) == null) missing.put(pkg)
        }
        return JSONObject()
            .put("sdk", Build.VERSION.SDK_INT)
            .put("enabled", cfg.optBoolean("enabled"))
            .put("usageAccess", Perms.hasUsageAccess(activity))
            .put("overlay", Perms.hasOverlay(activity))
            .put("notifications", Perms.hasNotifications(activity))
            .put("batteryUnrestricted", Perms.batteryUnrestricted(activity))
            .put("serviceRunning", age in 0..8000)
            .put("heartbeatAgeMs", age)
            .put("missing", missing)
            .toString()
    }

    @JavascriptInterface
    fun listApps(): String {
        val pm = activity.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val out = JSONArray()
        val seen = HashSet<String>()
        val rows = pm.queryIntentActivities(intent, 0)
            .map { Pair(it.activityInfo.packageName, it.loadLabel(pm).toString()) }
            .filter { it.first != activity.packageName && seen.add(it.first) }
            .sortedBy { it.second.lowercase() }
        for ((pkg, label) in rows) out.put(JSONObject().put("pkg", pkg).put("label", label))
        return out.toString()
    }

    // Payment apps NURA may open for "Move Money Now". Fixed list on purpose.
    private val payApps = listOf(
        "com.google.android.apps.nbu.paisa.user" to "Google Pay",
        "com.phonepe.app" to "PhonePe",
        "net.one97.paytm" to "Paytm",
        "in.org.npci.upiapp" to "BHIM"
    )

    @JavascriptInterface
    fun listPaymentApps(): String {
        val out = JSONArray()
        for ((pkg, label) in payApps) {
            if (activity.packageManager.getLaunchIntentForPackage(pkg) != null) {
                out.put(JSONObject().put("pkg", pkg).put("label", label))
            }
        }
        return out.toString()
    }

    /** Only opens the app. Nothing is sent to it and nothing is read from it. */
    @JavascriptInterface
    fun launchApp(pkg: String): Boolean {
        if (payApps.none { it.first == pkg }) return false
        val i = activity.packageManager.getLaunchIntentForPackage(pkg) ?: return false
        launch(i)
        return true
    }

    @JavascriptInterface
    fun getConfig(): String = Store.getConfig(activity).toString()

    /** Saves settings. Turning it ON needs Usage Access; the service starts/stops to match. */
    @JavascriptInterface
    fun setConfig(json: String): Boolean {
        val incoming = try { JSONObject(json) } catch (e: Exception) { return false }
        val wantOn = incoming.optBoolean("enabled", false)
        if (wantOn && !Perms.hasUsageAccess(activity)) {
            incoming.put("enabled", false)
            Store.setConfig(activity, incoming)
            return false
        }
        Store.setConfig(activity, incoming)
        if (wantOn) startMonitor() else stopMonitor()
        return true
    }

    @JavascriptInterface
    fun restartMonitor(): Boolean {
        val cfg = Store.getConfig(activity)
        if (!cfg.optBoolean("enabled") || !Perms.hasUsageAccess(activity)) return false
        startMonitor()
        return true
    }

    @JavascriptInterface
    fun getAllStats(): String = Store.allStats(activity).toString()

    // ---- settings screens (opened only after the web UI has explained why) ----

    @JavascriptInterface
    fun openUsageAccessSettings() = launch(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))

    @JavascriptInterface
    fun openOverlaySettings() =
        launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + activity.packageName)))

    @JavascriptInterface
    fun openBatterySettings() = launch(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))

    @JavascriptInterface
    fun openAppSettings() =
        launch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.packageName)))

    @JavascriptInterface
    fun requestNotifications() {
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                // If Android has stopped showing the prompt, this returns at once and the user can use App settings.
                activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7)
            } else {
                launch(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName))
            }
        }
    }

    private fun launch(i: Intent) {
        activity.runOnUiThread {
            try { activity.startActivity(i) } catch (_: Exception) {
                try { activity.startActivity(Intent(Settings.ACTION_SETTINGS)) } catch (_: Exception) {}
            }
        }
    }

    private fun startMonitor() {
        activity.runOnUiThread {
            try {
                ContextCompat.startForegroundService(activity, Intent(activity, MonitorService::class.java))
            } catch (_: Exception) {}
        }
    }

    private fun stopMonitor() {
        activity.runOnUiThread { activity.stopService(Intent(activity, MonitorService::class.java)) }
    }
}
