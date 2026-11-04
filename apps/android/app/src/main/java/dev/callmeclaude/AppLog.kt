package dev.callmeclaude

import android.util.Log

/**
 * Logcat plus, for [i] and [w], the hub (see [RemoteLog]). The counterpart of iOS `Log.d`: the same
 * events are forwarded (connection lifecycle, calls, call audio summaries, route changes, service
 * problems); chatty internals stay at [d] and only reach logcat.
 *
 * Never pass a transcript, the token or anything the user said: redaction is a safety net, not a filter.
 */
object AppLog {
    /** Set by [HubClient]; called from any thread. */
    @Volatile var sink: ((RemoteLog.Level, String, String) -> Unit)? = null

    fun d(tag: String, msg: String) {
        Log.d(tag, msg)
    }

    fun i(tag: String, msg: String) {
        Log.i(tag, msg)
        sink?.invoke(RemoteLog.Level.INFO, tag, msg)
    }

    fun w(tag: String, msg: String) {
        Log.w(tag, msg)
        sink?.invoke(RemoteLog.Level.WARN, tag, msg)
    }
}
