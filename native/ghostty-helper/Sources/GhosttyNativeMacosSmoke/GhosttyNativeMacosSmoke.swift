import AppKit
import Foundation
import GhosttyTerminal

private extension NSColor {
    static func vimeflowGhosttyHexColor(_ hexColor: String) -> String? {
        let hex = hexColor
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "#"))

        return hex.count == 6 && Int(hex, radix: 16) != nil ? hex : nil
    }

    convenience init?(vimeflowHexColor hexColor: String) {
        guard
            let hex = Self.vimeflowGhosttyHexColor(hexColor),
            let value = Int(hex, radix: 16)
        else {
            return nil
        }

        self.init(
            srgbRed: CGFloat((value >> 16) & 0xff) / 255,
            green: CGFloat((value >> 8) & 0xff) / 255,
            blue: CGFloat(value & 0xff) / 255,
            alpha: 1
        )
    }
}

// ponytail: helper-window spike; replace with an NSView addon if z-order/focus must be product-grade.
private final class GhosttyHelperWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

// Smoke-only layout hook. Production child layout belongs in
// EmbeddedGhosttySurface, then this helper class should be deleted.
private final class SmokeContainerView: NSView {
    var onLayout: (() -> Void)?

    override func layout() {
        super.layout()
        onLayout?()
    }
}

// Smoke-only divider. It proves the nested terminal region can be resized;
// production should move this behavior into the embedded AppKit surface.
private final class SmokeDividerView: NSView {
    var vertical = true
    var onDrag: ((CGFloat) -> Void)?

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: vertical ? .resizeLeftRight : .resizeUpDown)
    }

    override func mouseDragged(with event: NSEvent) {
        onDrag?(vertical ? event.deltaX : event.deltaY)
    }
}

// Smoke-only child routing. Keep the role generic so the production nested
// terminal path can support more than the burner use case.
private enum SmokeTerminalRole {
    case primary
    case secondary
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
    private var containerView: SmokeContainerView?
    private var terminalView: TerminalView?
    private var secondaryTerminalView: TerminalView?
    private var dividerView: SmokeDividerView?
    private var backendClient: VimeflowBackendClient?
    private var electronHostClient: ElectronHostClient?
    private var ptySessionId: String?
    private var secondaryPtySessionId: String?
    private var pendingGrid = GhosttyGridSize(columns: 80, rows: 24)
    private var secondaryPendingGrid = GhosttyGridSize(columns: 80, rows: 12)
    private var lastForwardedGrid: GhosttyGridSize?
    private var secondaryLastForwardedGrid: GhosttyGridSize?
    private var secondarySplitRatio: CGFloat = 0.34
    private var shortcutMonitor: Any?
    private let helperMode = CommandLine.arguments.contains("--electron-helper")

    private lazy var controller = TerminalController()

    private lazy var session = InMemoryTerminalSession(
        write: { [weak self] data in
            DispatchQueue.main.async {
                self?.handleTerminalInput(data, role: .primary)
            }
        },
        resize: { viewport in
            DispatchQueue.main.async { [weak self] in
                self?.handleGhosttyResize(
                    GhosttyGridSize(
                        columns: Int(viewport.columns),
                        rows: Int(viewport.rows)
                    ),
                    role: .primary
                )
            }
        }
    )

    private lazy var secondaryController = TerminalController()

