import AppIntents
import Intents
import PushKit
import SwiftUI
import UIKit

@main
struct CallMeClaudeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(HubClient.shared)
                .environmentObject(CallManager.shared)
                .onContinueUserActivity("INStartCallIntent") { _ in CallManager.shared.startOutgoing() }
                .onContinueUserActivity("INStartAudioCallIntent") { _ in CallManager.shared.startOutgoing() }
        }
        .onChange(of: phase) { _, p in
            if p == .active { HubClient.shared.ensureConnected() }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, PKPushRegistryDelegate {
    private var registry: PKPushRegistry?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        _ = CallManager.shared // wire callbacks before anything arrives
        // PushKit must be registered at launch so VoIP pushes can wake the app.
        let r = PKPushRegistry(queue: .main)
        r.delegate = self
        r.desiredPushTypes = [.voIP]
        registry = r
        return true
    }

    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        HubClient.shared.voipToken = token
    }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        let cmc = payload.dictionaryPayload["cmc"] as? [String: Any]
        let callId = cmc?["callId"] as? String ?? UUID().uuidString
        let title = cmc?["title"] as? String ?? "Claude"
        // iOS requires reporting a CallKit call for every VoIP push, immediately.
        CallManager.shared.reportIncoming(callId: callId, title: title, completion: completion)
    }
}

// MARK: Siri / Shortcuts: "Hey Siri, call CallMeClaude"

struct CallClaudeIntent: AppIntent {
    static var title: LocalizedStringResource = "Call Claude"
    static var description = IntentDescription("Places a voice call to the CallMeClaude hub on your Mac.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        CallManager.shared.startOutgoing()
        return .result()
    }
}

struct CallMeClaudeShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CallClaudeIntent(),
            phrases: ["Call \(.applicationName)", "Talk to \(.applicationName)", "Start a \(.applicationName) call"],
            shortTitle: "Call Claude",
            systemImageName: "phone.fill"
        )
    }
}
