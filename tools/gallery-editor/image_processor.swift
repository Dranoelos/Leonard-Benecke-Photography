// Color-managed dual SDR/HDR exports. Requires macOS 15+ and ImageIO/Core Image.
import Foundation
import ImageIO
import CoreImage
import CoreGraphics

struct ProcessingError: Error { let message: String }
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
let linearSRGB = CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!
let context = CIContext(options: [.useSoftwareRenderer: true, .workingColorSpace: linearSRGB])
let allowedTypes: Set<String> = ["public.jpeg", "public.png", "org.webmproject.webp", "public.avif", "public.heic", "public.heif", "public.jpeg-xl"]

func fail(_ message: String) throws -> Never { throw ProcessingError(message: message) }

func decode(_ source: CGImageSource, request: CFString) throws -> CGImage {
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any] ?? [:]
    let width = (properties[kCGImagePropertyPixelWidth as String] as? NSNumber)?.intValue ?? 0
    let height = (properties[kCGImagePropertyPixelHeight as String] as? NSNumber)?.intValue ?? 0
    guard width > 0 && height > 0 && Double(width) * Double(height) <= 120_000_000 else {
        try fail("Ungültige Bildgröße oder mehr als 120 Megapixel.")
    }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: min(2400, max(width, height)),
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldAllowFloat: true,
        kCGImageSourceDecodeRequest: request,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
        try fail("Das Bild konnte nicht farbverwaltet gelesen werden.")
    }
    return image
}

func sourceAt(_ url: URL) throws -> CGImageSource {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
          let type = CGImageSourceGetType(source), allowedTypes.contains(type as String) else {
        try fail("Bitte JPEG, PNG, WebP, AVIF, HEIC/HEIF oder JPEG XL verwenden.")
    }
    return source
}

func hasGainMap(_ source: CGImageSource, _ url: URL) -> Bool {
    if CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeISOGainMap) != nil ||
        CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeHDRGainMap) != nil { return true }
    // ImageIO can decode JPEG gain maps without exposing them via the auxiliary API.
    guard let data = try? Data(contentsOf: url) else { return false }
    return ["http://ns.adobe.com/hdr-gain-map/1.0/", "urn:iso:std:iso:ts:21496"].contains {
        data.range(of: Data($0.utf8)) != nil
    }
}

func inspect(_ url: URL, pixels: Bool = false) throws -> [String: Any] {
    let source = try sourceAt(url)
    let hdr = try decode(source, request: kCGImageSourceDecodeToHDR)
    let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any] ?? [:]
    let headroom = max(hdr.contentHeadroom, CIImage(cgImage: hdr).contentHeadroom)
    var result: [String: Any] = ["width": hdr.width, "height": hdr.height, "hdr": headroom > 1.01,
            "headroom": headroom, "gainMap": hasGainMap(source, url),
            "profile": props[kCGImagePropertyProfileName as String] as? String ?? "Nicht angegeben"]
    if pixels {
        let image = CIImage(cgImage: hdr)
        let maximum = image.applyingFilter("CIAreaMaximum", parameters: ["inputExtent": CIVector(cgRect: image.extent)])
        var pixel = [Float](repeating: 0, count: 4)
        pixel.withUnsafeMutableBytes { buffer in
            context.render(maximum, toBitmap: buffer.baseAddress!, rowBytes: 16,
                           bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBAf, colorSpace: linearSRGB)
        }
        result["peakLinear"] = pixel.prefix(3).max() ?? 0
    }
    return result
}

func jpeg(_ image: CIImage, hdr: CIImage? = nil) throws -> Data {
    var options: [CIImageRepresentationOption: Any] = [
        CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.94
    ]
    if let hdr = hdr { options[.hdrImage] = hdr; options[.hdrGainMapAsRGB] = true }
    guard let data = context.jpegRepresentation(of: image, colorSpace: sRGB, options: options) else {
        try fail("Die macOS-Bildverarbeitung konnte keine JPEG-Datei erzeugen. Den Editor bitte normal über die Startdatei öffnen.")
    }
    return data
}

