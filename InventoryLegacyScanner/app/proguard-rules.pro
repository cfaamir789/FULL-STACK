-keep class com.journeyapps.** { *; }
-keep class com.google.zxing.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

# Conscrypt — keep ALL classes and native methods
-keep class org.conscrypt.** { *; }
-keep class org.conscrypt.Conscrypt { *; }
-keep class org.conscrypt.ConscryptProvider { *; }
-dontwarn org.conscrypt.**
