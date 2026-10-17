import Capacitor
import Foundation

/// iPhone side of the "LuminScan" plugin: stores the API address and sign-in in the App Group so the two extensions
/// can upload as the person, and hands the website the latest result they left behind.
/// Set GROUP below (and in both extensions' LuminShared.swift) to your App Group id, e.g. group.com.yourco.lumin.
let LuminGroup = "group.com.example.lumin"

@objc(LuminScanPlugin)
public class LuminScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LuminScanPlugin"
    public let jsName = "LuminScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePending", returnType: CAPPluginReturnPromise),
    ]

    @objc func configure(_ call: CAPPluginCall) {
        guard let base = call.getString("apiBase"), base.hasPrefix("https://") else {
            call.reject("apiBase must be an https address"); return
        }
        let d = UserDefaults(suiteName: LuminGroup)
        d?.set(base, forKey: "apiBase")
        d?.set(call.getString("token") ?? "", forKey: "token")
        call.resolve()
    }

    @objc func consumePending(_ call: CAPPluginCall) {
        let d = UserDefaults(suiteName: LuminGroup)
        guard let json = d?.string(forKey: "pending"), let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            call.resolve([:]); return
        }
        d?.removeObject(forKey: "pending")
        call.resolve(obj)
    }
}
