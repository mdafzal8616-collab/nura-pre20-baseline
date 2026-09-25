package app.nura.claude

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The Intentional Open pause. Deliberately plain: no feed, no animation, no reward.
 * Continue is always reachable - this adds friction, it does not lock anything.
 */
class PauseOverlay(
    private val ctx: Context,
    private val label: String,
    private val icon: Drawable?,
    private val note: String?,
    private val cb: Callback
) {
    interface Callback {
        /** intention: "message", "specific:reply", "entertainment", "checking"... limitMin 0 = none */
        fun onContinue(intention: String, limitMin: Int)
        fun onBack()
    }

    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val h = Handler(Looper.getMainLooper())
    private val root = FrameLayout(ctx)
    private val column = LinearLayout(ctx)
    private var shown = false
    private var customMin = 10

    private val ivory = Color.parseColor("#F8F6F0")
    private val ink = Color.parseColor("#221F16")
    private val muted = Color.parseColor("#6B675B")
    private val emerald = Color.parseColor("#1B5E3F")
    private val line = Color.parseColor("#D9D4C5")

    private fun dp(v: Int): Int = (v * ctx.resources.displayMetrics.density).toInt()

    fun show() {
        root.setBackgroundColor(ivory)
        val scroll = ScrollView(ctx)
        scroll.isFillViewport = true
        column.orientation = LinearLayout.VERTICAL
        column.gravity = Gravity.CENTER_HORIZONTAL
        column.setPadding(dp(28), dp(56), dp(28), dp(40))
        scroll.addView(column, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(scroll, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        // Back key = go back, the natural reading of "not now".
        root.isFocusableInTouchMode = true
        root.setOnKeyListener { _, code, ev ->
            if (code == KeyEvent.KEYCODE_BACK && ev.action == KeyEvent.ACTION_UP) { goBack(); true } else false
        }

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.OPAQUE
        )
        wm.addView(root, lp)
        shown = true
        root.requestFocus()
        stageReason()
    }

    fun isShowing() = shown

    fun dismiss() {
        h.removeCallbacksAndMessages(null)
        if (shown) {
            try { wm.removeView(root) } catch (_: Exception) {}
            shown = false
        }
    }

    private fun goBack() { dismiss(); cb.onBack() }
    private fun proceed(intention: String, limitMin: Int) { dismiss(); cb.onContinue(intention, limitMin) }

    // ---- building blocks ----

    private fun reset(title: String?) {
        h.removeCallbacksAndMessages(null)
        column.removeAllViews()
        if (icon != null) {
            val iv = ImageView(ctx)
            iv.setImageDrawable(icon)
            column.addView(iv, LinearLayout.LayoutParams(dp(88), dp(88)).apply { bottomMargin = dp(14) })
        }
        column.addView(text(label, 28f, ink, true))
        column.addView(text("Pause for a moment.", 15f, muted, false).also { it.setPadding(0, dp(4), 0, dp(20)) })
        if (note != null) column.addView(text(note, 13.5f, muted, false).also { it.setPadding(0, 0, 0, dp(16)) })
        if (title != null) column.addView(text(title, 21f, ink, true).also { it.setPadding(0, 0, 0, dp(16)) })
    }

    private fun text(s: String, sp: Float, color: Int, bold: Boolean): TextView {
        val t = TextView(ctx)
        t.text = s
        t.textSize = sp
        t.setTextColor(color)
        t.gravity = Gravity.CENTER
        if (bold) t.setTypeface(t.typeface, Typeface.BOLD)
        return t
    }

    private fun button(s: String, primary: Boolean, onClick: () -> Unit): TextView {
        val b = text(s, 16f, if (primary) Color.WHITE else emerald, true)
        val bg = GradientDrawable()
        bg.cornerRadius = dp(14).toFloat()
        if (primary) bg.setColor(emerald) else { bg.setColor(Color.TRANSPARENT); bg.setStroke(dp(1), emerald) }
        b.background = bg
        b.setPadding(dp(16), dp(16), dp(16), dp(16))
        b.setOnClickListener { onClick() }
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.bottomMargin = dp(10)
        column.addView(b, lp)
        return b
    }

    private fun backLink() {
        val t = text("Go back", 15f, muted, false)
        t.setPadding(dp(12), dp(16), dp(12), dp(8))
        t.setOnClickListener { goBack() }
        column.addView(t)
    }

    // ---- stages ----

    private fun stageReason() {
        reset("Why are you opening this?")
        button("I need to message someone", false) { proceed("message", 0) }
        button("I need something specific", false) { stageSpecific() }
        button("Entertainment", false) { stageLimit("entertainment") }
        button("Just checking", false) { stageChecking() }
        backLink()
    }

    private fun stageSpecific() {
        reset("What are you here to do?")
        button("Reply to a message", false) { stageLimit("specific:reply") }
        button("Upload something", false) { stageLimit("specific:upload") }
        button("Find information", false) { stageLimit("specific:find") }
        button("Other", false) { stageLimit("specific:other") }
        backLink()
    }

    private fun stageLimit(intention: String) {
        reset("Set a limit?")
        column.addView(text("Finish what you came for, then leave.", 14f, muted, false).also { it.setPadding(0, 0, 0, dp(16)) })
        button("5 min", false) { proceed(intention, 5) }
        button("10 min", false) { proceed(intention, 10) }
        button("15 min", false) { proceed(intention, 15) }

        val row = LinearLayout(ctx)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.CENTER_VERTICAL
        val value = text("$customMin min", 18f, ink, true)
        val minus = stepButton("−") { if (customMin > 1) customMin -= 1; value.text = "$customMin min" }
        val plus = stepButton("+") { if (customMin < 240) customMin += 1; value.text = "$customMin min" }
        row.addView(minus)
        row.addView(value, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(plus)
        column.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(10) })
        button("Use custom limit", false) { proceed(intention, customMin) }
        button("No limit", true) { proceed(intention, 0) }
        backLink()
    }

    private fun stepButton(s: String, onClick: () -> Unit): TextView {
        val b = text(s, 22f, emerald, true)
        val bg = GradientDrawable()
        bg.shape = GradientDrawable.OVAL
        bg.setStroke(dp(1), line)
        b.background = bg
        b.layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
        b.setOnClickListener { onClick() }
        return b
    }

    private fun stageChecking() {
        reset(null)
        column.addView(text("Give yourself 5 seconds.", 21f, ink, true).also { it.setPadding(0, 0, 0, dp(16)) })
        val count = text("5", 64f, emerald, true)
        column.addView(count)
        var left = 5
        val tick = object : Runnable {
            override fun run() {
                left -= 1
                if (left <= 0) { stageConfirm(); return }
                count.text = left.toString()
                h.postDelayed(this, 1000)
            }
        }
        h.postDelayed(tick, 1000)
        column.addView(View(ctx), LinearLayout.LayoutParams(1, dp(24)))
        backLink()
    }

    private fun stageConfirm() {
        reset("Do you still want to open $label?")
        button("Continue", true) { proceed("checking", 0) }
        button("Go Back", false) { goBack() }
    }
}
