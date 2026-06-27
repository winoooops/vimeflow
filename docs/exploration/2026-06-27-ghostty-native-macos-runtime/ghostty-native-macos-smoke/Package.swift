// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "GhosttyNativeMacosSmoke",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(
            name: "ghostty-native-macos-smoke",
            targets: ["GhosttyNativeMacosSmoke"]
        ),
        .library(
            name: "GhosttyElectronBridge",
            type: .dynamic,
            targets: ["GhosttyElectronBridge"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/Lakr233/libghostty-spm.git", from: "1.2.0"),
    ],
    targets: [
        .executableTarget(
            name: "GhosttyNativeMacosSmoke",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm"),
            ]
        ),
        .target(
            name: "GhosttyElectronBridge",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm"),
            ]
        ),
    ]
)