func prepare(_ input: URL, _ output: URL) throws -> [String: Any] {
    let source = try sourceAt(input)
    // ImageIO uses the authored SDR base for adaptive HDR; otherwise its system
    // reference-white tone mapper. It never applies an arbitrary contrast filter.
    let sdrCG = try decode(source, request: kCGImageSourceDecodeToSDR)
    let hdrCG = try decode(source, request: kCGImageSourceDecodeToHDR)
    let sdr = CIImage(cgImage: sdrCG)
    let hdr = CIImage(cgImage: hdrCG)
    let headroom = max(hdrCG.contentHeadroom, hdr.contentHeadroom)
    let isHDR = headroom > 1.01
    let gainMap = hasGainMap(source, input)
    if gainMap && !isHDR { try fail("HDR-Metadaten sind vorhanden, konnten aber nicht sicher rekonstruiert werden. Die Datei wurde nicht als SDR gespeichert.") }
    let transparent = ![CGImageAlphaInfo.none, .noneSkipFirst, .noneSkipLast].contains(sdrCG.alphaInfo)
    let extensionSDR = transparent && !isHDR ? "png" : "jpg"
    let sdrData: Data
    if extensionSDR == "png" {
        guard let png = context.pngRepresentation(of: sdr, format: .RGBA8, colorSpace: sRGB) else { try fail("PNG-Ausgabe fehlgeschlagen.") }
        sdrData = png
    } else { sdrData = try jpeg(sdr) }
    try sdrData.write(to: output.appendingPathComponent("sdr." + extensionSDR))
    var info = try inspect(input)
    info["sdrExtension"] = extensionSDR
    info["sdrMethod"] = isHDR ? (gainMap ? "embedded-sdr" : "system-tone-map") : "color-managed-sdr"
    if isHDR {
        guard hdrCG.width == sdrCG.width && hdrCG.height == sdrCG.height else { try fail("HDR- und SDR-Abmessungen stimmen nicht überein.") }
        // Encode the HDR look together with this exact SDR rendition as its base.
        let hdrData = try jpeg(sdr, hdr: hdr)
        let url = output.appendingPathComponent("hdr.jpg")
        try hdrData.write(to: url)
        let verified = try inspect(url)
        guard verified["hdr"] as? Bool == true else { try fail("Die HDR-Ausgabe konnte nicht als HDR verifiziert werden.") }
        info["hdrExtension"] = "jpg"
        info["outputHeadroom"] = verified["headroom"]
    }
    return info
}

func fixtures(_ output: URL) throws -> [String: Any] {
    var pixels: [Float] = []
    for y in 0..<64 { for x in 0..<256 {
        let v = Float(x) / 255
        let highlight: Float = y < 32 ? 4 : 1
        pixels += [v * highlight, v * highlight * 0.7, v * highlight * 0.5, 1]
    }}
    let data = pixels.withUnsafeBytes { Data($0) }
    let hdr = CIImage(bitmapData: data, bytesPerRow: 256 * 16, size: CGSize(width: 256, height: 64), format: .RGBAf, colorSpace: linearSRGB).settingContentHeadroom(4)
    // An intentionally authored SDR rendition with a known appearance.
    let base = hdr.applyingFilter("CIColorMatrix", parameters: [
        "inputRVector": CIVector(x: 0.2, y: 0, z: 0, w: 0),
        "inputGVector": CIVector(x: 0, y: 0.25, z: 0, w: 0),
        "inputBVector": CIVector(x: 0, y: 0, z: 0.3, w: 0)])
    try jpeg(base, hdr: hdr).write(to: output.appendingPathComponent("gainmap.jpg"))
    try jpeg(base).write(to: output.appendingPathComponent("reference-sdr.jpg"))
    guard let plain = context.pngRepresentation(of: base, format: .RGBA8, colorSpace: sRGB),
          let p3 = context.pngRepresentation(of: base, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.displayP3)!) else { try fail("Testbilder konnten nicht erstellt werden.") }
    try plain.write(to: output.appendingPathComponent("sdr.png"))
    try p3.write(to: output.appendingPathComponent("p3-sdr.png"))
    guard let large = context.pngRepresentation(of: base.transformed(by: CGAffineTransform(scaleX: 12, y: 12)), format: .RGBA8, colorSpace: sRGB) else { try fail("Größentest konnte nicht erstellt werden.") }
    try large.write(to: output.appendingPathComponent("large-sdr.png"))
    guard let orientationImage = context.createCGImage(base, from: base.extent, format: .RGBA8, colorSpace: sRGB),
          let orientationDestination = CGImageDestinationCreateWithURL(output.appendingPathComponent("orientation.jpg") as CFURL, "public.jpeg" as CFString, 1, nil) else { try fail("Orientierungstest konnte nicht erstellt werden.") }
    CGImageDestinationAddImage(orientationDestination, orientationImage, [kCGImagePropertyOrientation: 6] as CFDictionary)
    guard CGImageDestinationFinalize(orientationDestination) else { try fail("Orientierungstest konnte nicht erstellt werden.") }
    guard let pq = CGColorSpace(name: CGColorSpace.itur_2100_PQ),
          let heic = try? context.heif10Representation(of: hdr, colorSpace: pq, options: [:]) else { try fail("HDR-HEIC-Testdatei konnte nicht erstellt werden.") }
    try heic.write(to: output.appendingPathComponent("iso-hdr.heic"))
    return ["fixtures": true]
}

