import Foundation

struct GhosttyGridSize: Equatable, Sendable {
    let columns: Int
    let rows: Int
}

struct VimeflowPtySession: Sendable {
    let id: String
    let pid: Int
    let cwd: String
    let shell: String
}

enum VimeflowBackendEvent: Sendable {
    case ptyData(sessionId: String, data: String)
}

enum VimeflowBackendClientError: Error, LocalizedError, Sendable {
    case backendBinaryNotFound(String)
    case processPipeUnavailable
    case backendUnavailable(String)
    case malformedFrame(String)

    var errorDescription: String? {
        switch self {
        case let .backendBinaryNotFound(message):
            message
        case .processPipeUnavailable:
            "backend process pipe unavailable"
        case let .backendUnavailable(message):
            message
        case let .malformedFrame(message):
            "malformed backend frame: \(message)"
        }
    }
}

final class VimeflowBackendClient: @unchecked Sendable {
    typealias EventHandler = @MainActor @Sendable (_ event: VimeflowBackendEvent) -> Void
    typealias SpawnCompletion = @MainActor @Sendable (
        Result<VimeflowPtySession, VimeflowBackendClientError>
    ) -> Void

    private static let maxFrameBytes = 16 * 1024 * 1024

    private enum PendingRequest: Sendable {
        case spawn(SpawnCompletion)

        @MainActor
        func fail(_ error: VimeflowBackendClientError) {
            switch self {
            case let .spawn(completion):
                completion(.failure(error))
            }
        }
    }

    private let ioQueue = DispatchQueue(label: "dev.vimeflow.ghostty-native-smoke.backend")
    private let appDataDir: String
    private var process: Process?
    private var stdinHandle: FileHandle?
    private var stdoutHandle: FileHandle?
    private var stderrHandle: FileHandle?
    private var stdoutBuffer = Data()
    private var pending: [String: PendingRequest] = [:]
    private var nextRequestId = 1
    private var disabledReason: String?
    private var eventHandler: EventHandler?

    init(appDataDir: String = VimeflowBackendClient.defaultAppDataDir()) {
        self.appDataDir = appDataDir
    }

    func start(onEvent: @escaping EventHandler) throws {
        eventHandler = onEvent

        let backendPath = try Self.resolveBackendBinary()
        try FileManager.default.createDirectory(
            atPath: appDataDir,
            withIntermediateDirectories: true
        )

        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: backendPath)
        process.arguments = ["--app-data-dir", appDataDir]
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        process.terminationHandler = { [weak self] process in
            self?.disable(
                .backendUnavailable(
                    "vimeflow-backend exited status=\(process.terminationStatus)"
                )
            )
        }

        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let client = self else { return }

            let data = handle.availableData
            guard !data.isEmpty else {
                client.disable(.backendUnavailable("backend stdout closed"))
                return
            }

