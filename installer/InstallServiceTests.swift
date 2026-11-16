import Foundation

@main struct InstallServiceTests {
    static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("systo-install-tests-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }
        let source = root.appendingPathComponent("Source.app")
        let contents = source.appendingPathComponent("Contents")
        try fm.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
        let plist: [String: String] = ["CFBundleIdentifier": "dev.systo.monitor", "CFBundleExecutable": "Systo", "CFBundlePackageType": "APPL"]
        try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
        let executable = contents.appendingPathComponent("MacOS/Systo")
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        // Stand in for a downloaded installer, whose payload carries the quarantine flag.
        let quarantine = Array("0081;00000000;Systo;".utf8)
        for url in [source, executable] {
            assert(setxattr(url.path, "com.apple.quarantine", quarantine, quarantine.count, 0, XATTR_NOFOLLOW) == 0)
        }
        let directory = root.appendingPathComponent("Applications")
        let target = try InstallService.install(source: source, directory: directory)
        for url in [target, target.appendingPathComponent("Contents/MacOS/Systo")] {
            assert(getxattr(url.path, "com.apple.quarantine", nil, 0, 0, XATTR_NOFOLLOW) == -1, "Quarantine left on \(url.path)")
        }
        assert(fm.isExecutableFile(atPath: target.appendingPathComponent("Contents/MacOS/Systo").path))
        let oldMarker = target.appendingPathComponent("old")
        try Data().write(to: oldMarker)
        _ = try InstallService.install(source: source, directory: directory)
        assert(!fm.fileExists(atPath: oldMarker.path))
        let remaining = try fm.contentsOfDirectory(atPath: directory.path)
        assert(remaining == ["Systo.app"])
        do {
            _ = try InstallService.install(source: root.appendingPathComponent("missing.app"), directory: directory)
            fatalError("Accepted missing payload")
        } catch InstallFailure.invalidPayload {}
        assert(fm.fileExists(atPath: target.path))
        try fm.removeItem(at: target)
        try fm.createSymbolicLink(at: target, withDestinationURL: source)
        do {
            _ = try InstallService.install(source: source, directory: directory)
            fatalError("Accepted symlink target")
        } catch InstallFailure.unsafeDestination {}
        assert(fm.fileExists(atPath: executable.path))
        print("PASS: install, quarantine removal, replace, staging cleanup, invalid payload preservation, symlink protection")
    }
}
