-keep class com.journeyapps.** { *; }
-keep class com.google.zxing.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

# Conscrypt — no longer used but keep dontwarn
-dontwarn org.conscrypt.**

# BouncyCastle JCE + JSSE providers
-keep class org.bouncycastle.jce.provider.BouncyCastleProvider { *; }
-keep class org.bouncycastle.jsse.provider.BouncyCastleJsseProvider { *; }
-keep class org.bouncycastle.jsse.** { *; }
-keep class org.bouncycastle.tls.** { *; }
-dontwarn org.bouncycastle.**
