package dev.callmeclaude

/**
 * "Call Claude" without opening the app first: the app shortcut, the quick settings tile and the
 * optional "Call Claude" launcher entry all land in [CallClaudeActivity], which picks one of these.
 * Pure, so the choice is unit tested; the call itself is the home screen button's path.
 */
enum class QuickCall {
    /** Not paired: open the app, which shows pairing. No call. */
    OPEN_PAIRING,

    /** A call is ringing or live: bring its screen forward instead of starting another. */
    SHOW_CALL,

    /** No microphone permission: hand over to the home screen, which asks and then calls. */
    ASK_MICROPHONE,

    /** Place the call. Offline is not special: the call says the computer can't be reached. */
    PLACE_CALL,
}

/**
 * [callLive]: a call is ringing or in progress. A failed attempt that only lingers on screen with
 * the hub's error doesn't count (the button would replace it too).
 * [connected] is deliberately not consulted: the home screen button calls while offline as well,
 * and the call reports "can't be reached" in Claude's voice language.
 */
@Suppress("UNUSED_PARAMETER")
fun decideQuickCall(paired: Boolean, callLive: Boolean, micGranted: Boolean, connected: Boolean): QuickCall = when {
    !paired -> QuickCall.OPEN_PAIRING
    callLive -> QuickCall.SHOW_CALL
    !micGranted -> QuickCall.ASK_MICROPHONE
    else -> QuickCall.PLACE_CALL
}

/** The intent action behind every quick entry point (shortcut, tile, launcher entry). */
const val ACTION_CALL_CLAUDE = "dev.callmeclaude.action.CALL_CLAUDE"
