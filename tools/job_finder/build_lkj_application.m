#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>

@interface CoverView : NSView
@property (nonatomic, strong) NSAttributedString *content;
@property (nonatomic, assign) NSRect textRect;
@property (nonatomic, strong) NSImage *signatureImage;
@property (nonatomic, assign) NSRect signatureRect;
@property (nonatomic, strong) NSDictionary *nameAttrs;
@end

@implementation CoverView
- (void)drawRect:(NSRect)dirtyRect {
  [[NSColor whiteColor] setFill];
  NSRectFill(self.bounds);
  if (self.content) {
    [self.content drawWithRect:self.textRect options:NSStringDrawingUsesLineFragmentOrigin | NSStringDrawingUsesFontLeading];
  }
  if (self.signatureImage) {
    [self.signatureImage drawInRect:self.signatureRect fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1.0];
    [@"Moritz Frisch" drawAtPoint:NSMakePoint(self.signatureRect.origin.x, self.signatureRect.origin.y - 16) withAttributes:self.nameAttrs];
  }
}
@end

static void appendLine(NSMutableAttributedString *out, NSString *text, NSDictionary *attrs) {
  [out appendAttributedString:[[NSAttributedString alloc] initWithString:[text stringByAppendingString:@"\n"] attributes:attrs]];
}

static void mergePDFs(NSArray<NSString *> *paths, NSString *outputPath) {
  PDFDocument *out = [[PDFDocument alloc] init];
  for (NSString *path in paths) {
    PDFDocument *doc = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:path]];
    if (!doc) continue;
    for (NSInteger i = 0; i < doc.pageCount; i++) {
      PDFPage *p = [doc pageAtIndex:i];
      if (p) [out insertPage:p atIndex:out.pageCount];
    }
  }
  [out writeToURL:[NSURL fileURLWithPath:outputPath]];
}

