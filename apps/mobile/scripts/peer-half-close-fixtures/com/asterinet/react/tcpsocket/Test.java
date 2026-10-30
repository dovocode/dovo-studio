package com.asterinet.react.tcpsocket;
import java.net.*; import java.io.*; import java.util.*; import java.util.concurrent.*;
public class Test {
 public static void main(String[] args) throws Exception {
  boolean early=args.length>0;
  try (ServerSocket server=new ServerSocket(0,1,InetAddress.getLoopbackAddress()); Socket remote=new Socket(InetAddress.getLoopbackAddress(),server.getLocalPort()); Socket accepted=server.accept()) {
   remote.setSoTimeout(15000); TcpEventListener listener=new TcpEventListener(); TcpSocketClient client=new TcpSocketClient(listener,1,accepted); client.startListening();
   if (early) { remote.getOutputStream().write(new byte[]{1,2}); remote.shutdownOutput(); long limit=System.nanoTime()+TimeUnit.SECONDS.toNanos(5); while(!listener.ended && System.nanoTime()<limit) Thread.sleep(1); if(!listener.ended) throw new Exception("missing early EOF"); }
   byte[] chunk=new byte[65536]; Arrays.fill(chunk,(byte)0x5a); for(int i=0;i<32;i++) client.write(i,chunk); client.shutdownWrite();
   Thread.sleep(100); // Force queued writes before the peer begins reading.
   int n,total=0; byte[] b=new byte[8192]; while((n=remote.getInputStream().read(b))!=-1) { for(int i=0;i<n;i++) if (b[i]!=(byte)0x5a) throw new Exception("bad byte"); total+=n; }
   if(!early) { remote.getOutputStream().write(new byte[]{1,2}); remote.shutdownOutput(); }
   long limit=System.nanoTime()+TimeUnit.SECONDS.toNanos(5); while(!listener.closed && System.nanoTime()<limit) Thread.sleep(1);
   if(total!=32*65536 || !listener.ended || !listener.closed || listener.bytes!=2 || listener.error!=null) throw new Exception("failed total="+total+" ended="+listener.ended+" close="+listener.closed+" bytes="+listener.bytes+" error="+listener.error);
   System.out.println("PASS early="+early+" bytes="+total); System.exit(0);
  }
 }
}
