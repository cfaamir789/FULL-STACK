-keep class com.journeyapps.** { *; }
-keep class com.google.zxing.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

# Conscrypt — no longer used but keep dontwarn
-dontwarn org.conscrypt.**

# BouncyCastle — keep ALL classes (JCE + JSSE + TLS + crypto internals).
# BC uses reflection-heavy SPI; stripping any class causes runtime crashes.
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**
