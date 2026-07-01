import AppKit
import Foundation
import GhosttyTerminal

public typealias VimeflowGhosttyInputCallback = @convention(c) (
    UnsafeMutableRawPointer?,
    UnsafePointer<UInt8>?,
    Int32
) -> Void

public typealias VimeflowGhosttyResizeCallback = @convention(c) (
    UnsafeMutableRawPointer?,
    Int32,
    Int32
) -> Void

public typealias VimeflowGhosttyContextMenuCallback = @convention(c) (
    UnsafeMutableRawPointer?,
    Double,
    Double
) -> Void

public typealias VimeflowGhosttyFocusCallback = @convention(c) (
    UnsafeMutableRawPointer?
) -> Void

public typealias VimeflowGhosttyShortcutCallback = @convention(c) (
    UnsafeMutableRawPointer?,
    UnsafePointer<CChar>?,
    UnsafePointer<CChar>?,
    Bool,
    Bool,
    Bool,
    Bool
) -> Void

private func mainActorSync<T: Sendable>(_ body: @MainActor () -> T) -> T {
    if Thread.isMainThread {
        return MainActor.assumeIsolated(body)
    }

    return DispatchQueue.main.sync {
        MainActor.assumeIsolated(body)
    }
}

private struct SendablePointer: @unchecked Sendable {
    let value: UnsafeMutableRawPointer?
}

private final class CallbackBox: @unchecked Sendable {
    private let inputCallback: VimeflowGhosttyInputCallback?
    private let resizeCallback: VimeflowGhosttyResizeCallback?
    private let contextMenuCallback: VimeflowGhosttyContextMenuCallback?
    private let focusCallback: VimeflowGhosttyFocusCallback?
    private let shortcutCallback: VimeflowGhosttyShortcutCallback?
    private let callbackContext: UnsafeMutableRawPointer?
    private var lastColumns = 0
    private var lastRows = 0

    init(
        inputCallback: VimeflowGhosttyInputCallback?,
        resizeCallback: VimeflowGhosttyResizeCallback?,
        contextMenuCallback: VimeflowGhosttyContextMenuCallback?,
        focusCallback: VimeflowGhosttyFocusCallback?,
        shortcutCallback: VimeflowGhosttyShortcutCallback?,
        callbackContext: UnsafeMutableRawPointer?
    ) {
        self.inputCallback = inputCallback
        self.resizeCallback = resizeCallback
        self.contextMenuCallback = contextMenuCallback
        self.focusCallback = focusCallback
        self.shortcutCallback = shortcutCallback
        self.callbackContext = callbackContext
    }

    func sendInput(_ data: Data) {
        data.withUnsafeBytes { buffer in
            let pointer = buffer.bindMemory(to: UInt8.self).baseAddress
            inputCallback?(callbackContext, pointer, Int32(buffer.count))
        }
    }

    func sendResize(columns: Int, rows: Int) {
        guard columns > 0, rows > 0 else {
            return
        }

        guard lastColumns != columns || lastRows != rows else {
            return
        }

        lastColumns = columns
        lastRows = rows
        resizeCallback?(callbackContext, Int32(columns), Int32(rows))
    }

    func openContextMenu(x: Double, y: Double) {
        contextMenuCallback?(callbackContext, x, y)
    }

    func focusSurface() {
        focusCallback?(callbackContext)
    }

    func forwardShortcut(
        key: String,
        code: String,
        control: Bool,
        meta: Bool,
        alt: Bool,
        shift: Bool
    ) {
        key.withCString { keyPointer in
            code.withCString { codePointer in
                shortcutCallback?(
                    callbackContext,
                    keyPointer,
                    codePointer,
                    control,
                    meta,
                    alt,
                    shift
                )
            }
        }
    }
}

@MainActor
private final class EmbeddedGhosttySurface: NSObject {
    private static let shortcutDigitByKeyCode: [UInt16: Character] = [
        18: "1",
        19: "2",
        20: "3",
        21: "4",
        23: "5",
        22: "6",
        26: "7",
        28: "8",
        25: "9"
    ]

    private let parentView: NSView
    private let container = NSView(frame: .zero)
    private let callbacks: CallbackBox
    private var focusMonitor: Any?
    private var contextMenuMonitor: Any?
    private var shortcutMonitor: Any?
    private var shortcutDigits = Set<Character>()

    private lazy var controller = TerminalController()

