package dev.callmeclaude

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log

/**
 * Follows the system default network and reports when it goes away or changes, so [HubClient]
 * can drop a socket that is bound to a dead network and reconnect the moment a usable one is back,
 * instead of waiting for a WebSocket ping to time out.
 *
 * Callbacks arrive on ConnectivityManager's own thread; the listener hops to the hub thread.
 */
class NetworkWatcher(context: Context, private val listener: (Change) -> Unit) {

    sealed interface Change {
        /** A default network is up ([id] changes when Wi-Fi ↔ mobile data switches). */
        data class Available(val id: String, val kind: String) : Change
        /** There is no default network any more. */
        data object Lost : Change
    }

    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private var current: Network? = null

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            Log.d(TAG, "default network available: ${idOf(network)}")
        }

        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            val kind = kindOf(caps)
            if (network != current) {
                current = network
                Log.d(TAG, "default network is now ${idOf(network)} ($kind)")
                listener(Change.Available(idOf(network), kind))
            }
        }

        override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) = Unit

        override fun onLost(network: Network) {
            Log.d(TAG, "default network lost: ${idOf(network)}")
            if (network == current) {
                current = null
                listener(Change.Lost)
            }
        }
    }

    /** Every network, not only the default one: logs when Wi-Fi is up but not (yet) the default. */
    private val all = object : ConnectivityManager.NetworkCallback() {
        private val validated = mutableMapOf<Network, Boolean>()
        override fun onAvailable(network: Network) {
            Log.d(TAG, "network up: ${idOf(network)}")
        }
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            val v = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            if (validated.put(network, v) != v) Log.d(TAG, "network ${idOf(network)} (${kindOf(caps)}) validated=$v")
        }
        override fun onLost(network: Network) {
            validated.remove(network)
            Log.d(TAG, "network down: ${idOf(network)}")
        }
    }

    fun start() {
        try {
            cm.registerNetworkCallback(NetworkRequest.Builder().build(), all)
            cm.registerDefaultNetworkCallback(callback)
        } catch (e: RuntimeException) {
            // SecurityException without ACCESS_NETWORK_STATE, or too many callbacks.
            Log.w(TAG, "registerDefaultNetworkCallback failed: $e")
        }
    }

    /** The default network right now, as reported to the listener (null = none / not known yet). */
    val currentId: String? get() = current?.let(::idOf)

    private companion object {
        const val TAG = "cmc.net"

        fun idOf(n: Network) = n.toString()

        fun kindOf(c: NetworkCapabilities) = when {
            c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            c.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            c.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
    }
}
