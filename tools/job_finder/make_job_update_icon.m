#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>

static void drawIcon(CGFloat size, NSString *path) {
  NSImage *img = [[NSImage alloc] initWithSize:NSMakeSize(size, size)];
  [img lockFocus];

  NSRect r = NSMakeRect(0, 0, size, size);
  [[NSColor colorWithCalibratedRed:0.96 green:0.98 blue:1 alpha:1] setFill];
  NSRectFill(r);

  NSBezierPath *bg = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(r, size*0.08, size*0.08)
                                                     xRadius:size*0.22
                                                     yRadius:size*0.22];
  NSGradient *grad = [[NSGradient alloc] initWithStartingColor:[NSColor colorWithCalibratedRed:0.14 green:0.44 blue:0.96 alpha:1]
                                                    endingColor:[NSColor colorWithCalibratedRed:0.06 green:0.18 blue:0.55 alpha:1]];
  [grad drawInBezierPath:bg angle:-90];

  NSRect env = NSMakeRect(size*0.21, size*0.31, size*0.58, size*0.4);
  NSBezierPath *envBody = [NSBezierPath bezierPathWithRoundedRect:env xRadius:size*0.04 yRadius:size*0.04];
  [[NSColor whiteColor] setFill];
  [envBody fill];

  NSBezierPath *flap = [NSBezierPath bezierPath];
  [flap moveToPoint:NSMakePoint(NSMinX(env), NSMaxY(env))];
  [flap lineToPoint:NSMakePoint(NSMidX(env), NSMidY(env)+size*0.02)];
  [flap lineToPoint:NSMakePoint(NSMaxX(env), NSMaxY(env))];
  [flap closePath];
  [[NSColor colorWithCalibratedWhite:0.92 alpha:1] setFill];
  [flap fill];

  NSBezierPath *bolt = [NSBezierPath bezierPath];
  [bolt moveToPoint:NSMakePoint(size*0.63, size*0.78)];
  [bolt lineToPoint:NSMakePoint(size*0.53, size*0.58)];
  [bolt lineToPoint:NSMakePoint(size*0.62, size*0.58)];
  [bolt lineToPoint:NSMakePoint(size*0.52, size*0.36)];
  [bolt lineToPoint:NSMakePoint(size*0.68, size*0.58)];
  [bolt lineToPoint:NSMakePoint(size*0.58, size*0.58)];
  [bolt closePath];
  [[NSColor colorWithCalibratedRed:1 green:0.84 blue:0.2 alpha:1] setFill];
  [bolt fill];

  [img unlockFocus];

  CGImageRef cg = [img CGImageForProposedRect:NULL context:nil hints:nil];
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:cg];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  [png writeToFile:path atomically:YES];
}

int main(int argc, const char * argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      fprintf(stderr, "usage: make_job_update_icon <iconset_dir>\n");
      return 1;
    }
    NSString *dir = [NSString stringWithUTF8String:argv[1]];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];

    NSDictionary<NSString *, NSNumber *> *icons = @{
      @"icon_16x16.png": @16,
      @"icon_16x16@2x.png": @32,
      @"icon_32x32.png": @32,
      @"icon_32x32@2x.png": @64,
      @"icon_128x128.png": @128,
      @"icon_128x128@2x.png": @256,
      @"icon_256x256.png": @256,
      @"icon_256x256@2x.png": @512,
      @"icon_512x512.png": @512,
      @"icon_512x512@2x.png": @1024
    };

    for (NSString *name in icons) {
      drawIcon(icons[name].doubleValue, [dir stringByAppendingPathComponent:name]);
    }
  }
  return 0;
}
