package dev.callmeclaude

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/**
 * WebSocket connection to the hub. JSON text frames = control, binary frames = audio.
 *
 * Port of apps/ios/CallMeClaude/HubClient.swift. Connecting races all pairing URLs (Tailscale IP,
 * MagicDNS name, LAN IP) in parallel; the first one that answers wins and the others are cancelled.
 *
 * This class does not know about Activities. Anything that needs the link up (the UI, the
 * foreground service, a live call) calls [setActive] with its own reason; the client keeps
 * reconnecting while at least one reason is active.
 */
class HubClient(
    private val store: PairingStore,
    private val deviceName: String,
) {
    private val _connected = MutableStateFlow(false)
    private val _snapshot = MutableStateFlow<Snapshot?>(null)
    private val _lastSeen = MutableStateFlow<Long?>(null)
    private val _status = MutableStateFlow("Not connected")
    private val _pairing = MutableStateFlow(store.load())

    val connected: StateFlow<Boolean> = _connected.asStateFlow()
    val snapshot: StateFlow<Snapshot?> = _snapshot.asStateFlow()
    val lastSeen: StateFlow<Long?> = _lastSeen.asStateFlow()
    val status: StateFlow<String> = _status.asStateFlow()
    val pairing: StateFlow<PairingInfo?> = _pairing.asStateFlow()

    /** Binary frames (assistant audio). Called on OkHttp's reader thread. */
    @Volatile var onBinary: ((ByteString) -> Unit)? = null

    /** Messages the client doesn't handle itself (call.*, audio.flush, transcript…). Called on the hub thread. */
    @Volatile var onMessage: ((HubMessage) -> Unit)? = null

    /** Fired after every successful (re)connection + hello. Called on the hub thread. */
    @Volatile var onConnected: (() -> Unit)? = null

    /** Fired when an established connection is lost or closed. Called on the hub thread. */
    @Volatile var onDisconnected: (() -> Unit)? = null

    // Everything below is confined to the single hub thread (the `q` of the iOS version).
    private val q = Executors.newSingleThreadExecutor { r -> Thread(r, "cmc.hub").apply { isDaemon = true } }
        .asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + q)
    private val main = Handler(Looper.getMainLooper())

    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        // WebSocket ping every 8 s keeps NAT mappings alive and detects dead links: OkHttp fails the
        // socket when a pong hasn't arrived by the next ping.
        .pingInterval(8, TimeUnit.SECONDS)
        .build()

    @Volatile private var task: WebSocket? = null          // the winning connection
    private val candidates = mutableListOf<WebSocket>()    // racing connections
    private var isConnected = false
    private var generation = 0
    private val helloWaiters = mutableListOf<(Boolean) -> Unit>()
    private var reconnectScheduled = false
    private val activeReasons = mutableSetOf<String>()

    private fun post(block: () -> Unit) {
        scope.launch { block() }
    }

    // region connection

    /** Keep the link up while [reason] is active (e.g. "ui" while the app is in the foreground). */
    fun setActive(reason: String, active: Boolean) = post {
        if (active) activeReasons += reason else activeReasons -= reason
        if (active) ensureConnectedLocked(null)
    }

    /** Connect (if needed) and call back on the main thread once the hub said hello (or gave up). */
    fun ensureConnected(done: ((Boolean) -> Unit)? = null) = post { ensureConnectedLocked(done) }

    private fun ensureConnectedLocked(done: ((Boolean) -> Unit)?) {
        if (isConnected) {
            done?.let { main.post { it(true) } }
            return
        }
        done?.let { helloWaiters += it }
        if (task == null && candidates.isEmpty()) open()
    }

    private val shouldStayConnected: Boolean
        get() = _pairing.value != null && (activeReasons.isNotEmpty() || helloWaiters.isNotEmpty())

    private fun open() {
        val p = _pairing.value
        if (p == null || p.urls.isEmpty()) {
            _status.value = "Not paired"
            flushWaiters(false)
            return
        }
        generation += 1
        val gen = generation
        _status.value = "Connecting…"
        Log.d(TAG, "connecting: racing ${p.urls.size} addresses")
        val auth = AppMessages.auth(p.token, deviceName)
        p.urls.forEachIndexed { i, s ->
            val req = try {
                Request.Builder().url(s).build()
            } catch (_: IllegalArgumentException) {
                return@forEachIndexed
            }
            candidates += http.newWebSocket(req, Listener(gen, i, req.url.host, auth))
        }
        scope.launch {
            delay(7_000)
            if (gen != generation || isConnected) return@launch
            Log.d(TAG, "connect: no address answered within 7s")
            candidates.forEach { it.cancel() }
            candidates.clear()
            task?.cancel()
            task = null
            _status.value = "Can't reach your computer"
            flushWaiters(false)
            scheduleReconnect(3_000)
        }
    }

    private inner class Listener(
        private val gen: Int,
        private val index: Int,
        private val host: String,
        private val auth: String,
    ) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send(auth)
        }

        override fun onMessage(webSocket: WebSocket, text: String) = post {
            if (task == null) {
                // Still racing: the first answer wins.
                if (gen != generation || webSocket !in candidates) {
                    webSocket.cancel()
                    return@post
                }
                task = webSocket
                candidates.filter { it !== webSocket }.forEach { it.cancel() }
                candidates.clear()
                Log.d(TAG, "connected via #$index $host")
                handle(text)
            } else if (task === webSocket) {
                handle(text)
            } else {
                webSocket.cancel()
            }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            // Audio. Delivered straight from the reader thread, like the iOS client does.
            if (task === webSocket) onBinary?.invoke(bytes)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
            ended(webSocket, "closed by hub: $code $reason")
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            ended(webSocket, t.message ?: t.javaClass.simpleName)
        }

        private fun ended(webSocket: WebSocket, why: String) = post {
            if (task == null && candidates.remove(webSocket)) {
                Log.d(TAG, "address #$index $host failed: $why")
            } else if (task === webSocket && gen == generation) {
                drop("receive: $why")
            }
        }
    }

    /** The established connection died. */
    private fun drop(why: String) {
        Log.d(TAG, "connection lost: $why")
        task?.cancel()
        task = null
        generation += 1
        setConnected(false)
        onDisconnected?.invoke()
        _status.value = "Connection lost, reconnecting…"
        scheduleReconnect(500)
    }

    private fun scheduleReconnect(afterMs: Long) {
        if (reconnectScheduled) return
        reconnectScheduled = true
        scope.launch {
            delay(afterMs)
            reconnectScheduled = false
            if (task != null || candidates.isNotEmpty()) return@launch
            if (shouldStayConnected) open()
        }
    }

    private fun setConnected(v: Boolean) {
        isConnected = v
        _connected.value = v
    }

    private fun flushWaiters(ok: Boolean) {
        val ws = helloWaiters.toList()
        helloWaiters.clear()
        if (ws.isNotEmpty()) main.post { ws.forEach { it(ok) } }
    }

    fun setPairing(p: PairingInfo?) = post {
        store.save(p)
        _pairing.value = p
        if (p == null) _snapshot.value = null
        generation += 1
        task?.close(1000, null)
        task = null
        candidates.forEach { it.close(1000, null) }
        candidates.clear()
        if (isConnected) onDisconnected?.invoke()
        setConnected(false)
        if (p != null) open() else _status.value = "Not paired"
    }

    // endregion

    // region messages

    private fun handle(text: String) {
        val msg = HubMessage.parse(text) ?: return
        _lastSeen.value = System.currentTimeMillis()
        when (msg) {
            is HubMessage.Hello -> {
                msg.snapshot?.let { _snapshot.value = it }
                setConnected(true)
                _status.value = "Connected to ${_pairing.value?.name ?: "computer"}"
                flushWaiters(true)
                onConnected?.invoke()
            }
            is HubMessage.SnapshotUpdate -> msg.snapshot?.let { _snapshot.value = it }
            is HubMessage.Heartbeat -> Unit
            is HubMessage.Error -> Log.d(TAG, "hub error: ${msg.message}")
            else -> onMessage?.invoke(msg)
        }
    }

    // endregion

    // region send

    fun sendJSON(text: String) {
        task?.send(text)
    }

    /** Microphone audio. Thread-safe; dropped while there is no connection (the hub keeps the call ~20 s). */
    fun sendBinary(bytes: ByteArray) {
        task?.send(bytes.toByteString())
    }

    fun setMode(mode: String) = sendJSON(AppMessages.modeSet(mode))
    fun setLanguage(code: String) = sendJSON(AppMessages.languageSet(code))
    fun panic() = sendJSON(AppMessages.panic())
    fun resume() = sendJSON(AppMessages.resume())
    fun resolve(pendingId: String, decision: Decision, note: String? = null) =
        sendJSON(AppMessages.resolve(pendingId, decision, note))

    // endregion

    private companion object {
        const val TAG = "cmc.hub"
    }
}
