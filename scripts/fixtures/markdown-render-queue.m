#import <Foundation/Foundation.h>
#import <stdatomic.h>
#import "ENRMAsyncRenderCoordinator.h"

static atomic_int livePayloads;
static atomic_int renders;
static atomic_int applies;

@interface RenderPayload : NSObject
@property (nonatomic) NSData *bytes;
@end
@implementation RenderPayload
- (instancetype)init
{
  if (self = [super init]) {
    atomic_fetch_add(&livePayloads, 1);
    _bytes = [NSMutableData dataWithLength:32768];
  }
  return self;
}
- (void)dealloc { atomic_fetch_sub(&livePayloads, 1); }
@end

static void check(BOOL condition, NSString *message)
{
  if (!condition) {
    NSLog(@"FAIL: %@", message);
    exit(1);
  }
}

static void waitFor(BOOL (^ready)(void))
{
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (!ready() && deadline.timeIntervalSinceNow > 0) {
    @autoreleasepool {
      [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
    }
  }
  check(ready(), @"Native worker did not finish");
}

int main(void)
{
  @autoreleasepool {
    ENRMAsyncRenderCoordinator *worker = [[ENRMAsyncRenderCoordinator alloc] initWithQueueLabel:"dovo.render.test"];
    dispatch_semaphore_t entered = dispatch_semaphore_create(0);
    dispatch_semaphore_t release = dispatch_semaphore_create(0);
    [worker scheduleRender:^BOOL {
      atomic_fetch_add(&renders, 1);
      dispatch_semaphore_signal(entered);
      dispatch_semaphore_wait(release, DISPATCH_TIME_FOREVER);
      return YES;
    } apply:^{ atomic_fetch_add(&applies, 1); }];
    check(dispatch_semaphore_wait(entered, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC * 5)) == 0,
          @"First render did not start");
    __block int latest = -1;
    for (int index = 0; index < 5000; index++) {
      @autoreleasepool {
        RenderPayload *payload = [[RenderPayload alloc] init];
        [worker scheduleRender:^BOOL {
          check(payload.bytes.length == 32768, @"Lost render payload");
          atomic_fetch_add(&renders, 1);
          return YES;
        } apply:^{
          latest = index;
          atomic_fetch_add(&applies, 1);
        }];
      }
    }
    check(atomic_load(&livePayloads) == 1, @"Obsolete streamed replies are retained");
    dispatch_semaphore_signal(release);
    waitFor(^BOOL { return latest == 4999 && atomic_load(&livePayloads) == 0; });
    check(atomic_load(&renders) == 2, @"Obsolete replies were parsed");
    check(atomic_load(&applies) == 1, @"Stale reply applied");

    [worker scheduleRender:^BOOL {
      dispatch_semaphore_signal(entered);
      dispatch_semaphore_wait(release, DISPATCH_TIME_FOREVER);
      return YES;
    } apply:^{ atomic_fetch_add(&applies, 1); }];
    check(dispatch_semaphore_wait(entered, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC * 5)) == 0,
          @"Recycle render did not start");
    [worker scheduleRender:^BOOL {
      atomic_fetch_add(&renders, 1);
      return YES;
    } apply:^{ atomic_fetch_add(&applies, 1); }];
    [worker invalidate];
    dispatch_semaphore_signal(release);
    [worker scheduleRender:^BOOL { return YES; } apply:^{ latest = 5000; }];
    waitFor(^BOOL { return latest == 5000; });
    check(atomic_load(&renders) == 2 && atomic_load(&applies) == 1,
          @"Recycled view received obsolete work");
    worker.blockAsyncRender = YES;
    [worker scheduleRender:^BOOL { return YES; } apply:^{ latest = 5001; }];
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    check(latest == 5000, @"Synchronous renderer received async work");
    puts("PASS: 5,000 streamed updates retain one pending reply; only latest renders; recycle and synchronous cancellation pass");
  }
  return 0;
}
