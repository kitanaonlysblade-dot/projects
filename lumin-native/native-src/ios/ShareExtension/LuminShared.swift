import Foundation

// Shared by both extensions (add this file to both targets). Keep the group id identical everywhere.
let LuminGroup = "group.com.example.lumin"

enum LuminScan {
    static var defaults: UserDefaults? { UserDefaults(suiteName: LuminGroup) }
    static let maxBytes = 30 * 1024 * 1024

    /// Sends a video file to /scan/match or a link to /scan/link; stores the answer for the app. Calls back on any thread.
    static func send(file: URL? = nil, link: String? = nil, done: @escaping (Bool) -> Void) {
        guard let base = defaults?.string(forKey: "apiBase"), base.hasPrefix("https://"),
              let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + (file != nil ? "/scan/match" : "/scan/link")) else {
            store(["found": false, "message": "Open Lumin once and sign in, then try again."]); done(false); return
        }
        var req = URLRequest(url: url, timeoutInterval: 60)
        req.httpMethod = "POST"
        if let t = defaults?.string(forKey: "token"), !t.isEmpty { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        var body = Data()
        if let file = file {
            guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= maxBytes,
                  let bytes = try? Data(contentsOf: file) else {
                store(["found": false, "message": "That video is too large to scan. Try a shorter clip."]); done(false); return
            }
            let boundary = "lumin" + UUID().uuidString
            req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"clip\"; filename=\"clip.mp4\"\r\nContent-Type: video/mp4\r\n\r\n".data(using: .utf8)!)
            body.append(bytes)
            body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        } else if let link = link {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            body = (try? JSONSerialization.data(withJSONObject: ["url": link])) ?? Data()
        } else { done(false); return }
        req.httpBody = body
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            var out: [String: Any] = ["found": false, "message": "We couldn't reach Lumin. Check your connection and try again."]
            if let data = data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                if status >= 400 {
                    out = ["found": false, "message": (obj["detail"] as? String) ?? "Something went wrong. Please try again."]
                } else {
                    let id = obj["video_post_id"] as? String
                    out = ["found": (obj["found"] as? Bool ?? false) && id != nil, "video_post_id": id as Any, "message": obj["message"] as Any]
                }
            }
            store(out)
            done((out["found"] as? Bool) ?? false)
        }.resume()
    }

    static func store(_ obj: [String: Any]) {
        if let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) {
            defaults?.set(s, forKey: "pending")
        }
    }
}
