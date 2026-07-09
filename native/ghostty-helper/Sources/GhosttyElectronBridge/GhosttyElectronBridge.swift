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
    Bool,
    Bool
) -> Void

public typealias VimeflowGhosttyRenamePaneCallback = @convention(c) (
    UnsafeMutableRawPointer?
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

@MainActor
private enum SurfaceHandleRegistry {
    private static var live = Set<UInt>()

    static func insert(_ pointer: UnsafeMutableRawPointer) {
        live.insert(UInt(bitPattern: pointer))
    }

    static func contains(_ pointer: UnsafeMutableRawPointer) -> Bool {
        live.contains(UInt(bitPattern: pointer))
    }

    static func remove(_ pointer: UnsafeMutableRawPointer) -> Bool {
        live.remove(UInt(bitPattern: pointer)) != nil
    }
}

@MainActor
private func liveSurface(from pointer: SendablePointer) -> EmbeddedGhosttySurface? {
    guard
        let rawPointer = pointer.value,
        SurfaceHandleRegistry.contains(rawPointer)
    else {
        return nil
    }

    return Unmanaged<EmbeddedGhosttySurface>
        .fromOpaque(rawPointer)
        .takeUnretainedValue()
}

private final class EmbeddedGhosttyContainerView: NSView {
    var onLayout: (() -> Void)?

    override func layout() {
        super.layout()
        onLayout?()
    }
}

private final class EmbeddedGhosttyDividerView: NSView {
    var isDarkBackground = true {
        didSet {
            needsDisplay = true
        }
    }
    var vertical = true {
        didSet {
            needsDisplay = true
        }
    }
    var onDrag: ((CGFloat) -> Void)?

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        let lineWidth = 1 / scale
        // App theme and macOS appearance can differ; contrast against Ghostty's canvas.
        let dividerColor = isDarkBackground
            ? NSColor.white.withAlphaComponent(0.22)
            : NSColor.black.withAlphaComponent(0.12)
        dividerColor.setFill()

        if vertical {
            NSRect(
                x: floor((bounds.width - lineWidth) / 2),
                y: 0,
                width: lineWidth,
                height: bounds.height
            ).fill()
        } else {
            NSRect(
                x: 0,
                y: floor((bounds.height - lineWidth) / 2),
                width: bounds.width,
                height: lineWidth
            ).fill()
        }
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: vertical ? .resizeLeftRight : .resizeUpDown)
    }

    override func mouseDragged(with event: NSEvent) {
        onDrag?(vertical ? event.deltaX : event.deltaY)
    }
}

private extension NSColor {
    static func vimeflowGhosttyHexColor(_ hexColor: String) -> String? {
        let hex = hexColor
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "#"))

        return hex.count == 6 && Int(hex, radix: 16) != nil ? hex : nil
    }

    static func vimeflowIsDarkHexColor(_ hexColor: String) -> Bool {
        guard
            let hex = vimeflowGhosttyHexColor(hexColor),
            let value = Int(hex, radix: 16)
        else {
            return true
        }

        let red = Double((value >> 16) & 0xff) / 255
        let green = Double((value >> 8) & 0xff) / 255
        let blue = Double(value & 0xff) / 255

        return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.5
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

private final class CallbackBox: @unchecked Sendable {
    private let inputCallback: VimeflowGhosttyInputCallback?
    private let resizeCallback: VimeflowGhosttyResizeCallback?
    private let focusCallback: VimeflowGhosttyFocusCallback?
    private let shortcutCallback: VimeflowGhosttyShortcutCallback?
    private let renamePaneCallback: VimeflowGhosttyRenamePaneCallback?
    private let callbackContext: UnsafeMutableRawPointer?
    private var lastColumns = 0
    private var lastRows = 0

    init(
        inputCallback: VimeflowGhosttyInputCallback?,
        resizeCallback: VimeflowGhosttyResizeCallback?,
        focusCallback: VimeflowGhosttyFocusCallback?,
        shortcutCallback: VimeflowGhosttyShortcutCallback?,
        renamePaneCallback: VimeflowGhosttyRenamePaneCallback?,
        callbackContext: UnsafeMutableRawPointer?
    ) {
        self.inputCallback = inputCallback
        self.resizeCallback = resizeCallback
        self.focusCallback = focusCallback
        self.shortcutCallback = shortcutCallback
        self.renamePaneCallback = renamePaneCallback
        self.callbackContext = callbackContext
    }

    func sendInput(_ data: Data) {
        guard data.count <= Int(Int32.max) else {
            return
        }

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

    func focusSurface() {
        focusCallback?(callbackContext)
    }

    func forwardShortcut(
        key: String,
        code: String,
        control: Bool,
        meta: Bool,
        alt: Bool,
        shift: Bool,
        repeatEvent: Bool
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
                    shift,
                    repeatEvent
                )
            }
        }
    }

    func renamePane() {
        renamePaneCallback?(callbackContext)
    }
}