int main(void) {
  @autoreleasepool {
    NSString *folder = @"/Users/moritz/Documents/New project/bewerbungen/lkj_berlin_referent_pr_partizipation_2026-02-21";
    NSString *coverPDF = [folder stringByAppendingPathComponent:@"Moritz_Frisch_Anschreiben_LKJ.pdf"];
    NSString *compactPDF = [folder stringByAppendingPathComponent:@"Moritz_Frisch_Bewerbung_LKJ_kompakt.pdf"];
    NSString *fullPDF = [folder stringByAppendingPathComponent:@"Moritz_Frisch_Bewerbung_LKJ_vollstaendig.pdf"];

    NSString *cvPDF = @"/Users/moritz/Documents/Arbeit/Bewerbungen/CV/CV_MoritzFrisch.pdf";
    NSString *certPDF = @"/Users/moritz/Documents/Arbeit/Bewerbungen/Zeugnisse/Zeugnisse_MoritzFrisch.pdf";
    NSString *signaturePath = [folder stringByAppendingPathComponent:@"signatur_moritz.png"];

    NSFont *normalFont = [NSFont fontWithName:@"Arial" size:10.0] ?: [NSFont systemFontOfSize:10.0];
    NSFont *boldFont = [NSFont fontWithName:@"Arial Bold" size:10.0] ?: [NSFont boldSystemFontOfSize:10.0];

    NSMutableParagraphStyle *p = [[NSMutableParagraphStyle alloc] init];
    p.lineBreakMode = NSLineBreakByWordWrapping;
    p.lineSpacing = 2.0;
    p.alignment = NSTextAlignmentJustified;
    NSMutableParagraphStyle *pRight = [p mutableCopy];
    pRight.alignment = NSTextAlignmentRight;

    NSDictionary *normal = @{NSFontAttributeName: normalFont, NSParagraphStyleAttributeName: p, NSForegroundColorAttributeName: NSColor.blackColor};
    NSDictionary *bold = @{NSFontAttributeName: boldFont, NSParagraphStyleAttributeName: p, NSForegroundColorAttributeName: NSColor.blackColor};
    NSDictionary *rightNormal = @{NSFontAttributeName: normalFont, NSParagraphStyleAttributeName: pRight, NSForegroundColorAttributeName: NSColor.blackColor};

    NSMutableAttributedString *txt = [[NSMutableAttributedString alloc] init];
    appendLine(txt, @"Moritz Frisch", normal);
    appendLine(txt, @"Liebigstraße 2", normal);
    appendLine(txt, @"10247 Berlin", normal);
    appendLine(txt, @"0172 4225450", normal);
    appendLine(txt, @"moritzfrisch@gmx.net", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Landesvereinigung Kulturelle Kinder- und Jugendbildung Berlin e.V.", normal);
    appendLine(txt, @"Axel-Springer-Straße 40-41", normal);
    appendLine(txt, @"10969 Berlin", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Berlin, 21. Februar 2026", rightNormal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Bewerbung als Referent*in (m/w/d) – Öffentlichkeitsarbeit & Projektleitung \"Partizipation in der kulturellen Bildung\"", bold);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Sehr geehrte Damen und Herren,", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"die Verbindung aus operativer Öffentlichkeitsarbeit, strategischer Projektsteuerung und diversitätssensibler Bildungsarbeit in Ihrer Ausschreibung entspricht sehr genau meinem Profil und meiner Motivation.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"In meiner aktuellen Funktion bei der IHK Berlin verantworte ich zentrale Public-Affairs- und Kommunikationsaufgaben: kontinuierliches Monitoring politischer und regulatorischer Entwicklungen, strukturierte Aufbereitung komplexer Inhalte für interne Entscheidungsprozesse sowie die Entwicklung belastbarer Positions- und Kommunikationslinien. Die adressatengerechte Vermittlung gegenüber Politik, Verwaltung, Medien und Öffentlichkeit ist fester Bestandteil meines Arbeitsalltags.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Bei der Heinrich-Böll-Stiftung (Green Campus) war ich in die Konzeption und Umsetzung von Bildungs- und Veranstaltungsformaten eingebunden. Zu meinem Verantwortungsbereich gehörten Recherche, inhaltliche Strukturierung, Evaluation und Datenanalyse, Prozesskoordination sowie digitale Öffentlichkeitsarbeit. Diese Erfahrung stärkt meine Fähigkeit, anspruchsvolle Themen zielgruppengerecht aufzubereiten und in wirksame Formate für Wissenstransfer, Netzwerkpflege und Community-Kommunikation zu überführen.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Für die ausgeschriebene Rolle bringe ich damit genau die von Ihnen genannten Kompetenzen mit: operative PR-Arbeit (Website, Newsletter, Social Media, Presse), Kampagnenmitarbeit von Konzeption bis Umsetzung, Projektsteuerung inkl. Zeit-, Budget- und Risikomanagement sowie strukturierte Dokumentation und Reporting. Auch in der Zusammenarbeit mit externen Dienstleister*innen und unterschiedlichen Stakeholdern arbeite ich verlässlich, organisiert und lösungsorientiert.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Meine Arbeitsweise ist geprägt von klarer Struktur, hoher Sprachsicherheit und einem inklusiv-diversitätssensiblen Verständnis von Kommunikation und Teilhabe. Genau darin sehe ich eine sehr gute Passung zu Ihrem Modellprojekt „Partizipation in der kulturellen Bildung“ und zum Selbstverständnis der LKJ Berlin e.V.", normal);
    appendLine(txt, @"", normal);
    appendLine(txt, @"Als Rollstuhlahrer freue ich mich über einen barrierearmen Arbeitsplatz.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Über die Einladung zu einem persönlichen Gespräch freue ich mich sehr.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Mit freundlichen Grüßen", normal);
    appendLine(txt, @"", normal);
    appendLine(txt, @"Moritz Frisch", normal);

    NSRect page = NSMakeRect(0, 0, 595.28, 841.89);
    CGFloat margin = 56.0;
    NSRect textRect = NSMakeRect(margin, margin, page.size.width - margin * 2.0, page.size.height - margin * 2.0);

    CoverView *view = [[CoverView alloc] initWithFrame:page];
    view.content = txt;
    view.textRect = textRect;
    view.signatureRect = NSMakeRect(56, 78, 170, 55);
    view.nameAttrs = @{NSFontAttributeName: normalFont, NSForegroundColorAttributeName: NSColor.blackColor};
    if ([[NSFileManager defaultManager] fileExistsAtPath:signaturePath]) {
      view.signatureImage = [[NSImage alloc] initWithContentsOfFile:signaturePath];
    }

    NSData *coverData = [view dataWithPDFInsideRect:page];
    [coverData writeToFile:coverPDF atomically:YES];

    mergePDFs(@[coverPDF, cvPDF], compactPDF);
    mergePDFs(@[coverPDF, cvPDF, certPDF], fullPDF);

    printf("OK\n%s\n%s\n%s\n", coverPDF.UTF8String, compactPDF.UTF8String, fullPDF.UTF8String);
  }
  return 0;
}