    private lazy var secondarySession = InMemoryTerminalSession(
        write: { [weak self] data in
            DispatchQueue.main.async {
                self?.handleTerminalInput(data, role: .secondary)
            }
        },
        resize: { viewport in
            DispatchQueue.main.async { [weak self] in
                self?.handleGhosttyResize(
                    GhosttyGridSize(
                        columns: Int(viewport.columns),
                        rows: Int(viewport.rows)
                    ),
                    role: .secondary
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
            window.isOpaque = false
            window.backgroundColor = .clear
            window.ignoresMouseEvents = false
            window.acceptsMouseMovedEvents = true
            window.level = .floating
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.orderOut(nil)
        } else {
            window.center()
        }
        window.title = "Vimeflow Ghostty native smoke"

        let container = SmokeContainerView()
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.cgColor
        container.onLayout = { [weak self] in
            self?.layoutSmokeTerminalViews()
        }
        window.contentView = container

        let terminalView = TerminalView(frame: .zero)
        terminalView.delegate = self
        terminalView.controller = controller
        terminalView.configuration = TerminalSurfaceOptions(
            backend: .inMemory(session)
        )

        container.addSubview(terminalView)

        self.window = window
        self.containerView = container
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
                    + "Smoke controls: Cmd+B show burner, Cmd+Shift+B hide burner, Cmd+Option+B remove burner.\r\n"
                    + "Starting shell...\r\n\r\n"
            )
            installSmokeShortcuts()
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
        if let secondaryPtySessionId {
            backendClient?.killPty(sessionId: secondaryPtySessionId)
        }
        if let shortcutMonitor {
            NSEvent.removeMonitor(shortcutMonitor)
            self.shortcutMonitor = nil
        }
        backendClient?.shutdown()
        electronHostClient?.sendClosed()
        electronHostClient?.close()
    }

    func terminalDidChangeTitle(_ title: String) {
        window?.title = title.isEmpty ? "Vimeflow Ghostty native smoke" : title
    }

    func terminalDidResize(columns: Int, rows: Int) {
        handleGhosttyResize(
            GhosttyGridSize(columns: columns, rows: rows),
            role: .primary
        )
    }

    func terminalDidClose(processAlive _: Bool) {
        NSApp.terminate(nil)
    }

    private func handleTerminalInput(_ data: Data, role: SmokeTerminalRole) {
        if helperMode {
            electronHostClient?.sendInput(data)
            return
        }

        let targetSessionId =
            switch role {
            case .primary:
                ptySessionId
            case .secondary:
                secondaryPtySessionId
            }

        guard let targetSessionId else {
            return
        }

        backendClient?.writePty(sessionId: targetSessionId, data: data)
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
                self.forwardResizeIfNeeded(self.pendingGrid, role: .primary)
            case let .failure(error):
                self.ptySessionId = nil
                self.showBackendError(error)
            }
        }
    }

    private func handleBackendEvent(_ event: VimeflowBackendEvent) {
        switch event {
        case let .ptyData(sessionId, data):
            if sessionId == ptySessionId {
                session.receive(data)
            } else if sessionId == secondaryPtySessionId {
                secondarySession.receive(data)
            }
        }
    }

    private func handleGhosttyResize(_ grid: GhosttyGridSize, role: SmokeTerminalRole) {
        guard grid.columns > 0, grid.rows > 0 else {
            return
        }

        switch role {
        case .primary:
            pendingGrid = grid
        case .secondary:
            secondaryPendingGrid = grid
        }

        if helperMode {
            guard role == .primary else {
                return
            }

            guard lastForwardedGrid != grid else {
                return
            }

            lastForwardedGrid = grid
            electronHostClient?.sendResize(grid)
            return
        }

        forwardResizeIfNeeded(grid, role: role)
    }

    private func forwardResizeIfNeeded(_ grid: GhosttyGridSize, role: SmokeTerminalRole) {
        guard let backendClient else {
            return
        }

        let targetSessionId =
            switch role {
            case .primary:
                ptySessionId
            case .secondary:
                secondaryPtySessionId
            }

        guard let targetSessionId else {
            return
        }

        switch role {
        case .primary:
            guard lastForwardedGrid != grid else {
                return
            }
            lastForwardedGrid = grid
        case .secondary:
            guard secondaryLastForwardedGrid != grid else {
                return
            }
            secondaryLastForwardedGrid = grid
        }

        backendClient.resizePty(sessionId: targetSessionId, grid: grid)
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

        setBackgroundColor(frame.backgroundColor)
        let safeBottomCornerRadius = max(0, frame.bottomCornerRadius)
        containerView?.layer?.cornerRadius = CGFloat(safeBottomCornerRadius)
        containerView?.layer?.maskedCorners = [
            .layerMinXMinYCorner,
            .layerMaxXMinYCorner,
        ]
        containerView?.layer?.masksToBounds = safeBottomCornerRadius > 0

        if !frame.visible || frame.width <= 0 || frame.height <= 0 {
            window.orderOut(nil)
            return
        }

        let appKitFrame = appKitFrameFromTopLeft(frame)
        window.setFrame(appKitFrame, display: true)
        window.orderFront(nil)
    }

    private func setBackgroundColor(_ hexColor: String) {
        guard
            let color = NSColor(vimeflowHexColor: hexColor),
            let ghosttyHex = NSColor.vimeflowGhosttyHexColor(hexColor)
        else {
            return
        }

        containerView?.layer?.backgroundColor = color.cgColor
        controller.setTheme(TerminalTheme(
            light: TerminalConfiguration().background(ghosttyHex),
            dark: TerminalConfiguration().background(ghosttyHex)
        ))
        secondaryController.setTheme(TerminalTheme(
            light: TerminalConfiguration().background(ghosttyHex),
            dark: TerminalConfiguration().background(ghosttyHex)
        ))
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

    // Smoke-only keyboard controls. Production add/hide/remove will be driven
    // by Electron IPC from the pane header, not by local AppKit shortcuts.
    private func installSmokeShortcuts() {
        shortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
            guard let self, self.handleSmokeShortcut(event) else {
                return event
            }

            return nil
        }
    }

    private func handleSmokeShortcut(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command),
              event.charactersIgnoringModifiers?.lowercased() == "b"
        else {
            return false
        }

        if flags.contains(.option) {
            removeSecondarySmokeTerminal()
            return true
        }

        if flags.contains(.shift) {
            hideSecondarySmokeTerminal()
            return true
        }

        showSecondarySmokeTerminal()
        return true
    }

    private func showSecondarySmokeTerminal() {
        if let secondaryTerminalView {
            secondaryTerminalView.isHidden = false
            layoutSmokeTerminalViews()
            window?.makeFirstResponder(secondaryTerminalView)
            return
        }

        let secondaryTerminalView = TerminalView(frame: .zero)
        secondaryTerminalView.controller = secondaryController
        secondaryTerminalView.configuration = TerminalSurfaceOptions(
            backend: .inMemory(secondarySession)
        )
        containerView?.addSubview(secondaryTerminalView)
        self.secondaryTerminalView = secondaryTerminalView
        ensureSmokeDivider()
        dividerView?.isHidden = false
        secondarySession.receive(
            "\u{001b}[38;2;214;163;72mVimeflow burner smoke\u{001b}[0m\r\n"
                + "Separate TerminalView, TerminalController, and ephemeral PTY.\r\n\r\n"
        )
        layoutSmokeTerminalViews()
        window?.makeFirstResponder(secondaryTerminalView)
        startSecondaryBackendPty()
    }

    private func hideSecondarySmokeTerminal() {
        secondaryTerminalView?.isHidden = true
        dividerView?.isHidden = true
        layoutSmokeTerminalViews()
        if let terminalView {
            window?.makeFirstResponder(terminalView)
        }
    }

    private func removeSecondarySmokeTerminal() {
        if let secondaryPtySessionId {
            backendClient?.killPty(sessionId: secondaryPtySessionId)
        }
        secondaryPtySessionId = nil
        secondaryLastForwardedGrid = nil
        secondaryTerminalView?.removeFromSuperview()
        secondaryTerminalView = nil
        dividerView?.isHidden = true
        layoutSmokeTerminalViews()
        if let terminalView {
            window?.makeFirstResponder(terminalView)
        }
    }

    private func startSecondaryBackendPty() {
        guard secondaryPtySessionId == nil else {
            return
        }

        let sessionId = UUID().uuidString
        secondaryPtySessionId = sessionId
        backendClient?.spawnPty(
            sessionId: sessionId,
            cwd: VimeflowBackendClient.defaultWorkingDirectory()
        ) { [weak self] result in
            guard let self else { return }

            switch result {
            case let .success(pty):
                self.secondaryPtySessionId = pty.id
                self.forwardResizeIfNeeded(self.secondaryPendingGrid, role: .secondary)
            case let .failure(error):
                self.secondaryPtySessionId = nil
                self.secondarySession.receive(
                    "\r\n\u{001b}[38;2;243;139;168mBurner spawn failed:\u{001b}[0m "
                        + "\(error.localizedDescription)\r\n"
                )
            }
        }
    }

    private func ensureSmokeDivider() {
        if dividerView != nil {
            return
        }

        let divider = SmokeDividerView(frame: .zero)
        divider.wantsLayer = true
        divider.layer?.backgroundColor = NSColor.separatorColor.cgColor
        divider.onDrag = { [weak self] delta in
            self?.resizeSecondarySplit(delta: delta)
        }
        containerView?.addSubview(divider)
        dividerView = divider
    }

    private func resizeSecondarySplit(delta: CGFloat) {
        guard let containerView else {
            return
        }

        let bounds = containerView.bounds
        if bounds.width < 720 {
            secondarySplitRatio = max(0.2, min(0.65, secondarySplitRatio - delta / max(1, bounds.height)))
        } else {
            secondarySplitRatio = max(0.2, min(0.65, secondarySplitRatio - delta / max(1, bounds.width)))
        }
        layoutSmokeTerminalViews()
    }

    private func clamped(_ value: CGFloat, min minValue: CGFloat, max maxValue: CGFloat) -> CGFloat {
        min(max(value, minValue), maxValue)
    }

    private func layoutSmokeTerminalViews() {
        guard let containerView, let terminalView else {
            return
        }

        let bounds = containerView.bounds
        guard let secondaryTerminalView, !secondaryTerminalView.isHidden else {
            terminalView.frame = bounds
            dividerView?.isHidden = true
            return
        }

        let divider: CGFloat = 6
        dividerView?.isHidden = false
        if bounds.width < 720 {
            let secondaryHeight = clamped(
                floor(bounds.height * secondarySplitRatio),
                min: 140,
                max: max(140, bounds.height - 180)
            )
            terminalView.frame = NSRect(
                x: 0,
                y: secondaryHeight + divider,
                width: bounds.width,
                height: max(0, bounds.height - secondaryHeight - divider)
            )
            secondaryTerminalView.frame = NSRect(
                x: 0,
                y: 0,
                width: bounds.width,
                height: secondaryHeight
            )
            dividerView?.vertical = false
            dividerView?.frame = NSRect(
                x: 0,
                y: secondaryHeight,
                width: bounds.width,
                height: divider
            )
        } else {
            let secondaryWidth = clamped(
                floor(bounds.width * secondarySplitRatio),
                min: 260,
                max: max(260, bounds.width - 320)
            )
            terminalView.frame = NSRect(
                x: 0,
                y: 0,
                width: max(0, bounds.width - secondaryWidth - divider),
                height: bounds.height
            )
            secondaryTerminalView.frame = NSRect(
                x: bounds.width - secondaryWidth,
                y: 0,
                width: secondaryWidth,
                height: bounds.height
            )
            dividerView?.vertical = true
            dividerView?.frame = NSRect(
                x: bounds.width - secondaryWidth - divider,
                y: 0,
                width: divider,
                height: bounds.height
            )
        }
        if let dividerView {
            containerView.window?.invalidateCursorRects(for: dividerView)
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