@MainActor
private final class EmbeddedGhosttyChild {
    let callbacks: CallbackBox
    let controller: TerminalController
    let session: InMemoryTerminalSession
    let terminalView: TerminalView
    private var backgroundHexColor = "000000"
    private var foregroundHexColor = "ffffff"
    private var fontFamily: String?

    init(callbacks: CallbackBox) {
        self.callbacks = callbacks

        let controller = TerminalController()
        self.controller = controller

        let session = InMemoryTerminalSession(
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
        self.session = session

        let view = TerminalView(frame: .zero)
        view.controller = controller
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        self.terminalView = view
    }

    func setBackgroundColor(_ hexColor: String) {
        guard let ghosttyHex = NSColor.vimeflowGhosttyHexColor(hexColor) else {
            return
        }

        backgroundHexColor = ghosttyHex
        applyTheme()
    }

    func setForegroundColor(_ hexColor: String) {
        guard let ghosttyHex = NSColor.vimeflowGhosttyHexColor(hexColor) else {
            return
        }

        foregroundHexColor = ghosttyHex
        applyTheme()
    }

    func setFontFamily(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        fontFamily = trimmed
        applyTheme()
    }

    private func terminalConfiguration() -> TerminalConfiguration {
        let configuration = TerminalConfiguration()
            .background(backgroundHexColor)
            .foreground(foregroundHexColor)

        guard let fontFamily else {
            return configuration
        }

        return configuration.fontFamily(fontFamily)
    }

    private func applyTheme() {
        let configuration = terminalConfiguration()
        controller.setTheme(TerminalTheme(
            light: configuration,
            dark: configuration
        ))
    }

    func receive(_ text: String) {
        session.receive(text)
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

    // App-owned shortcuts must cross the AppKit -> Electron boundary while
    // Ghostty has focus. VIM-294 tracks replacing this explicit list with a
    // shared shortcut registry; Cmd+R/reload is still a later scope.
    private static let workspaceShortcutByKeyCode: [UInt16: (key: String, code: String)] = [
        5: ("g", "KeyG"),
        6: ("z", "KeyZ"),
        11: ("b", "KeyB"),
        14: ("e", "KeyE"),
        29: ("0", "Digit0"),
        42: ("\\", "Backslash"),
        45: ("n", "KeyN")
    ]

    private static let workspaceShortcutCodesAllowingExtraModifiers = Set([
        "Digit0",
        "Backslash"
    ])

    private let parentView: NSView
    private let container = EmbeddedGhosttyContainerView(frame: .zero)
    private let callbacks: CallbackBox
    private var focusMonitor: Any?
    private var contextMenuMonitor: Any?
    private var shortcutMonitor: Any?
    private var shortcutDigits = Set<Character>()
    private var backgroundHexColor = "000000"
    private var foregroundHexColor = "ffffff"
    private var fontFamily: String?
    private var secondaryChild: EmbeddedGhosttyChild?
    private var dividerView: EmbeddedGhosttyDividerView?
    private var secondarySplitRatio: CGFloat = 0.34

    private lazy var contextMenu: NSMenu = {
        let menu = NSMenu()
        menu.autoenablesItems = true
        let renameItem = NSMenuItem(
            title: "Change Pane Name",
            action: #selector(changePaneName(_:)),
            keyEquivalent: ""
        )
        renameItem.target = self
        menu.addItem(renameItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(
            title: "Copy",
            action: #selector(NSText.copy(_:)),
            keyEquivalent: ""
        ))
        menu.addItem(NSMenuItem(
            title: "Paste",
            action: #selector(NSText.paste(_:)),
            keyEquivalent: ""
        ))

        return menu
    }()

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
        focusCallback: VimeflowGhosttyFocusCallback?,
        shortcutCallback: VimeflowGhosttyShortcutCallback?,
        renamePaneCallback: VimeflowGhosttyRenamePaneCallback?,
        callbackContext: UnsafeMutableRawPointer?
    ) {
        self.parentView = parentView
        self.callbacks = CallbackBox(
            inputCallback: inputCallback,
            resizeCallback: resizeCallback,
            focusCallback: focusCallback,
            shortcutCallback: shortcutCallback,
            renamePaneCallback: renamePaneCallback,
            callbackContext: callbackContext
        )
        super.init()
        install()
    }

    @objc private func changePaneName(_ sender: Any?) {
        callbacks.renamePane()
    }

    func setFrame(
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        bottomCornerRadius: Double,
        parentHeight: Double
    ) {
        let safeWidth = max(0, width)
        let safeHeight = max(0, height)
        let safeBottomCornerRadius = max(0, bottomCornerRadius)
        let safeParentHeight = parentHeight.isFinite && parentHeight > 0 ? parentHeight : parentView.bounds.height
        let appKitY = safeParentHeight - y - safeHeight

        container.layer?.cornerRadius = CGFloat(safeBottomCornerRadius)
        container.layer?.maskedCorners = [
            .layerMinXMinYCorner,
            .layerMaxXMinYCorner
        ]
        container.layer?.masksToBounds = safeBottomCornerRadius > 0
        container.frame = NSRect(
            x: x,
            y: appKitY,
            width: safeWidth,
            height: safeHeight
        )
        updateLiveResizePrediction(frame: container.frame)
        layoutChildren()
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

    func setBackgroundColor(_ hexColor: String) {
        guard
            let color = NSColor(vimeflowHexColor: hexColor),
            let ghosttyHex = NSColor.vimeflowGhosttyHexColor(hexColor)
        else {
            return
        }

        container.layer?.backgroundColor = color.cgColor
        backgroundHexColor = ghosttyHex
        dividerView?.isDarkBackground = NSColor.vimeflowIsDarkHexColor(ghosttyHex)
        applyTheme()
        secondaryChild?.setBackgroundColor(ghosttyHex)
    }

    func setForegroundColor(_ hexColor: String) {
        guard let ghosttyHex = NSColor.vimeflowGhosttyHexColor(hexColor) else {
            return
        }

        foregroundHexColor = ghosttyHex
        applyTheme()
        secondaryChild?.setForegroundColor(ghosttyHex)
    }

    func setFontFamily(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        fontFamily = trimmed
        applyTheme()
        secondaryChild?.setFontFamily(trimmed)
    }

    private func terminalConfiguration() -> TerminalConfiguration {
        let configuration = TerminalConfiguration()
            .background(backgroundHexColor)
            .foreground(foregroundHexColor)

        guard let fontFamily else {
            return configuration
        }

        return configuration.fontFamily(fontFamily)
    }

    private func applyTheme() {
        let configuration = terminalConfiguration()
        controller.setTheme(TerminalTheme(
            light: configuration,
            dark: configuration
        ))
    }

    func receive(_ text: String) {
        session.receive(text)
    }

    func addSecondary(
        inputCallback: VimeflowGhosttyInputCallback?,
        resizeCallback: VimeflowGhosttyResizeCallback?,
        focusCallback: VimeflowGhosttyFocusCallback?,
        callbackContext: UnsafeMutableRawPointer?
    ) {
        if let secondaryChild {
            secondaryChild.terminalView.isHidden = false
            dividerView?.isHidden = false
            layoutChildren()
            parentView.window?.makeFirstResponder(secondaryChild.terminalView)
            return
        }

        let callbacks = CallbackBox(
            inputCallback: inputCallback,
            resizeCallback: resizeCallback,
            focusCallback: focusCallback,
            shortcutCallback: nil,
            renamePaneCallback: nil,
            callbackContext: callbackContext
        )
        let child = EmbeddedGhosttyChild(callbacks: callbacks)
        child.setBackgroundColor(backgroundHexColor)
        child.setForegroundColor(foregroundHexColor)
        if let fontFamily {
            child.setFontFamily(fontFamily)
        }
        container.addSubview(child.terminalView)
        secondaryChild = child
        ensureDivider()
        dividerView?.isHidden = false
        layoutChildren()
        parentView.window?.makeFirstResponder(child.terminalView)
    }

    func setSecondaryVisible(_ visible: Bool) {
        guard let secondaryChild else {
            return
        }

        secondaryChild.terminalView.isHidden = !visible
        dividerView?.isHidden = !visible
        layoutChildren()
        if visible {
            parentView.window?.makeFirstResponder(secondaryChild.terminalView)
        } else {
            focus()
        }
    }

    func removeSecondary(refocusPrimary: Bool = true) {
        secondaryChild?.terminalView.removeFromSuperview()
        secondaryChild = nil
        dividerView?.isHidden = true
        layoutChildren()
        if refocusPrimary {
            focus()
        }
    }

    func receiveSecondary(_ text: String) {
        secondaryChild?.receive(text)
    }

    func focusSecondary() {
        guard let secondaryTerminalView = secondaryChild?.terminalView else {
            return
        }

        parentView.window?.makeFirstResponder(secondaryTerminalView)
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
        removeSecondary(refocusPrimary: false)
        container.removeFromSuperview()
    }

    private func install() {
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.cgColor
        container.onLayout = { [weak self] in
            self?.layoutChildren()
        }
        container.addSubview(terminalView)
        parentView.addSubview(container, positioned: .above, relativeTo: nil)
        focusMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            self?.handleMouseDown(event)

            return event
        }
        contextMenuMonitor = NSEvent.addLocalMonitorForEvents(matching: [.rightMouseDown]) { [weak self] event in
            self?.handleRightMouse(event) == true ? nil : event
        }
        shortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
            self?.handleKeyDown(event) == true ? nil : event
        }
    }