            client.ioQueue.async { [weak client] in
                client?.appendStdout(data)
            }
        }

        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }

            let text = String(decoding: data, as: UTF8.self)
            FileHandle.standardError.write(Data("[vimeflow-backend] \(text)".utf8))
        }

        try process.run()

        self.process = process
        stdinHandle = stdin.fileHandleForWriting
        stdoutHandle = stdout.fileHandleForReading
        stderrHandle = stderr.fileHandleForReading
    }

    func spawnPty(
        sessionId: String,
        cwd: String,
        completion: @escaping SpawnCompletion
    ) {
        sendRequest(
            method: "spawn_pty",
            params: [
                "request": [
                    "sessionId": sessionId,
                    "cwd": cwd,
                    "enableAgentBridge": false,
                    "ephemeral": true,
                ],
            ],
            pending: .spawn(completion)
        )
    }

    func writePty(sessionId: String, data: Data) {
        let text = String(decoding: data, as: UTF8.self)
        sendRequest(
            method: "write_pty",
            params: [
                "request": [
                    "sessionId": sessionId,
                    "data": text,
                ],
            ],
            pending: nil
        )
    }

    func resizePty(sessionId: String, grid: GhosttyGridSize) {
        sendRequest(
            method: "resize_pty",
            params: [
                "request": [
                    "sessionId": sessionId,
                    "rows": grid.rows,
                    "cols": grid.columns,
                ],
            ],
            pending: nil
        )
    }

    func killPty(sessionId: String) {
        sendRequest(
            method: "kill_pty",
            params: [
                "request": [
                    "sessionId": sessionId,
                ],
            ],
            pending: nil
        )
    }

    func shutdown() {
        ioQueue.async {
            guard self.disabledReason == nil else { return }

            self.disabledReason = "shutdown"
            let frame = Self.encodeRawFrame(["kind": "shutdown"])
            try? self.stdinHandle?.write(contentsOf: frame)
            try? self.stdinHandle?.close()
            self.stdoutHandle?.readabilityHandler = nil
            self.stderrHandle?.readabilityHandler = nil

            if self.process?.isRunning == true {
                self.process?.terminate()
            }
        }
    }

    static func defaultWorkingDirectory() -> String {
        findRepoRoot(from: FileManager.default.currentDirectoryPath)?
            .path
            ?? FileManager.default.homeDirectoryForCurrentUser.path
    }

    private func sendRequest(
        method: String,
        params: [String: Any],
        pending pendingRequest: PendingRequest?
    ) {
        let paramsData: Data
        do {
            paramsData = try JSONSerialization.data(withJSONObject: params)
        } catch {
            Task { @MainActor in
                pendingRequest?.fail(
                    .backendUnavailable("request encode failed: \(error.localizedDescription)")
                )
            }
            return
        }

        ioQueue.async {
            if let disabledReason = self.disabledReason {
                Task { @MainActor in
                    pendingRequest?.fail(.backendUnavailable(disabledReason))
                }
                return
            }

            guard let stdinHandle = self.stdinHandle else {
                Task { @MainActor in
                    pendingRequest?.fail(.processPipeUnavailable)
                }
                return
            }

            let requestId = String(self.nextRequestId)
            self.nextRequestId += 1

            if let pendingRequest {
                self.pending[requestId] = pendingRequest
            }

            do {
                let paramsObject = try JSONSerialization.jsonObject(with: paramsData)
                let body = try JSONSerialization.data(
                    withJSONObject: [
                        "kind": "request",
                        "id": requestId,
                        "method": method,
                        "params": paramsObject,
                    ]
                )
                let frame = Self.frame(body: body)
                try stdinHandle.write(contentsOf: frame)
            } catch {
                self.pending.removeValue(forKey: requestId)
                Task { @MainActor in
                    pendingRequest?.fail(
                        .backendUnavailable("request send failed: \(error.localizedDescription)")
                    )
                }
            }
        }
    }

    private func appendStdout(_ data: Data) {
        stdoutBuffer.append(data)
        guard stdoutBuffer.count <= Self.maxFrameBytes else {
            disable(.malformedFrame("frame exceeds maximum size"))
            return
        }

        processStdoutBuffer()
    }

    private func processStdoutBuffer() {
        let marker = Data("\r\n\r\n".utf8)

        while true {
            guard let headerRange = stdoutBuffer.range(of: marker) else {
                return
            }

            let headerEnd = headerRange.lowerBound
            let bodyStart = headerRange.upperBound
            guard
                let header = String(
                    data: stdoutBuffer.subdata(in: stdoutBuffer.startIndex..<headerEnd),
                    encoding: .ascii
                ),
                let contentLength = Self.parseContentLength(header)
            else {
                disable(.malformedFrame("missing Content-Length"))
                return
            }
            guard contentLength >= 0 && contentLength <= Self.maxFrameBytes else {
                disable(.malformedFrame("invalid Content-Length"))
                return
            }

            let bodyEnd = bodyStart + contentLength
            guard stdoutBuffer.count >= bodyEnd else {
                return
            }

            let body = stdoutBuffer.subdata(in: bodyStart..<bodyEnd)
            stdoutBuffer.removeSubrange(stdoutBuffer.startIndex..<bodyEnd)

            do {
                let frame = try JSONSerialization.jsonObject(with: body)
                dispatch(frame)
            } catch {
                disable(.malformedFrame("invalid JSON body"))
                return
            }
        }
    }

    private func dispatch(_ frame: Any) {
        guard let object = frame as? [String: Any], let kind = object["kind"] as? String else {
            return
        }

        if kind == "response" {
            dispatchResponse(object)
            return
        }

        if kind == "event" {
            dispatchEvent(object)
        }
    }

    private func dispatchResponse(_ object: [String: Any]) {
        guard let id = object["id"] as? String else { return }
        guard let pendingRequest = pending.removeValue(forKey: id) else { return }

        if object["ok"] as? Bool != true {
            let message = object["error"] as? String ?? "backend request failed"
            complete(pendingRequest, with: .failure(.backendUnavailable(message)))
            return
        }

        switch pendingRequest {
        case let .spawn(completion):
            guard
                let result = object["result"] as? [String: Any],
                let sessionId = result["id"] as? String,
                let pid = result["pid"] as? Int,
                let cwd = result["cwd"] as? String,
                let shell = result["shell"] as? String
            else {
                complete(
                    pendingRequest,
                    with: .failure(.malformedFrame("spawn result"))
                )
                return
            }

            let session = VimeflowPtySession(
                id: sessionId,
                pid: pid,
                cwd: cwd,
                shell: shell
            )
            Task { @MainActor in
                completion(.success(session))
            }
        }
    }

    private func dispatchEvent(_ object: [String: Any]) {
        guard object["event"] as? String == "pty-data" else { return }
        guard
            let payload = object["payload"] as? [String: Any],
            let sessionId = payload["sessionId"] as? String,
            let data = payload["data"] as? String
        else {
            return
        }

        let event = VimeflowBackendEvent.ptyData(sessionId: sessionId, data: data)
        Task { @MainActor [eventHandler] in
            eventHandler?(event)
        }
    }

    private func complete(
        _ pendingRequest: PendingRequest,
        with result: Result<VimeflowPtySession, VimeflowBackendClientError>
    ) {
        Task { @MainActor in
            switch pendingRequest {
            case let .spawn(completion):
                completion(result)
            }
        }
    }

    private func disable(_ error: VimeflowBackendClientError) {
        ioQueue.async {
            guard self.disabledReason == nil else { return }

            self.disabledReason = error.localizedDescription
            let pending = self.pending
            self.pending.removeAll()
            self.stdoutHandle?.readabilityHandler = nil
            self.stderrHandle?.readabilityHandler = nil

            Task { @MainActor in
                for pendingRequest in pending.values {
                    pendingRequest.fail(error)
                }
            }
        }
    }

    private static func resolveBackendBinary() throws -> String {
        if let override = ProcessInfo.processInfo.environment["VIMEFLOW_BACKEND_BIN"],
            !override.isEmpty
        {
            return override
        }

        if let repoRoot = findRepoRoot(from: FileManager.default.currentDirectoryPath) {
            let candidate = repoRoot
                .appendingPathComponent("target")
                .appendingPathComponent("debug")
                .appendingPathComponent("vimeflow-backend")
                .path

            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }

        throw VimeflowBackendClientError.backendBinaryNotFound(
            "Cannot find target/debug/vimeflow-backend. Run `npm run backend:build` at the Vimeflow repo root, or set VIMEFLOW_BACKEND_BIN."
        )
    }

    private static func defaultAppDataDir() -> String {
        URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("vimeflow-ghostty-native-smoke", isDirectory: true)
            .path
    }

    private static func findRepoRoot(from path: String) -> URL? {
        var cursor = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        let fileManager = FileManager.default

        while true {
            let marker = cursor
                .appendingPathComponent("crates")
                .appendingPathComponent("backend")
                .appendingPathComponent("Cargo.toml")
                .path

            if fileManager.fileExists(atPath: marker) {
                return cursor
            }

            let parent = cursor.deletingLastPathComponent()
            if parent.path == cursor.path {
                return nil
            }

            cursor = parent
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

    private static func encodeRawFrame(_ object: [String: Any]) -> Data {
        let body = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        return frame(body: body)
    }

    private static func frame(body: Data) -> Data {
        var frame = Data("Content-Length: \(body.count)\r\n\r\n".utf8)
        frame.append(body)
        return frame
    }
}
