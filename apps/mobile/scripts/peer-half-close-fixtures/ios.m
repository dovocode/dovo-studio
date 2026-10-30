#import <Foundation/Foundation.h>
#import "TcpSocketClient.h"
#import <sys/socket.h>
#import <arpa/inet.h>
#import <unistd.h>
#import <stdatomic.h>

@interface Harness : NSObject <SocketClientDelegate>
@property(nonatomic, strong) TcpSocketClient *server;
@property(nonatomic, strong) TcpSocketClient *client;
@property(nonatomic, strong) NSMutableDictionary *clients;
@property(nonatomic, assign) BOOL early;
@property(nonatomic, assign) BOOL ended;
@property(nonatomic, assign) BOOL closed;
@property(nonatomic, assign) BOOL failed;
@property(nonatomic, assign) NSUInteger received;
@end
@implementation Harness
- (NSNumber *)getNextId { return @2; }
- (void)addClient:(TcpSocketClient *)client { self.client=client; self.clients[client.id]=client; }
- (void)onConnect:(TcpSocketClient *)c {}
- (void)onListen:(TcpSocketClient *)c {}
- (void)onConnection:(TcpSocketClient *)client toClient:(NSNumber *)server {
    if (!self.early) [self send];
}
- (void)send {
    NSMutableData *data=[NSMutableData dataWithLength:65536];
    memset(data.mutableBytes, 0x5a, data.length);
    for (int i=0;i<32;i++) [self.client writeData:data msgId:@(i+1)];
    [self.client shutdownWrite];
}
- (void)onSecureConnection:(TcpSocketClient *)c toClient:(NSNumber *)server {}
- (void)onData:(NSNumber *)clientID data:(NSData *)data { self.received += data.length; }
- (void)onEnd:(NSNumber *)clientID { self.ended=YES; if (self.early) [self send]; }
- (void)onClose:(NSNumber *)clientID withError:(NSError *)err { self.closed=YES; if (err) self.failed=YES; }
- (void)onError:(TcpSocketClient *)client withError:(NSError *)err { NSLog(@"ERROR %@", err); self.failed=YES; }
- (void)onWrittenData:(TcpSocketClient *)client msgId:(NSNumber *)msgId {}
@end

int main(int argc, char **argv) { @autoreleasepool {
    Harness *h=[Harness new]; h.clients=[NSMutableDictionary new]; h.early=argc>1;
    h.server=[TcpSocketClient socketClientWithId:@1 andConfig:h];
    NSError *error=nil;
    if (![h.server listen:@{@"host":@"127.0.0.1", @"port":@0, @"allowHalfOpen":@YES} error:&error]) { NSLog(@"listen %@", error); return 1; }
    int port=[h.server.getAddress[@"port"] intValue];
    __block int remoteResult=-1;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT,0), ^{
        int fd=socket(AF_INET,SOCK_STREAM,0); struct sockaddr_in a={0}; a.sin_family=AF_INET; a.sin_port=htons(port); a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
        if (connect(fd,(struct sockaddr *)&a,sizeof(a))) { remoteResult=1; return; }
        if (h.early) { write(fd,"in",2); shutdown(fd,SHUT_WR); }
        // Force the native writes to queue before the peer drains the socket.
        usleep(100000);
        char buf[8192]; ssize_t n; size_t total=0; int valid=1;
        while ((n=read(fd,buf,sizeof(buf)))>0) { for (ssize_t i=0;i<n;i++) if (buf[i]!=0x5a) valid=0; total+=(size_t)n; }
        if (!h.early) { write(fd,"in",2); shutdown(fd,SHUT_WR); }
        close(fd); remoteResult=(n==0 && valid && total==32*65536) ? 0 : 2;
    });
    NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:15];
    while ((!h.closed || remoteResult<0) && !h.failed && deadline.timeIntervalSinceNow>0) [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    BOOL ok=h.closed && h.ended && h.received==2 && !h.failed && remoteResult==0;
    NSLog(@"%@ early=%d end=%d close=%d read=%lu remote=%d",ok?@"PASS":@"FAIL",h.early,h.ended,h.closed,(unsigned long)h.received,remoteResult);
    [h.server destroy]; return ok?0:1;
} }