    private func updateLiveResizePrediction(frame: NSRect) {
        guard parentView.inLiveResize else {
            container.autoresizingMask = []

            return
        }

        // AppKit moves/resizes the native view between renderer IPC corrections
        // during live resize; renderer frames still win on the next update.
        container.autoresizingMask = predictedAutoresizingMask(
            frame: frame,
            parentBounds: parentView.bounds
        )
    }

    private func predictedAutoresizingMask(
        frame: NSRect,
        parentBounds: NSRect
    ) -> NSView.AutoresizingMask {
        let tolerance: CGFloat = 1
        let touchesLeft = abs(frame.minX - parentBounds.minX) <= tolerance
        let touchesRight = abs(frame.maxX - parentBounds.maxX) <= tolerance
        let touchesBottom = abs(frame.minY - parentBounds.minY) <= tolerance
        let touchesTop = abs(frame.maxY - parentBounds.maxY) <= tolerance
        var mask: NSView.AutoresizingMask = []

        mask.formUnion(axisAutoresizingMask(
            touchesMin: touchesLeft,
            touchesMax: touchesRight,
            size: .width,
            minMargin: .minXMargin,
            maxMargin: .maxXMargin
        ))
        mask.formUnion(axisAutoresizingMask(
            touchesMin: touchesBottom,
            touchesMax: touchesTop,
            size: .height,
            minMargin: .minYMargin,
            maxMargin: .maxYMargin
        ))

        return mask
    }

