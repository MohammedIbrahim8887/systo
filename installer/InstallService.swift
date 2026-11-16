import Foundation

enum InstallFailure: LocalizedError {
    case invalidPayload, unsafeDestination
    var errorDescription: String? {
        switch self {
        case .invalidPayload: return "The bundled Systo app is missing or incomplete. Build or download the installer again."
        case .unsafeDestination: return "The destination is a symbolic link. Choose another folder to install Systo."
        }
    }
}

struct InstallService {
    // Stage beside the destination so the final rename is on the same volume.
    // Keep the previous app until the new copy is fully in place.
    static func install(source: URL, directory: URL) throws -> URL {
        let fm = FileManager.default
        guard let bundle = Bundle(url: source), bundle.bundleIdentifier == "dev.systo.monitor",
              let executable = bundle.executableURL, fm.isExecutableFile(atPath: executable.path)
        else { throw InstallFailure.invalidPayload }
        let target = directory.appendingPathComponent("Systo.app")
        if (try? target.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true {
            throw InstallFailure.unsafeDestination
        }
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        let stage = directory.appendingPathComponent(".systo-install-\(UUID().uuidString)")
        try fm.createDirectory(at: stage, withIntermediateDirectories: false)
        let staged = stage.appendingPathComponent("Systo.app")
        let backup = stage.appendingPathComponent("Previous.app")
        var hasBackup = false
        var preserveBackup = false
        defer { if !preserveBackup { try? fm.removeItem(at: stage) } }
        try fm.copyItem(at: source, to: staged)
        removeQuarantine(staged)
        if fm.fileExists(atPath: target.path) {
            try fm.moveItem(at: target, to: backup)
            hasBackup = true
        }
        do {
            try fm.moveItem(at: staged, to: target)
        } catch {
            if hasBackup {
                do { try fm.moveItem(at: backup, to: target) }
                catch {
                    preserveBackup = true
                    throw NSError(domain: "SystoInstaller", code: 2, userInfo: [NSLocalizedDescriptionKey:
                        "Installation could not finish. Your previous app is preserved at \(backup.path). Move it back to \(directory.path), then try again."])
                }
            }
            throw error
        }
        return target
    }

    // A downloaded installer is quarantined, and macOS passes that on to everything it writes.
    // A quarantined app that Finder did not move runs from a read-only App Translocation mount,
    // where Systo cannot unpack itself on first launch ("The application could not be installed").
    static func removeQuarantine(_ bundle: URL) {
        let strip = { (url: URL) in _ = removexattr(url.path, "com.apple.quarantine", XATTR_NOFOLLOW) }
        strip(bundle)
        guard let items = FileManager.default.enumerator(at: bundle, includingPropertiesForKeys: nil) else { return }
        for case let url as URL in items { strip(url) }
    }
}
