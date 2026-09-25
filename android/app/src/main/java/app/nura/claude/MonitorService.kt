package app.nura.claude

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import org.json.JSONObject

/**
 * Watches which app is in front, using UsageStatsManager (Usage Access granted by the
 * user). It only ever sees package names and timestamps - never what is inside an app.
 * It only reacts to apps the user selected, and stops itself when the feature is OFF or
 * Usage Access is revoked.
 */
class MonitorService : Service() {
    private val h = Handler(Looper.getMainLooper())
    private lateinit var usm: UsageStatsManager
    private var running = false
    private var lastEventTs = 0L
    private var lastTick = 0L
    private var fg: String? = null
    private val lastLeft = HashMap<String, Long>()
    private val recentOpens = HashMap<String, ArrayList<Long>>()
    private val graceUntil = HashMap<String, Long>()
    private val sessionEnd = HashMap<String, Long>()
    private var overlay: PauseOverlay? = null
    private var overlayPkg: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        createChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = buildOngoing()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ONGOING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ONGOING, n)
        }
        if (!running) {
            running = true
            val now = System.currentTimeMillis()
            lastEventTs = now - 2000
            lastTick = now
            h.post(loop)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        h.removeCallbacksAndMessages(null)
        overlay?.dismiss()
        overlay = null
        super.onDestroy()
    }

    private val loop = object : Runnable {
        override fun run() {
            if (!running) return
            try { tick() } catch (e: Exception) { Log.e(TAG, "tick failed", e) }
            if (running) h.postDelayed(this, 1000)
        }
    }

    private fun tick() {
        val cfg = Store.getConfig(this)
        if (!cfg.optBoolean("enabled") || !Perms.hasUsageAccess(this)) {
            running = false
            overlay?.dismiss()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        val now = System.currentTimeMillis()
        Store.heartbeat(this, now)
        val apps = cfg.getJSONObject("apps")

        val events = usm.queryEvents(lastEventTs + 1, now)
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            val pkg = e.packageName ?: continue
            if (e.timeStamp > lastEventTs) lastEventTs = e.timeStamp
            when (e.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> onResumed(pkg, e.timeStamp, apps, cfg)
                UsageEvents.Event.MOVE_TO_BACKGROUND -> if (pkg == fg) { fg = null; lastLeft[pkg] = e.timeStamp }
            }
        }

        // Time in a watched app only counts while no pause screen is waiting on the user.
        val cur = fg
        if (cur != null && apps.has(cur) && overlay == null) {
            val delta = (now - lastTick).coerceIn(0L, 3000L)
            val total = Store.addMs(this, cur, delta)
            val a = apps.getJSONObject(cur)
            val target = a.optInt("dailyTargetMin", 0)
            if (target > 0 && total >= target * 60_000L && Store.markLimitNotified(this, cur)) {
                notifyLimit("You've reached the ${a.optString("label", cur)} limit you chose ($target min today).")
            }
            val end = sessionEnd[cur]
            if (end != null && now >= end) {
                sessionEnd.remove(cur)
                notifyLimit("Your time in ${a.optString("label", cur)} is up. Finish what you came for, then leave.")
            }
        }
        lastTick = now
    }

    private fun onResumed(pkg: String, ts: Long, apps: JSONObject, cfg: JSONObject) {
        val prev = fg
        fg = pkg
        if (pkg == packageName) return

        // Any other app coming to the front while a pause is showing means the user left.
        if (overlay != null && overlayPkg != pkg) {
            overlay?.dismiss()
            overlay = null
            Store.addWentBack(this)
            overlayPkg = null
        }
        if (!apps.has(pkg)) return

        // Same app again within moments = moving between its own screens, not a new open.
        val cont = prev == pkg || (lastLeft[pkg]?.let { ts - it < 3000 } == true)
        if (cont) return
        handleOpen(pkg, ts, cfg, apps.getJSONObject(pkg))
    }

    private fun handleOpen(pkg: String, ts: Long, cfg: JSONObject, a: JSONObject) {
        val windowMs = cfg.optInt("repeatWindowMin", 15) * 60_000L
        val list = recentOpens.getOrPut(pkg) { ArrayList() }
        list.add(ts)
        list.removeAll { ts - it > windowMs }
        val opensToday = Store.addOpen(this, pkg)

        val repeated = list.size >= cfg.optInt("repeatCount", 3)
        val fresh = ts > (graceUntil[pkg] ?: 0L)
        val openLimit = a.optInt("openLimit", 0)
        val overOpenLimit = openLimit > 0 && opensToday > openLimit
        val target = a.optInt("dailyTargetMin", 0)
        val overTarget = target > 0 && Store.todayMs(this, pkg) >= target * 60_000L

        val need = (fresh && cfg.optBoolean("pauseFreshOpen", true)) || repeated || overOpenLimit
        if (!need || overlay != null) return
        if (!Perms.hasOverlay(this)) return

        val label = a.optString("label", pkg)
        val note = when {
            overOpenLimit -> "You chose to open $label up to $openLimit times a day. This is open number $opensToday."
            overTarget -> "You've passed the daily time you chose for $label ($target min)."
            repeated -> "You've opened $label ${list.size} times in the last ${cfg.optInt("repeatWindowMin", 15)} minutes."
            else -> null
        }
        if (repeated) list.clear()
        showPause(pkg, label, note, cfg, a)
    }

    private fun showPause(pkg: String, label: String, note: String?, cfg: JSONObject, a: JSONObject) {
        val icon = try { packageManager.getApplicationIcon(pkg) } catch (_: Exception) { null }
        Store.addPause(this)
        overlayPkg = pkg
        val o = PauseOverlay(this, label, icon, note, object : PauseOverlay.Callback {
            override fun onContinue(intention: String, limitMin: Int) {
                overlay = null; overlayPkg = null
                Store.addContinued(this@MonitorService)
                Store.addIntention(this@MonitorService, intention)
                val now = System.currentTimeMillis()
                val minutes = if (limitMin > 0) limitMin else a.optInt("sessionMin", 0)
                if (minutes > 0) {
                    sessionEnd[pkg] = now + minutes * 60_000L
                    graceUntil[pkg] = now + minutes * 60_000L
                } else {
                    graceUntil[pkg] = now + cfg.optInt("graceMin", 10) * 60_000L
                }
                lastTick = now
            }

            override fun onBack() {
                overlay = null; overlayPkg = null
                Store.addWentBack(this@MonitorService)
                graceUntil.remove(pkg)
                goHome()
            }
        })
        overlay = o
        try {
            o.show()
        } catch (e: Exception) {
            Log.e(TAG, "overlay failed", e)
            overlay = null; overlayPkg = null
        }
    }

    private fun goHome() {
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(i)
    }

    // ---- notifications ----

    private fun createChannels() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CH_ONGOING, "Intentional Open is on", NotificationManager.IMPORTANCE_MIN).apply {
            description = "Shown while NURA is watching the apps you selected. Turn the feature off in NURA to remove it."
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CH_LIMITS, "Limits you set", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Only when a time limit you chose is reached."
            setShowBadge(false)
        })
    }

    private fun openApp(): PendingIntent =
        PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)

    private fun buildOngoing(): Notification =
        Notification.Builder(this, CH_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_nura)
            .setContentTitle("Intentional Open is on")
            .setContentText("Watching only the apps you selected. Tap to change.")
            .setContentIntent(openApp())
            .setOngoing(true)
            .setShowWhen(false)
            .build()

    private fun notifyLimit(msg: String) {
        if (!Perms.hasNotifications(this)) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val n = Notification.Builder(this, CH_LIMITS)
            .setSmallIcon(R.drawable.ic_stat_nura)
            .setContentText(msg)
            .setContentIntent(openApp())
            .setAutoCancel(true)
            .build()
        nm.notify((System.currentTimeMillis() % 100000).toInt() + 10, n)
    }

    companion object {
        private const val TAG = "NuraMonitor"
        private const val CH_ONGOING = "nura_monitor"
        private const val CH_LIMITS = "nura_limits"
        private const val NOTIF_ONGOING = 1
    }
}
