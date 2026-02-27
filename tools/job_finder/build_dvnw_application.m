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
  } else {
    [@"Moritz Frisch" drawAtPoint:NSMakePoint(56, 62) withAttributes:self.nameAttrs];
  }
}
@end

static void appendLine(NSMutableAttributedString *out, NSString *text, NSDictionary *attrs) {
  NSString *line = [text stringByAppendingString:@"\n"];
  [out appendAttributedString:[[NSAttributedString alloc] initWithString:line attributes:attrs]];
}

int main(void) {
  @autoreleasepool {
    NSString *folder = @"/Users/moritz/Documents/New project/bewerbungen/dvnw_referent_vergaberecht_2026-02-21";
    NSString *coverPDF = [folder stringByAppendingPathComponent:@"Moritz_Frisch_Anschreiben_DVNW.pdf"];
    NSString *combinedPDF = [folder stringByAppendingPathComponent:@"Moritz_Frisch_Bewerbung_komplett.pdf"];
    NSString *cvPDF = @"/Users/moritz/Documents/Arbeit/Bewerbungen/CV/CV_MoritzFrisch.pdf";
    NSString *certPDF = @"/Users/moritz/Documents/Arbeit/Bewerbungen/Zeugnisse/Zeugnisse_MoritzFrisch.pdf";
    NSString *signaturePath = [folder stringByAppendingPathComponent:@"signatur_moritz.png"];

    NSFont *normalFont = [NSFont fontWithName:@"Arial" size:10.0] ?: [NSFont systemFontOfSize:10.0];
    NSFont *boldFont = [NSFont fontWithName:@"Arial Bold" size:10.0] ?: [NSFont boldSystemFontOfSize:10.0];

    NSMutableParagraphStyle *p = [[NSMutableParagraphStyle alloc] init];
    p.lineBreakMode = NSLineBreakByWordWrapping;
    p.lineSpacing = 2.0;
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

    appendLine(txt, @"DVNW Deutsches Vergabenetzwerk GmbH", normal);
    appendLine(txt, @"Haus der Bundespressekonferenz | Büro 1209", normal);
    appendLine(txt, @"Schiffbauerdamm 40", normal);
    appendLine(txt, @"10117 Berlin", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Berlin, 21. Februar 2026", rightNormal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Bewerbung als Referent Vergaberecht und öffentliche Beschaffung", bold);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Sehr geehrte Damen und Herren,", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"die Kombination aus fachlichem Monitoring, inhaltlicher Strukturierung und strategischer Kommunikation, die Sie beschreiben, entspricht exakt meinem beruflichen Schwerpunkt.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"In meiner derzeitigen Funktion als Public Affairs Manager bei der IHK Berlin verantworte ich zentrale Aufgaben im politischen und regulatorischen Monitoring. Dazu gehören die kontinuierliche Analyse gesetzgeberischer Vorhaben, die strukturierte Aufbereitung komplexer Sachverhalte für interne Entscheidungsprozesse sowie die Entwicklung fundierter Positions- und Kommunikationslinien. Die adressatengerechte Vermittlung gegenüber Politik, Verwaltung, Medien und Öffentlichkeit ist dabei ebenso Bestandteil meiner Tätigkeit wie die strategische Begleitung politischer Prozesse. Ich arbeite somit kontinuierlich an der Schnittstelle von Analyse, Interessenvertretung und Kommunikation.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Zuvor war ich bei der Heinrich-Böll-Stiftung (Green Campus) in die Konzeption und Umsetzung von Bildungs- und Veranstaltungsformaten eingebunden. Mein Verantwortungsbereich umfasste Recherche, inhaltliche Strukturierung, Evaluation und Datenanalyse, Prozesskoordination sowie digitale Öffentlichkeitsarbeit. Diese Tätigkeit hat meine Fähigkeit geschärft, fachlich anspruchsvolle Inhalte strukturiert aufzubereiten und in tragfähige Formate für Wissenstransfer, Netzwerkpflege und öffentliche Kommunikation zu überführen.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Mein Masterstudium im Political Management (M.Sc.) sowie mein Bachelorstudium in Interkultureller Wirtschaftspsychologie (B.Sc.) verbinden politisch-regulatorische Perspektiven mit analytischer Methodik. Dadurch gelingt es mir, komplexe Sachverhalte präzise zu strukturieren, zielgruppengerecht aufzubereiten und konstruktiv in kooperative Prozesse mit Stakeholdern aus Verwaltung, Politik und Wirtschaft einzubringen.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Die von Ihnen beschriebenen Schwerpunkte – fachliches Monitoring im Vergaberecht und in der öffentlichen Beschaffung, die inhaltliche Mitwirkung an Schulungs- und Veranstaltungsformaten, der Aufbau und die Pflege belastbarer Netzwerke sowie substanzielle Beiträge zur Presse- und Öffentlichkeitsarbeit – entsprechen in hohem Maße meinem Profil und meinen beruflichen Interessen.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Meine Gehaltsvorstellung liegt bei 55.000 EUR brutto pro Jahr. Als Eintrittstermin ist der 01.05.2026 möglich.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Gerne würde ich meine analytische, strukturierte und kommunikative Arbeitsweise in Ihr Team einbringen und weiterentwickeln. Über die Einladung zu einem persönlichen Gespräch freue ich mich sehr.", normal);
    appendLine(txt, @"", normal);

    appendLine(txt, @"Mit freundlichen Grüßen", normal);
    appendLine(txt, @"", normal);

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
    if (![coverData writeToFile:coverPDF atomically:YES]) {
      fprintf(stderr, "Failed to write cover PDF\n");
      return 1;
    }

    PDFDocument *out = [[PDFDocument alloc] init];
    for (NSString *path in @[coverPDF, cvPDF, certPDF]) {
      PDFDocument *doc = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:path]];
      if (!doc) {
        fprintf(stderr, "Cannot open PDF: %s\n", path.UTF8String);
        return 1;
      }
      for (NSInteger i = 0; i < doc.pageCount; i++) {
        PDFPage *pageObj = [doc pageAtIndex:i];
        if (pageObj) [out insertPage:pageObj atIndex:out.pageCount];
      }
    }

    if (![out writeToURL:[NSURL fileURLWithPath:combinedPDF]]) {
      fprintf(stderr, "Failed to write combined PDF\n");
      return 1;
    }

    printf("OK\n%s\n%s\n", coverPDF.UTF8String, combinedPDF.UTF8String);
  }
  return 0;
}
