// Vision OCR with line boxes: for each image file, one JSON line
// { file, width, height, lines: [{ text, x, y, w, h }] } in pixels from the top-left, lines top to bottom.
// Used by ocr_scanned_pages.mjs for textbooks whose PDF has no text layer.
import Foundation
import ImageIO
import Vision

struct Line: Codable { let text: String; let x: Double; let y: Double; let w: Double; let h: Double }
struct Row: Codable { let file: String; let width: Int; let height: Int; let lines: [Line]; let error: String? }

let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]
for file in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: file)
    var width = 0, height = 0
    if let source = CGImageSourceCreateWithURL(url as CFURL, nil),
       let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] {
        width = props[kCGImagePropertyPixelWidth] as? Int ?? 0
        height = props[kCGImagePropertyPixelHeight] as? Int ?? 0
    }
    var observations: [VNRecognizedTextObservation] = []
    let request = VNRecognizeTextRequest { request, _ in observations = request.results as? [VNRecognizedTextObservation] ?? [] }
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    var failure: String? = nil
    do { try VNImageRequestHandler(url: url, options: [:]).perform([request]) } catch let caught { failure = "\(caught)" }
    let W = Double(width), H = Double(height)
    let lines = observations
        .sorted { abs($0.boundingBox.maxY - $1.boundingBox.maxY) > 0.01 ? $0.boundingBox.maxY > $1.boundingBox.maxY : $0.boundingBox.minX < $1.boundingBox.minX }
        .compactMap { obs -> Line? in
            guard let text = obs.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
            let b = obs.boundingBox
            return Line(text: text, x: (b.minX * W).rounded(), y: ((1 - b.maxY) * H).rounded(), w: (b.width * W).rounded(), h: (b.height * H).rounded())
        }
    if let data = try? encoder.encode(Row(file: file, width: width, height: height, lines: lines, error: failure)), let json = String(data: data, encoding: .utf8) { print(json) }
}
