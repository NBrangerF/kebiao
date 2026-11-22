import Foundation
import PDFKit
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
var pages: [[String: Any]] = []
for i in 0..<doc.pageCount {
  guard let p = doc.page(at: i) else { continue }
  let box = p.bounds(for: .mediaBox)
  var rows: [[Any]] = []
  if let s = p.selection(for: box) {
    for l in s.selectionsByLine() {
      let t = (l.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      if t.isEmpty { continue }
      let b = l.bounds(for: p)
      rows.append([Int(b.minX), Int(box.height - b.maxY), Int(b.maxX), Int(box.height - b.minY), t])
    }
  }
  pages.append(["page": i+1, "w": Int(box.width), "h": Int(box.height), "lines": rows])
}
let d = try JSONSerialization.data(withJSONObject: pages, options: [])
FileManager.default.createFile(atPath: CommandLine.arguments[2], contents: d)
