package dev.callmeclaude.ui

import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

/** Session state labels, same as `SessionStateUI.label` on iOS. */
fun stateLabel(s: String): String = when (s) {
    "running" -> "Working"
    "waiting_permission" -> "Needs permission"
    "waiting_input" -> "Waiting for you"
    "blocked" -> "Stuck"
    "done" -> "Done"
    "errored" -> "Error"
    "stale" -> "Quiet"
    "ended" -> "Closed"
    else -> s
}

/**
 * English short relative time ("5 min. ago"), like iOS's RelativeDateTimeFormatter(.short, en_US).
 * Timestamps come from the computer's clock; a slightly-ahead clock must not read "in 1 sec.".
 */
fun relative(iso: String, now: Instant = Instant.now()): String {
    val t = try {
        Instant.parse(iso)
    } catch (_: DateTimeParseException) {
        return ""
    }
    val a = Duration.between(t, now).seconds.coerceAtLeast(0)
    val (n, unit) = when {
        a < 60 -> a to "sec."
        a < 3_600 -> a / 60 to "min."
        a < 86_400 -> a / 3_600 to "hr."
        a < 7 * 86_400 -> (a / 86_400).let { it to if (it == 1L) "day" else "days" }
        else -> (a / (7 * 86_400)).let { it to "wk." }
    }
    return "$n $unit ago"
}
