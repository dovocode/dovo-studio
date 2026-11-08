package com.asterinet.react.tcpsocket;
import android.content.Context; import com.facebook.react.bridge.ReadableMap; import java.net.Socket; import javax.net.ssl.SSLSocketFactory;
class ResolvableOption { ResolvableOption(String s, boolean b) {} }
class KeystoreInfo { KeystoreInfo(String a,String b,String c,String d) {} }
class SSLCertificateHelper {
 static SSLSocketFactory createCustomTrustedSocketFactory(Context c, ResolvableOption a, ResolvableOption b, ResolvableOption d, KeystoreInfo k) { return null; }
 static SSLSocketFactory createBlindSocketFactory() { return null; }
 static ReadableMap getCertificateInfo(Socket s, boolean peer) { return null; }
}
class TcpEventListener {
 volatile boolean ended, closed; volatile Exception error; int bytes;
 void onData(int id, byte[] data) { bytes+=data.length; }
 void onEnd(int id) { ended=true; }
 void onClose(int id, Exception error) { closed=true; this.error=error; }
 void onError(int id, Exception error) { this.error=error; }
 void onWritten(int id,int msg,Exception error) { if (error!=null) this.error=error; }
}