    private func axisAutoresizingMask(
        touchesMin: Bool,
        touchesMax: Bool,
        size: NSView.AutoresizingMask,
        minMargin: NSView.AutoresizingMask,
        maxMargin: NSView.AutoresizingMask
    ) -> NSView.AutoresizingMask {
        if touchesMin && touchesMax {
            return [size]
        }
        if touchesMin {
            return [maxMargin]
        }
        if touchesMax {
            return [minMargin]
        }

        return [minMargin, size, maxMargin]
    }

    private func ensureDivider() {
        if dividerView != nil {
            return
        }

        let divider = EmbeddedGhosttyDividerView(frame: .zero)
        divider.isDarkBackground = NSColor.vimeflowIsDarkHexColor(backgroundHexColor)
        divider.onDrag = { [weak self] delta in
            self?.resizeSecondarySplit(delta: delta)
        }
        container.addSubview(divider)
        dividerView = divider
    }

    private func resizeSecondarySplit(delta: CGFloat) {
        let bounds = container.bounds
        if bounds.width < 720 {
            secondarySplitRatio = clamped(
                secondarySplitRatio - delta / max(1, bounds.height),
                min: 0.2,
                max: 0.65
            )
        } else {
            secondarySplitRatio = clamped(
                secondarySplitRatio - delta / max(1, bounds.width),
                min: 0.2,
                max: 0.65
            )
        }
        layoutChildren()
    }

    private func clamped(_ value: CGFloat, min minValue: CGFloat, max maxValue: CGFloat) -> CGFloat {
        min(max(value, minValue), maxValue)
    }

