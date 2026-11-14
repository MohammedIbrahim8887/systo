import AppKit
import WebKit

final class Installer: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var directory = URL(fileURLWithPath: "/Applications", isDirectory: true)
    var installed: URL?
    var busy = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Systo Installer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApplication.shared.mainMenu = menu
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "installer")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 650), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Install Systo"
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = web
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)
        guard let resources = Bundle.main.resourceURL else { return }
        web.loadFileURL(resources.appendingPathComponent("index.html"), allowingReadAccessTo: resources)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { busy ? .terminateCancel : .terminateNow }
    func windowShouldClose(_ sender: NSWindow) -> Bool { !busy }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }
    func js(_ function: String, _ arguments: [String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: arguments), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.\(function)(...\(json))", completionHandler: nil)
    }
    func state(_ name: String, _ message: String = "") { js("installerState", [name, message]) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true, !busy, let action = message.body as? String else { return }
        switch action {
        case "choose":
            let panel = NSOpenPanel()
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.canCreateDirectories = true
            panel.prompt = "Choose Folder"
            panel.directoryURL = directory
            panel.beginSheetModal(for: window) { result in
                if result == .OK, let url = panel.url {
                    self.directory = url
                    self.js("installerLocation", [url.path])
                    self.state("ready")
                }
            }
        case "install": confirmAndInstall()
        case "open":
            guard let url = installed else { return }
            NSWorkspace.shared.openApplication(at: url, configuration: .init()) { _, error in
                DispatchQueue.main.async {
                    if let error { self.state("done", "Systo was installed, but could not open: \(error.localizedDescription)") }
                    else { NSApp.terminate(nil) }
                }
            }
        default: break
        }
    }
    func confirmAndInstall() {
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: "dev.systo.monitor")
        if !running.isEmpty {
            let alert = NSAlert()
            alert.messageText = "Systo is still running"
            alert.informativeText = "Systo needs to quit before it can be replaced. Your settings and history are kept."
            alert.addButton(withTitle: "Quit Systo and Install")
            alert.addButton(withTitle: "Cancel")
            alert.beginSheetModal(for: window) { response in
                guard response == .alertFirstButtonReturn else { return }
                self.state("installing", "Quitting Systo…")
                self.quit(running) { stopped in
                    if stopped { self.confirmAndInstall() }
                    else { self.state("error", "Systo didn't quit. Quit it from the menu bar, then try again.") }
                }
            }
            return
        }
        let target = directory.appendingPathComponent("Systo.app")
        if FileManager.default.fileExists(atPath: target.path) {
            let alert = NSAlert()
            alert.messageText = "Replace the existing Systo app?"
            alert.informativeText = "The copy in \(directory.path) will be replaced. Your Systo settings will be kept."
            alert.addButton(withTitle: "Replace")
            alert.addButton(withTitle: "Cancel")
            alert.beginSheetModal(for: window) { response in
                if response == .alertFirstButtonReturn { self.performInstall() }
            }
        } else { performInstall() }
    }
    /// Asks each instance to quit, then force-quits any that remain (a windowless launcher can ignore a polite quit).
    func quit(_ apps: [NSRunningApplication], completion: @escaping (Bool) -> Void) {
        apps.forEach { $0.terminate() }
        DispatchQueue.global(qos: .userInitiated).async {
            let deadline = Date().addingTimeInterval(4)
            while Date() < deadline, apps.contains(where: { !$0.isTerminated }) { Thread.sleep(forTimeInterval: 0.2) }
            apps.filter { !$0.isTerminated }.forEach { $0.forceTerminate() }
            let forced = Date().addingTimeInterval(2)
            while Date() < forced, apps.contains(where: { !$0.isTerminated }) { Thread.sleep(forTimeInterval: 0.2) }
            let stopped = apps.allSatisfy { $0.isTerminated }
            DispatchQueue.main.async { completion(stopped) }
        }
    }
    func performInstall() {
        guard let source = Bundle.main.resourceURL?.appendingPathComponent("Systo.app") else { return }
        busy = true
        window.standardWindowButton(.closeButton)?.isEnabled = false
        state("installing", "Copying Systo to \(directory.path)…")
        let destination = directory
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try InstallService.install(source: source, directory: destination) }
            DispatchQueue.main.async {
                self.busy = false
                self.window.standardWindowButton(.closeButton)?.isEnabled = true
                switch result {
                case .success(let url): self.installed = url; self.state("done", "Systo is ready in \(destination.path).")
                case .failure(let error): self.state("error", "\(error.localizedDescription) Choose another folder or try again.")
                }
            }
        }
    }
}
let app = NSApplication.shared
let delegate = Installer()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
