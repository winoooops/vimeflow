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
        .package(url: "https://github.com/winoooops/libghostty-spm.git", revision: "5e9d4dcde1ccd8a3f6a74c2438d814722ad50e7f"),
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
