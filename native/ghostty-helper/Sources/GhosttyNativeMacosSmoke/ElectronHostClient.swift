import Foundation

struct GhosttyNativeFrame: Sendable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let visible: Bool
    let backgroundColor: String
    let bottomCornerRadius: Double
}

enum ElectronHostCommand: Sendable {
    case setFrame(GhosttyNativeFrame)
    case ptyData(sessionId: String, data: String)
    case focus
    case shutdown
}

final class ElectronHostClient: @unchecked Sendable {
    typealias CommandHandler = @MainActor @Sendable (_ command: ElectronHostCommand) -> Void

    private let ioQueue = DispatchQueue(label: "dev.vimeflow.ghostty-native-smoke.electron-host")
    private var inputBuffer = Data()
    private var commandHandler: CommandHandler?
    private var closed = false

    func start(onCommand: @escaping CommandHandler) {
        commandHandler = onCommand

        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            guard let client = self else { return }

            let data = handle.availableData
            guard !data.isEmpty else {
                client.close()
                return
            }

            client.ioQueue.async { [weak client] in
                client?.appendInput(data)
            }
        }
    }

    func sendInput(_ data: Data) {
        let text = String(decoding: data, as: UTF8.self)
        emit(event: "pty-input", payload: ["data": text])
    }

    func sendResize(_ grid: GhosttyGridSize) {
        emit(
            event: "pty-resize",
            payload: [
                "cols": grid.columns,
                "rows": grid.rows,
            ]
        )
    }

    func sendClosed() {
        emit(event: "closed", payload: [:])
    }

    func close() {
        ioQueue.async {
            guard !self.closed else { return }
            self.closed = true
            FileHandle.standardInput.readabilityHandler = nil
        }
    }

    private func emit(event: String, payload: [String: Any]) {
        let body: Data
        do {
            body = try JSONSerialization.data(
                withJSONObject: [
                    "kind": "event",
                    "event": event,
                    "payload": payload,
                ]
            )
        } catch {
            return
        }

        ioQueue.async {
            guard !self.closed else { return }

            do {
                try FileHandle.standardOutput.write(contentsOf: Self.frame(body: body))
            } catch {
                self.closed = true
            }
        }
    }

    private func appendInput(_ data: Data) {
        inputBuffer.append(data)
        processInputBuffer()
    }

    private func processInputBuffer() {
        let marker = Data("\r\n\r\n".utf8)

        while true {
            guard let headerRange = inputBuffer.range(of: marker) else {
                return
            }

            let headerEnd = headerRange.lowerBound
            let bodyStart = headerRange.upperBound
            guard
                let header = String(
                    data: inputBuffer.subdata(in: inputBuffer.startIndex..<headerEnd),
                    encoding: .ascii
                ),
                let contentLength = Self.parseContentLength(header)
            else {
                close()
                return
            }

            let bodyEnd = bodyStart + contentLength
            guard inputBuffer.count >= bodyEnd else {
                return
            }

            let body = inputBuffer.subdata(in: bodyStart..<bodyEnd)
            inputBuffer.removeSubrange(inputBuffer.startIndex..<bodyEnd)

            do {
                let object = try JSONSerialization.jsonObject(with: body)
                dispatch(object)
            } catch {
                close()
                return
            }
        }
    }

    private func dispatch(_ object: Any) {
        guard
            let command = Self.parseCommand(object),
            let commandHandler
        else {
            return
        }

        Task { @MainActor in
            commandHandler(command)
        }
    }

    private static func parseCommand(_ object: Any) -> ElectronHostCommand? {
        guard let frame = object as? [String: Any] else {
            return nil
        }

        if frame["kind"] as? String == "shutdown" {
            return .shutdown
        }

        guard frame["kind"] as? String == "command" else {
            return nil
        }

        switch frame["command"] as? String {
        case "set-frame":
            guard
                let x = frame["x"] as? Double,
                let y = frame["y"] as? Double,
                let width = frame["width"] as? Double,
                let height = frame["height"] as? Double,
                let visible = frame["visible"] as? Bool,
                let backgroundColor = frame["backgroundColor"] as? String
            else {
                return nil
            }
            let bottomCornerRadius = frame["bottomCornerRadius"] as? Double ?? 0

            return .setFrame(
                GhosttyNativeFrame(
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    visible: visible,
                    backgroundColor: backgroundColor,
                    bottomCornerRadius: bottomCornerRadius
                )
            )

        case "pty-data":
            guard
                let sessionId = frame["sessionId"] as? String,
                let data = frame["data"] as? String
            else {
                return nil
            }

            return .ptyData(sessionId: sessionId, data: data)

        case "focus":
            return .focus

        default:
            return nil
        }
    }

    private static func parseContentLength(_ header: String) -> Int? {
        for line in header.components(separatedBy: "\r\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2 else { continue }
            guard parts[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length"
            else {
                continue
            }

            return Int(parts[1].trimmingCharacters(in: .whitespaces))
        }

        return nil
    }

    private static func frame(body: Data) -> Data {
        var frame = Data("Content-Length: \(body.count)\r\n\r\n".utf8)
        frame.append(body)
        return frame
    }
}