    private func layoutChildren() {
        let bounds = container.bounds
        guard let secondaryTerminalView = secondaryChild?.terminalView,
              !secondaryTerminalView.isHidden
        else {
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
            container.window?.invalidateCursorRects(for: dividerView)
        }
    }

    private func terminalHit(for event: NSEvent) -> (view: TerminalView, callbacks: CallbackBox)? {
        if let secondaryChild, !secondaryChild.terminalView.isHidden {
            let secondaryLocation = secondaryChild.terminalView.convert(event.locationInWindow, from: nil)
            if secondaryChild.terminalView.bounds.contains(secondaryLocation) {
                return (secondaryChild.terminalView, secondaryChild.callbacks)
            }
        }

        let terminalLocation = terminalView.convert(event.locationInWindow, from: nil)
        if terminalView.bounds.contains(terminalLocation) {
            return (terminalView, callbacks)
        }

        return nil
    }

    private func handleMouseDown(_ event: NSEvent) {
        guard let window = container.window, event.window === window else {
            return
        }

        terminalHit(for: event)?.callbacks.focusSurface()
    }

    private func handleRightMouse(_ event: NSEvent) -> Bool {
        guard let window = container.window, event.window === window else {
            return false
        }

        guard let hit = terminalHit(for: event) else {
            return false
        }

        parentView.window?.makeFirstResponder(hit.view)
        NSMenu.popUpContextMenu(contextMenu, with: event, for: hit.view)

        return true
    }

    private func handleKeyDown(_ event: NSEvent) -> Bool {
        guard let window = container.window, event.window === window else {
            return false
        }

        guard let firstResponder = window.firstResponder as? NSView else {
            return false
        }

        let primaryFocused = firstResponder === terminalView ||
            firstResponder.isDescendant(of: terminalView)
        let secondaryFocused =
            if let secondaryTerminalView = secondaryChild?.terminalView {
                firstResponder === secondaryTerminalView ||
                    firstResponder.isDescendant(of: secondaryTerminalView)
            } else {
                false
            }
        if !primaryFocused && !secondaryFocused {
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
                shift: flags.contains(.shift),
                repeatEvent: event.isARepeat
            )

            return true
        }

        if let shortcut = Self.workspaceShortcutByKeyCode[event.keyCode] {
            let allowsExtraModifiers =
                Self.workspaceShortcutCodesAllowingExtraModifiers.contains(shortcut.code)
            if allowsExtraModifiers || (!flags.contains(.option) && !flags.contains(.shift)) {
                callbacks.forwardShortcut(
                    key: shortcut.key,
                    code: shortcut.code,
                    control: flags.contains(.control),
                    meta: flags.contains(.command),
                    alt: flags.contains(.option),
                    shift: flags.contains(.shift),
                    repeatEvent: event.isARepeat
                )

                return true
            }
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
            shift: flags.contains(.shift),
            repeatEvent: event.isARepeat
        )

        return true
    }
}

@_cdecl("vimeflow_ghostty_create")
public func vimeflowGhosttyCreate(
    _ parentViewPointer: UnsafeMutableRawPointer?,
    _ inputCallback: VimeflowGhosttyInputCallback?,
    _ resizeCallback: VimeflowGhosttyResizeCallback?,
    _ focusCallback: VimeflowGhosttyFocusCallback?,
    _ shortcutCallback: VimeflowGhosttyShortcutCallback?,
    _ renamePaneCallback: VimeflowGhosttyRenamePaneCallback?,
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
            focusCallback: focusCallback,
            shortcutCallback: shortcutCallback,
            renamePaneCallback: renamePaneCallback,
            callbackContext: contextPointer.value
        )

        let rawPointer = Unmanaged.passRetained(surface).toOpaque()
        SurfaceHandleRegistry.insert(rawPointer)

        return SendablePointer(value: rawPointer)
    }

    return surfacePointer.value
}

@_cdecl("vimeflow_ghostty_set_frame")
public func vimeflowGhosttySetFrame(
    _ surfacePointer: UnsafeMutableRawPointer?,
    _ x: Double,
    _ y: Double,
    _ width: Double,
    _ height: Double,
    _ bottomCornerRadius: Double,
    _ parentHeight: Double
) {
    guard let surfacePointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    mainActorSync {
        guard let surface = liveSurface(from: pointer) else { return }
        surface.setFrame(
            x: x,
            y: y,
            width: width,
            height: height,
            bottomCornerRadius: bottomCornerRadius,
            parentHeight: parentHeight
        )
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
        guard let surface = liveSurface(from: pointer) else { return }
        surface.setShortcutDigits(digits)
    }
}

