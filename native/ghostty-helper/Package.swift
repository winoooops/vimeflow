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
        .package(url: "https://github.com/winoooops/libghostty-spm.git", revision: "5a965cab35898fc1dd696a9db7f3cc2276cd7ee2"),
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
        .testTarget(
            name: "GhosttyElectronBridgeTests",
            dependencies: ["GhosttyElectronBridge"]
        ),
    ]
)
