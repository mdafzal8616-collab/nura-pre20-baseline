package app.nura.claude

import android.content.Context
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * All Intentional Open data lives here, in this app's private storage on the phone.
 * Nothing is sent anywhere. Only package name, counts, durations and the reason the
 * user picked are stored - never anything from inside another app.
 */
object Store {
    private const val PREFS = "nura_pc"
    private const val KEEP_DAYS = 60

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun dayKey(t: Long = System.currentTimeMillis()): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(t))

    fun defaultConfig(): JSONObject = JSONObject()
        .put("enabled", false)
        .put("repeatCount", 3)
        .put("repeatWindowMin", 15)
        .put("graceMin", 10)
        .put("pauseFreshOpen", true)
        .put("apps", JSONObject())

    @Synchronized
    fun getConfig(c: Context): JSONObject {
        val raw = prefs(c).getString("config", null) ?: return defaultConfig()
        return try {
            val cfg = JSONObject(raw)
            val d = defaultConfig()
            for (k in d.keys()) if (!cfg.has(k)) cfg.put(k, d.get(k))
            cfg
        } catch (e: Exception) {
            defaultConfig()
        }
    }

    /** Keeps only known fields and clamps numbers, so a bad value can't break monitoring. */
    @Synchronized
    fun setConfig(c: Context, incoming: JSONObject) {
        val out = defaultConfig()
        out.put("enabled", incoming.optBoolean("enabled", false))
        out.put("repeatCount", incoming.optInt("repeatCount", 3).coerceIn(2, 10))
        out.put("repeatWindowMin", incoming.optInt("repeatWindowMin", 15).coerceIn(1, 120))
        out.put("graceMin", incoming.optInt("graceMin", 10).coerceIn(1, 120))
        out.put("pauseFreshOpen", incoming.optBoolean("pauseFreshOpen", true))
        val apps = JSONObject()
        val inApps = incoming.optJSONObject("apps")
        if (inApps != null) {
            for (pkg in inApps.keys()) {
                if (apps.length() >= 40) break
                val a = inApps.optJSONObject(pkg) ?: continue
                apps.put(
                    pkg, JSONObject()
                        .put("label", a.optString("label", pkg).take(60))
                        .put("dailyTargetMin", a.optInt("dailyTargetMin", 0).coerceIn(0, 1440))
                        .put("openLimit", a.optInt("openLimit", 0).coerceIn(0, 500))
                        .put("sessionMin", a.optInt("sessionMin", 0).coerceIn(0, 240))
                )
            }
        }
        out.put("apps", apps)
        prefs(c).edit().putString("config", out.toString()).apply()
    }

    fun heartbeat(c: Context, t: Long) { prefs(c).edit().putLong("heartbeat", t).apply() }
    fun lastHeartbeat(c: Context): Long = prefs(c).getLong("heartbeat", 0L)

    @Synchronized
    private fun day(c: Context, key: String): JSONObject {
        val raw = prefs(c).getString("stats_$key", null)
        return try {
            if (raw != null) JSONObject(raw) else emptyDay()
        } catch (e: Exception) {
            emptyDay()
        }
    }

    private fun emptyDay(): JSONObject = JSONObject()
        .put("apps", JSONObject())
        .put("pauses", 0)
        .put("wentBack", 0)
        .put("continued", 0)
        .put("intentions", JSONObject())
        .put("limitNotified", JSONObject())

    @Synchronized
    private fun mutate(c: Context, block: (JSONObject) -> Unit) {
        val key = dayKey()
        val d = day(c, key)
        block(d)
        prefs(c).edit().putString("stats_$key", d.toString()).apply()
    }

    private fun appEntry(d: JSONObject, pkg: String): JSONObject {
        val apps = d.getJSONObject("apps")
        if (!apps.has(pkg)) apps.put(pkg, JSONObject().put("opens", 0).put("ms", 0L))
        return apps.getJSONObject(pkg)
    }

    /** Returns how many times this app has been opened today, including this one. */
    @Synchronized
    fun addOpen(c: Context, pkg: String): Int {
        var n = 0
        mutate(c) { d ->
            val a = appEntry(d, pkg)
            n = a.optInt("opens", 0) + 1
            a.put("opens", n)
        }
        return n
    }

    /** Returns today's total milliseconds for this app after adding. */
    @Synchronized
    fun addMs(c: Context, pkg: String, ms: Long): Long {
        var total = 0L
        mutate(c) { d ->
            val a = appEntry(d, pkg)
            total = a.optLong("ms", 0L) + ms
            a.put("ms", total)
        }
        return total
    }

    fun todayOpens(c: Context, pkg: String): Int =
        day(c, dayKey()).getJSONObject("apps").optJSONObject(pkg)?.optInt("opens", 0) ?: 0

    fun todayMs(c: Context, pkg: String): Long =
        day(c, dayKey()).getJSONObject("apps").optJSONObject(pkg)?.optLong("ms", 0L) ?: 0L

    fun addPause(c: Context) = mutate(c) { it.put("pauses", it.optInt("pauses", 0) + 1) }
    fun addWentBack(c: Context) = mutate(c) { it.put("wentBack", it.optInt("wentBack", 0) + 1) }
    fun addContinued(c: Context) = mutate(c) { it.put("continued", it.optInt("continued", 0) + 1) }

    fun addIntention(c: Context, key: String) = mutate(c) { d ->
        val i = d.getJSONObject("intentions")
        i.put(key, i.optInt(key, 0) + 1)
    }

    /** True the first time it is called for this app today; false afterwards. */
    @Synchronized
    fun markLimitNotified(c: Context, pkg: String): Boolean {
        var first = false
        mutate(c) { d ->
            val n = d.getJSONObject("limitNotified")
            if (!n.optBoolean(pkg, false)) { n.put(pkg, true); first = true }
        }
        return first
    }

    /** Every stored day as { "yyyy-MM-dd": {...} }, oldest days pruned. */
    @Synchronized
    fun allStats(c: Context): JSONObject {
        val p = prefs(c)
        val out = JSONObject()
        val cutoff = dayKey(System.currentTimeMillis() - KEEP_DAYS * 86_400_000L)
        val edit = p.edit()
        for ((k, v) in p.all) {
            if (!k.startsWith("stats_") || v !is String) continue
            val date = k.removePrefix("stats_")
            if (date < cutoff) { edit.remove(k); continue }
            try { out.put(date, JSONObject(v)) } catch (_: Exception) {}
        }
        edit.apply()
        return out
    }
}
