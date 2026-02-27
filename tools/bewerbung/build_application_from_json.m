#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>

@interface CoverView : NSView
@property (nonatomic, strong) NSAttributedString *content;
@property (nonatomic, assign) NSRect textRect;
@property (nonatomic, strong) NSImage *signatureImage;
@property (nonatomic, assign) NSRect signatureRect;
@property (nonatomic, strong) NSDictionary *nameAttrs;
@property (nonatomic, strong) NSString *nameLine;
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
    if (self.nameLine.length > 0) {
      [self.nameLine drawAtPoint:NSMakePoint(self.signatureRect.origin.x, self.signatureRect.origin.y - 16) withAttributes:self.nameAttrs];
    }
  }
}
@end

static void appendLine(NSMutableAttributedString *out, NSString *text, NSDictionary *attrs) {
  [out appendAttributedString:[[NSAttributedString alloc] initWithString:[text stringByAppendingString:@"\n"] attributes:attrs]];
}

static NSString *pathJoin(NSString *base, NSString *file) {
  if ([file hasPrefix:@"/"]) return file;
  return [base stringByAppendingPathComponent:file];
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

static void writeMultiPageCoverPDF(NSString *outputPath,
                                   NSAttributedString *content,
                                   NSRect pageRect,
                                   NSRect textRect,
                                   NSImage *signatureImage,
                                   NSRect signatureRect,
                                   NSString *nameLine,
                                   NSDictionary *nameAttrs) {
  NSMutableData *pdfData = [NSMutableData data];
  CGDataConsumerRef consumer = CGDataConsumerCreateWithCFData((__bridge CFMutableDataRef)pdfData);
  CGContextRef cg = CGPDFContextCreate(consumer, &pageRect, NULL);
  if (consumer) CGDataConsumerRelease(consumer);
  if (!cg) return;
  NSAttributedString *full = content ?: [[NSAttributedString alloc] initWithString:@""];
  NSUInteger fullLen = full.length;
  NSMutableArray<NSAttributedString *> *pages = [NSMutableArray array];

  if (fullLen == 0) {
    [pages addObject:[[NSAttributedString alloc] initWithString:@""]];
  } else {
    NSUInteger start = 0;
    while (start < fullLen) {
      NSUInteger remaining = fullLen - start;
      NSUInteger low = 1, high = remaining, best = 1;
      while (low <= high) {
        NSUInteger mid = low + (high - low) / 2;
        NSAttributedString *probe = [full attributedSubstringFromRange:NSMakeRange(start, mid)];
        NSRect b = [probe boundingRectWithSize:textRect.size
                                       options:NSStringDrawingUsesLineFragmentOrigin | NSStringDrawingUsesFontLeading];
        if (b.size.height <= textRect.size.height + 0.5) {
          best = mid;
          low = mid + 1;
        } else {
          if (mid == 0) break;
          high = mid - 1;
        }
      }

      NSUInteger end = start + best;
      // Avoid cutting hard inside a word where possible.
      if (end < fullLen && best > 40) {
        NSRange lookback = NSMakeRange(start, best);
        NSString *chunk = [[full attributedSubstringFromRange:lookback] string];
        NSRange lastNl = [chunk rangeOfString:@"\n" options:NSBackwardsSearch];
        if (lastNl.location != NSNotFound && lastNl.location > chunk.length - 300) {
          end = start + lastNl.location + 1;
        } else {
          NSRange lastWs = [chunk rangeOfCharacterFromSet:[NSCharacterSet whitespaceCharacterSet] options:NSBackwardsSearch];
          if (lastWs.location != NSNotFound && lastWs.location > chunk.length - 120) {
            end = start + lastWs.location + 1;
          }
        }
      }
      if (end <= start) end = start + MIN((NSUInteger)1, remaining);
      [pages addObject:[full attributedSubstringFromRange:NSMakeRange(start, end - start)]];
      start = end;
    }
  }

  for (NSUInteger i = 0; i < pages.count; i++) {
    CGPDFContextBeginPage(cg, NULL);
    NSGraphicsContext *gc = [NSGraphicsContext graphicsContextWithCGContext:cg flipped:NO];
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:gc];
    [[NSColor whiteColor] setFill];
    NSRectFill(pageRect);
    [pages[i] drawWithRect:textRect options:NSStringDrawingUsesLineFragmentOrigin | NSStringDrawingUsesFontLeading];

    BOOL isLast = (i == pages.count - 1);
    if (isLast && signatureImage) {
      [signatureImage drawInRect:signatureRect
                        fromRect:NSZeroRect
                       operation:NSCompositingOperationSourceOver
                        fraction:1.0];
      if (nameLine.length > 0) {
        [nameLine drawAtPoint:NSMakePoint(signatureRect.origin.x, signatureRect.origin.y - 16)
               withAttributes:nameAttrs];
      }
    }
    [NSGraphicsContext restoreGraphicsState];
    CGPDFContextEndPage(cg);
  }

  CGPDFContextClose(cg);
  CGContextRelease(cg);
  [pdfData writeToFile:outputPath atomically:YES];
}

