#!/usr/bin/env swift

import AppKit
import Foundation

guard CommandLine.arguments.count == 4 else {
    fputs(
        "Usage: \(CommandLine.arguments[0]) <mark.svg> <icon-output-directory> <touch-icon.png>\n",
        stderr
    )
    exit(1)
}

let fileManager = FileManager.default
let workingDirectory = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)

func resolvedURL(_ path: String, isDirectory: Bool = false) -> URL {
    if path.hasPrefix("/") {
        return URL(fileURLWithPath: path, isDirectory: isDirectory)
    }
    return workingDirectory.appendingPathComponent(path, isDirectory: isDirectory)
}

let sourceURL = resolvedURL(CommandLine.arguments[1])
let iconDirectoryURL = resolvedURL(CommandLine.arguments[2], isDirectory: true)
let touchIconURL = resolvedURL(CommandLine.arguments[3])
let dmgBackgroundURL = iconDirectoryURL.appendingPathComponent("dmg-background.png")

guard let sourceImage = NSImage(contentsOf: sourceURL) else {
    fputs("Could not load AirHop mark at \(sourceURL.path)\n", stderr)
    exit(1)
}

try fileManager.createDirectory(at: iconDirectoryURL, withIntermediateDirectories: true)
try fileManager.createDirectory(
    at: touchIconURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)

enum AssetError: Error, CustomStringConvertible {
    case bitmapCreation(width: Int, height: Int)
    case pngEncoding(URL)
    case unexpectedDimensions(URL, expectedWidth: Int, expectedHeight: Int)
    case processFailure(String, Int32)

    var description: String {
        switch self {
        case let .bitmapCreation(width, height):
            return "Could not create \(width)x\(height) bitmap"
        case let .pngEncoding(url):
            return "Could not encode PNG at \(url.path)"
        case let .unexpectedDimensions(url, expectedWidth, expectedHeight):
            return "Wrong dimensions at \(url.path); expected \(expectedWidth)x\(expectedHeight)"
        case let .processFailure(command, status):
            return "\(command) exited with status \(status)"
        }
    }
}

func makeBitmap(width: Int, height: Int) throws -> NSBitmapImageRep {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bitmapFormat: [],
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw AssetError.bitmapCreation(width: width, height: height)
    }
    bitmap.size = NSSize(width: width, height: height)
    return bitmap
}

func renderPng(
    width: Int,
    height: Int,
    to outputURL: URL,
    draw: (NSRect) -> Void
) throws {
    let bitmap = try makeBitmap(width: width, height: height)
    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw AssetError.bitmapCreation(width: width, height: height)
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    let canvas = NSRect(x: 0, y: 0, width: width, height: height)
    NSColor.clear.setFill()
    canvas.fill()
    draw(canvas)
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw AssetError.pngEncoding(outputURL)
    }
    try png.write(to: outputURL, options: .atomic)

    guard let verification = NSBitmapImageRep(data: png),
          verification.pixelsWide == width,
          verification.pixelsHigh == height else {
        throw AssetError.unexpectedDimensions(
            outputURL,
            expectedWidth: width,
            expectedHeight: height
        )
    }
    print("Generated: \(outputURL.path)")
}

func drawMark(in canvas: NSRect, insetFraction: CGFloat = 0) {
    let inset = min(canvas.width, canvas.height) * insetFraction
    let side = min(canvas.width, canvas.height) - inset * 2
    let target = NSRect(
        x: canvas.midX - side / 2,
        y: canvas.midY - side / 2,
        width: side,
        height: side
    )
    sourceImage.draw(
        in: target,
        from: .zero,
        operation: .sourceOver,
        fraction: 1,
        respectFlipped: true,
        hints: [.interpolation: NSImageInterpolation.high]
    )
}

func run(_ executable: String, _ arguments: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.currentDirectoryURL = workingDirectory
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw AssetError.processFailure(
            ([executable] + arguments).joined(separator: " "),
            process.terminationStatus
        )
    }
}

func generateIcns() throws {
    let temporaryRoot = fileManager.temporaryDirectory.appendingPathComponent(
        "airhop-icons-\(UUID().uuidString)",
        isDirectory: true
    )
    let iconsetURL = temporaryRoot.appendingPathComponent("AirHop.iconset", isDirectory: true)
    try fileManager.createDirectory(at: iconsetURL, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: temporaryRoot) }

    let iconsetSizes: [(String, Int)] = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    for (name, size) in iconsetSizes {
        try renderPng(
            width: size,
            height: size,
            to: iconsetURL.appendingPathComponent(name),
            draw: { drawMark(in: $0) }
        )
    }
    let outputURL = iconDirectoryURL.appendingPathComponent("icon.icns")
    try run("/usr/bin/iconutil", ["-c", "icns", iconsetURL.path, "-o", outputURL.path])
    print("Generated: \(outputURL.path)")
}

do {
    // Validate that AppKit can rasterize the canonical SVG at production size.
    let masterURL = fileManager.temporaryDirectory.appendingPathComponent(
        "airhop-master-\(UUID().uuidString).png"
    )
    try renderPng(width: 1024, height: 1024, to: masterURL) { drawMark(in: $0) }
    defer { try? fileManager.removeItem(at: masterURL) }

    // Tauri produces the Windows, Android, iOS and platform-specific derivatives.
    try run(
        "/usr/bin/env",
        [
            "pnpm", "tauri", "icon", sourceURL.path,
            "--output", iconDirectoryURL.path,
        ]
    )

    let desktopPngSizes: [(String, Int)] = [
        ("32x32.png", 32),
        ("64x64.png", 64),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 512),
    ]
    for (name, size) in desktopPngSizes {
        try renderPng(
            width: size,
            height: size,
            to: iconDirectoryURL.appendingPathComponent(name),
            draw: { drawMark(in: $0) }
        )
    }
    try generateIcns()

    try renderPng(width: 180, height: 180, to: touchIconURL) {
        drawMark(in: $0, insetFraction: 0.04)
    }

    try renderPng(width: 660, height: 532, to: dmgBackgroundURL) { canvas in
        NSColor(calibratedRed: 0.965, green: 0.969, blue: 0.978, alpha: 1).setFill()
        canvas.fill()

        let markRect = NSRect(x: canvas.midX - 48, y: 386, width: 96, height: 96)
        sourceImage.draw(
            in: markRect,
            from: .zero,
            operation: .sourceOver,
            fraction: 1,
            respectFlipped: true,
            hints: [.interpolation: NSImageInterpolation.high]
        )
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 36, weight: .semibold),
            .foregroundColor: NSColor(calibratedRed: 0.055, green: 0.071, blue: 0.118, alpha: 1),
        ]
        let wordmark = "AirHop" as NSString
        let wordmarkSize = wordmark.size(withAttributes: attributes)
        wordmark.draw(
            at: NSPoint(x: canvas.midX - wordmarkSize.width / 2, y: 338),
            withAttributes: attributes
        )
    }

    let legacySourceURL = iconDirectoryURL.appendingPathComponent("buzz-source.png")
    if fileManager.fileExists(atPath: legacySourceURL.path) {
        try fileManager.removeItem(at: legacySourceURL)
        print("Removed legacy asset: \(legacySourceURL.path)")
    }
} catch {
    fputs("AirHop asset generation failed: \(error)\n", stderr)
    exit(1)
}
