import AppKit
import Foundation
import GhosttyTerminal

// ponytail: helper-window spike; replace with an NSView addon if z-order/focus must be product-grade.
private final class GhosttyHelperWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@main
final class GhosttyNativeMacosSmoke:
    NSObject,
    NSApplicationDelegate,
    TerminalSurfaceTitleDelegate,
    TerminalSurfaceResizeDelegate,
    TerminalSurfaceCloseDelegate
{
    private var window: NSWindow?
    private var terminalView: TerminalView?
    private var backendClient: VimeflowBackendClient?
    private var electronHostClient: ElectronHostClient?
    private var ptySessionId: String?
    private var pendingGrid = GhosttyGridSize(columns: 80, rows: 24)
    private var lastForwardedGrid: GhosttyGridSize?
    private let helperMode = CommandLine.arguments.contains("--electron-helper")

    private lazy var controller = TerminalController()

    private lazy var session = InMemoryTerminalSession(
        write: { [weak self] data in
            DispatchQueue.main.async {
                self?.handleTerminalInput(data)
            }
        },
        resize: { viewport in
            DispatchQueue.main.async { [weak self] in
                self?.handleGhosttyResize(
                    GhosttyGridSize(
                        columns: Int(viewport.columns),
                        rows: Int(viewport.rows)
                    )
                )
            }
        }
    )

    static func main() {
        let app = NSApplication.shared
        let delegate = GhosttyNativeMacosSmoke()
        app.delegate = delegate
        app.setActivationPolicy(
            CommandLine.arguments.contains("--electron-helper") ? .accessory : .regular
        )
        app.run()
    }

    func applicationDidFinishLaunching(_: Notification) {
        let window =
            if helperMode {
                GhosttyHelperWindow(
                    contentRect: NSRect(x: 0, y: 0, width: 1, height: 1),
                    styleMask: [.borderless],
                    backing: .buffered,
                    defer: false
                )
            } else {
                NSWindow(
                    contentRect: NSRect(x: 0, y: 0, width: 920, height: 560),
                    styleMask: [.titled, .closable, .miniaturizable, .resizable],
                    backing: .buffered,
                    defer: false
                )
            }
        if helperMode {
            window.isReleasedWhenClosed = false
            window.ignoresMouseEvents = false
            window.acceptsMouseMovedEvents = true
            window.level = .floating
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.orderOut(nil)
        } else {
            window.center()
        }
        window.title = "Vimeflow Ghostty native smoke"

        let container = NSView()
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.cgColor
        window.contentView = container

        let terminalView = TerminalView(frame: .zero)
        terminalView.delegate = self
        terminalView.controller = controller
        terminalView.configuration = TerminalSurfaceOptions(
            backend: .inMemory(session)
        )
        terminalView.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(terminalView)
        NSLayoutConstraint.activate([
            terminalView.topAnchor.constraint(equalTo: container.topAnchor),
            terminalView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            terminalView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            terminalView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])

        self.window = window
        self.terminalView = terminalView

        if helperMode {
            startElectronHost()
        } else {
            window.makeKeyAndOrderFront(nil)
            window.makeFirstResponder(terminalView)
            activateApp()

            session.receive(
                "\u{001b}[38;2;141;224;210mVimeflow Ghostty native smoke\u{001b}[0m\r\n"
                    + "GhosttyTerminal is now connected to vimeflow-backend PTY over stdio IPC.\r\n"
                    + "Starting shell...\r\n\r\n"
            )
            startBackendPty()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_: Notification) {
        if let ptySessionId {
            backendClient?.killPty(sessionId: ptySessionId)
        }
        backendClient?.shutdown()
        electronHostClient?.sendClosed()
        electronHostClient?.close()
    }

    func terminalDidChangeTitle(_ title: String) {
        window?.title = title.isEmpty ? "Vimeflow Ghostty native smoke" : title
    }

    func terminalDidResize(columns: Int, rows: Int) {
        handleGhosttyResize(GhosttyGridSize(columns: columns, rows: rows))
    }

    func terminalDidClose(processAlive _: Bool) {
        NSApp.terminate(nil)
    }

    private func handleTerminalInput(_ data: Data) {
        if helperMode {
            electronHostClient?.sendInput(data)
            return
        }

        guard let ptySessionId else {
            return
        }

        backendClient?.writePty(sessionId: ptySessionId, data: data)
    }

    private func startBackendPty() {
        let client = VimeflowBackendClient()
        let sessionId = UUID().uuidString
        ptySessionId = sessionId

        do {
            try client.start { [weak self] event in
                self?.handleBackendEvent(event)
            }
        } catch {
            ptySessionId = nil
            showBackendError(error)
            return
        }

        backendClient = client
        client.spawnPty(
            sessionId: sessionId,
            cwd: VimeflowBackendClient.defaultWorkingDirectory()
        ) { [weak self] result in
            guard let self else { return }

            switch result {
            case let .success(pty):
                self.ptySessionId = pty.id
                self.window?.title = "Vimeflow Ghostty native smoke - \(pty.shell)"
                self.forwardResizeIfNeeded(self.pendingGrid)
            case let .failure(error):
                self.ptySessionId = nil
                self.showBackendError(error)
            }
        }
    }

    private func handleBackendEvent(_ event: VimeflowBackendEvent) {
        switch event {
        case let .ptyData(sessionId, data):
            guard sessionId == ptySessionId else { return }
            session.receive(data)
        }
    }

    private func handleGhosttyResize(_ grid: GhosttyGridSize) {
        guard grid.columns > 0, grid.rows > 0 else {
            return
        }

        pendingGrid = grid

        if helperMode {
            guard lastForwardedGrid != grid else {
                return
            }

            lastForwardedGrid = grid
            electronHostClient?.sendResize(grid)
            return
        }

        forwardResizeIfNeeded(grid)
    }

    private func forwardResizeIfNeeded(_ grid: GhosttyGridSize) {
        guard let ptySessionId, let backendClient else {
            return
        }

        guard lastForwardedGrid != grid else {
            return
        }

        lastForwardedGrid = grid
        backendClient.resizePty(sessionId: ptySessionId, grid: grid)
    }

    private func showBackendError(_ error: Error) {
        session.receive(
            "\r\n\u{001b}[38;2;243;139;168mVimeflow backend failed:\u{001b}[0m "
                + "\(error.localizedDescription)\r\n"
        )
    }

    private func startElectronHost() {
        let client = ElectronHostClient()
        electronHostClient = client
        client.start { [weak self] command in
            self?.handleElectronHostCommand(command)
        }
    }

    private func handleElectronHostCommand(_ command: ElectronHostCommand) {
        switch command {
        case let .setFrame(frame):
            applyHelperFrame(frame)
        case let .ptyData(sessionId, data):
            ptySessionId = sessionId
            session.receive(data)
        case .focus:
            focusHelperWindow()
        case .shutdown:
            NSApp.terminate(nil)
        }
    }

    private func applyHelperFrame(_ frame: GhosttyNativeFrame) {
        guard let window else { return }

        if !frame.visible || frame.width <= 0 || frame.height <= 0 {
            window.orderOut(nil)
            return
        }

        let appKitFrame = appKitFrameFromTopLeft(frame)
        window.setFrame(appKitFrame, display: true)
        window.orderFront(nil)
    }

    private func focusHelperWindow() {
        guard let window else { return }

        activateApp()
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(terminalView)
    }

    private func activateApp() {
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func appKitFrameFromTopLeft(_ frame: GhosttyNativeFrame) -> NSRect {
        let topLeft = NSPoint(x: frame.x, y: frame.y)
        let screen =
            NSScreen.screens.first { screen in
                screen.frame.contains(topLeft)
            } ?? NSScreen.main

        let screenMaxY = screen?.frame.maxY ?? frame.y + frame.height

        return NSRect(
            x: frame.x,
            y: screenMaxY - frame.y - frame.height,
            width: frame.width,
            height: frame.height
        )
    }
}
