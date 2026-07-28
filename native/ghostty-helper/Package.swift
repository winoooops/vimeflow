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
        .package(url: "https://github.com/winoooops/libghostty-spm.git", revision: "8f105f19256915f7a2fc998e2afadb896b9c7efd"),
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
