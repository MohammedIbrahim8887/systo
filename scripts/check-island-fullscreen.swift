// Run: swift scripts/check-island-fullscreen.swift <Systo Bun PID>
// Opens and closes a temporary full-screen Space, restoring the previously active app.
import AppKit
import CoreGraphics
let app = NSApplication.shared
let previous = NSWorkspace.shared.frontmostApplication
guard CommandLine.arguments.count == 2, Int32(CommandLine.arguments[1]) != nil else {
 fputs("Usage: swift scripts/check-island-fullscreen.swift <Systo Bun PID>\n", stderr)
 exit(2)
}
let target = Int32(CommandLine.arguments[1])!
var passed = false
@discardableResult func sample(_ phase: String) -> Bool {
 let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
 let matches = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == target }.map { w -> [String:Any] in
  ["layer": w[kCGWindowLayer as String] ?? 0, "bounds": w[kCGWindowBounds as String] ?? [:], "alpha": w[kCGWindowAlpha as String] ?? 0]
 }
 let data = try! JSONSerialization.data(withJSONObject: ["phase":phase,"windows":matches], options:[.sortedKeys])
 print(String(data:data,encoding:.utf8)!)
 fflush(stdout)
 return matches.contains { ($0["layer"] as? Int) == 25 && (($0["bounds"] as? [String: Any])?["Width"] as? Int) == 460 }
}
class Delegate: NSObject, NSWindowDelegate {
 func windowDidEnterFullScreen(_ notification: Notification) {
  DispatchQueue.main.asyncAfter(deadline:.now()+4) {
   passed = sample("other-app-fullscreen")
   (notification.object as? NSWindow)?.toggleFullScreen(nil)
  }
 }
 func windowDidExitFullScreen(_ notification: Notification) { finish() }
 func finish() { previous?.activate(options:[]); exit(passed ? 0 : 1) }
}
let delegate=Delegate()
app.setActivationPolicy(.regular)
let window=NSWindow(contentRect:NSRect(x:100,y:100,width:800,height:600),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
window.title="Systo full-screen overlay check"
window.delegate=delegate
window.collectionBehavior=[.fullScreenPrimary]
let label=NSTextField(labelWithString:"Checking Systo over another app’s full-screen Space. This window closes automatically.")
label.frame=NSRect(x:30,y:280,width:740,height:60)
window.contentView?.addSubview(label)
sample("before")
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps:true)
DispatchQueue.main.asyncAfter(deadline:.now()+1) { window.toggleFullScreen(nil) }
DispatchQueue.main.asyncAfter(deadline:.now()+15) { delegate.finish() }
app.run()

