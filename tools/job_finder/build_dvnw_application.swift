import Foundation
import AppKit
import PDFKit

let folder = "/Users/moritz/Documents/New project/bewerbungen/dvnw_referent_vergaberecht_2026-02-21"
let coverPDF = folder + "/Moritz_Frisch_Anschreiben_DVNW.pdf"
let combinedPDF = folder + "/Moritz_Frisch_Bewerbung_komplett.pdf"
let cvPDF = "/Users/moritz/Documents/Arbeit/Bewerbungen/CV/CV_MoritzFrisch.pdf"
let certPDF = "/Users/moritz/Documents/Arbeit/Bewerbungen/Zeugnisse/Zeugnisse_MoritzFrisch.pdf"

let pageRect = CGRect(x: 0, y: 0, width: 595.28, height: 841.89) // A4
let margin: CGFloat = 56
let textRect = CGRect(x: margin, y: margin, width: pageRect.width - 2 * margin, height: pageRect.height - 2 * margin)

func line(_ s: String) -> String { s + "\n" }

let normalFont = NSFont(name: "Arial", size: 10) ?? NSFont.systemFont(ofSize: 10)
let boldFont = NSFont(name: "Arial Bold", size: 10) ?? NSFont.boldSystemFont(ofSize: 10)
let paragraph = NSMutableParagraphStyle()
paragraph.lineSpacing = 2

let attrs: [NSAttributedString.Key: Any] = [
  .font: normalFont,
  .paragraphStyle: paragraph,
  .foregroundColor: NSColor.black
]
let boldAttrs: [NSAttributedString.Key: Any] = [
  .font: boldFont,
  .paragraphStyle: paragraph,
  .foregroundColor: NSColor.black
]

let text = NSMutableAttributedString()
text.append(NSAttributedString(string: line("Moritz Frisch"), attributes: attrs))
text.append(NSAttributedString(string: line("Liebigstraße 2"), attributes: attrs))
text.append(NSAttributedString(string: line("10247 Berlin"), attributes: attrs))
text.append(NSAttributedString(string: line("0172 4225450"), attributes: attrs))
text.append(NSAttributedString(string: line("moritzfrisch@gmx.net"), attributes: attrs))
text.append(NSAttributedString(string: "\n", attributes: attrs))

text.append(NSAttributedString(string: line("DVNW Deutsches Vergabenetzwerk GmbH"), attributes: attrs))
text.append(NSAttributedString(string: line("Haus der Bundespressekonferenz | Büro 1209"), attributes: attrs))
text.append(NSAttributedString(string: line("Schiffbauerdamm 40"), attributes: attrs))
text.append(NSAttributedString(string: line("10117 Berlin"), attributes: attrs))
text.append(NSAttributedString(string: "\n", attributes: attrs))

text.append(NSAttributedString(string: line("Berlin, 21. Februar 2026"), attributes: attrs))
text.append(NSAttributedString(string: "\n", attributes: attrs))

text.append(NSAttributedString(string: line("Bewerbung als Referent Vergaberecht und öffentliche Beschaffung"), attributes: boldAttrs))
text.append(NSAttributedString(string: "\n", attributes: attrs))

text.append(NSAttributedString(string: line("Sehr geehrte Damen und Herren,"), attributes: attrs))
text.append(NSAttributedString(string: "\n", attributes: attrs))

text.append(NSAttributedString(string: "mit großem Interesse habe ich Ihre Ausschreibung im Vergabeblog gelesen. Die Position verbindet genau die Felder, in denen ich meine Stärken sehe: politische und regulatorische Entwicklungen systematisch beobachten, Inhalte adressatengerecht aufbereiten und diese in Netzwerk, Fortbildung und Kommunikation wirksam vermitteln.\n\n", attributes: attrs))

text.append(NSAttributedString(string: "Derzeit bin ich als Trainee Politik bei der IHK Berlin tätig. Dort monitoriere ich politische, gesetzliche und regulatorische Entwicklungen, bereite diese entscheidungsorientiert auf und unterstütze die Entwicklung von Kommunikationsstrategien gegenüber Politik, Medien und Öffentlichkeit. Zuvor war ich studentischer Mitarbeiter bei der Heinrich-Böll-Stiftung (Green Campus). Zu meinen Aufgaben gehörten dort unter anderem Recherche und Analyse, Evaluierung und Datenanalyse, die Konzeption digitaler Kommunikation sowie die inhaltliche und organisatorische Begleitung von Bildungsformaten.\n\n", attributes: attrs))

