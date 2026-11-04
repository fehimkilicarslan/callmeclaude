package dev.callmeclaude.calls

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Process
import dev.callmeclaude.AppLog

/**
 * Full-duplex call audio, off the main thread.
 * Mic: AudioRecord (VOICE_COMMUNICATION + platform AEC/NS) → PCM16 16 kHz 20 ms frames → [send].
 * Speaker: [play] → [PlaybackQueue] → AudioTrack (USAGE_VOICE_COMMUNICATION, stream mode, 24 kHz).
 * Telecom owns the audio mode and the route (earpiece / speaker / Bluetooth).
 */
class CallAudio(
    private val context: Context,
    private val send: (ByteArray) -> Unit,
    private val muted: () -> Boolean,
) : CallAudioPort {
    private val queue = PlaybackQueue()

    /** One per call. Stopping only flips the flag: the threads release the devices themselves, off the main thread. */
    private class Session {
        @Volatile var running = true
    }

    private var session: Session? = null
    private var mic: Thread? = null
    private var player: Thread? = null
    @Volatile private var track: AudioTrack? = null
    @Volatile private var playedBytes = 0L
    @Volatile private var micBytes = 0L

    @Synchronized
    override fun start() {
        if (session != null) return
        val s = Session().also { session = it }
        // A call right after the previous one: let the old threads release the mic/track first.
        val previous = listOfNotNull(mic, player)
        playedBytes = 0
        micBytes = 0
        mic = Thread({ previous.forEach { it.join(1_000) }; micLoop(s) }, "cmc.mic").apply { start() }
        player = Thread({ previous.forEach { it.join(1_000) }; playLoop(s) }, "cmc.play").apply { start() }
    }

    @Synchronized
    override fun stop() {
        val s = session ?: return
        session = null
        s.running = false
        queue.flush()
    }

    override fun play(pcm24k: ByteArray) = queue.offer(pcm24k)

    /** Barge-in: drop what is queued and cut what is playing right now. */
    override fun flush() {
        queue.flush()
        track?.let { t ->
            try {
                t.pause()
                t.flush()
                t.play()
            } catch (e: IllegalStateException) {
                AppLog.w(TAG, "flush: $e")
            }
        }
    }

    @SuppressLint("MissingPermission") // checked right below; without it we stream silence
    private fun micLoop(s: Session) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        var rec: AudioRecord? = null
        val effects = mutableListOf<android.media.audiofx.AudioEffect>()
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            try {
                val min = AudioRecord.getMinBufferSize(MIC_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                val r = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                    MIC_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    maxOf(min, MIC_FRAME_BYTES * 8),
                )
                if (r.state == AudioRecord.STATE_INITIALIZED) {
                    if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(r.audioSessionId)?.let { it.enabled = true; effects += it }
                    if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(r.audioSessionId)?.let { it.enabled = true; effects += it }
                    r.startRecording()
                    rec = r
                    AppLog.i(TAG, "mic started: aec=${effects.any { it is AcousticEchoCanceler }} ns=${effects.any { it is NoiseSuppressor }}")
                } else {
                    r.release()
                    AppLog.w(TAG, "AudioRecord failed to initialize: sending silence")
                }
            } catch (e: RuntimeException) {
                AppLog.w(TAG, "AudioRecord failed: $e: sending silence")
            }
        } else {
            AppLog.w(TAG, "no RECORD_AUDIO permission: sending silence")
        }
        val pump = MicPump(
            read = { b -> rec?.read(b, 0, b.size) ?: -1 },
            send = send,
            muted = muted,
        )
        var lastLog = System.currentTimeMillis()
        var lastBytes = 0L
        try {
            while (s.running) {
                pump.pumpOnce()
                micBytes = pump.sentBytes
                val now = System.currentTimeMillis()
                if (now - lastLog >= 5_000) {
                    AppLog.i(TAG, "audio 5s: mic→hub ${(micBytes - lastBytes) / 1024}KB${if (muted()) " (muted)" else ""}, hub→speaker total ${playedBytes / 1024}KB, queued ${queue.bytes / 1024}KB")
                    lastBytes = micBytes
                    lastLog = now
                }
            }
        } finally {
            effects.forEach { it.release() }
            rec?.let {
                try { it.stop() } catch (_: IllegalStateException) {}
                it.release()
            }
            AppLog.i(TAG, "audio stopped: mic=${micBytes / (MIC_RATE * 2)}s sent, played=${playedBytes / (PLAY_RATE * 2)}s, dropped=${queue.dropped / (PLAY_RATE * 2)}s")
        }
    }

    private fun playLoop(s: Session) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val min = AudioTrack.getMinBufferSize(PLAY_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val t = try {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(PLAY_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .build(),
                )
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(maxOf(min, PLAY_RATE * 2 / 5)) // ≥ 200 ms
                .build()
        } catch (e: RuntimeException) {
            AppLog.w(TAG, "AudioTrack failed: $e")
            return
        }
        track = t
        t.play()
        try {
            while (s.running) {
                val (chunk, gen) = queue.take(100) ?: continue
                // Write in 20 ms slices so a flush stops mid-chunk.
                var off = 0
                while (off < chunk.size && s.running && gen == queue.generation) {
                    val n = t.write(chunk, off, minOf(SLICE, chunk.size - off))
                    if (n < 0) {
                        AppLog.w(TAG, "AudioTrack.write: $n")
                        break
                    }
                    off += n
                    playedBytes += n
                }
            }
        } finally {
            if (track === t) track = null
            try { t.stop() } catch (_: IllegalStateException) {}
            t.release()
        }
    }

    private companion object {
        const val TAG = "cmc.audio"
        const val SLICE = PLAY_RATE * 2 / 50 // 20 ms
    }
}
