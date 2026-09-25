package app.nura.claude

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/** After a reboot, resume monitoring only if the user had turned Intentional Open on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val cfg = Store.getConfig(context)
        if (cfg.optBoolean("enabled") && Perms.hasUsageAccess(context)) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, MonitorService::class.java))
            } catch (_: Exception) {
                // Some phones block this at boot; NURA shows "monitoring stopped" next time it is opened.
            }
        }
    }
}