func rebase(_ hdrURL: URL, _ sdrURL: URL, _ output: URL) throws -> [String: Any] {
    let hdrInfo = try inspect(hdrURL)
    let sdrInfo = try inspect(sdrURL)
    guard hdrInfo["hdr"] as? Bool == true, sdrInfo["hdr"] as? Bool == false else {
        try fail("Bitte für die eigene SDR-Version einen SDR-Export verwenden, kein weiteres HDR-Bild.")
    }
    let hdrCG = try decode(sourceAt(hdrURL), request: kCGImageSourceDecodeToHDR)
    let sdrCG = try decode(sourceAt(sdrURL), request: kCGImageSourceDecodeToSDR)
    let ratio = Double(sdrCG.width) / Double(sdrCG.height) / (Double(hdrCG.width) / Double(hdrCG.height))
    guard abs(ratio - 1) <= 0.005 else { try fail("SDR-Version und HDR-Foto müssen denselben Bildausschnitt und dasselbe Seitenverhältnis haben.") }
    let width = min(hdrCG.width, sdrCG.width)
    let height = Int((Double(width) * Double(hdrCG.height) / Double(hdrCG.width)).rounded())
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    let hdr = CIImage(cgImage: hdrCG).transformed(by: CGAffineTransform(scaleX: Double(width) / Double(hdrCG.width), y: Double(height) / Double(hdrCG.height))).cropped(to: rect)
    let sdr = CIImage(cgImage: sdrCG).transformed(by: CGAffineTransform(scaleX: Double(width) / Double(sdrCG.width), y: Double(height) / Double(sdrCG.height))).cropped(to: rect)
    try jpeg(sdr).write(to: output.appendingPathComponent("sdr.jpg"))
    let hdrOutput = output.appendingPathComponent("hdr.jpg")
    try jpeg(sdr, hdr: hdr).write(to: hdrOutput)
    let verified = try inspect(hdrOutput)
    guard verified["hdr"] as? Bool == true else { try fail("Die HDR-Ausgabe konnte nicht verifiziert werden.") }
    return ["width": width, "height": height, "hdr": true, "headroom": verified["headroom"]!,
            "sdrExtension": "jpg", "hdrExtension": "jpg", "sdrMethod": "custom-sdr"]
}

func compareSDR(_ first: URL, _ second: URL) throws -> [String: Any] {
    func pixels(_ url: URL) throws -> ([UInt8], Int, Int) {
        let image = try decode(sourceAt(url), request: kCGImageSourceDecodeToSDR)
        guard let bitmap = CGContext(data: nil, width: image.width, height: image.height,
                                    bitsPerComponent: 8, bytesPerRow: image.width * 4,
                                    space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let data = bitmap.data else { try fail("Pixelvergleich fehlgeschlagen.") }
        bitmap.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return (Array(UnsafeBufferPointer(start: data.assumingMemoryBound(to: UInt8.self), count: image.width * image.height * 4)), image.width, image.height)
    }
    let (a, width, height) = try pixels(first)
    let (b, bw, bh) = try pixels(second)
    guard width == bw && height == bh else { try fail("Unterschiedliche Vergleichsgrößen.") }
    var total = 0.0
    var maximum = 0
    for index in a.indices where index % 4 != 3 {
        let difference = abs(Int(a[index]) - Int(b[index]))
        total += Double(difference); maximum = max(maximum, difference)
    }
    return ["meanError": total / Double(width * height * 3), "maxError": maximum]
}

func main() throws {
    guard #available(macOS 15, *) else { try fail("HDR-Verarbeitung benötigt macOS 15 oder neuer.") }
    let args = CommandLine.arguments
    guard args.count >= 3 else { try fail("Ungültiger Aufruf der Bildverarbeitung.") }
    let result: [String: Any]
    if args[1] == "--fixtures" { result = try fixtures(URL(fileURLWithPath: args[2])) }
    else if args[1] == "--inspect" { result = try inspect(URL(fileURLWithPath: args[2]), pixels: true) }
    else if args[1] == "--rebase" && args.count == 5 {
        result = try rebase(URL(fileURLWithPath: args[2]), URL(fileURLWithPath: args[3]), URL(fileURLWithPath: args[4]))
    }
    else if args[1] == "--compare" && args.count == 4 {
        result = try compareSDR(URL(fileURLWithPath: args[2]), URL(fileURLWithPath: args[3]))
    }
    else {
        guard args[1] == "--prepare" && args.count == 4 else { try fail("Ungültiger Aufruf.") }
        result = try prepare(URL(fileURLWithPath: args[2]), URL(fileURLWithPath: args[3]))
    }
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
}

do { try main() } catch {
    let message = (error as? ProcessingError)?.message ?? error.localizedDescription
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
