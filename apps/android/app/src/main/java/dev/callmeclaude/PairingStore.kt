package dev.callmeclaude

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeps the pairing (including the hub token) in app-private storage, encrypted with an AES-GCM key
 * that lives in the Android Keystore and never leaves it. The iOS counterpart is the Keychain
 * (`PairingStore` in Models.swift). Backups are disabled in the manifest; and even if the file were
 * copied, the key stays behind on this device.
 */
@Suppress("UseKtx") // core-ktx is not a dependency
class PairingStore(context: Context) {
    private val prefs = context.getSharedPreferences("pairing", Context.MODE_PRIVATE)

    fun load(): PairingInfo? {
        val blob = prefs.getString(KEY, null) ?: return null
        return try {
            val bytes = Base64.decode(blob, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_LEN))
            val json = String(cipher.doFinal(bytes, IV_LEN, bytes.size - IV_LEN), Charsets.UTF_8)
            (PairingInfo.parse(json) as? PairingResult.Ok)?.info
        } catch (e: Exception) {
            AppLog.w(TAG, "stored pairing unreadable, dropping it: ${e.javaClass.simpleName}")
            prefs.edit().remove(KEY).apply()
            null
        }
    }

    fun save(p: PairingInfo?) {
        if (p == null) {
            prefs.edit().remove(KEY).apply()
            return
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        check(iv.size == IV_LEN)
        val out = iv + cipher.doFinal(p.toJson().toByteArray(Charsets.UTF_8))
        prefs.edit().putString(KEY, Base64.encodeToString(out, Base64.NO_WRAP)).apply()
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private companion object {
        const val TAG = "cmc.pairing"
        const val KEY = "cmc.pairing"
        const val ALIAS = "cmc.pairing.key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_LEN = 12
    }
}
