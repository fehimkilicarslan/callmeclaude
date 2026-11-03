import Foundation

/// App diagnostics: written to the device log and forwarded to the hub (~/.callmeclaude/logs/app-*.log),
/// so call problems can be debugged from the Mac without Xcode attached.
enum Log {
    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    static func d(_ s: String) {
        NSLog("[cmc] %@", s)
        HubClient.shared.remoteLog("\(fmt.string(from: Date())) \(s)")
    }
}

/// Tiny thread-safe boolean for flags read on the audio thread.
final class AtomicFlag {
    private let lock = NSLock()
    private var v = false
    var value: Bool {
        get { lock.lock(); defer { lock.unlock() }; return v }
        set { lock.lock(); v = newValue; lock.unlock() }
    }
}