    private lazy var session = InMemoryTerminalSession(
        write: { [callbacks] data in
            callbacks.sendInput(data)
        },
        resize: { [callbacks] viewport in
            callbacks.sendResize(
                columns: Int(viewport.columns),
                rows: Int(viewport.rows)
            )
        }
    )

    private lazy var terminalView: TerminalView = {
        let view = TerminalView(frame: .zero)
        view.controller = controller
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.autoresizingMask = [.width, .height]

        return view
    }()

    init(
        parentView: NSView,
        inputCallback: VimeflowGhosttyInputCallback?,
        resizeCallback: VimeflowGhosttyResizeCallback?,
        contextMenuCallback: VimeflowGhosttyContextMenuCallback?,
        focusCallback: VimeflowGhosttyFocusCallback?,
        shortcutCallback: VimeflowGhosttyShortcutCallback?,
        callbackContext: UnsafeMutableRawPointer?
    ) {
        self.parentView = parentView
        self.callbacks = CallbackBox(
            inputCallback: inputCallback,
            resizeCallback: resizeCallback,
            contextMenuCallback: contextMenuCallback,
            focusCallback: focusCallback,
            shortcutCallback: shortcutCallback,
            callbackContext: callbackContext
        )
        super.init()
        install()
    }

    func setFrame(x: Double, y: Double, width: Double, height: Double) {
        let safeWidth = max(0, width)
        let safeHeight = max(0, height)
        let parentHeight = parentView.bounds.height
        let appKitY = parentHeight - y - safeHeight

        container.frame = NSRect(
            x: x,
            y: appKitY,
            width: safeWidth,
            height: safeHeight
        )
        terminalView.frame = container.bounds
        container.isHidden = safeWidth <= 0 || safeHeight <= 0
    }

    func setShortcutDigits(_ digits: String) {
        shortcutDigits = Set(digits.filter { character in
            guard let value = character.wholeNumberValue else {
                return false
            }

            return (1...9).contains(value)
        })
    }

    func receive(_ text: String) {
        session.receive(text)
    }

    func focus() {
        parentView.window?.makeFirstResponder(terminalView)
    }

    func destroy() {
        if let focusMonitor {
            NSEvent.removeMonitor(focusMonitor)
            self.focusMonitor = nil
        }
        if let contextMenuMonitor {
            NSEvent.removeMonitor(contextMenuMonitor)
            self.contextMenuMonitor = nil
        }
        if let shortcutMonitor {
            NSEvent.removeMonitor(shortcutMonitor)
            self.shortcutMonitor = nil
        }
        container.removeFromSuperview()
    }

    private func install() {
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.cgColor
        container.addSubview(terminalView)
        parentView.addSubview(container, positioned: .above, relativeTo: nil)
        focusMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            self?.handleMouseDown(event)

            return event
        }
        contextMenuMonitor = NSEvent.addLocalMonitorForEvents(matching: [.rightMouseDown]) { [weak self] event in
            self?.handleRightMouse(event)

            return event
        }
        shortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
            self?.handleKeyDown(event) == true ? nil : event
        }
    }

    private func handleMouseDown(_ event: NSEvent) {
        guard let window = terminalView.window, event.window === window else {
            return
        }

        let terminalLocation = terminalView.convert(event.locationInWindow, from: nil)
        guard terminalView.bounds.contains(terminalLocation) else {
            return
        }

        callbacks.focusSurface()
    }

    private func handleRightMouse(_ event: NSEvent) {
        guard let window = terminalView.window, event.window === window else {
            return
        }

        let terminalLocation = terminalView.convert(event.locationInWindow, from: nil)
        guard terminalView.bounds.contains(terminalLocation) else {
            return
        }

        let parentLocation = terminalView.convert(terminalLocation, to: parentView)
        let x = parentLocation.x
        let y = parentView.bounds.height - parentLocation.y
        callbacks.openContextMenu(x: x, y: y)
    }

    private func handleKeyDown(_ event: NSEvent) -> Bool {
        guard let window = terminalView.window, event.window === window else {
            return false
        }

        guard let firstResponder = window.firstResponder as? NSView else {
            return false
        }

        if firstResponder !== terminalView,
           !firstResponder.isDescendant(of: terminalView) {
            return false
        }

        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command), !flags.contains(.control) else {
            return false
        }

        if !flags.contains(.option),
           !flags.contains(.shift),
           event.charactersIgnoringModifiers == ";" {
            callbacks.forwardShortcut(
                key: ";",
                code: "Semicolon",
                control: flags.contains(.control),
                meta: flags.contains(.command),
                alt: flags.contains(.option),
                shift: flags.contains(.shift)
            )

            return true
        }

        guard let digit = Self.shortcutDigitByKeyCode[event.keyCode] else {
            return false
        }

        guard shortcutDigits.contains(digit) else {
            return false
        }

        callbacks.forwardShortcut(
            key: String(digit),
            code: "Digit\(digit)",
            control: flags.contains(.control),
            meta: flags.contains(.command),
            alt: flags.contains(.option),
            shift: flags.contains(.shift)
        )

        return true
    }
}

