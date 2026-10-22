import UIKit
import UniformTypeIdentifiers

/// iPhone share sheet -> Lumin. Takes a shared video or link, scans it, and tells the person to open Lumin.
class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)
        let label = UILabel()
        label.text = "Looking for this on Lumin…"
        label.textColor = .white
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: view.centerXAnchor), label.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { finish(); return }
        let providers = items.flatMap { $0.attachments ?? [] }
        if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) }) {
            p.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, _ in
                guard let url = url else { self.finish(); return }
                // The system deletes the file when this closure returns, so copy it first.
                let copy = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
                try? FileManager.default.copyItem(at: url, to: copy)
                LuminScan.send(file: copy) { _ in try? FileManager.default.removeItem(at: copy); self.finish() }
            }
        } else if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            p.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                guard let u = item as? URL, u.scheme == "https" || u.scheme == "http" else { self.finish(); return }
                LuminScan.send(link: u.absoluteString) { _ in self.finish() }
            }
        } else {
            LuminScan.store(["found": false, "message": "Nothing to scan was shared. Share a video or a video link to Lumin."])
            finish()
        }
    }

    private func finish() {
        DispatchQueue.main.async { self.extensionContext?.completeRequest(returningItems: nil) }
    }
}