text.append(NSAttributedString(string: "Fachlich bringe ich ein Masterstudium im Political Management (M.Sc., Note 1,0) sowie ein Bachelorstudium in Interkultureller Wirtschaftspsychologie (B.Sc., Note 1,3) mit. Diese Kombination unterstützt mich dabei, komplexe Sachverhalte strukturiert zu analysieren, präzise schriftlich aufzubereiten und unterschiedliche Stakeholder zielgerichtet einzubinden.\n\n", attributes: attrs))

text.append(NSAttributedString(string: "Die in Ihrer Ausschreibung genannten Aufgaben passen sehr gut zu meinem Profil: Monitoring und Wissensvermittlung, inhaltliche Unterstützung von Schulungs- und Veranstaltungsformaten, Netzwerkarbeit mit Akteurinnen und Akteuren aus Politik, Verwaltung und Wirtschaft sowie die fachliche Mitwirkung in der Presse- und Öffentlichkeitsarbeit.\n\n", attributes: attrs))

text.append(NSAttributedString(string: "Meine Gehaltsvorstellung liegt bei [BITTE ERGÄNZEN] EUR brutto/Jahr. Der frühestmögliche Eintrittstermin ist [BITTE ERGÄNZEN].\n\n", attributes: attrs))

text.append(NSAttributedString(string: "Ich freue mich auf die Möglichkeit, mich mit meiner analytischen und kommunikativen Arbeitsweise in Ihr Team einzubringen.\n\n", attributes: attrs))

text.append(NSAttributedString(string: "Mit freundlichen Grüßen\n\nMoritz Frisch\n", attributes: attrs))

let storage = NSTextStorage(attributedString: text)
let layout = NSLayoutManager()
storage.addLayoutManager(layout)
let container = NSTextContainer(size: textRect.size)
container.lineFragmentPadding = 0
layout.addTextContainer(container)

let pdfData = NSMutableData()
guard let consumer = CGDataConsumer(data: pdfData as CFMutableData) else {
  fatalError("Failed to create data consumer")
}
var mediaBox = pageRect
guard let context = CGContext(consumer: consumer, mediaBox: &mediaBox, nil) else {
  fatalError("Failed to create PDF context")
}

var glyphIndex = 0
let totalGlyphs = layout.numberOfGlyphs
while glyphIndex < totalGlyphs {
  context.beginPDFPage(nil)
  NSGraphicsContext.saveGraphicsState()
  let nsCtx = NSGraphicsContext(cgContext: context, flipped: false)
  NSGraphicsContext.current = nsCtx

  context.translateBy(x: 0, y: pageRect.height)
  context.scaleBy(x: 1, y: -1)

  let glyphRange = layout.glyphRange(for: container)
  layout.drawGlyphs(forGlyphRange: NSRange(location: glyphIndex, length: glyphRange.length), at: textRect.origin)
  layout.drawBackground(forGlyphRange: NSRange(location: glyphIndex, length: glyphRange.length), at: textRect.origin)

  NSGraphicsContext.restoreGraphicsState()
  context.endPDFPage()
  glyphIndex += glyphRange.length
  if glyphRange.length == 0 { break }
}
context.closePDF()

try pdfData.write(to: URL(fileURLWithPath: coverPDF), options: .atomic)

let outputDoc = PDFDocument()
for p in [coverPDF, cvPDF, certPDF] {
  guard let doc = PDFDocument(url: URL(fileURLWithPath: p)) else {
    fputs("Cannot open PDF: \(p)\n", stderr)
    exit(1)
  }
  for i in 0..<doc.pageCount {
    if let page = doc.page(at: i) {
      outputDoc.insert(page, at: outputDoc.pageCount)
    }
  }
}

if !outputDoc.write(to: URL(fileURLWithPath: combinedPDF)) {
  fputs("Failed to write combined PDF\n", stderr)
  exit(1)
}

print("OK")
print(coverPDF)
print(combinedPDF)