@_cdecl("vimeflow_ghostty_create")
public func vimeflowGhosttyCreate(
    _ parentViewPointer: UnsafeMutableRawPointer?,
    _ inputCallback: VimeflowGhosttyInputCallback?,
    _ resizeCallback: VimeflowGhosttyResizeCallback?,
    _ contextMenuCallback: VimeflowGhosttyContextMenuCallback?,
    _ focusCallback: VimeflowGhosttyFocusCallback?,
    _ shortcutCallback: VimeflowGhosttyShortcutCallback?,
    _ callbackContext: UnsafeMutableRawPointer?
) -> UnsafeMutableRawPointer? {
    guard let parentViewPointer else {
        return nil
    }

    let parentPointer = SendablePointer(value: parentViewPointer)
    let contextPointer = SendablePointer(value: callbackContext)
    let surfacePointer = mainActorSync {
        let parentView = Unmanaged<NSView>
            .fromOpaque(parentPointer.value!)
            .takeUnretainedValue()
        let surface = EmbeddedGhosttySurface(
            parentView: parentView,
            inputCallback: inputCallback,
            resizeCallback: resizeCallback,
            contextMenuCallback: contextMenuCallback,
            focusCallback: focusCallback,
            shortcutCallback: shortcutCallback,
            callbackContext: contextPointer.value
        )

        return SendablePointer(value: Unmanaged.passRetained(surface).toOpaque())
    }

    return surfacePointer.value
}

@_cdecl("vimeflow_ghostty_set_frame")
public func vimeflowGhosttySetFrame(
    _ surfacePointer: UnsafeMutableRawPointer?,
    _ x: Double,
    _ y: Double,
    _ width: Double,
    _ height: Double
) {
    guard let surfacePointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    mainActorSync {
        let surface = Unmanaged<EmbeddedGhosttySurface>
            .fromOpaque(pointer.value!)
            .takeUnretainedValue()
        surface.setFrame(x: x, y: y, width: width, height: height)
    }
}

@_cdecl("vimeflow_ghostty_set_shortcut_digits")
public func vimeflowGhosttySetShortcutDigits(
    _ surfacePointer: UnsafeMutableRawPointer?,
    _ digitsPointer: UnsafePointer<CChar>?
) {
    guard let surfacePointer, let digitsPointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    let digits = String(cString: digitsPointer)
    mainActorSync {
        let surface = Unmanaged<EmbeddedGhosttySurface>
            .fromOpaque(pointer.value!)
            .takeUnretainedValue()
        surface.setShortcutDigits(digits)
    }
}

@_cdecl("vimeflow_ghostty_write")
public func vimeflowGhosttyWrite(
    _ surfacePointer: UnsafeMutableRawPointer?,
    _ bytes: UnsafePointer<UInt8>?,
    _ length: Int32
) {
    guard let surfacePointer, let bytes, length > 0 else {
        return
    }

    let text = String(decoding: UnsafeBufferPointer(start: bytes, count: Int(length)), as: UTF8.self)

    let pointer = SendablePointer(value: surfacePointer)
    mainActorSync {
        let surface = Unmanaged<EmbeddedGhosttySurface>
            .fromOpaque(pointer.value!)
            .takeUnretainedValue()
        surface.receive(text)
    }
}

@_cdecl("vimeflow_ghostty_focus")
public func vimeflowGhosttyFocus(_ surfacePointer: UnsafeMutableRawPointer?) {
    guard let surfacePointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    mainActorSync {
        let surface = Unmanaged<EmbeddedGhosttySurface>
            .fromOpaque(pointer.value!)
            .takeUnretainedValue()
        surface.focus()
    }
}

@_cdecl("vimeflow_ghostty_destroy")
public func vimeflowGhosttyDestroy(_ surfacePointer: UnsafeMutableRawPointer?) {
    guard let surfacePointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    mainActorSync {
        let surface = Unmanaged<EmbeddedGhosttySurface>
            .fromOpaque(pointer.value!)
            .takeRetainedValue()
        surface.destroy()
    }
}
