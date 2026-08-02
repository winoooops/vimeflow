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
        .package(url: "https://github.com/winoooops/libghostty-spm-shaders.git", revision: "633a7889fd4d6fabf0f480253b409561c8c3342c"),
    ],
    targets: [
        .executableTarget(
            name: "GhosttyNativeMacosSmoke",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm-shaders"),
            ]
        ),
        .target(
            name: "GhosttyElectronBridge",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm-shaders"),
            ]
        ),
        .testTarget(
            name: "GhosttyElectronBridgeTests",
            dependencies: ["GhosttyElectronBridge"]
        ),
    ]
)