int main(int argc, const char * argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      fprintf(stderr, "Usage: build_application_from_json <config.json>\n");
      return 1;
    }

    NSString *cfgPath = [NSString stringWithUTF8String:argv[1]];
    NSData *data = [NSData dataWithContentsOfFile:cfgPath];
    if (!data) {
      fprintf(stderr, "Cannot read config: %s\n", cfgPath.UTF8String);
      return 1;
    }

    NSError *jsonErr = nil;
    NSDictionary *cfg = [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonErr];
    if (!cfg || ![cfg isKindOfClass:[NSDictionary class]]) {
      fprintf(stderr, "Invalid JSON config\n");
      return 1;
    }

    NSString *outputDir = cfg[@"output_dir"] ?: @".";
    [[NSFileManager defaultManager] createDirectoryAtPath:outputDir withIntermediateDirectories:YES attributes:nil error:nil];

    NSDictionary *layout = cfg[@"layout"] ?: @{};
    NSString *fontName = layout[@"font"] ?: @"Arial";
    CGFloat fontSize = layout[@"size"] ? [layout[@"size"] doubleValue] : 10.0;
    BOOL justify = layout[@"justify"] ? [layout[@"justify"] boolValue] : YES;

    NSFont *normalFont = [NSFont fontWithName:fontName size:fontSize] ?: [NSFont systemFontOfSize:fontSize];
    NSFont *boldFont = [NSFont fontWithName:[fontName stringByAppendingString:@" Bold"] size:fontSize] ?: [NSFont boldSystemFontOfSize:fontSize];

    NSMutableParagraphStyle *p = [[NSMutableParagraphStyle alloc] init];
    p.lineBreakMode = NSLineBreakByWordWrapping;
    CGFloat lineSpacing = layout[@"line_spacing"] ? [layout[@"line_spacing"] doubleValue] : 2.0;
    p.lineSpacing = lineSpacing;
    p.alignment = justify ? NSTextAlignmentJustified : NSTextAlignmentLeft;

    NSMutableParagraphStyle *pRight = [p mutableCopy];
    pRight.alignment = NSTextAlignmentRight;

    NSDictionary *normal = @{NSFontAttributeName: normalFont, NSParagraphStyleAttributeName: p, NSForegroundColorAttributeName: NSColor.blackColor};
    NSDictionary *bold = @{NSFontAttributeName: boldFont, NSParagraphStyleAttributeName: p, NSForegroundColorAttributeName: NSColor.blackColor};
    NSDictionary *rightNormal = @{NSFontAttributeName: normalFont, NSParagraphStyleAttributeName: pRight, NSForegroundColorAttributeName: NSColor.blackColor};

    NSMutableAttributedString *txt = [[NSMutableAttributedString alloc] init];

    for (NSString *line in (cfg[@"applicant_lines"] ?: @[])) appendLine(txt, line, normal);
    appendLine(txt, @"", normal);

    for (NSString *line in (cfg[@"recipient_lines"] ?: @[])) appendLine(txt, line, normal);
    appendLine(txt, @"", normal);

    if (cfg[@"date_line"]) appendLine(txt, cfg[@"date_line"], rightNormal);
    appendLine(txt, @"", normal);

    if (cfg[@"subject"]) appendLine(txt, cfg[@"subject"], bold);
    appendLine(txt, @"", normal);

    if (cfg[@"salutation"]) appendLine(txt, cfg[@"salutation"], normal);
    appendLine(txt, @"", normal);

    for (NSString *para in (cfg[@"paragraphs"] ?: @[])) {
      appendLine(txt, para, normal);
      appendLine(txt, @"", normal);
    }

    if (cfg[@"closing"]) appendLine(txt, cfg[@"closing"], normal);
    BOOL blankBeforeName = cfg[@"blank_line_before_name"] ? [cfg[@"blank_line_before_name"] boolValue] : YES;
    if (blankBeforeName) appendLine(txt, @"", normal);
    if (cfg[@"name_line"]) appendLine(txt, cfg[@"name_line"], normal);

    NSRect page = NSMakeRect(0, 0, 595.28, 841.89);
    CGFloat margin = layout[@"margin"] ? [layout[@"margin"] doubleValue] : 56.0;
    NSRect textRect = NSMakeRect(margin, margin, page.size.width - margin * 2.0, page.size.height - margin * 2.0);

    CoverView *view = [[CoverView alloc] initWithFrame:page];
    view.content = txt;
    view.textRect = textRect;
    view.signatureRect = NSMakeRect(56, 78, 170, 55);
    view.nameAttrs = @{NSFontAttributeName: normalFont, NSForegroundColorAttributeName: NSColor.blackColor};
    view.nameLine = cfg[@"name_line"] ?: @"";

    NSString *signaturePath = cfg[@"signature_path"];
    if (signaturePath.length > 0) {
      NSString *abs = pathJoin(outputDir, signaturePath);
      if ([[NSFileManager defaultManager] fileExistsAtPath:abs]) {
        view.signatureImage = [[NSImage alloc] initWithContentsOfFile:abs];
      }
    }

    NSString *coverPDF = pathJoin(outputDir, cfg[@"cover_pdf"] ?: @"Anschreiben.pdf");
    writeMultiPageCoverPDF(coverPDF, txt, page, textRect, view.signatureImage, view.signatureRect, view.nameLine, view.nameAttrs);

    NSArray *fullAttachments = cfg[@"attachments_full"] ?: @[];
    NSMutableArray *fullPaths = [NSMutableArray arrayWithObject:coverPDF];
    for (NSString *p0 in fullAttachments) [fullPaths addObject:pathJoin(outputDir, p0)];

    NSString *fullPDF = cfg[@"combined_pdf"] ? pathJoin(outputDir, cfg[@"combined_pdf"]) : nil;
    if (fullPDF) mergePDFs(fullPaths, fullPDF);

    NSArray *compactAttachments = cfg[@"attachments_compact"] ?: @[];
    if (cfg[@"compact_pdf"] && compactAttachments.count > 0) {
      NSMutableArray *compactPaths = [NSMutableArray arrayWithObject:coverPDF];
      for (NSString *p0 in compactAttachments) [compactPaths addObject:pathJoin(outputDir, p0)];
      mergePDFs(compactPaths, pathJoin(outputDir, cfg[@"compact_pdf"]));
    }

    printf("OK\n%s\n", coverPDF.UTF8String);
    if (fullPDF) printf("%s\n", fullPDF.UTF8String);
  }
  return 0;
}