@_cdecl("vimeflow_ghostty_set_background_color")
public func vimeflowGhosttySetBackgroundColor(
    _ surfacePointer: UnsafeMutableRawPointer?,
    _ colorPointer: UnsafePointer<CChar>?
) {
    guard let surfacePointer, let colorPointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    let color = String(cString: colorPointer)
    mainActorSync {
        guard let surface = liveSurface(from: pointer) else { return }
        surface.setBackgroundColor(color)
    }
}

@_cdecl("vimeflow_ghostty_set_foreground_color")
public func vimeflowGhosttySetForegroundColor(
    _ surfacePointer: UnsafeMutableRawPointer?,
    _ colorPointer: UnsafePointer<CChar>?
) {
    guard let surfacePointer, let colorPointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    let color = String(cString: colorPointer)
    mainActorSync {
        guard let surface = liveSurface(from: pointer) else { return }
        surface.setForegroundColor(color)
    }
}

@_cdecl("vimeflow_ghostty_set_font_family")
public func vimeflowGhosttySetFontFamily(
    _ surfacePointer: UnsafeMutableRawPointer?,
    _ fontFamilyPointer: UnsafePointer<CChar>?
) {
    guard let surfacePointer, let fontFamilyPointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    let fontFamily = String(cString: fontFamilyPointer)
    mainActorSync {
        guard let surface = liveSurface(from: pointer) else { return }
        surface.setFontFamily(fontFamily)
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
        guard let surface = liveSurface(from: pointer) else { return }
        surface.receive(text)
    }
}

@_cdecl("vimeflow_ghostty_add_secondary")
public func vimeflowGhosttyAddSecondary(
    _ surfacePointer: UnsafeMutableRawPointer?,
    _ inputCallback: VimeflowGhosttyInputCallback?,
    _ resizeCallback: VimeflowGhosttyResizeCallback?,
    _ focusCallback: VimeflowGhosttyFocusCallback?,
    _ callbackContext: UnsafeMutableRawPointer?
) {
    guard let surfacePointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    let contextPointer = SendablePointer(value: callbackContext)
    mainActorSync {
        guard let surface = liveSurface(from: pointer) else { return }
        surface.addSecondary(
            inputCallback: inputCallback,
            resizeCallback: resizeCallback,
            focusCallback: focusCallback,
            callbackContext: contextPointer.value
        )
    }
}

@_cdecl("vimeflow_ghostty_set_secondary_visible")
public func vimeflowGhosttySetSecondaryVisible(
    _ surfacePointer: UnsafeMutableRawPointer?,
    _ visible: Bool
) {
    guard let surfacePointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    mainActorSync {
        guard let surface = liveSurface(from: pointer) else { return }
        surface.setSecondaryVisible(visible)
    }
}

@_cdecl("vimeflow_ghostty_remove_secondary")
public func vimeflowGhosttyRemoveSecondary(_ surfacePointer: UnsafeMutableRawPointer?) {
    guard let surfacePointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    mainActorSync {
        guard let surface = liveSurface(from: pointer) else { return }
        surface.removeSecondary()
    }
}

@_cdecl("vimeflow_ghostty_write_secondary")
public func vimeflowGhosttyWriteSecondary(
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
        guard let surface = liveSurface(from: pointer) else { return }
        surface.receiveSecondary(text)
    }
}

@_cdecl("vimeflow_ghostty_focus_secondary")
public func vimeflowGhosttyFocusSecondary(_ surfacePointer: UnsafeMutableRawPointer?) {
    guard let surfacePointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    mainActorSync {
        guard let surface = liveSurface(from: pointer) else { return }
        surface.focusSecondary()
    }
}

@_cdecl("vimeflow_ghostty_focus")
public func vimeflowGhosttyFocus(_ surfacePointer: UnsafeMutableRawPointer?) {
    guard let surfacePointer else {
        return
    }

    let pointer = SendablePointer(value: surfacePointer)
    mainActorSync {
        guard let surface = liveSurface(from: pointer) else { return }
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
        guard
            let rawPointer = pointer.value,
            SurfaceHandleRegistry.remove(rawPointer)
        else {
            return
        }

        let surface = Unmanaged<EmbeddedGhosttySurface>
            .fromOpaque(rawPointer)
            .takeRetainedValue()
        surface.destroy()
    }
}
