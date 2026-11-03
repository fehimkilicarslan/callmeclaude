import AVFoundation

/// Full-duplex call audio with Apple's voice processing (echo cancellation, noise suppression).
/// Mic → PCM16 16 kHz mono → hub. Hub → PCM16 24 kHz mono → speaker / Bluetooth (helmet intercom).
///
/// A fresh AVAudioEngine is built for every call and rebuilt on route changes (e.g. the intercom
/// connects mid-call). Assistant audio that arrives before CallKit activates the audio session is
/// buffered and played once the engine runs, so the greeting is never lost.
final class AudioIO {
    var onMic: ((Data) -> Void)?
    var muted = false

    private let q = DispatchQueue(label: "cmc.audio")
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var converter: AVAudioConverter?
    private var configObserver: NSObjectProtocol?
    private var pending: [Data] = []
    private var pendingBytes = 0
    private(set) var running = false
    private var micBytes = 0
    private var playBytes = 0
    private var statTimer: DispatchSourceTimer?
    private var lastMic = 0
    private var lastPlay = 0

    private let playFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
    private let micFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!

    static func configureSession() {
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .duckOthers])
            try s.setPreferredSampleRate(48000)
            try s.setPreferredIOBufferDuration(0.02)
        } catch {
            Log.d("audio session config failed: \(error)")
        }
    }

    static func routeDescription() -> String {
        let r = AVAudioSession.sharedInstance().currentRoute
        let i = r.inputs.map { $0.portType.rawValue }.joined(separator: ",")
        let o = r.outputs.map { $0.portType.rawValue }.joined(separator: ",")
        return "in=[\(i)] out=[\(o)]"
    }

    func start() { q.sync { startLocked() } }

    func stop() {
        q.sync {
            stopLocked()
            pending.removeAll()
            pendingBytes = 0
            statTimer?.cancel()
            statTimer = nil
            Log.d("audio stopped: mic=\(micBytes / 32000)s sent, played=\(playBytes / 48000)s")
            micBytes = 0
            playBytes = 0
            lastMic = 0
            lastPlay = 0
        }
    }

    private func startLocked() {
        guard !running else { return }
        let e = AVAudioEngine()
        let p = AVAudioPlayerNode()
        let input = e.inputNode
        do {
            try input.setVoiceProcessingEnabled(true)
        } catch {
            Log.d("voice processing unavailable: \(error)")
        }
        e.attach(p)
        e.connect(p, to: e.mainMixerNode, format: playFormat)
        let inFormat = input.outputFormat(forBus: 0)
        Log.d("audio start: input \(Int(inFormat.sampleRate))Hz ch=\(inFormat.channelCount) \(AudioIO.routeDescription())")
        guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else {
            Log.d("audio start aborted: invalid input format")
            return
        }
        let conv = AVAudioConverter(from: inFormat, to: micFormat)
        conv?.downmix = true
        converter = conv
        input.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { [weak self] buf, _ in
            self?.handleMic(buf)
        }
        do {
            e.prepare()
            try e.start()
        } catch {
            Log.d("audio engine start failed: \(error)")
            input.removeTap(onBus: 0)
            return
        }
        p.play()
        engine = e
        player = p
        running = true
        startedAt = Date()
        lastRoute = AudioIO.routeDescription()
        // Enabling voice processing (and the speaker override) fire configuration-change notifications
        // right after start. Rebuilding on each of them loops forever, so: restart the existing engine,
        // and only rebuild when the audio route really changed (e.g. the helmet intercom connected).
        configObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: e, queue: nil) { [weak self] _ in
            self?.q.async { self?.handleConfigChange() }
        }
        if statTimer == nil {
            let t = DispatchSource.makeTimerSource(queue: q)
            t.schedule(deadline: .now() + 5, repeating: 5)
            t.setEventHandler { [weak self] in
                guard let self else { return }
                Log.d("audio 5s: mic→hub \((self.micBytes - self.lastMic) / 1024)KB, hub→speaker \((self.playBytes - self.lastPlay) / 1024)KB, engine=\(self.engine?.isRunning == true ? "on" : "off")")
                self.lastMic = self.micBytes
                self.lastPlay = self.playBytes
            }
            t.resume()
            statTimer = t
        }
        if !pending.isEmpty {
            Log.d("audio: playing \(pending.count) buffered chunks")
            pending.forEach(schedule)
            pending.removeAll()
            pendingBytes = 0
        }
    }

    private var startedAt = Date.distantPast
    private var lastRoute = ""
    private var rebuilds: [Date] = []

    private func handleConfigChange() {
        guard running, let e = engine else { return }
        let route = AudioIO.routeDescription()
        let routeChanged = route != lastRoute
        let settling = Date().timeIntervalSince(startedAt) < 2
        rebuilds = rebuilds.filter { Date().timeIntervalSince($0) < 30 }
        if routeChanged && !settling && rebuilds.count < 3 {
            Log.d("audio route changed \(lastRoute) → \(route): rebuilding engine")
            rebuilds.append(Date())
            stopLocked()
            startLocked()
            return
        }
        lastRoute = route
        if !e.isRunning {
            do {
                try e.start()
                player?.play()
                Log.d("audio engine restarted after config change (\(route))")
            } catch {
                Log.d("audio engine restart failed: \(error)")
            }
        }
    }

    private func stopLocked() {
        if let o = configObserver { NotificationCenter.default.removeObserver(o) }
        configObserver = nil
        guard running, let e = engine else { running = false; return }
        e.inputNode.removeTap(onBus: 0)
        player?.stop()
        e.stop()
        engine = nil
        player = nil
        running = false
    }

    private func handleMic(_ buf: AVAudioPCMBuffer) {
        guard !muted, let converter else { return }
        let ratio = micFormat.sampleRate / buf.format.sampleRate
        let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio + 32)
        guard let out = AVAudioPCMBuffer(pcmFormat: micFormat, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        converter.convert(to: out, error: &err) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buf
        }
        guard err == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }
        let d = Data(bytes: ch[0], count: Int(out.frameLength) * 2)
        micBytes += d.count
        onMic?(d)
    }

    /// Queue assistant audio (PCM16 LE, 24 kHz mono).
    func play(_ data: Data) {
        q.async {
            if self.running {
                self.schedule(data)
            } else {
                // Buffer up to ~15 s until CallKit activates the audio session.
                self.pending.append(data)
                self.pendingBytes += data.count
                while self.pendingBytes > 24000 * 2 * 15, !self.pending.isEmpty {
                    self.pendingBytes -= self.pending.removeFirst().count
                }
            }
        }
    }

    private func schedule(_ data: Data) {
        guard let player else { return }
        let frames = data.count / 2
        guard frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(frames)) else { return }
        buf.frameLength = AVAudioFrameCount(frames)
        let dst = buf.floatChannelData![0]
        data.withUnsafeBytes { raw in
            let src = raw.bindMemory(to: Int16.self)
            for i in 0..<frames { dst[i] = Float(Int16(littleEndian: src[i])) / 32768.0 }
        }
        playBytes += data.count
        player.scheduleBuffer(buf, completionHandler: nil)
        if !player.isPlaying { player.play() }
    }

    /// Barge-in: drop whatever is still queued.
    func flush() {
        q.async {
            self.pending.removeAll()
            self.pendingBytes = 0
            guard self.running, let p = self.player else { return }
            p.stop()
            p.play()
        }
    }
}
